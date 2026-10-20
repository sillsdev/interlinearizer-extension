/// <reference types="jest" />

import papi, { logger } from '@papi/frontend';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { DraftProject, TextAnalysis } from 'interlinearizer';
import { FIXTURE_STAMPS } from '../test-helpers';
import useDraftProject, {
  type DraftContent,
  type StepSummary,
  type UseDraftProjectResult,
} from '../../hooks/useDraftProject';
import { emptyAnalysis } from '../../types/empty-factories';
import { CURRENT_MODEL_VERSION } from '../../types/model-version';

const SOURCE_PROJECT_ID = 'source-project-1';
const PLATFORM_LANGUAGE = 'en';

const mockSendCommand = jest.mocked(papi.commands.sendCommand);

/**
 * Builds a {@link DraftProject} for seeding the `getDraft` mock, overriding any fields needed by a
 * test.
 */
function makeDraft(overrides: Partial<DraftProject> = {}): DraftProject {
  return {
    sourceProjectId: SOURCE_PROJECT_ID,
    modelVersion: CURRENT_MODEL_VERSION,
    analysisLanguages: ['fr'],
    analysis: emptyAnalysis(),
    dirty: false,
    ...overrides,
  };
}

/**
 * Builds a {@link TextAnalysis} carrying a single token analysis so tests can prove a specific
 * analysis object round-trips through the draft.
 */
function analysisWithToken(id: string): TextAnalysis {
  return {
    ...emptyAnalysis(),
    tokenAnalyses: [{ ...FIXTURE_STAMPS, id, surfaceText: 'word' }],
    tokenAnalysisLinks: [
      {
        id: 'tl-1',
        ...FIXTURE_STAMPS,
        analysisId: id,
        status: 'approved',
        token: { tokenRef: 'GEN 1:1:0', surfaceText: 'word' },
      },
    ],
  };
}

/**
 * Points the `getDraft` command at a resolved JSON draft while leaving `saveDraft` resolving void.
 * All other commands resolve undefined so an unexpected call never rejects.
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
 */
async function renderLoaded() {
  const view = renderHook(() => useDraftProject(SOURCE_PROJECT_ID, PLATFORM_LANGUAGE));
  await waitFor(() => expect(view.result.current.isDraftLoading).toBe(false));
  return view;
}

/**
 * Returns the JSON payload of the most recent `saveDraft` call, parsed back into a
 * {@link DraftProject}.
 *
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

/** Saves the draft as a Save whose host copy lands would, so the draft reads clean. */
async function saveNow(result: { current: UseDraftProjectResult }): Promise<void> {
  await act(async () => {
    await result.current.commitDraft(async () => true);
  });
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

    // The fallback draft has no analysis languages, so the seeding branch fills in the platform
    // language.
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
      // The second autosave neither bumps draftVersion nor flips dirty, so it doesn't re-render: the
      // rendered `draft` still shows the first edit while the ref (and snapshot) hold the second.
      expect(result.current.draft?.analysis.tokenAnalyses[0].id).toBe('first');
      expect(result.current.getDraftSnapshot()?.analysis.tokenAnalyses[0].id).toBe('second');
      expect(lastSavedDraft().analysis.tokenAnalyses[0].id).toBe('second');
    });
  });

  describe('commitDraft', () => {
    /** Counts the draft writes sent so far. */
    function saveDraftCount(): number {
      return mockSendCommand.mock.calls.filter((c) => c[0] === 'interlinearizer.saveDraft').length;
    }

    /**
     * Serves `getDraft` as {@link mockGetDraftResolves} does, but holds each draft write until the
     * returned function settles it.
     */
    function holdDraftWrites(): (outcome: 'resolve' | 'reject') => void {
      const pending: { resolve: () => void; reject: (e: Error) => void }[] = [];
      mockSendCommand.mockImplementation((...args: Parameters<typeof mockSendCommand>) => {
        if (args[0] === 'interlinearizer.getDraft')
          return Promise.resolve(JSON.stringify(makeDraft()));
        if (args[0] !== 'interlinearizer.saveDraft') return Promise.resolve(undefined);
        return new Promise<undefined>((resolve, reject) => {
          pending.push({ resolve: () => resolve(undefined), reject });
        });
      });
      return (outcome) =>
        pending
          .splice(0)
          .forEach((write) =>
            outcome === 'resolve' ? write.resolve() : write.reject(new Error('disk full')),
          );
    }

    /** A copy that resolves `landed`, with `seen` holding the snapshot it was given. */
    function recordingCopy(landed = true) {
      const seen: { snapshot?: DraftProject } = {};
      const copy = jest.fn(async (snapshot: DraftProject) => {
        seen.snapshot = snapshot;
        return landed;
      });
      return { copy, seen };
    }

    it('writes a pending autosave before the copy runs, passing it the draft it wrote', async () => {
      const { result } = await renderLoaded();
      jest.useFakeTimers();
      act(() => {
        result.current.autosaveAnalysis(analysisWithToken('pending'));
      });
      const { copy, seen } = recordingCopy();

      await act(async () => {
        await result.current.commitDraft(copy);
      });
      jest.useRealTimers();

      expect(copy).toHaveBeenCalledTimes(1);
      expect(seen.snapshot?.analysis.tokenAnalyses[0].id).toBe('pending');
      // The first write carried the edit; the second is the clean flag once the copy landed.
      expect(saveDraftCount()).toBe(2);
      expect(lastSavedDraft().dirty).toBe(false);
      expect(result.current.dirty).toBe(false);
    });

    it('does not write the flushed autosave a second time when its debounce would have fired', async () => {
      const { result } = await renderLoaded();
      jest.useFakeTimers();
      act(() => {
        result.current.autosaveAnalysis(analysisWithToken('pending'));
      });

      await act(async () => {
        await result.current.commitDraft(async () => false);
      });
      act(() => {
        jest.advanceTimersByTime(300);
      });
      jest.useRealTimers();

      expect(saveDraftCount()).toBe(1);
    });

    it('sends no write when no autosave is pending', async () => {
      const { result } = await renderLoaded();
      const { copy, seen } = recordingCopy(false);

      await act(async () => {
        await result.current.commitDraft(copy);
      });

      expect(saveDraftCount()).toBe(0);
      expect(seen.snapshot).toBe(result.current.getDraftSnapshot());
    });

    it('waits for a draft write already in flight to land before copying', async () => {
      const settle = holdDraftWrites();
      const { result } = await renderLoaded();
      jest.useFakeTimers();
      act(() => {
        result.current.autosaveAnalysis(analysisWithToken('in-flight'));
      });
      act(() => {
        jest.advanceTimersByTime(300);
      });
      jest.useRealTimers();
      const { copy } = recordingCopy();

      let commit: Promise<boolean> | undefined;
      act(() => {
        commit = result.current.commitDraft(copy);
      });
      await act(async () => {});
      expect(saveDraftCount()).toBe(1);
      expect(copy).not.toHaveBeenCalled();

      await act(async () => {
        settle('resolve');
        await commit;
      });
      expect(copy).toHaveBeenCalledTimes(1);
    });

    it('writes an edit made while the writes settle before copying', async () => {
      const settle = holdDraftWrites();
      const { result } = await renderLoaded();
      jest.useFakeTimers();
      act(() => {
        result.current.autosaveAnalysis(analysisWithToken('first'));
      });
      act(() => {
        jest.advanceTimersByTime(300);
      });
      const { copy, seen } = recordingCopy();
      let commit: Promise<boolean> | undefined;
      act(() => {
        commit = result.current.commitDraft(copy);
      });
      // A second edit lands while the first write is still in flight.
      act(() => {
        result.current.autosaveAnalysis(analysisWithToken('second'));
      });
      act(() => {
        jest.advanceTimersByTime(300);
      });
      jest.useRealTimers();

      await act(async () => {
        settle('resolve');
        await commit;
      });

      // Both writes landed before the copy ran, and the copy saw the draft the second one wrote.
      expect(seen.snapshot?.analysis.tokenAnalyses[0].id).toBe('second');
      expect(
        mockSendCommand.mock.calls.filter((c) => c[0] === 'interlinearizer.saveDraft')[1][2],
      ).toContain('second');
      expect(result.current.dirty).toBe(false);
    });

    it('sends the draft again when the last write failed, so a later Save is not stuck', async () => {
      const settle = holdDraftWrites();
      const { result } = await renderLoaded();
      jest.useFakeTimers();
      act(() => {
        result.current.autosaveAnalysis(analysisWithToken('retried'));
      });
      act(() => {
        jest.advanceTimersByTime(300);
      });
      jest.useRealTimers();
      await act(async () => {
        settle('reject');
      });
      expect(saveDraftCount()).toBe(1);
      const { copy } = recordingCopy(false);

      let commit: Promise<boolean> | undefined;
      act(() => {
        commit = result.current.commitDraft(copy);
      });

      expect(saveDraftCount()).toBe(2);
      await act(async () => {
        settle('resolve');
        await commit;
      });
      expect(lastSavedDraft().analysis.tokenAnalyses[0].id).toBe('retried');
      expect(copy).toHaveBeenCalledTimes(1);
    });

    it('rejects without copying when the write sent again fails too', async () => {
      const settle = holdDraftWrites();
      const { result } = await renderLoaded();
      jest.useFakeTimers();
      act(() => {
        result.current.autosaveAnalysis(analysisWithToken('doomed'));
      });
      jest.useRealTimers();
      const { copy } = recordingCopy();

      let commit: Promise<boolean> | undefined;
      act(() => {
        commit = result.current.commitDraft(copy);
      });
      await act(async () => {
        settle('reject');
      });
      expect(saveDraftCount()).toBe(2);

      await act(async () => {
        settle('reject');
        await expect(commit).rejects.toThrow('disk full');
      });
      expect(copy).not.toHaveBeenCalled();
      expect(result.current.isSaving).toBe(false);
      expect(result.current.dirty).toBe(true);
    });

    it('resolves false and copies nothing when the draft is replaced while its writes settle', async () => {
      const settle = holdDraftWrites();
      const { result } = await renderLoaded();
      jest.useFakeTimers();
      act(() => {
        result.current.autosaveAnalysis(analysisWithToken('replaced'));
      });
      act(() => {
        jest.advanceTimersByTime(300);
      });
      jest.useRealTimers();
      const { copy } = recordingCopy();
      let commit: Promise<boolean> | undefined;
      act(() => {
        commit = result.current.commitDraft(copy);
      });

      act(() => {
        result.current.wipeAll();
      });
      let landed: boolean | undefined;
      await act(async () => {
        settle('resolve');
        landed = await commit;
      });

      expect(landed).toBe(false);
      expect(copy).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        'Interlinearizer: the draft was replaced during a save, so nothing was saved',
      );
    });

    it('reports the save running until the copy settles', async () => {
      const { result } = await renderLoaded();
      let finish!: (landed: boolean) => void;
      const copy = () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        });
      expect(result.current.isSaving).toBe(false);

      let commit: Promise<boolean> | undefined;
      act(() => {
        commit = result.current.commitDraft(copy);
      });
      await act(async () => {});
      expect(result.current.isSaving).toBe(true);

      await act(async () => {
        finish(true);
        await commit;
      });
      expect(result.current.isSaving).toBe(false);
    });

    it('resolves false without copying while another save is in flight', async () => {
      const { result } = await renderLoaded();
      let finish!: (landed: boolean) => void;
      const first = jest.fn(
        () =>
          new Promise<boolean>((resolve) => {
            finish = resolve;
          }),
      );
      const { copy: second } = recordingCopy();

      let firstCommit: Promise<boolean> | undefined;
      let secondCommit: Promise<boolean> | undefined;
      act(() => {
        firstCommit = result.current.commitDraft(first);
      });
      await act(async () => {});
      act(() => {
        secondCommit = result.current.commitDraft(second);
      });

      await expect(secondCommit).resolves.toBe(false);
      expect(second).not.toHaveBeenCalled();
      await act(async () => {
        finish(true);
        await firstCommit;
      });
    });

    it('leaves the draft dirty when the copy reports that nothing landed', async () => {
      const { result } = await renderLoaded();
      act(() => {
        result.current.autosaveAnalysis(analysisWithToken('unsaved'));
      });

      let landed: boolean | undefined;
      await act(async () => {
        landed = await result.current.commitDraft(async () => false);
      });

      expect(landed).toBe(false);
      expect(result.current.dirty).toBe(true);
    });

    it('rejects and ends the save when the copy rejects', async () => {
      const { result } = await renderLoaded();

      await act(async () => {
        await expect(
          result.current.commitDraft(() => Promise.reject(new Error('host down'))),
        ).rejects.toThrow('host down');
      });

      expect(result.current.isSaving).toBe(false);
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

    it('bumps segmentationVersion on every edit, including when the draft was already dirty', async () => {
      // Re-marking an already-dirty draft causes no re-render, so the version bump is what forces
      // the view to recompute the ref-held segmentation on each edit.
      const { result } = await renderLoaded();

      jest.useFakeTimers();
      const versionBefore = result.current.segmentationVersion;
      act(() => {
        result.current.autosaveSegmentation({ removedVerseStarts: ['GEN 1:2:0'], addedStarts: [] });
      });
      expect(result.current.dirty).toBe(true);
      expect(result.current.segmentationVersion).toBe(versionBefore + 1);

      // A second edit while already dirty must still bump the version so the view recomputes.
      act(() => {
        result.current.autosaveSegmentation({
          removedVerseStarts: [],
          addedStarts: [{ tokenRef: 'GEN 1:1:6', surfaceText: 'beta' }],
        });
      });
      expect(result.current.segmentationVersion).toBe(versionBefore + 2);

      act(() => {
        jest.advanceTimersByTime(300);
      });
      jest.useRealTimers();
    });

    it('leaves a clean draft clean when an edit keeps the boundaries it has', async () => {
      const { result } = await renderLoaded();

      act(() => result.current.autosaveSegmentation(undefined));

      expect(result.current.dirty).toBe(false);
    });

    it('does not bump segmentationVersion for an edit that keeps the boundaries it has', async () => {
      const { result } = await renderLoaded();
      const versionBefore = result.current.segmentationVersion;

      act(() => result.current.autosaveSegmentation(undefined));

      expect(result.current.segmentationVersion).toBe(versionBefore);
    });

    it('replaces a pending debounced write when called again before it flushes', async () => {
      const { result } = await renderLoaded();

      jest.useFakeTimers();
      act(() => {
        result.current.autosaveSegmentation({ removedVerseStarts: ['GEN 1:2:0'], addedStarts: [] });
      });
      // A second call before the debounce fires clears the pending timer and schedules a new write.
      act(() => {
        result.current.autosaveSegmentation({
          removedVerseStarts: [],
          addedStarts: [{ tokenRef: 'GEN 1:1:6', surfaceText: 'beta' }],
        });
      });
      act(() => {
        jest.advanceTimersByTime(300);
      });
      jest.useRealTimers();

      expect(lastSavedDraft().segmentation).toEqual({
        removedVerseStarts: [],
        addedStarts: [{ tokenRef: 'GEN 1:1:6', surfaceText: 'beta' }],
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

      const delta = {
        removedVerseStarts: ['GEN 1:2:0'],
        addedStarts: [{ tokenRef: 'GEN 1:1:6', surfaceText: 'beta' }],
      };
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
        tokenAnalyses: [
          ...genToken.tokenAnalyses,
          { ...FIXTURE_STAMPS, id: 'mat-tok', surfaceText: 'word' },
        ],
        tokenAnalysisLinks: [
          ...genToken.tokenAnalysisLinks,
          {
            id: 'tl-2',
            ...FIXTURE_STAMPS,
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

    it('drops the wiped book’s custom boundaries while keeping other books’', async () => {
      mockGetDraftResolves(
        makeDraft({
          segmentation: { removedVerseStarts: ['GEN 1:2:0', 'MAT 3:4:0'], addedStarts: [] },
        }),
      );
      const { result } = await renderLoaded();

      act(() => {
        result.current.wipeBook('GEN');
      });

      const expected = { removedVerseStarts: ['MAT 3:4:0'], addedStarts: [] };
      expect(result.current.draft?.segmentation).toEqual(expected);
      expect(lastSavedDraft().segmentation).toEqual(expected);
    });

    it('clears the segmentation field entirely when only the wiped book had boundaries', async () => {
      mockGetDraftResolves(
        makeDraft({
          segmentation: {
            removedVerseStarts: ['GEN 1:2:0'],
            addedStarts: [{ tokenRef: 'GEN 1:3:5', surfaceText: 'word' }],
          },
        }),
      );
      const { result } = await renderLoaded();

      act(() => {
        result.current.wipeBook('GEN');
      });

      expect(result.current.draft?.segmentation).toBeUndefined();
      expect(lastSavedDraft().segmentation).toBeUndefined();
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

  describe('marking the draft synced after a save', () => {
    it('clears dirty and persists the synced draft without bumping the version', async () => {
      const { result } = await renderLoaded();
      // Make the draft dirty first so the transition to synced is observable.
      act(() => {
        result.current.autosaveAnalysis(analysisWithToken('tok-sync'));
      });
      expect(result.current.dirty).toBe(true);
      const versionBefore = result.current.draftVersion;

      await saveNow(result);

      expect(result.current.dirty).toBe(false);
      expect(result.current.draftVersion).toBe(versionBefore);
      expect(lastSavedDraft().dirty).toBe(false);
    });

    it('leaves the draft dirty when an edit landed during the copy', async () => {
      const { result } = await renderLoaded();
      act(() => {
        result.current.autosaveAnalysis(analysisWithToken('tok-saved'));
      });

      await act(async () => {
        await result.current.commitDraft(async () => {
          // A newer edit lands during the save round-trip, replacing the ref's analysis.
          act(() => {
            result.current.autosaveAnalysis(analysisWithToken('tok-newer'));
          });
          return true;
        });
      });

      expect(result.current.dirty).toBe(true);
    });

    it('leaves the draft dirty when a segmentation edit landed during the copy', async () => {
      const { result } = await renderLoaded();
      act(() => {
        result.current.autosaveAnalysis(analysisWithToken('tok-saved'));
      });

      await act(async () => {
        await result.current.commitDraft(async () => {
          // A boundary edit carries the analysis over by reference, so only the segmentation
          // identity distinguishes the ref from the snapshot the copy saved.
          act(() => {
            result.current.autosaveSegmentation({
              removedVerseStarts: ['GEN 1:2:0'],
              addedStarts: [],
            });
          });
          return true;
        });
      });

      expect(result.current.dirty).toBe(true);
    });

    it('clears dirty over a boundary edit the copy saved', async () => {
      const { result } = await renderLoaded();
      const delta = { removedVerseStarts: ['GEN 1:2:0'], addedStarts: [] };
      act(() => {
        result.current.autosaveSegmentation(delta);
      });
      expect(result.current.dirty).toBe(true);

      await saveNow(result);

      expect(result.current.dirty).toBe(false);
      const saved = lastSavedDraft();
      expect(saved.dirty).toBe(false);
      expect(saved.segmentation).toEqual(delta);
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

  describe('undo history', () => {
    it('drops the history when the source changes', async () => {
      const view = renderHook(({ source }) => useDraftProject(source, PLATFORM_LANGUAGE), {
        initialProps: { source: SOURCE_PROJECT_ID },
      });
      await waitFor(() => expect(view.result.current.isDraftLoading).toBe(false));
      act(() => view.result.current.autosaveAnalysis(analysisWithToken('tok-edited')));

      view.rerender({ source: 'source-project-2' });
      await waitFor(() => expect(view.result.current.isDraftLoading).toBe(false));

      expect(view.result.current.canUndo).toBe(false);
    });

    it('undoes an analysis edit back to the analysis before it', async () => {
      const loaded = analysisWithToken('tok-loaded');
      mockGetDraftResolves(makeDraft({ analysis: loaded }));
      const { result } = await renderLoaded();

      act(() => result.current.autosaveAnalysis(analysisWithToken('tok-edited')));
      act(() => result.current.undo());

      expect(result.current.getDraftSnapshot()?.analysis).toEqual(loaded);
    });

    it('hands the analysis an undo restores to subscribers', async () => {
      const loaded = analysisWithToken('tok-loaded');
      mockGetDraftResolves(makeDraft({ analysis: loaded }));
      const { result } = await renderLoaded();
      const listener = jest.fn();
      result.current.subscribeToAnalysisReplacements(listener);

      act(() => result.current.autosaveAnalysis(analysisWithToken('tok-edited')));
      act(() => result.current.undo());

      expect(listener).toHaveBeenCalledWith(loaded);
    });

    it('does not hand subscribers an edit the analysis store made itself', async () => {
      const { result } = await renderLoaded();
      const listener = jest.fn();
      result.current.subscribeToAnalysisReplacements(listener);

      act(() => result.current.autosaveAnalysis(analysisWithToken('tok-edited')));

      expect(listener).not.toHaveBeenCalled();
    });

    it('stops handing analyses to a listener once it unsubscribes', async () => {
      const { result } = await renderLoaded();
      const listener = jest.fn();
      const unsubscribe = result.current.subscribeToAnalysisReplacements(listener);

      unsubscribe();
      act(() => result.current.autosaveAnalysis(analysisWithToken('tok-edited')));
      act(() => result.current.undo());

      expect(listener).not.toHaveBeenCalled();
    });

    it('undoes a boundary edit back to the boundaries before it', async () => {
      const { result } = await renderLoaded();

      act(() =>
        result.current.autosaveSegmentation({ removedVerseStarts: ['GEN 1:2:0'], addedStarts: [] }),
      );
      act(() => result.current.undo());

      expect(result.current.getDraftSnapshot()?.segmentation).toBeUndefined();
    });

    it('redoes an undone boundary edit', async () => {
      const { result } = await renderLoaded();
      const delta = { removedVerseStarts: ['GEN 1:2:0'], addedStarts: [] };

      act(() => result.current.autosaveSegmentation(delta));
      act(() => result.current.undo());
      act(() => result.current.redo());

      expect(result.current.getDraftSnapshot()?.segmentation).toBe(delta);
    });

    it('bumps segmentationVersion when an undo changes the boundaries', async () => {
      const { result } = await renderLoaded();
      act(() =>
        result.current.autosaveSegmentation({ removedVerseStarts: ['GEN 1:2:0'], addedStarts: [] }),
      );
      const versionBefore = result.current.segmentationVersion;

      act(() => result.current.undo());

      expect(result.current.segmentationVersion).toBe(versionBefore + 1);
    });

    it('redoes an undone edit', async () => {
      const { result } = await renderLoaded();
      const edited = analysisWithToken('tok-edited');

      act(() => result.current.autosaveAnalysis(edited));
      act(() => result.current.undo());
      act(() => result.current.redo());

      expect(result.current.getDraftSnapshot()?.analysis).toBe(edited);
    });

    it('records no step for a save that changes nothing', async () => {
      const loaded = analysisWithToken('tok-loaded');
      mockGetDraftResolves(makeDraft({ analysis: loaded }));
      const { result } = await renderLoaded();
      const edited = analysisWithToken('tok-edited');

      act(() => result.current.autosaveAnalysis(edited));
      act(() => result.current.autosaveAnalysis(edited));
      act(() => result.current.undo());

      expect(result.current.getDraftSnapshot()?.analysis).toEqual(loaded);
    });

    it('undoes the saves made as one step together', async () => {
      const loaded = analysisWithToken('tok-loaded');
      mockGetDraftResolves(makeDraft({ analysis: loaded }));
      const { result } = await renderLoaded();

      act(() =>
        result.current.asOneStep(() => {
          result.current.autosaveAnalysis(analysisWithToken('tok-edited'));
          result.current.autosaveSegmentation({
            removedVerseStarts: ['GEN 1:2:0'],
            addedStarts: [],
          });
        }),
      );
      act(() => result.current.undo());

      expect(result.current.getDraftSnapshot()?.analysis).toEqual(loaded);
      expect(result.current.getDraftSnapshot()?.segmentation).toBeUndefined();
    });

    it('leaves the draft clean when there is nothing to undo', async () => {
      const { result } = await renderLoaded();

      act(() => result.current.undo());

      expect(result.current.dirty).toBe(false);
    });

    it('forgets the history when a project is opened', async () => {
      const { result } = await renderLoaded();
      const opened = analysisWithToken('tok-open');

      act(() => result.current.autosaveAnalysis(analysisWithToken('tok-edited')));
      act(() => result.current.loadFromProject({ analysis: opened, analysisLanguages: ['de'] }));
      act(() => result.current.undo());

      expect(result.current.getDraftSnapshot()?.analysis).toBe(opened);
    });

    it('forgets the history when a new draft is started', async () => {
      mockGetDraftResolves(makeDraft({ analysis: analysisWithToken('tok-loaded') }));
      const { result } = await renderLoaded();

      act(() => result.current.autosaveAnalysis(analysisWithToken('tok-edited')));
      act(() => result.current.newDraft({ analysisLanguages: ['sw'] }));
      act(() => result.current.undo());

      expect(result.current.getDraftSnapshot()?.analysis).toEqual(emptyAnalysis());
    });

    it('has nothing to undo or redo before any edit', async () => {
      const { result } = await renderLoaded();

      expect(result.current.canUndo).toBe(false);
      expect(result.current.canRedo).toBe(false);
    });

    it('can undo once an edit is made', async () => {
      const { result } = await renderLoaded();

      act(() => result.current.autosaveAnalysis(analysisWithToken('tok-edited')));

      expect(result.current.canUndo).toBe(true);
    });

    it('can redo once an edit is undone', async () => {
      const { result } = await renderLoaded();

      act(() => result.current.autosaveAnalysis(analysisWithToken('tok-edited')));
      act(() => result.current.undo());

      expect(result.current.canRedo).toBe(true);
      expect(result.current.canUndo).toBe(false);
    });

    it('has nothing to undo once a project is opened', async () => {
      const { result } = await renderLoaded();

      act(() => result.current.autosaveAnalysis(analysisWithToken('tok-edited')));
      act(() =>
        result.current.loadFromProject({ analysis: emptyAnalysis(), analysisLanguages: [] }),
      );

      expect(result.current.canUndo).toBe(false);
    });

    describe('wipes', () => {
      it('undoes a book wipe', async () => {
        const loaded = analysisWithToken('tok-loaded');
        mockGetDraftResolves(makeDraft({ analysis: loaded }));
        const { result } = await renderLoaded();

        act(() => result.current.wipeBook('GEN'));
        act(() => {
          result.current.undo();
        });

        expect(result.current.getDraftSnapshot()?.analysis).toEqual(loaded);
      });

      it('undoes a whole-draft wipe', async () => {
        const loaded = analysisWithToken('tok-loaded');
        mockGetDraftResolves(makeDraft({ analysis: loaded }));
        const { result } = await renderLoaded();

        act(() => result.current.wipeAll());
        act(() => {
          result.current.undo();
        });

        expect(result.current.getDraftSnapshot()?.analysis).toEqual(loaded);
      });

      it('keeps the edits made before a wipe undoable', async () => {
        const loaded = analysisWithToken('tok-loaded');
        mockGetDraftResolves(makeDraft({ analysis: loaded }));
        const { result } = await renderLoaded();

        act(() => result.current.autosaveAnalysis(analysisWithToken('tok-edited')));
        act(() => result.current.wipeAll());
        act(() => {
          result.current.undo();
        });
        act(() => {
          result.current.undo();
        });

        expect(result.current.getDraftSnapshot()?.analysis).toEqual(loaded);
      });

      it('is clean after undoing a whole-draft wipe of a clean draft', async () => {
        mockGetDraftResolves(makeDraft({ analysis: analysisWithToken('tok-loaded') }));
        const { result } = await renderLoaded();

        act(() => result.current.wipeAll());
        act(() => {
          result.current.undo();
        });

        expect(result.current.dirty).toBe(false);
      });

      it('is dirty after undoing a whole-draft wipe back to an unsaved edit', async () => {
        mockGetDraftResolves(makeDraft({ analysis: analysisWithToken('tok-loaded') }));
        const { result } = await renderLoaded();

        act(() => result.current.autosaveAnalysis(analysisWithToken('tok-edited')));
        act(() => result.current.wipeAll());
        act(() => {
          result.current.undo();
        });

        expect(result.current.dirty).toBe(true);
      });

      it('is clean once undo passes back through a wipe to the loaded content', async () => {
        mockGetDraftResolves(makeDraft({ analysis: analysisWithToken('tok-loaded') }));
        const { result } = await renderLoaded();

        act(() => result.current.autosaveAnalysis(analysisWithToken('tok-edited')));
        act(() => result.current.wipeAll());
        act(() => {
          result.current.undo();
        });
        act(() => {
          result.current.undo();
        });

        expect(result.current.dirty).toBe(false);
      });

      it('is dirty after undoing back to a wipe made before the last save', async () => {
        const { result } = await renderLoaded();
        const saved = analysisWithToken('tok-saved');

        act(() => result.current.wipeAll());
        act(() => result.current.autosaveAnalysis(saved));
        await saveNow(result);
        act(() => {
          result.current.undo();
        });

        expect(result.current.dirty).toBe(true);
      });

      it('is clean again after redoing a whole-draft wipe', async () => {
        mockGetDraftResolves(makeDraft({ analysis: analysisWithToken('tok-loaded') }));
        const { result } = await renderLoaded();

        act(() => result.current.wipeAll());
        act(() => {
          result.current.undo();
        });
        act(() => {
          result.current.redo();
        });

        expect(result.current.dirty).toBe(false);
      });
    });

    describe('history revision', () => {
      it('moves when a step is recorded', async () => {
        const { result } = await renderLoaded();
        const before = result.current.getHistoryRevision();

        act(() => result.current.autosaveAnalysis(analysisWithToken('tok-edited')));

        expect(result.current.getHistoryRevision()).not.toBe(before);
      });

      it('moves when a step is undone', async () => {
        const { result } = await renderLoaded();
        act(() => result.current.autosaveAnalysis(analysisWithToken('tok-edited')));
        const before = result.current.getHistoryRevision();

        act(() => {
          result.current.undo();
        });

        expect(result.current.getHistoryRevision()).not.toBe(before);
      });

      it('holds still through a re-anchor', async () => {
        mockGetDraftResolves(makeDraft({ analysis: analysisWithToken('tok') }));
        const { result } = await renderLoaded();
        act(() => result.current.autosaveAnalysis(analysisWithToken('tok-edited')));
        const before = result.current.getHistoryRevision();

        act(() =>
          result.current.reanchorBook('GEN', (content) => ({
            ...content,
            analysis: analysisWithToken('tok-reanchored'),
          })),
        );

        expect(result.current.getHistoryRevision()).toBe(before);
      });

      it('tells subscribers when it moves', async () => {
        const { result } = await renderLoaded();
        const listener = jest.fn();
        result.current.subscribeToHistoryRevisions(listener);

        act(() => result.current.autosaveAnalysis(analysisWithToken('tok-edited')));

        expect(listener).toHaveBeenCalledTimes(1);
      });

      it('stops telling a subscriber once it unsubscribes', async () => {
        const { result } = await renderLoaded();
        const listener = jest.fn();
        const unsubscribe = result.current.subscribeToHistoryRevisions(listener);

        unsubscribe();
        act(() => result.current.autosaveAnalysis(analysisWithToken('tok-edited')));

        expect(listener).not.toHaveBeenCalled();
      });
    });

    describe('step summaries', () => {
      it('summarizes a grouped step as it was told to', async () => {
        const { result } = await renderLoaded();

        act(() =>
          result.current.asOneStep(
            () => result.current.autosaveAnalysis(analysisWithToken('tok-edited')),
            { kind: 'catalogDelete', form: 'word', analysisId: 'ta-1', count: 2 },
          ),
        );
        let summary: StepSummary | undefined;
        act(() => {
          summary = result.current.undo()?.summary;
        });

        expect(summary).toEqual({
          kind: 'catalogDelete',
          form: 'word',
          analysisId: 'ta-1',
          count: 2,
        });
      });

      it('summarizes a grouped step by what its action returned', async () => {
        const { result } = await renderLoaded();

        act(() =>
          result.current.asOneStep(
            () => {
              result.current.autosaveAnalysis(analysisWithToken('tok-edited'));
              return 'ta-3';
            },
            (survivor) => ({
              kind: 'catalogMerge',
              form: 'word',
              analysisId: 'ta-1',
              survivingAnalysisId: survivor,
            }),
          ),
        );
        let summary: StepSummary | undefined;
        act(() => {
          summary = result.current.undo()?.summary;
        });

        expect(summary).toEqual({
          kind: 'catalogMerge',
          form: 'word',
          analysisId: 'ta-1',
          survivingAnalysisId: 'ta-3',
        });
      });
    });

    describe('edit locations', () => {
      it('names where an undone edit was made', async () => {
        const { result } = await renderLoaded();

        act(() => result.current.autosaveAnalysis(analysisWithToken('tok-edited'), 'GEN 1:1:0'));
        let location: string | undefined;
        act(() => {
          location = result.current.undo()?.location;
        });

        expect(location).toBe('GEN 1:1:0');
      });

      it('names where a redone edit was made', async () => {
        const { result } = await renderLoaded();

        act(() => result.current.autosaveAnalysis(analysisWithToken('tok-edited'), 'GEN 1:1:0'));
        act(() => {
          result.current.undo();
        });
        let location: string | undefined;
        act(() => {
          location = result.current.redo()?.location;
        });

        expect(location).toBe('GEN 1:1:0');
      });

      it('names where an undone boundary edit was made', async () => {
        const { result } = await renderLoaded();

        act(() =>
          result.current.autosaveSegmentation(
            { removedVerseStarts: [], addedStarts: [{ tokenRef: 'GEN 1:1:6', surfaceText: 'b' }] },
            'GEN 1:1:6',
          ),
        );
        let location: string | undefined;
        act(() => {
          location = result.current.undo()?.location;
        });

        expect(location).toBe('GEN 1:1:6');
      });

      it('names a grouped step by where its first edit was made', async () => {
        const { result } = await renderLoaded();

        act(() =>
          result.current.asOneStep(() => {
            result.current.autosaveAnalysis(analysisWithToken('tok-edited'), 'GEN 1:1:0');
            result.current.autosaveSegmentation(
              { removedVerseStarts: ['GEN 1:2:0'], addedStarts: [] },
              'GEN 1:2:0',
            );
          }),
        );
        let location: string | undefined;
        act(() => {
          location = result.current.undo()?.location;
        });

        expect(location).toBe('GEN 1:1:0');
      });
    });

    describe('dirty baseline', () => {
      it('is clean again when an undo returns to the loaded content', async () => {
        const { result } = await renderLoaded();

        act(() => result.current.autosaveAnalysis(analysisWithToken('tok-edited')));
        act(() => result.current.undo());

        expect(result.current.dirty).toBe(false);
      });

      it('stays dirty when an undo lands on content that was never synced', async () => {
        const { result } = await renderLoaded();

        act(() => result.current.autosaveAnalysis(analysisWithToken('tok-first')));
        act(() => result.current.autosaveAnalysis(analysisWithToken('tok-second')));
        act(() => result.current.undo());

        expect(result.current.dirty).toBe(true);
      });

      it('is clean again when an undo returns to the last saved content', async () => {
        const { result } = await renderLoaded();
        const saved = analysisWithToken('tok-saved');

        act(() => result.current.autosaveAnalysis(saved));
        await saveNow(result);
        act(() => result.current.autosaveAnalysis(analysisWithToken('tok-after-save')));
        act(() => result.current.undo());

        expect(result.current.dirty).toBe(false);
      });

      it('is clean again when an undo returns to an opened project', async () => {
        const { result } = await renderLoaded();

        act(() =>
          result.current.loadFromProject({
            analysis: analysisWithToken('tok-open'),
            analysisLanguages: ['de'],
          }),
        );
        act(() => result.current.autosaveAnalysis(analysisWithToken('tok-edited')));
        act(() => result.current.undo());

        expect(result.current.dirty).toBe(false);
      });

      it('stays dirty when an undo reaches a state saved under the history an Open replaced', async () => {
        const { result } = await renderLoaded();
        const saved = analysisWithToken('tok-saved');

        act(() => result.current.autosaveAnalysis(analysisWithToken('tok-first')));
        act(() => result.current.autosaveAnalysis(saved));
        await saveNow(result);
        act(() =>
          result.current.loadFromProject({
            analysis: analysisWithToken('tok-open'),
            analysisLanguages: ['de'],
          }),
        );
        act(() => result.current.autosaveAnalysis(analysisWithToken('tok-a')));
        act(() => result.current.autosaveAnalysis(analysisWithToken('tok-b')));
        act(() => result.current.autosaveAnalysis(analysisWithToken('tok-c')));
        act(() => result.current.undo());

        expect(result.current.dirty).toBe(true);
      });

      it('stays dirty after undoing into a draft that loaded unsaved', async () => {
        mockGetDraftResolves(makeDraft({ dirty: true }));
        const { result } = await renderLoaded();

        act(() => result.current.autosaveAnalysis(analysisWithToken('tok-edited')));
        act(() => result.current.undo());

        expect(result.current.dirty).toBe(true);
      });

      it('persists the draft as clean once an undo returns it to the baseline', async () => {
        const { result } = await renderLoaded();

        jest.useFakeTimers();
        act(() => result.current.autosaveAnalysis(analysisWithToken('tok-edited')));
        act(() => result.current.undo());
        act(() => jest.advanceTimersByTime(300));
        jest.useRealTimers();

        expect(lastSavedDraft().dirty).toBe(false);
      });
    });

    describe('re-anchoring', () => {
      /** A pass that renames the content's token analysis, so a test can see where it ran. */
      const renameToken =
        (suffix: string) =>
        (content: DraftContent): DraftContent => ({
          ...content,
          analysis: analysisWithToken(`${content.analysis.tokenAnalyses[0]?.id}${suffix}`),
        });

      it("applies a book's pass to the draft", async () => {
        mockGetDraftResolves(makeDraft({ analysis: analysisWithToken('tok') }));
        const { result } = await renderLoaded();

        act(() => result.current.reanchorBook('GEN', renameToken('+GEN')));

        expect(result.current.getDraftSnapshot()?.analysis.tokenAnalyses[0].id).toBe('tok+GEN');
      });

      it('keeps a re-anchor when the edit before it is undone', async () => {
        mockGetDraftResolves(makeDraft({ analysis: analysisWithToken('tok-loaded') }));
        const { result } = await renderLoaded();

        act(() => result.current.autosaveAnalysis(analysisWithToken('tok-edited')));
        act(() => result.current.reanchorBook('GEN', renameToken('+GEN')));
        act(() => result.current.undo());

        expect(result.current.getDraftSnapshot()?.analysis.tokenAnalyses[0].id).toBe(
          'tok-loaded+GEN',
        );
      });

      it('hands a re-anchored analysis to subscribers', async () => {
        mockGetDraftResolves(makeDraft({ analysis: analysisWithToken('tok') }));
        const { result } = await renderLoaded();
        const listener = jest.fn();
        result.current.subscribeToAnalysisReplacements(listener);

        act(() => result.current.reanchorBook('GEN', renameToken('+GEN')));

        expect(listener).toHaveBeenCalledWith(analysisWithToken('tok+GEN'));
      });

      it('leaves the draft clean when a pass moves nothing', async () => {
        const { result } = await renderLoaded();

        act(() => result.current.reanchorBook('GEN', (content) => content));

        expect(result.current.dirty).toBe(false);
      });

      it('leaves a clean draft clean when a pass moves something', async () => {
        mockGetDraftResolves(makeDraft({ analysis: analysisWithToken('tok') }));
        const { result } = await renderLoaded();

        act(() => result.current.reanchorBook('GEN', renameToken('+GEN')));

        expect(result.current.dirty).toBe(false);
      });

      it('keeps an edited draft dirty through a re-anchor', async () => {
        mockGetDraftResolves(makeDraft({ analysis: analysisWithToken('tok') }));
        const { result } = await renderLoaded();

        act(() => result.current.autosaveAnalysis(analysisWithToken('tok-edited')));
        act(() => result.current.reanchorBook('GEN', renameToken('+GEN')));

        expect(result.current.dirty).toBe(true);
      });

      it('is clean again once an edit is undone past two passes over its book', async () => {
        mockGetDraftResolves(makeDraft({ analysis: analysisWithToken('tok') }));
        const { result } = await renderLoaded();

        act(() => result.current.autosaveAnalysis(analysisWithToken('tok-edited')));
        act(() => result.current.reanchorBook('GEN', renameToken('+a')));
        act(() => result.current.reanchorBook('GEN', renameToken('+b')));
        act(() => result.current.undo());

        expect(result.current.dirty).toBe(false);
      });

      it('replays a pass run twice only once on undo', async () => {
        mockGetDraftResolves(makeDraft({ analysis: analysisWithToken('tok-loaded') }));
        const { result } = await renderLoaded();
        const pass = renameToken('+GEN');

        act(() => result.current.autosaveAnalysis(analysisWithToken('tok-edited')));
        act(() => result.current.reanchorBook('GEN', pass));
        act(() => result.current.reanchorBook('GEN', pass));
        act(() => result.current.undo());

        expect(result.current.getDraftSnapshot()?.analysis.tokenAnalyses[0].id).toBe(
          'tok-loaded+GEN',
        );
      });

      it('is clean again once the edit before a re-anchor is undone', async () => {
        mockGetDraftResolves(makeDraft({ analysis: analysisWithToken('tok') }));
        const { result } = await renderLoaded();

        act(() => result.current.autosaveAnalysis(analysisWithToken('tok-edited')));
        act(() => result.current.reanchorBook('GEN', renameToken('+GEN')));
        act(() => result.current.undo());

        expect(result.current.dirty).toBe(false);
      });
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

    // Resolve after unmount: the stale-load guard must skip the ref/state publish.
    await act(async () => {
      resolveGetDraft(JSON.stringify(makeDraft()));
      await deferred;
    });

    // State stayed at its last mounted value (still loading) and no error was logged.
    expect(result.current.isDraftLoading).toBe(true);
    expect(jest.mocked(logger.error)).not.toHaveBeenCalled();
  });
});
