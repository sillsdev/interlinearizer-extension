/** @file Hook owning the always-present, auto-saved draft buffer for one source project. */
import papi, { logger } from '@papi/frontend';
import type { DraftProject, InterlinearProject, TextAnalysis } from 'interlinearizer';
import { useCallback, useEffect, useRef, useState } from 'react';
import { emptyAnalysis, emptyDraft } from '../types/empty-factories';
import { removeBookFromAnalysis } from '../utils/analysis-book';

/** Configuration captured by the "New" flow when resetting the draft to an empty baseline. */
export type NewDraftConfig = {
  /** BCP 47 gloss / annotation language tags for the new draft. */
  analysisLanguages: string[];
  /** Optional alignment target-text project ID. */
  targetProjectId?: string;
  /** Optional name typed in the New dialog, retained on the draft to prefill Save As. */
  name?: string;
  /** Optional description typed in the New dialog, retained on the draft to prefill Save As. */
  description?: string;
};

/** The subset of an {@link InterlinearProject} needed to open it into the draft as a working copy. */
export type OpenableProject = Pick<
  InterlinearProject,
  'analysis' | 'analysisLanguages' | 'targetProjectId'
>;

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
   * Whether the draft has diverged from its active project since the last Save / Save As / Open /
   * New. Drives the discard confirmation and the tab's unsaved-changes indicator.
   */
  dirty: boolean;
  /**
   * Returns the latest draft envelope synchronously by reading the live ref rather than a render
   * snapshot. Save / Save As must use this so they persist edits that auto-saved without a
   * re-render.
   *
   * @returns The current draft, or `undefined` before the initial load completes.
   */
  getDraftSnapshot: () => DraftProject | undefined;
  /**
   * Persists an edited analysis into the draft and marks it dirty. Wire as the editor's
   * `onSaveAnalysis`.
   *
   * @param analysis - The updated analysis from the store.
   */
  autosaveAnalysis: (analysis: TextAnalysis) => void;
  /**
   * Resets the draft to an empty analysis with the given config — the "New" flow.
   *
   * @param config - Gloss languages and optional alignment target for the fresh draft.
   */
  resetDraft: (config: NewDraftConfig) => void;
  /**
   * Replaces the draft with a working copy of an existing project's analysis and config — the
   * "Open" flow.
   *
   * @param project - The project whose analysis / languages / target to copy into the draft.
   */
  loadFromProject: (project: OpenableProject) => void;
  /**
   * Removes one book's analysis from the draft and marks it dirty.
   *
   * @param bookCode - The 3-letter book code (e.g. `"GEN"`) to wipe.
   */
  wipeBook: (bookCode: string) => void;
  /** Clears the draft's analysis entirely and marks it dirty. */
  wipeAll: () => void;
  /** Marks the draft as synced (not dirty) after a successful Save / Save As. */
  markSynced: () => void;
};

/**
 * Owns the always-present, auto-saved draft for one source project. Loads the draft on mount, seeds
 * a gloss language when none is stored, and exposes callbacks to auto-save edits and to replace the
 * draft wholesale (New / Open / Wipe).
 *
 * The full draft lives in a ref — the synchronous source of truth for persistence and Save — while
 * a small amount of state (`isDraftLoading`, `draftVersion`, `dirty`) drives re-renders. As a
 * result per-edit auto-saves never re-render the loader unless the dirty flag actually flips,
 * matching the prior behavior where editing did not re-render the loader.
 *
 * @param sourceProjectId - The Platform.Bible source project whose draft to manage.
 * @param platformLanguage - BCP 47 tag used to seed `analysisLanguages` for a brand-new source.
 * @returns Draft state and the callbacks described on {@link UseDraftProjectResult}.
 */
export default function useDraftProject(
  sourceProjectId: string,
  platformLanguage: string,
): UseDraftProjectResult {
  const draftRef = useRef<DraftProject | undefined>(undefined);
  const [isDraftLoading, setIsDraftLoading] = useState(true);
  const [draftVersion, setDraftVersion] = useState(0);
  const [dirty, setDirty] = useState(false);

  // Read the latest platform language via a ref so the load effect (keyed only on sourceProjectId)
  // does not re-run when the UI language changes after the draft has loaded.
  const platformLanguageRef = useRef(platformLanguage);
  platformLanguageRef.current = platformLanguage;

  /**
   * Persists `draft` to storage, fire-and-forget. The backend surfaces an error notification on
   * failure; here we only log so a rejected write never throws into a render or event handler.
   *
   * @param draft - The draft envelope to write.
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
     *
     * @returns A promise that resolves once the draft has been published or the load was canceled.
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
    };
  }, [sourceProjectId]);

  const getDraftSnapshot = useCallback(() => draftRef.current, []);

  /**
   * Applies a wholesale draft replacement: update the ref, persist, refresh `dirty`, and bump the
   * remount counter so the editor reseeds.
   *
   * @param next - The replacement draft.
   */
  const applyReplacement = useCallback(
    (next: DraftProject) => {
      draftRef.current = next;
      persist(next);
      setDirty(next.dirty);
      setDraftVersion((v) => v + 1);
    },
    [persist],
  );

  const autosaveAnalysis = useCallback(
    (analysis: TextAnalysis) => {
      const { current } = draftRef;
      /* v8 ignore next -- auto-save only fires from the mounted editor, which exists only post-load */
      if (!current) return;
      const next: DraftProject = { ...current, analysis, dirty: true };
      draftRef.current = next;
      persist(next);
      // No version bump (no remount) and a no-op when already dirty, so editing does not re-render.
      setDirty(true);
    },
    [persist],
  );

  const resetDraft = useCallback(
    (config: NewDraftConfig) => {
      const analysisLanguages =
        config.analysisLanguages.length > 0
          ? config.analysisLanguages
          : [platformLanguageRef.current];
      applyReplacement({
        sourceProjectId,
        analysisLanguages,
        ...(config.targetProjectId !== undefined && { targetProjectId: config.targetProjectId }),
        ...(config.name !== undefined && { suggestedName: config.name }),
        ...(config.description !== undefined && { suggestedDescription: config.description }),
        analysis: emptyAnalysis(),
        dirty: false,
      });
    },
    [applyReplacement, sourceProjectId],
  );

  const loadFromProject = useCallback(
    (project: OpenableProject) => {
      applyReplacement({
        sourceProjectId,
        analysisLanguages: project.analysisLanguages,
        ...(project.targetProjectId !== undefined && { targetProjectId: project.targetProjectId }),
        analysis: project.analysis,
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
      applyReplacement({
        ...current,
        analysis: removeBookFromAnalysis(current.analysis, bookCode),
        dirty: true,
      });
    },
    [applyReplacement],
  );

  const wipeAll = useCallback(() => {
    const { current } = draftRef;
    /* v8 ignore next -- wipe is only reachable from the mounted editor */
    if (!current) return;
    applyReplacement({ ...current, analysis: emptyAnalysis(), dirty: true });
  }, [applyReplacement]);

  const markSynced = useCallback(() => {
    const { current } = draftRef;
    /* v8 ignore next -- save is only reachable from the mounted editor */
    if (!current) return;
    const next: DraftProject = { ...current, dirty: false };
    draftRef.current = next;
    persist(next);
    setDirty(false);
  }, [persist]);

  return {
    isDraftLoading,
    draft: draftRef.current,
    draftVersion,
    dirty,
    getDraftSnapshot,
    autosaveAnalysis,
    resetDraft,
    loadFromProject,
    wipeBook,
    wipeAll,
    markSynced,
  };
}
