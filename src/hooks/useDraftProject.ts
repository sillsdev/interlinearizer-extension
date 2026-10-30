import papi, { logger } from '@papi/frontend';
import type {
  DraftProject,
  InterlinearProject,
  SegmentationDelta,
  TextAnalysis,
} from 'interlinearizer';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EditStep, StepSummary } from '../types/edit-step';
import { emptyAnalysis, emptyDraft } from '../types/empty-factories';
import { CURRENT_MODEL_VERSION } from '../types/model-version';
import { restoreBookInAnalysis, restoreBookInSegmentation } from '../utils/analysis-book';
import { DebouncedWriter } from '../utils/debounced-writer';
import { perfTime, perfTrack } from '../utils/perf-marks';
import { isEmptyDelta } from '../utils/segmentation';
import {
  canRedo as historyCanRedo,
  canUndo as historyCanUndo,
  emptyHistory,
  recordBookPass,
  recordStep,
  redo as redoStep,
  undo as undoStep,
  type BookPass,
  type HistoryMove,
  type UndoHistory,
} from '../utils/undo-history';

/** Milliseconds to wait after the last keystroke before flushing an autosave write. */
const AUTOSAVE_DEBOUNCE_MS = 300;

/**
 * Whether a copy of the draft into a project landed, `'partial'` when it left part of the draft
 * out.
 */
export type DraftCopyResult = boolean | 'partial';

/** The part of a draft its undo history covers. */
export type DraftContent = Readonly<{
  analysis: TextAnalysis;
  segmentation: SegmentationDelta | undefined;
}>;

function contentOf(draft: DraftProject): DraftContent {
  return { analysis: draft.analysis, segmentation: draft.segmentation };
}

function sameContent(a: DraftContent, b: DraftContent): boolean {
  return a.analysis === b.analysis && a.segmentation === b.segmentation;
}

/** Whether `content` holds no analysis and no custom segment boundaries. */
function isEmptyContent({ analysis, segmentation }: DraftContent): boolean {
  return (
    Object.values(analysis).every((records) => records.length === 0) && isEmptyDelta(segmentation)
  );
}

/** Returns `draft` holding `content`, marked `dirty` or not. */
function withContent(
  draft: DraftProject,
  { analysis, segmentation }: DraftContent,
  dirty: boolean,
): DraftProject {
  const next: DraftProject = { ...draft, analysis, dirty };
  if (segmentation !== undefined) next.segmentation = segmentation;
  else delete next.segmentation;
  return next;
}

const memoizedPasses = new WeakMap<BookPass<DraftContent>, BookPass<DraftContent>>();

/**
 * Returns `pass` answering each analysis and boundary delta pair with one result, however often
 * run, and the same function for the same `pass`.
 */
function memoizePass(pass: BookPass<DraftContent>): BookPass<DraftContent> {
  const cached = memoizedPasses.get(pass);
  if (cached) return cached;
  const results = new WeakMap<TextAnalysis, Map<SegmentationDelta | undefined, DraftContent>>();
  const memoized: BookPass<DraftContent> = (content) => {
    let bySegmentation = results.get(content.analysis);
    if (!bySegmentation) {
      bySegmentation = new Map();
      results.set(content.analysis, bySegmentation);
    }
    let result = bySegmentation.get(content.segmentation);
    if (!result) {
      result = pass(content);
      bySegmentation.set(content.segmentation, result);
    }
    return result;
  };
  memoizedPasses.set(pass, memoized);
  return memoized;
}

/** An action whose edits are being gathered into one undo step. */
type StepGroup = {
  /** The action's first edit: the content before it, and where it was made. */
  edit?: { before: DraftContent; location?: string };
};

/** The subset of an {@link InterlinearProject} needed to open it into the draft as a working copy. */
export type OpenableProject = Pick<
  InterlinearProject,
  'analysis' | 'analysisLanguages' | 'targetProjectId' | 'segmentation'
>;

/** Configuration for starting a fresh, empty draft via {@link UseDraftProjectResult.newDraft}. */
export type NewDraftConfig = {
  /** BCP 47 tags for the gloss / annotation languages the new draft should use. */
  analysisLanguages: string[];
  /** Name typed in the New dialog, retained to prefill Save As; omitted when left blank. */
  suggestedName?: string;
  /** Description typed in the New dialog, retained to prefill Save As; omitted when left blank. */
  suggestedDescription?: string;
};

/** Return value of {@link useDraftProject}. */
export type UseDraftProjectResult = {
  /** True while the initial draft load is in flight; gates rendering the editor. */
  isDraftLoading: boolean;
  /**
   * The current draft envelope — the source of truth for the analysis and config being edited — or
   * `undefined` while the initial load is in flight.
   */
  draft: DraftProject | undefined;
  /**
   * Monotonic counter bumped on every wholesale analysis replacement (New / Open / Discard).
   * Include it in the editor's React `key` so the analysis store reseeds from the new draft;
   * per-edit auto-saves deliberately do not bump it, so editing never remounts the editor.
   */
  draftVersion: number;
  /**
   * Monotonic counter bumped on every change to the draft's segment-boundary delta (per-edit
   * auto-saves included). Unlike {@link UseDraftProjectResult.draftVersion} it is deliberately kept
   * out of the editor's remount key: the resegmented book is derived from `draft.segmentation`,
   * which lives in a ref, so a boundary edit needs a re-render to recompute the book — but must not
   * remount the editor (that would drop analysis-edit, scroll, and focus state). Consumers thread
   * this into the memo that resegments the book so the new boundaries take effect in place.
   */
  segmentationVersion: number;
  /**
   * Whether the draft has diverged from its active project since the last Save / Save As / Open /
   * New. Drives the discard confirmation and the tab's unsaved-changes indicator.
   */
  dirty: boolean;
  /**
   * Returns the draft as of the moment of the call, including edits that auto-saved without a
   * re-render; {@link UseDraftProjectResult.draft} is only current as of the last render.
   * `undefined` before the initial load completes.
   */
  getDraftSnapshot: () => DraftProject | undefined;
  /**
   * True while {@link UseDraftProjectResult.commitDraft} runs. Wholesale replacements (New / Open /
   * Discard) must be held off while it is, so the draft being saved stays the one the save copies.
   */
  isSaving: boolean;
  /**
   * Saves the draft to a project: once the draft's writes have settled, passes the draft as it then
   * stands to `copy`, which copies the stored draft into a project and resolves whether the copy
   * landed. When it landed whole, the draft is marked synced unless an edit landed meanwhile; a
   * partial copy leaves it unsaved. Resolves whether the copy landed, or `false` without copying
   * when no draft has loaded, when another save is in flight, or when the draft was replaced while
   * its writes settled.
   *
   * @throws If a draft write fails, so the stored draft lags the one in memory; the draft stays
   *   dirty and nothing is copied.
   * @throws Whatever `copy` throws; the draft stays dirty.
   */
  commitDraft: (copy: (snapshot: DraftProject) => Promise<DraftCopyResult>) => Promise<boolean>;
  /**
   * Persists an edited analysis into the draft and marks it dirty, recording `location` — the token
   * ref or segment id the edit was made at, if one place — for its undo step. Wire as the editor's
   * `onSaveAnalysis`.
   */
  autosaveAnalysis: (analysis: TextAnalysis, location?: string) => void;
  /**
   * Persists an edited segment-boundary delta into the draft and marks it dirty, recording
   * `location` — the token ref the boundary edit was made at — for its undo step. Pass `undefined`
   * (or a default/empty delta) to clear custom boundaries back to the default verse segmentation.
   */
  autosaveSegmentation: (segmentation: SegmentationDelta | undefined, location?: string) => void;
  /**
   * Replaces the draft with a working copy of an existing project's analysis and config — the
   * "Open" flow.
   */
  loadFromProject: (project: OpenableProject) => void;
  /**
   * Starts a fresh, empty draft for the current source — the "New" flow. Seeds the chosen analysis
   * languages and retains the typed name/description as `suggestedName`/`suggestedDescription`. The
   * new draft is clean (`dirty: false`), so the unsaved-changes indicator stays clear until the
   * first edit. The caller is responsible for immediately persisting the project to the backend.
   */
  newDraft: (config: NewDraftConfig) => void;
  /**
   * Discards one book's unsaved changes, by 3-letter book code: resets its analysis and boundaries
   * to those in `saved`, or removes them when `saved` is absent. With `saved`, the draft stays as
   * dirty as it was. Without `saved`, the draft is marked dirty.
   */
  discardBook: (bookCode: string, saved?: DraftContent) => void;
  /**
   * Discards the draft's unsaved changes: resets its analysis and boundaries to those in `saved`,
   * or empties them when `saved` is absent. Marks the draft clean. Keeps its languages and
   * alignment target.
   */
  discardAll: (saved?: DraftContent) => void;
  /**
   * Records that the project the draft saves to was deleted. Marks the draft unsaved unless it is
   * empty, so nothing it holds is replaced without asking. Settles once the draft has loaded, any
   * save in progress has finished, and the draft has been marked.
   */
  detachFromProject: () => Promise<void>;
  canUndo: boolean;
  canRedo: boolean;
  /**
   * Reads the history's revision, which changes whenever a step is recorded, undone, or redone, or
   * the history is cleared, and at no other time.
   */
  getHistoryRevision: () => number;
  /**
   * Registers `listener` to hear each change of the history's revision, without re-rendering.
   *
   * @returns A function that unregisters the listener.
   */
  subscribeToHistoryRevisions: (listener: () => void) => () => void;
  /**
   * Returns the draft's content to how it stood before the latest undo step.
   *
   * @returns The step undone, or `undefined` when there was nothing to undo.
   */
  undo: () => EditStep | undefined;
  /**
   * Reapplies the most recently undone step.
   *
   * @returns The step redone, or `undefined` when there was nothing to redo.
   */
  redo: () => EditStep | undefined;
  /**
   * Runs `action`, recording every edit it auto-saves as one undo step, summarized as given or as
   * derived from the action's result.
   */
  asOneStep: <T>(action: () => T, summary?: StepSummary | ((result: T) => StepSummary)) => T;
  /**
   * Runs `pass` over the draft's content to re-anchor it to the book `bookCode` names. Bookkeeping
   * rather than an edit: never an undo step, never undone, and never what dirties the draft.
   */
  reanchorBook: (bookCode: string, pass: BookPass<DraftContent>) => void;
  /**
   * Registers `listener` to receive each analysis the draft takes from somewhere other than the
   * analysis store's own edits.
   *
   * @returns A function that unregisters the listener.
   */
  subscribeToAnalysisReplacements: (listener: (analysis: TextAnalysis) => void) => () => void;
};

/**
 * Owns the always-present, auto-saved draft for one source project. Loads the draft on mount, seeds
 * a gloss language when none is stored, and exposes callbacks to auto-save edits, to undo and redo
 * them, and to replace the draft wholesale (New / Open / Discard).
 *
 * The full draft lives in a ref — the synchronous source of truth for persistence and Save — while
 * a small amount of state (`isDraftLoading`, `draftVersion`, `dirty`) drives re-renders, so
 * per-edit auto-saves never re-render the loader unless the dirty flag actually flips.
 *
 * @param sourceProjectId - The Platform.Bible source project whose draft to manage.
 * @param platformLanguage - BCP 47 tag that seeds a brand-new source's analysis languages, or
 *   `undefined` while the tag is still loading. A brand-new source's draft stays loading until the
 *   tag is known.
 */
export default function useDraftProject(
  sourceProjectId: string,
  platformLanguage: string | undefined,
): UseDraftProjectResult {
  const draftRef = useRef<DraftProject | undefined>(undefined);
  const [isDraftLoading, setIsDraftLoading] = useState(true);
  // Settles with the draft the latest load published, or `undefined` when that load was canceled.
  const draftLoadedRef = useRef<Promise<DraftProject | undefined>>(Promise.resolve(undefined));
  const [draftVersion, setDraftVersion] = useState(0);
  const [segmentationVersion, setSegmentationVersion] = useState(0);
  const [dirty, setDirty] = useState(false);
  const historyRef = useRef<UndoHistory<DraftContent, EditStep>>(emptyHistory());
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  // The history states that read clean: the one the draft last started from or was saved at, and
  // any discard since that left it clean.
  const cleanStatesRef = useRef(new Set<number>());
  const replacementListenersRef = useRef(new Set<(analysis: TextAnalysis) => void>());
  const historyRevisionRef = useRef(0);
  const revisionListenersRef = useRef(new Set<() => void>());
  const setHistory = useCallback((next: UndoHistory<DraftContent, EditStep>) => {
    const previous = historyRef.current;
    historyRef.current = next;
    if (
      next.past.at(-1) !== previous.past.at(-1) ||
      next.future.at(-1) !== previous.future.at(-1)
    ) {
      historyRevisionRef.current += 1;
      revisionListenersRef.current.forEach((listener) => listener());
    }
    setCanUndo(historyCanUndo(next));
    setCanRedo(historyCanRedo(next));
  }, []);
  const stepGroupRef = useRef<StepGroup | undefined>(undefined);

  // Read the latest platform language via a ref so the load effect (keyed on sourceProjectId)
  // does not re-run when the UI language changes after the draft has loaded.
  const platformLanguageRef = useRef(platformLanguage);
  platformLanguageRef.current = platformLanguage;
  // Settles with the first platform language known. A load that needs a language waits on it.
  const [platformLanguageKnown] = useState(() => Promise.withResolvers<string>());
  if (platformLanguage !== undefined) platformLanguageKnown.resolve(platformLanguage);

  // Whether the draft has been started over (New, Open) since it loaded, so the host may discard
  // stored analysis it could not read. Every later write says so too: discarding again is harmless,
  // so a write that fails needs no retry of its own.
  const startedOverRef = useRef(false);

  // Every change to the draft ref goes through this writer, so settling it is what makes the
  // stored draft the one in memory. The backend notifies the user of a failed write; here it is
  // only logged, since the writer never throws into a render or event handler. The `dirty` flag
  // is set before the write, not in response to its outcome.
  const writer = useMemo(
    () =>
      new DebouncedWriter<DraftProject>({
        write: (draft) => {
          const json = perfTime('autosave-serialize', () => JSON.stringify(draft));
          return perfTrack(
            'autosave',
            startedOverRef.current
              ? papi.commands.sendCommand('interlinearizer.saveDraft', sourceProjectId, json, true)
              : papi.commands.sendCommand('interlinearizer.saveDraft', sourceProjectId, json),
            { bytes: json.length },
          );
        },
        delayMs: AUTOSAVE_DEBOUNCE_MS,
        onFailure: (e) => logger.error('Interlinearizer: failed to save draft', e),
      }),
    [sourceProjectId],
  );

  const [isSaving, setIsSaving] = useState(false);
  const isSavingRef = useRef(false);
  // Settles once the save in progress, if any, has finished, whether or not it saved.
  const saveSettledRef = useRef<Promise<void>>(Promise.resolve());
  // Counts wholesale replacements, so a save can tell whether one landed while its writes settled.
  const replacementCountRef = useRef(0);

  useEffect(() => {
    let canceled = false;
    startedOverRef.current = false;
    setIsDraftLoading(true);
    setHistory(emptyHistory());

    /**
     * Loads the stored draft for the source (falling back to an empty draft on failure), seeds a
     * gloss language when none is present, and publishes it to the ref and state. A replacement
     * that lands while the load waits wins over the stored draft.
     *
     * @returns The draft published, the replacement that won over it, or `undefined` when the load
     *   was canceled first.
     */
    const load = async (): Promise<DraftProject | undefined> => {
      const replacements = replacementCountRef.current;
      let draft: DraftProject;
      try {
        const json = await perfTrack(
          'draft-fetch',
          papi.commands.sendCommand('interlinearizer.getDraft', sourceProjectId),
        );
        draft = perfTime('draft-parse', () => JSON.parse(json), { bytes: json.length });
      } catch (e) {
        logger.error('Interlinearizer: failed to load draft', e);
        draft = emptyDraft(sourceProjectId);
      }
      if (canceled) return undefined;

      // Seed a gloss language in memory when the stored draft has none (a brand-new source). Not
      // persisted here — the first auto-save / New / Open carries it to storage.
      if (draft.analysisLanguages.length === 0) {
        const firstKnown = await platformLanguageKnown.promise;
        if (canceled) return undefined;
        draft = { ...draft, analysisLanguages: [platformLanguageRef.current ?? firstKnown] };
      }
      // A New or Open while the load waited already replaced the draft; the stored one is older.
      if (replacementCountRef.current !== replacements) {
        setIsDraftLoading(false);
        return draftRef.current;
      }
      draftRef.current = draft;
      cleanStatesRef.current = new Set(draft.dirty ? [] : [historyRef.current.state]);
      setDirty(draft.dirty);
      setIsDraftLoading(false);
      return draft;
    };

    draftLoadedRef.current = load();
    return () => {
      canceled = true;
      // The last edit before unmount or a source change is written rather than lost.
      writer.flush();
    };
  }, [writer, setHistory, sourceProjectId, platformLanguageKnown]);

  const getDraftSnapshot = useCallback(() => draftRef.current, []);

  const getHistoryRevision = useCallback(() => historyRevisionRef.current, []);

  const subscribeToHistoryRevisions = useCallback((listener: () => void) => {
    revisionListenersRef.current.add(listener);
    return () => {
      revisionListenersRef.current.delete(listener);
    };
  }, []);

  /**
   * Applies a wholesale draft replacement, keeping `history` as its undo history: update the ref,
   * persist, refresh `dirty`, and bump the remount counter so the editor reseeds.
   */
  const applyReplacement = useCallback(
    (next: DraftProject, history: UndoHistory<DraftContent, EditStep>) => {
      draftRef.current = next;
      replacementCountRef.current += 1;
      setHistory(history);
      // A fresh history numbers its states anew, voiding the clean states of the one it replaces.
      if (history.stateCount === 0) cleanStatesRef.current.clear();
      if (!next.dirty) cleanStatesRef.current.add(history.state);
      // Written at once, dropping any scheduled keystroke write of the draft replaced.
      writer.writeNow(next);
      setDirty(next.dirty);
      setDraftVersion((v) => v + 1);
    },
    [writer, setHistory],
  );

  /**
   * Swaps `next` into the ref, debounces the persistence write, and publishes its dirty flag. There
   * is no version bump and so no remount, and republishing an unchanged flag is a no-op, so writing
   * does not re-render.
   */
  const writeDraft = useCallback(
    (next: DraftProject) => {
      draftRef.current = next;
      // Debounced so rapid keystrokes do not queue unbounded commands to the backend.
      writer.schedule(next);
      setDirty(next.dirty);
    },
    [writer],
  );

  /**
   * Shared per-edit auto-save pipeline: writes the mutated draft and records the edit in the undo
   * history.
   *
   * @param mutate - Produces the next draft from the current one; must set `dirty: true`.
   * @param location - Where the edit was made, if at one place.
   * @returns `true` when the edit was applied; `false` when no draft has loaded yet or the edit
   *   changes nothing.
   */
  const autosaveDraft = useCallback(
    (mutate: (current: DraftProject) => DraftProject, location: string | undefined): boolean => {
      const { current } = draftRef;
      /* v8 ignore next -- auto-save only fires from the mounted editor, which exists only post-load */
      if (!current) return false;

      const next = mutate(current);
      if (sameContent(contentOf(next), contentOf(current))) return false;
      const group = stepGroupRef.current;
      if (!group) setHistory(recordStep(historyRef.current, contentOf(current), { location }));
      else group.edit ??= { before: contentOf(current), location };
      writeDraft(next);
      return true;
    },
    [writeDraft, setHistory],
  );

  const autosaveAnalysis = useCallback(
    (analysis: TextAnalysis, location?: string) => {
      autosaveDraft((current) => ({ ...current, analysis, dirty: true }), location);
    },
    [autosaveDraft],
  );

  const autosaveSegmentation = useCallback(
    (segmentation: SegmentationDelta | undefined, location?: string) => {
      // Treat the default segmentation (undefined or a delta with both arrays empty) the same as
      // `undefined`: clear the field rather than persisting a redundant custom object.
      const hasCustomBoundaries = !isEmptyDelta(segmentation);
      const applied = autosaveDraft((current) => {
        const next: DraftProject = { ...current, dirty: true };
        // Store custom boundaries when present; clear the field for the default segmentation so the
        // persisted draft stays minimal.
        if (hasCustomBoundaries && segmentation !== undefined) next.segmentation = segmentation;
        else delete next.segmentation;
        return next;
      }, location);
      if (!applied) return;
      // The resegmented book is derived from `draftRef.current.segmentation`, which lives in a ref;
      // `setDirty(true)` bails out of the re-render when the draft was already dirty, so bump a
      // dedicated version to force the loader to re-read the boundaries and recompute the book.
      setSegmentationVersion((v) => v + 1);
    },
    [autosaveDraft],
  );

  const loadFromProject = useCallback(
    (project: OpenableProject) => {
      startedOverRef.current = true;
      applyReplacement(
        {
          sourceProjectId,
          modelVersion: CURRENT_MODEL_VERSION,
          analysisLanguages: project.analysisLanguages,
          ...(project.targetProjectId !== undefined && {
            targetProjectId: project.targetProjectId,
          }),
          ...(project.segmentation !== undefined && { segmentation: project.segmentation }),
          analysis: project.analysis,
          dirty: false,
        },
        emptyHistory(),
      );
    },
    [applyReplacement, sourceProjectId],
  );

  const newDraft = useCallback(
    (config: NewDraftConfig) => {
      startedOverRef.current = true;
      applyReplacement(
        {
          sourceProjectId,
          modelVersion: CURRENT_MODEL_VERSION,
          analysisLanguages: config.analysisLanguages,
          ...(config.suggestedName !== undefined && { suggestedName: config.suggestedName }),
          ...(config.suggestedDescription !== undefined && {
            suggestedDescription: config.suggestedDescription,
          }),
          analysis: emptyAnalysis(),
          dirty: false,
        },
        emptyHistory(),
      );
    },
    [applyReplacement, sourceProjectId],
  );

  const discardBook = useCallback(
    (bookCode: string, saved?: DraftContent) => {
      const { current } = draftRef;
      /* v8 ignore next -- discarding is only reachable from the mounted editor */
      if (!current) return;

      const restored: DraftContent = {
        analysis: restoreBookInAnalysis(current.analysis, saved?.analysis, bookCode),
        segmentation: restoreBookInSegmentation(
          current.segmentation,
          saved?.segmentation,
          bookCode,
        ),
      };
      // Other books may still differ from the saved project.
      // Without one, nothing they hold is saved.
      applyReplacement(
        withContent(current, restored, saved ? current.dirty : true),
        recordStep(historyRef.current, contentOf(current), {
          summary: { kind: 'discardBook', book: bookCode },
        }),
      );
    },
    [applyReplacement],
  );

  const discardAll = useCallback(
    (saved?: DraftContent) => {
      const { current } = draftRef;
      /* v8 ignore next -- discarding is only reachable from the mounted editor */
      if (!current) return;

      applyReplacement(
        withContent(
          current,
          saved ?? { analysis: emptyAnalysis(), segmentation: undefined },
          false,
        ),
        recordStep(historyRef.current, contentOf(current), { summary: { kind: 'discardAll' } }),
      );
    },
    [applyReplacement],
  );

  const detachFromProject = useCallback(async () => {
    // A draft still loading is detached once it loads. A canceled load gave way to another source's
    // draft, which the deleted project never held.
    const loaded = await draftLoadedRef.current;
    if (!loaded) return;
    // A save that finishes after the delete would mark the draft synced; detaching after it wins.
    await saveSettledRef.current;
    const { current } = draftRef;
    /* v8 ignore next -- a load that published a draft set the ref */
    if (!current) return;

    // Each history state that reads clean matched the deleted project, so none stays clean. Only an
    // empty draft has nothing to lose.
    const empty = isEmptyContent(contentOf(current));
    const clean = empty && !current.dirty;
    cleanStatesRef.current = new Set(clean ? [historyRef.current.state] : []);
    if (!empty && !current.dirty) writeDraft({ ...current, dirty: true });
  }, [writeDraft]);

  /**
   * Marks the draft synced once `saved` has been copied into a project, unless an edit landed
   * meanwhile: then the draft stays dirty, so the indicator and the next Save reflect that edit. An
   * edit made and undone during the save leaves the draft synced in memory, though the stored draft
   * may still reopen marked unsaved.
   */
  const markSynced = useCallback((saved: DraftProject) => {
    const { current } = draftRef;
    /* v8 ignore next -- a save runs only once the draft has loaded */
    if (!current) return;

    // An edit during the save swaps a fresh analysis or boundary delta into the ref. Both are
    // compared: a boundary edit carries `analysis` over by reference.
    if (current.analysis !== saved.analysis || current.segmentation !== saved.segmentation) return;

    draftRef.current = { ...current, dirty: false };
    cleanStatesRef.current = new Set([historyRef.current.state]);
    setDirty(false);
  }, []);

  const commitDraft = useCallback(
    async (copy: (snapshot: DraftProject) => Promise<DraftCopyResult>): Promise<boolean> => {
      /* v8 ignore next -- a save is only reachable once the draft has loaded */
      if (!draftRef.current) return false;
      if (isSavingRef.current) return false;
      isSavingRef.current = true;
      setIsSaving(true);
      const { promise: saveSettled, resolve: saveFinished } = Promise.withResolvers<void>();
      saveSettledRef.current = saveSettled;
      try {
        const replacements = replacementCountRef.current;
        await writer.settle();
        // Settled, so storage holds the draft the ref holds now, edits during the wait included,
        // less any analysis the host left out for a book it could not read.
        const snapshot = draftRef.current;
        if (replacementCountRef.current !== replacements) {
          logger.warn(
            'Interlinearizer: the draft was replaced during a save, so nothing was saved',
          );
          return false;
        }
        const copied = await copy(snapshot);
        if (copied === true) markSynced(snapshot);
        return copied !== false;
      } finally {
        isSavingRef.current = false;
        setIsSaving(false);
        saveFinished();
      }
    },
    [markSynced, writer],
  );

  /**
   * Writes content that did not come from the analysis store's own edits, bringing the store and
   * the boundary consumers along with it.
   */
  const replaceContent = useCallback(
    (current: DraftProject, content: DraftContent, isDirty: boolean) => {
      writeDraft(withContent(current, content, isDirty));
      if (content.analysis !== current.analysis)
        replacementListenersRef.current.forEach((listener) => listener(content.analysis));
      if (content.segmentation !== current.segmentation) setSegmentationVersion((v) => v + 1);
    },
    [writeDraft],
  );

  /**
   * Moves through the undo history, bringing the draft and its analysis store to the content moved
   * to, and returns the step moved through.
   */
  const moveThroughHistory = useCallback(
    (
      step: (
        history: UndoHistory<DraftContent, EditStep>,
        present: DraftContent,
      ) => HistoryMove<DraftContent, EditStep> | undefined,
    ): EditStep | undefined => {
      const { current } = draftRef;
      /* v8 ignore next -- undo and redo are unavailable until the draft loads */
      if (!current) return undefined;
      const move = step(historyRef.current, contentOf(current));
      if (!move) return undefined;
      setHistory(move.history);
      replaceContent(current, move.content, !cleanStatesRef.current.has(move.history.state));
      return move.step;
    },
    [replaceContent, setHistory],
  );

  const undo = useCallback(() => moveThroughHistory(undoStep), [moveThroughHistory]);

  const redo = useCallback(() => moveThroughHistory(redoStep), [moveThroughHistory]);

  const reanchorBook = useCallback(
    (bookCode: string, pass: BookPass<DraftContent>) => {
      const { current } = draftRef;
      /* v8 ignore next -- books are re-anchored only once the draft has loaded */
      if (!current) return;
      const memoized = memoizePass(pass);
      setHistory(recordBookPass(historyRef.current, bookCode, memoized));
      const before = contentOf(current);
      const after = memoized(before);
      // Re-anchoring is bookkeeping rather than an edit, so it leaves the draft as dirty as it was.
      if (!sameContent(after, before)) replaceContent(current, after, current.dirty);
    },
    [replaceContent, setHistory],
  );

  const asOneStep = useCallback(
    <T>(action: () => T, summary?: StepSummary | ((result: T) => StepSummary)): T => {
      const group: StepGroup = {};
      stepGroupRef.current = group;
      try {
        const result = action();
        if (group.edit) {
          const { before, location } = group.edit;
          const described = typeof summary === 'function' ? summary(result) : summary;
          setHistory(recordStep(historyRef.current, before, { location, summary: described }));
        }
        return result;
      } finally {
        stepGroupRef.current = undefined;
      }
    },
    [setHistory],
  );

  const subscribeToAnalysisReplacements = useCallback(
    (listener: (analysis: TextAnalysis) => void) => {
      replacementListenersRef.current.add(listener);
      return () => {
        replacementListenersRef.current.delete(listener);
      };
    },
    [],
  );

  return {
    isDraftLoading,
    draft: draftRef.current,
    draftVersion,
    segmentationVersion,
    dirty,
    getDraftSnapshot,
    isSaving,
    commitDraft,
    autosaveAnalysis,
    autosaveSegmentation,
    loadFromProject,
    newDraft,
    discardBook,
    discardAll,
    detachFromProject,
    canUndo,
    canRedo,
    getHistoryRevision,
    subscribeToHistoryRevisions,
    undo,
    redo,
    asOneStep,
    reanchorBook,
    subscribeToAnalysisReplacements,
  };
}
