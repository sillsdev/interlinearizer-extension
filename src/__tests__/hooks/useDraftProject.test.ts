/** @file Unit tests for useDraftProject hook. */
/// <reference types="jest" />

import papi, { logger } from '@papi/frontend';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { DraftProject, TextAnalysis } from 'interlinearizer';
import useDraftProject from '../../hooks/useDraftProject';
import { emptyAnalysis } from '../../types/empty-factories';

const SOURCE_PROJECT_ID = 'source-project-1';
const PLATFORM_LANGUAGE = 'en';

/** Handle to the mocked PAPI sendCommand so tests can assert on / override its calls. */
const mockSendCommand = jest.mocked(papi.commands.sendCommand);

/**
 * Builds a `DraftProject` for seeding the `getDraft` mock, overriding any fields needed by a test.
 *
 * @param overrides - Partial fields to merge over the baseline draft.
 * @returns A fresh `DraftProject` with the overrides applied.
 */
function makeDraft(overrides: Partial<DraftProject> = {}): DraftProject {
  return {
    sourceProjectId: SOURCE_PROJECT_ID,
    analysisLanguages: ['fr'],
    analysis: emptyAnalysis(),
    dirty: false,
    ...overrides,
  };
}

/**
 * Builds a `TextAnalysis` carrying a single token analysis so tests can prove a specific analysis
 * object round-trips through the draft.
 *
 * @param id - Identifier for the lone token analysis, used to distinguish instances.
 * @returns A `TextAnalysis` containing one token analysis with the given id.
 */
function analysisWithToken(id: string): TextAnalysis {
  return {
    ...emptyAnalysis(),
    tokenAnalyses: [{ id, surfaceText: 'word' }],
    tokenAnalysisLinks: [
      { analysisId: id, status: 'approved', token: { tokenRef: 'GEN 1:1:0', surfaceText: 'word' } },
    ],
  };
}

/**
 * Points the `getDraft` command at a resolved JSON draft while leaving `saveDraft` resolving void.
 * All other commands resolve undefined so an unexpected call never rejects.
 *
 * @param draft - The draft the `getDraft` command should return (JSON-serialized).
 */
function mockGetDraftResolves(draft: DraftProject): void {
  mockSendCommand.mockImplementation((...args: Parameters<typeof mockSendCommand>) => {
    if (args[0] === 'interlinearizer.getDraft') return Promise.resolve(JSON.stringify(draft));
    return Promise.resolve(undefined);
  });
}

/**
 * Renders the hook and waits for the initial `getDraft` load to settle so `draft` is populated and
 * `isDraftLoading` is false before a test exercises a callback.
 *
 * @returns The renderHook result handle, post-load.
 */
async function renderLoaded() {
  const view = renderHook(() => useDraftProject(SOURCE_PROJECT_ID, PLATFORM_LANGUAGE));
  await waitFor(() => expect(view.result.current.isDraftLoading).toBe(false));
  return view;
}

/**
 * Returns the JSON payload of the most recent `saveDraft` call, parsed back into a `DraftProject`.
 *
 * @returns The persisted draft from the latest `saveDraft` invocation.
 * @throws If no `saveDraft` call has been made, or its second argument was not a string.
 */
function lastSavedDraft(): DraftProject {
  const saveCalls = mockSendCommand.mock.calls.filter(
    (call) => call[0] === 'interlinearizer.saveDraft',
  );
  const lastCall = saveCalls[saveCalls.length - 1];
  if (!lastCall) throw new Error('expected at least one saveDraft call');
  const json = lastCall[2];
  if (typeof json !== 'string') throw new Error('expected saveDraft JSON argument to be a string');
  return JSON.parse(json);
}

describe('useDraftProject', () => {
  beforeEach(() => {
    jest.mocked(logger.error).mockImplementation(() => {});
    mockGetDraftResolves(makeDraft());
  });

  it('loads the stored draft on mount and clears the loading flag', async () => {
    const stored = makeDraft({ analysis: analysisWithToken('tok-load') });
    mockGetDraftResolves(stored);

    const { result } = await renderLoaded();

    expect(result.current.draft?.analysis.tokenAnalyses[0].id).toBe('tok-load');
    expect(result.current.isDraftLoading).toBe(false);
    expect(result.current.dirty).toBe(false);
  });

  it('requests the draft for the given source project id', async () => {
    await renderLoaded();

    expect(mockSendCommand).toHaveBeenCalledWith('interlinearizer.getDraft', SOURCE_PROJECT_ID);
  });

  it('seeds the platform language in memory when the stored draft has no analysis languages', async () => {
    mockGetDraftResolves(makeDraft({ analysisLanguages: [] }));

    const { result } = await renderLoaded();

    expect(result.current.draft?.analysisLanguages).toEqual([PLATFORM_LANGUAGE]);
  });

  it('keeps the stored analysis languages when the draft already has some', async () => {
    mockGetDraftResolves(makeDraft({ analysisLanguages: ['fr', 'de'] }));

    const { result } = await renderLoaded();

    expect(result.current.draft?.analysisLanguages).toEqual(['fr', 'de']);
  });

  it('falls back to an empty draft and logs when getDraft rejects', async () => {
    const failure = new Error('storage down');
    mockSendCommand.mockImplementation((...args: Parameters<typeof mockSendCommand>) => {
      if (args[0] === 'interlinearizer.getDraft') return Promise.reject(failure);
      return Promise.resolve(undefined);
    });

    const { result } = await renderLoaded();

    // emptyDraft has no analysis languages, so the seeding branch fills in the platform language.
    expect(result.current.draft?.analysisLanguages).toEqual([PLATFORM_LANGUAGE]);
    expect(result.current.draft?.analysis.tokenAnalyses).toEqual([]);
    expect(result.current.dirty).toBe(false);
    expect(jest.mocked(logger.error)).toHaveBeenCalledWith(
      'Interlinearizer: failed to load draft',
      failure,
    );
  });

  describe('autosaveAnalysis', () => {
    it('stores the edited analysis, marks the draft dirty, and persists with dirty:true', async () => {
      const { result } = await renderLoaded();

      jest.useFakeTimers();
      const edited = analysisWithToken('tok-autosave');
      act(() => {
        result.current.autosaveAnalysis(edited);
      });
      // Advance past the debounce window so the scheduled persist fires.
      act(() => {
        jest.advanceTimersByTime(300);
      });
      jest.useRealTimers();

      expect(result.current.dirty).toBe(true);
      expect(result.current.draft?.analysis.tokenAnalyses[0].id).toBe('tok-autosave');
      const saved = lastSavedDraft();
      expect(saved.dirty).toBe(true);
      expect(saved.analysis.tokenAnalyses[0].id).toBe('tok-autosave');
    });

    it('does not error or re-render when called again while already dirty', async () => {
      const { result } = await renderLoaded();

      jest.useFakeTimers();
      act(() => {
        result.current.autosaveAnalysis(analysisWithToken('first'));
      });
      act(() => {
        result.current.autosaveAnalysis(analysisWithToken('second'));
      });
      // The second call replaces the first timer; advance past the debounce to flush the write.
      act(() => {
        jest.advanceTimersByTime(300);
      });
      jest.useRealTimers();

      expect(result.current.dirty).toBe(true);
      // The second autosave does not bump draftVersion and dirty was already true, so it does not
      // re-render: the rendered `draft` still reflects the first edit while the live ref holds the
      // second. The second edit is persisted and visible through the synchronous snapshot.
      expect(result.current.draft?.analysis.tokenAnalyses[0].id).toBe('first');
      expect(result.current.getDraftSnapshot()?.analysis.tokenAnalyses[0].id).toBe('second');
      expect(lastSavedDraft().analysis.tokenAnalyses[0].id).toBe('second');
    });
  });

  describe('autosaveSegmentation', () => {
    it('stores the boundary delta on the draft, marks it dirty, and persists it', async () => {
      const { result } = await renderLoaded();

      jest.useFakeTimers();
      const delta = { removedVerseStarts: ['GEN 1:2:0'], addedStarts: [] };
      act(() => {
        result.current.autosaveSegmentation(delta);
      });
      act(() => {
        jest.advanceTimersByTime(300);
      });
      jest.useRealTimers();

      expect(result.current.dirty).toBe(true);
      expect(result.current.getDraftSnapshot()?.segmentation).toEqual(delta);
      expect(lastSavedDraft().segmentation).toEqual(delta);
    });

    it('replaces a pending debounced write when called again before it flushes', async () => {
      const { result } = await renderLoaded();

      jest.useFakeTimers();
      act(() => {
        result.current.autosaveSegmentation({ removedVerseStarts: ['GEN 1:2:0'], addedStarts: [] });
      });
      // A second call before the debounce fires clears the pending timer and schedules a new write.
      act(() => {
        result.current.autosaveSegmentation({ removedVerseStarts: [], addedStarts: ['GEN 1:1:6'] });
      });
      act(() => {
        jest.advanceTimersByTime(300);
      });
      jest.useRealTimers();

      expect(lastSavedDraft().segmentation).toEqual({
        removedVerseStarts: [],
        addedStarts: ['GEN 1:1:6'],
      });
    });

    it('clears the segmentation field when passed undefined (back to default segmentation)', async () => {
      // Seed a draft that already has custom boundaries so clearing them is observable.
      mockGetDraftResolves(
        makeDraft({ segmentation: { removedVerseStarts: ['GEN 1:2:0'], addedStarts: [] } }),
      );
      const { result } = await renderLoaded();

      jest.useFakeTimers();
      act(() => {
        result.current.autosaveSegmentation(undefined);
      });
      act(() => {
        jest.advanceTimersByTime(300);
      });
      jest.useRealTimers();

      expect(result.current.getDraftSnapshot()?.segmentation).toBeUndefined();
      expect(lastSavedDraft().segmentation).toBeUndefined();
    });
  });

  describe('loadFromProject', () => {
    it('copies a project segmentation delta into the draft when present', async () => {
      const { result } = await renderLoaded();

      const delta = { removedVerseStarts: ['GEN 1:2:0'], addedStarts: ['GEN 1:1:6'] };
      act(() => {
        result.current.loadFromProject({
          analysis: analysisWithToken('tok-open'),
          analysisLanguages: ['de'],
          segmentation: delta,
        });
      });

      expect(result.current.draft?.segmentation).toEqual(delta);
    });

    it('copies analysis, analysis languages, and target, clears dirty, and bumps the version', async () => {
      const { result } = await renderLoaded();
      const versionBefore = result.current.draftVersion;

      const projectAnalysis = analysisWithToken('tok-open');
      act(() => {
        result.current.loadFromProject({
          analysis: projectAnalysis,
          analysisLanguages: ['de'],
          targetProjectId: 'target-9',
        });
      });

      expect(result.current.draft?.analysis.tokenAnalyses[0].id).toBe('tok-open');
      expect(result.current.draft?.analysisLanguages).toEqual(['de']);
      expect(result.current.draft?.targetProjectId).toBe('target-9');
      expect(result.current.dirty).toBe(false);
      expect(result.current.draftVersion).toBe(versionBefore + 1);
      expect(lastSavedDraft().dirty).toBe(false);
    });

    it('omits the target project id when the opened project has none', async () => {
      const { result } = await renderLoaded();

      act(() => {
        result.current.loadFromProject({
          analysis: emptyAnalysis(),
          analysisLanguages: ['de'],
        });
      });

      expect(result.current.draft?.targetProjectId).toBeUndefined();
    });

    it('cancels a pending autosave so the stale edit is not written after the replacement', async () => {
      const { result } = await renderLoaded();
      const savesBefore = mockSendCommand.mock.calls.filter(
        (c) => c[0] === 'interlinearizer.saveDraft',
      ).length;

      jest.useFakeTimers();
      act(() => {
        result.current.autosaveAnalysis(analysisWithToken('pending'));
      });
      act(() => {
        result.current.loadFromProject({
          analysis: analysisWithToken('replaced'),
          analysisLanguages: ['de'],
        });
      });
      act(() => {
        jest.advanceTimersByTime(300);
      });
      jest.useRealTimers();

      // loadFromProject itself persists once; the cancelled autosave must not add a second save.
      const savesAfter = mockSendCommand.mock.calls.filter(
        (c) => c[0] === 'interlinearizer.saveDraft',
      ).length;
      expect(savesAfter - savesBefore).toBe(1);
      expect(lastSavedDraft().analysis.tokenAnalyses[0].id).toBe('replaced');
    });
  });

  describe('newDraft', () => {
    it('starts an empty, clean draft carrying the chosen languages and suggested name/description', async () => {
      // Start from a dirty draft with analysis so the reset to a clean, empty draft is observable.
      mockGetDraftResolves(makeDraft({ analysis: analysisWithToken('tok-old'), dirty: true }));
      const { result } = await renderLoaded();
      expect(result.current.dirty).toBe(true);
      const versionBefore = result.current.draftVersion;

      act(() => {
        result.current.newDraft({
          analysisLanguages: ['sw'],
          suggestedName: 'My Draft',
          suggestedDescription: 'A description',
        });
      });

      expect(result.current.draft?.analysis.tokenAnalyses).toEqual([]);
      expect(result.current.draft?.analysisLanguages).toEqual(['sw']);
      expect(result.current.draft?.suggestedName).toBe('My Draft');
      expect(result.current.draft?.suggestedDescription).toBe('A description');
      expect(result.current.dirty).toBe(false);
      expect(result.current.draftVersion).toBe(versionBefore + 1);
      // The suggested name/description must survive the persist so Save As can prefill from it.
      const saved = lastSavedDraft();
      expect(saved.dirty).toBe(false);
      expect(saved.suggestedName).toBe('My Draft');
      expect(saved.suggestedDescription).toBe('A description');
    });

    it('omits suggested name/description when the New dialog left them blank', async () => {
      const { result } = await renderLoaded();

      act(() => {
        result.current.newDraft({ analysisLanguages: ['de'] });
      });

      expect(result.current.draft?.suggestedName).toBeUndefined();
      expect(result.current.draft?.suggestedDescription).toBeUndefined();
      expect(result.current.draft?.analysisLanguages).toEqual(['de']);
      expect(result.current.dirty).toBe(false);
    });
  });

  describe('wipeBook', () => {
    it('removes the book, marks the draft dirty, bumps the version, and persists', async () => {
      const genToken = analysisWithToken('gen-tok');
      // A MAT token that should survive wiping GEN.
      const mixed: TextAnalysis = {
        ...genToken,
        tokenAnalyses: [...genToken.tokenAnalyses, { id: 'mat-tok', surfaceText: 'word' }],
        tokenAnalysisLinks: [
          ...genToken.tokenAnalysisLinks,
          {
            analysisId: 'mat-tok',
            status: 'approved',
            token: { tokenRef: 'MAT 1:1:0', surfaceText: 'word' },
          },
        ],
      };
      mockGetDraftResolves(makeDraft({ analysis: mixed }));
      const { result } = await renderLoaded();
      const versionBefore = result.current.draftVersion;

      act(() => {
        result.current.wipeBook('GEN');
      });

      const ids = result.current.draft?.analysis.tokenAnalyses.map((a) => a.id);
      expect(ids).toEqual(['mat-tok']);
      expect(result.current.dirty).toBe(true);
      expect(result.current.draftVersion).toBe(versionBefore + 1);
      expect(lastSavedDraft().dirty).toBe(true);
    });
  });

  describe('wipeAll', () => {
    it('clears the analysis entirely, clears dirty (clean baseline), bumps the version, and persists', async () => {
      // Start from a dirty draft so the transition to clean is observable.
      mockGetDraftResolves(makeDraft({ analysis: analysisWithToken('tok-wipe-all'), dirty: true }));
      const { result } = await renderLoaded();
      expect(result.current.dirty).toBe(true);
      const versionBefore = result.current.draftVersion;

      act(() => {
        result.current.wipeAll();
      });

      expect(result.current.draft?.analysis.tokenAnalyses).toEqual([]);
      expect(result.current.dirty).toBe(false);
      expect(result.current.draftVersion).toBe(versionBefore + 1);
      expect(lastSavedDraft().dirty).toBe(false);
    });

    it('clears any custom segment boundaries as part of the clean baseline', async () => {
      mockGetDraftResolves(
        makeDraft({
          analysis: analysisWithToken('tok-wipe-all'),
          dirty: true,
          segmentation: { removedVerseStarts: ['GEN 1:2:0'], addedStarts: [] },
        }),
      );
      const { result } = await renderLoaded();

      act(() => {
        result.current.wipeAll();
      });

      expect(result.current.draft?.segmentation).toBeUndefined();
      expect(lastSavedDraft().segmentation).toBeUndefined();
    });
  });

  describe('markSynced', () => {
    it('clears dirty and persists the synced draft without bumping the version', async () => {
      const { result } = await renderLoaded();
      // Make the draft dirty first so the transition to synced is observable.
      const synced = analysisWithToken('tok-sync');
      act(() => {
        result.current.autosaveAnalysis(synced);
      });
      expect(result.current.dirty).toBe(true);
      const versionBefore = result.current.draftVersion;

      act(() => {
        result.current.markSynced(synced);
      });

      expect(result.current.dirty).toBe(false);
      expect(result.current.draftVersion).toBe(versionBefore);
      expect(lastSavedDraft().dirty).toBe(false);
    });

    it('leaves the draft dirty when an edit landed since the saved snapshot', async () => {
      const { result } = await renderLoaded();
      // The analysis that a Save captured and persisted.
      const savedSnapshot = analysisWithToken('tok-saved');
      act(() => {
        result.current.autosaveAnalysis(savedSnapshot);
      });
      // A newer edit lands during the save round-trip, replacing the ref's analysis.
      act(() => {
        result.current.autosaveAnalysis(analysisWithToken('tok-newer'));
      });
      expect(result.current.dirty).toBe(true);

      // Syncing against the now-stale snapshot must not clear the unsaved-changes flag.
      act(() => {
        result.current.markSynced(savedSnapshot);
      });

      expect(result.current.dirty).toBe(true);
    });
  });

  describe('getDraftSnapshot', () => {
    it('returns the latest draft synchronously after an autosave', async () => {
      const { result } = await renderLoaded();

      const edited = analysisWithToken('tok-snapshot');
      act(() => {
        result.current.autosaveAnalysis(edited);
      });

      const snapshot = result.current.getDraftSnapshot();
      expect(snapshot?.analysis.tokenAnalyses[0].id).toBe('tok-snapshot');
      expect(snapshot?.dirty).toBe(true);
    });
  });

  it('does not update state or throw when unmounted before getDraft resolves', async () => {
    let resolveGetDraft: (json: string) => void = () => {};
    const deferred = new Promise<string>((resolve) => {
      resolveGetDraft = resolve;
    });
    mockSendCommand.mockImplementation((...args: Parameters<typeof mockSendCommand>) => {
      if (args[0] === 'interlinearizer.getDraft') return deferred;
      return Promise.resolve(undefined);
    });

    const { result, unmount } = renderHook(() =>
      useDraftProject(SOURCE_PROJECT_ID, PLATFORM_LANGUAGE),
    );
    expect(result.current.isDraftLoading).toBe(true);

    unmount();

    // Resolve after unmount: the canceled guard must skip the ref/state publish.
    await act(async () => {
      resolveGetDraft(JSON.stringify(makeDraft()));
      await deferred;
    });

    // State stayed at its last mounted value (still loading) and no error was logged.
    expect(result.current.isDraftLoading).toBe(true);
    expect(jest.mocked(logger.error)).not.toHaveBeenCalled();
  });
});
