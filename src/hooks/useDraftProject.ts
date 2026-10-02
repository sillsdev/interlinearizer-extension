import papi, { logger } from '@papi/frontend';
import type {
  DraftProject,
  InterlinearProject,
  SegmentationDelta,
  TextAnalysis,
} from 'interlinearizer';
import { useCallback, useEffect, useRef, useState } from 'react';
import { emptyAnalysis, emptyDraft } from '../types/empty-factories';
import { CURRENT_MODEL_VERSION } from '../types/model-version';
import { removeBookFromAnalysis, removeBookFromSegmentation } from '../utils/analysis-book';
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

/** What a step made in the analysis catalog tells the reader it was. */
type CatalogStepSummary = {
  form: string;
  /** The analysis whose catalog row the step acted on. */
  analysisId: string;
  /** The analysis holding that row once the step is made, absent when the step leaves none. */
  survivingAnalysisId?: string;
};

/** What an undo step made at no one place tells the reader it was, once undone or redone. */
export type StepSummary = Readonly<
  | (CatalogStepSummary & { kind: 'catalogEdit' | 'catalogMerge' })
  | (CatalogStepSummary & {
      kind: 'catalogDelete';
      /** How many uses the deleted analysis had. */
      count: number;
    })
  | { kind: 'wipeBook'; book: string }
  | { kind: 'wipeAll' }
>;

/** An undo step, as recorded. */
export type EditStep = Readonly<{
  /** The token ref or segment id the step was made at, when it was made at one place. */
  location?: string;
  summary?: StepSummary;
}>;

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
   * Monotonic counter bumped on every wholesale analysis replacement (New / Open / Wipe). Include
   * it in the editor's React `key` so the analysis store reseeds from the new draft; per-edit
   * auto-saves deliberately do not bump it, so editing never remounts the editor.
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
  /** Removes one book's analysis from the draft, by 3-letter book code, and marks it dirty. */
  wipeBook: (bookCode: string) => void;
  /**
   * Clears the draft's analysis entirely and marks it **not** dirty — a wiped draft is treated as a
   * clean baseline, so the unsaved-changes indicator clears. The active project is left untouched.
   */
  wipeAll: () => void;
  /**
   * Marks the draft as synced (not dirty) after a successful Save / Save As — but only when the
   * draft has not changed since the snapshot that was persisted. Pass the exact analysis and
   * boundary delta that were written (an `undefined` boundary delta means the draft had the default
   * segmentation); if a later auto-save replaced either (an edit made during the save round-trip),
   * the draft is left dirty so the unsaved-changes indicator and the next Save reflect that
   * un-persisted edit rather than being cleared against a now-stale snapshot.
   */
  markSynced: (
    savedAnalysis: TextAnalysis,
    savedSegmentation: SegmentationDelta | undefined,
  ) => void;
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
 * them, and to replace the draft wholesale (New / Open / Wipe).
 *
 * The full draft lives in a ref — the synchronous source of truth for persistence and Save — while
 * a small amount of state (`isDraftLoading`, `draftVersion`, `dirty`) drives re-renders, so
 * per-edit auto-saves never re-render the loader unless the dirty flag actually flips.
 *
 * @param sourceProjectId - The Platform.Bible source project whose draft to manage.
 * @param platformLanguage - BCP 47 tag used to seed the analysis languages of a brand-new source.
 */
export default function useDraftProject(
  sourceProjectId: string,
  platformLanguage: string,
): UseDraftProjectResult {
  const draftRef = useRef<DraftProject | undefined>(undefined);
  const [isDraftLoading, setIsDraftLoading] = useState(true);
  const [draftVersion, setDraftVersion] = useState(0);
  const [segmentationVersion, setSegmentationVersion] = useState(0);
  const [dirty, setDirty] = useState(false);
  const historyRef = useRef<UndoHistory<DraftContent, EditStep>>(emptyHistory());
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  // The history state last synced with a project; unknown for a draft loaded dirty.
  const savedStateRef = useRef<number | undefined>(undefined);
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

  // Pending debounced-autosave timer. Flushed on unmount/source change (so the last edit is not
  // lost), and canceled on any wholesale replacement so stale keystroke data is never written
  // after a New / Open / Wipe.
  const autosaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  /**
   * Persists `draft` to storage, fire-and-forget. The backend surfaces an error notification on
   * failure; here we only log so a rejected write never throws into a render or event handler.
   *
   * This is the only persistence path — there is no retry on blur or unmount. If storage is
   * unavailable during editing the backend sends one error notification per failed write; should
   * that notification itself fail, edits in that window are silently lost on the next refresh. The
   * `dirty` flag is set optimistically before the write, not in response to its outcome.
   */
  const persist = useCallback(
    (draft: DraftProject) => {
      papi.commands
        .sendCommand('interlinearizer.saveDraft', sourceProjectId, JSON.stringify(draft))
        .catch((e) => logger.error('Interlinearizer: failed to save draft', e));
    },
    [sourceProjectId],
  );

  useEffect(() => {
    let canceled = false;
    setIsDraftLoading(true);
    setHistory(emptyHistory());

    /**
     * Loads the stored draft for the source (falling back to an empty draft on failure), seeds a
     * gloss language when none is present, and publishes it to the ref and state.
     */
    const load = async () => {
      let draft: DraftProject;
      try {
        const json = await papi.commands.sendCommand('interlinearizer.getDraft', sourceProjectId);
        draft = JSON.parse(json);
      } catch (e) {
        logger.error('Interlinearizer: failed to load draft', e);
        draft = emptyDraft(sourceProjectId);
      }
      if (canceled) return;

      // Seed a gloss language in memory when the stored draft has none (a brand-new source). Not
      // persisted here — the first auto-save / New / Open carries it to storage.
      if (draft.analysisLanguages.length === 0)
        draft = { ...draft, analysisLanguages: [platformLanguageRef.current] };
      draftRef.current = draft;
      savedStateRef.current = draft.dirty ? undefined : historyRef.current.state;
      setDirty(draft.dirty);
      setIsDraftLoading(false);
    };

    load();
    return () => {
      canceled = true;
      if (autosaveTimeoutRef.current !== undefined) {
        clearTimeout(autosaveTimeoutRef.current);
        autosaveTimeoutRef.current = undefined;
        // Flush the pending write so the last edit before unmount/source-change is not lost.
        if (draftRef.current) persist(draftRef.current);
      }
    };
  }, [persist, setHistory, sourceProjectId]);

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
      // Cancel any pending debounced autosave so stale keystroke data is not written after a
      // wholesale replacement (New / Open / Wipe).
      if (autosaveTimeoutRef.current !== undefined) {
        clearTimeout(autosaveTimeoutRef.current);
        autosaveTimeoutRef.current = undefined;
      }
      draftRef.current = next;
      setHistory(history);
      if (!next.dirty) savedStateRef.current = history.state;
      persist(next);
      setDirty(next.dirty);
      setDraftVersion((v) => v + 1);
    },
    [persist, setHistory],
  );

  /**
   * Swaps `next` into the ref, debounces the persistence write, and publishes its dirty flag. There
   * is no version bump and so no remount, and republishing an unchanged flag is a no-op, so writing
   * does not re-render.
   */
  const writeDraft = useCallback(
    (next: DraftProject) => {
      draftRef.current = next;
      // Debounce writes so rapid keystrokes don't queue unbounded commands to the backend.
      if (autosaveTimeoutRef.current !== undefined) clearTimeout(autosaveTimeoutRef.current);
      autosaveTimeoutRef.current = setTimeout(() => {
        autosaveTimeoutRef.current = undefined;
        persist(next);
      }, AUTOSAVE_DEBOUNCE_MS);
      setDirty(next.dirty);
    },
    [persist],
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

  const wipeBook = useCallback(
    (bookCode: string) => {
      const { current } = draftRef;
      /* v8 ignore next -- wipe is only reachable from the mounted editor */
      if (!current) return;

      // Drop the book's custom segment boundaries alongside its analysis: the anchors are working
      // state keyed by book, so keeping them would re-apply the wiped book's merges/splits on
      // reload. Clear the field when nothing remains for any other book.
      const segmentation = removeBookFromSegmentation(current.segmentation, bookCode);
      const next: DraftProject = {
        ...current,
        analysis: removeBookFromAnalysis(current.analysis, bookCode),
        dirty: true,
      };
      if (segmentation !== undefined) next.segmentation = segmentation;
      else delete next.segmentation;
      applyReplacement(
        next,
        recordStep(historyRef.current, contentOf(current), {
          summary: { kind: 'wipeBook', book: bookCode },
        }),
      );
    },
    [applyReplacement],
  );

  const wipeAll = useCallback(() => {
    const { current } = draftRef;
    /* v8 ignore next -- wipe is only reachable from the mounted editor */
    if (!current) return;

    // Wiping the whole draft is treated as a clean baseline (dirty: false) so the user is not nagged
    // to save an empty draft. The active project is left untouched, so a subsequent Save still
    // targets it. Custom segment boundaries are working state, so a whole-draft wipe clears them too.
    // (Per-book wipe stays dirty, as it is a partial edit the user will usually want to save.)
    const next: DraftProject = { ...current, analysis: emptyAnalysis(), dirty: false };
    delete next.segmentation;
    applyReplacement(
      next,
      recordStep(historyRef.current, contentOf(current), { summary: { kind: 'wipeAll' } }),
    );
  }, [applyReplacement]);

  const markSynced = useCallback(
    (savedAnalysis: TextAnalysis, savedSegmentation: SegmentationDelta | undefined) => {
      const { current } = draftRef;
      /* v8 ignore next -- save is only reachable from the mounted editor */
      if (!current) return;

      // If an edit landed during the save round-trip, the auto-save has already swapped a newer
      // analysis or boundary delta (a fresh object) into the ref and marked the draft dirty. Leave
      // it dirty so the next Save reflects that un-persisted edit rather than clearing against the
      // stale snapshot. Both fields are compared: a boundary edit carries `analysis` over by
      // reference, so checking analysis alone would wrongly clear dirty over a segmentation change.
      if (current.analysis !== savedAnalysis || current.segmentation !== savedSegmentation) return;

      // Cancel any pending debounced autosave before persisting the clean state so a stale
      // {dirty: true} timer cannot fire after this and overwrite the {dirty: false} record.
      if (autosaveTimeoutRef.current !== undefined) {
        clearTimeout(autosaveTimeoutRef.current);
        autosaveTimeoutRef.current = undefined;
      }
      const next: DraftProject = { ...current, dirty: false };
      draftRef.current = next;
      savedStateRef.current = historyRef.current.state;
      persist(next);
      setDirty(false);
    },
    [persist],
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
      replaceContent(current, move.content, move.history.state !== savedStateRef.current);
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
    autosaveAnalysis,
    autosaveSegmentation,
    loadFromProject,
    newDraft,
    wipeBook,
    wipeAll,
    markSynced,
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
