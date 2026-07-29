import papi, { logger } from '@papi/frontend';
import type {
  DraftProject,
  InterlinearProject,
  SegmentationDelta,
  TextAnalysis,
} from 'interlinearizer';
import { useCallback, useEffect, useRef, useState } from 'react';
import { emptyAnalysis, emptyDraft } from '../types/empty-factories';
import { removeBookFromAnalysis, removeBookFromSegmentation } from '../utils/analysis-book';
import { isDefaultSegmentation } from '../utils/segmentation';

/** Milliseconds to wait after the last keystroke before flushing an autosave write. */
const AUTOSAVE_DEBOUNCE_MS = 300;

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
   * Returns the latest draft envelope synchronously by reading the live ref rather than a render
   * snapshot. Save / Save As must use this so they persist edits that auto-saved without a
   * re-render. Yields `undefined` before the initial load completes.
   */
  getDraftSnapshot: () => DraftProject | undefined;
  /**
   * Persists an edited analysis into the draft and marks it dirty. Wire as the editor's
   * `onSaveAnalysis`.
   */
  autosaveAnalysis: (analysis: TextAnalysis) => void;
  /**
   * Persists an edited segment-boundary delta into the draft and marks it dirty. Pass `undefined`
   * (or a default/empty delta) to clear custom boundaries back to the default verse segmentation.
   */
  autosaveSegmentation: (segmentation: SegmentationDelta | undefined) => void;
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
   * boundary delta that were written; if a later auto-save replaced either (an edit made during the
   * save round-trip), the draft is left dirty so the unsaved-changes indicator and the next Save
   * reflect that un-persisted edit rather than being cleared against a now-stale snapshot.
   *
   * Pass the exact references that were written; a `undefined` boundary delta means the draft had
   * the default segmentation.
   */
  markSynced: (
    savedAnalysis: TextAnalysis,
    savedSegmentation: SegmentationDelta | undefined,
  ) => void;
};

/**
 * Owns the always-present, auto-saved draft for one source project. Loads the draft on mount, seeds
 * a gloss language when none is stored, and exposes callbacks to auto-save edits and to replace the
 * draft wholesale (New / Open / Wipe).
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

  // Read the latest platform language via a ref so the load effect (keyed on sourceProjectId)
  // does not re-run when the UI language changes after the draft has loaded.
  const platformLanguageRef = useRef(platformLanguage);
  platformLanguageRef.current = platformLanguage;

  // Pending debounced-autosave timer. Flushed on unmount/source change (so the last edit is not
  // lost), and cancelled on any wholesale replacement (applyReplacement) so stale keystroke data
  // is never written after a New / Open / Wipe.
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
  }, [persist, sourceProjectId]);

  const getDraftSnapshot = useCallback(() => draftRef.current, []);

  /**
   * Applies a wholesale draft replacement: update the ref, persist, refresh `dirty`, and bump the
   * remount counter so the editor reseeds.
   */
  const applyReplacement = useCallback(
    (next: DraftProject) => {
      // Cancel any pending debounced autosave so stale keystroke data is not written after a
      // wholesale replacement (New / Open / Wipe).
      if (autosaveTimeoutRef.current !== undefined) {
        clearTimeout(autosaveTimeoutRef.current);
        autosaveTimeoutRef.current = undefined;
      }
      draftRef.current = next;
      persist(next);
      setDirty(next.dirty);
      setDraftVersion((v) => v + 1);
    },
    [persist],
  );

  /**
   * Shared per-edit auto-save pipeline: swaps the mutated draft into the ref, debounces the
   * persistence write, and marks the draft dirty. There is no version bump and so no remount, and
   * re-marking an already-dirty draft is a no-op, so editing does not re-render.
   *
   * Returns `false` without applying anything when no draft has loaded yet.
   *
   * @param mutate - Produces the next draft from the current one; must set `dirty: true`.
   * @returns `true` when the edit was applied; `false` when no draft has loaded yet.
   */
  const autosaveDraft = useCallback(
    (mutate: (current: DraftProject) => DraftProject): boolean => {
      const { current } = draftRef;
      /* v8 ignore next -- auto-save only fires from the mounted editor, which exists only post-load */
      if (!current) return false;

      const next = mutate(current);
      draftRef.current = next;
      // Debounce writes so rapid keystrokes don't queue unbounded commands to the backend.
      if (autosaveTimeoutRef.current !== undefined) clearTimeout(autosaveTimeoutRef.current);
      autosaveTimeoutRef.current = setTimeout(() => {
        autosaveTimeoutRef.current = undefined;
        persist(next);
      }, AUTOSAVE_DEBOUNCE_MS);
      setDirty(true);
      return true;
    },
    [persist],
  );

  const autosaveAnalysis = useCallback(
    (analysis: TextAnalysis) => {
      autosaveDraft((current) => ({ ...current, analysis, dirty: true }));
    },
    [autosaveDraft],
  );

  const autosaveSegmentation = useCallback(
    (segmentation: SegmentationDelta | undefined) => {
      // Treat the default segmentation (undefined or a delta with both arrays empty) the same as
      // `undefined`: clear the field rather than persisting a redundant custom object. Shares
      // `isDefaultSegmentation` with the loader's dispatch so the empty-delta rule lives in one place.
      const hasCustomBoundaries = !isDefaultSegmentation(segmentation);
      const applied = autosaveDraft((current) => {
        const next: DraftProject = { ...current, dirty: true };
        // Store custom boundaries when present; clear the field for the default segmentation so the
        // persisted draft stays minimal.
        if (hasCustomBoundaries && segmentation !== undefined) next.segmentation = segmentation;
        else delete next.segmentation;
        return next;
      });
      /* v8 ignore next -- auto-save only fires from the mounted editor, which exists only post-load */
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
      applyReplacement({
        sourceProjectId,
        analysisLanguages: project.analysisLanguages,
        ...(project.targetProjectId !== undefined && { targetProjectId: project.targetProjectId }),
        ...(project.segmentation !== undefined && { segmentation: project.segmentation }),
        analysis: project.analysis,
        dirty: false,
      });
    },
    [applyReplacement, sourceProjectId],
  );

  const newDraft = useCallback(
    (config: NewDraftConfig) => {
      applyReplacement({
        sourceProjectId,
        analysisLanguages: config.analysisLanguages,
        ...(config.suggestedName !== undefined && { suggestedName: config.suggestedName }),
        ...(config.suggestedDescription !== undefined && {
          suggestedDescription: config.suggestedDescription,
        }),
        analysis: emptyAnalysis(),
        dirty: false,
      });
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
      applyReplacement(next);
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
    applyReplacement(next);
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
      persist(next);
      setDirty(false);
    },
    [persist],
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
  };
}
