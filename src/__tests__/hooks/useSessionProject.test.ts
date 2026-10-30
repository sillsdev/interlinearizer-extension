/// <reference types="jest" />

import papi, { logger } from '@papi/frontend';
import { act, renderHook, waitFor } from '@testing-library/react';
import useSessionProject from '../../hooks/useSessionProject';
import { emptyAnalysis } from '../../types/empty-factories';
import { fakeHost } from '../cache/fake-host';
import { ref } from '../cache/session-source';

const SCR_REF = { book: 'GEN', chapterNum: 1, verseNum: 1 };

/** Renders the hook over the source `src`, saving to `saveTargetId` or viewing `importProjectId`. */
function renderProject(saveTargetId?: string, importProjectId?: string) {
  const initialProps: Partial<Record<'saveTargetId' | 'importProjectId', string>> = {
    saveTargetId,
    importProjectId,
  };
  return renderHook(
    (props: Partial<Record<'saveTargetId' | 'importProjectId', string>>) =>
      useSessionProject('src', 'en', {
        saveTargetId: props.saveTargetId,
        importProjectId: props.importProjectId,
        bookId: 'GEN',
        scrRef: SCR_REF,
      }),
    { initialProps },
  );
}

/** Renders the hook and waits until its session's draft and pages have loaded. */
async function renderLoaded() {
  const host = await fakeHost();
  const rendered = renderProject();
  await waitFor(() => expect(rendered.result.current.session?.client).toBeDefined());
  return { host, ...rendered };
}

describe('useSessionProject', () => {
  it('opens a session on the source, showing its draft once it has loaded', async () => {
    await fakeHost();

    const { result } = renderProject();

    expect(result.current.isDraftLoading).toBe(true);
    await waitFor(() => expect(result.current.isDraftLoading).toBe(false));
    expect(result.current.draft?.analysisLanguages).toStrictEqual(['en']);
    expect(papi.commands.sendCommand).toHaveBeenCalledWith('interlinearizer.openSession', {
      sourceProjectId: 'src',
    });
  });

  it('opens the session on the interlinear project the draft saves to', async () => {
    await fakeHost();

    renderProject('proj-1');

    await waitFor(() =>
      expect(papi.commands.sendCommand).toHaveBeenCalledWith('interlinearizer.openSession', {
        sourceProjectId: 'src',
        interlinearProjectId: 'proj-1',
      }),
    );
  });

  it('closes a session that opens after the view has unmounted', async () => {
    await fakeHost();
    const { unmount } = renderProject();

    unmount();

    await waitFor(() =>
      expect(papi.commands.sendCommand).toHaveBeenCalledWith('interlinearizer.closeSession', {
        sessionId: expect.any(String),
      }),
    );
  });

  it('closes its session once unmounted', async () => {
    const { result, unmount } = await renderLoaded();
    const sessionId = result.current.session?.sessionId;

    unmount();

    await waitFor(() =>
      expect(papi.commands.sendCommand).toHaveBeenCalledWith('interlinearizer.closeSession', {
        sessionId,
      }),
    );
  });

  it('reads the draft again once the session reports a change', async () => {
    const { result } = await renderLoaded();

    await act(async () => {
      await result.current.session?.client?.send((changeId) =>
        papi.commands
          .sendCommand('interlinearizer.writeGloss', {
            sessionId: result.current.session?.sessionId ?? '',
            changeId,
            tokenRef: ref('earth'),
            surfaceText: 'earth',
            value: 'land',
          })
          .then((reply) => JSON.parse(reply)),
      );
    });

    await waitFor(() => expect(result.current.dirty).toBe(true));
    expect(result.current.draft?.analysis.tokenAnalyses.map(({ id }) => id)).toContain('ta-land');
  });
});

/** Glosses "earth" through the hook's session, as a gloss input would. */
async function glossEarth(
  result: { current: ReturnType<typeof useSessionProject> },
  value: string,
) {
  await act(async () => {
    await result.current.session?.client?.send((changeId) =>
      papi.commands
        .sendCommand('interlinearizer.writeGloss', {
          sessionId: result.current.session?.sessionId ?? '',
          changeId,
          tokenRef: ref('earth'),
          surfaceText: 'earth',
          value,
        })
        .then((reply) => JSON.parse(reply)),
    );
  });
}

/** A reply in the shape that the host gives a discard, for an edit that changed nothing. */
const EMPTY_REPLY = JSON.stringify({
  changeId: 'c',
  changes: { intent: 'x' },
  poolBuckets: {},
  poolAnalyses: [],
  resegmentedBooks: [],
  staleTranslationBooks: [],
  canUndo: true,
  canRedo: false,
  hasFreeTranslations: true,
});

describe('useSessionProject history', () => {
  it('undoes an edit through the session, handing back its step', async () => {
    const { result } = await renderLoaded();
    await glossEarth(result, 'land');
    expect(result.current.canUndo).toBe(true);

    let step: unknown;
    await act(async () => {
      step = await result.current.undo();
    });

    expect(step).toStrictEqual({ location: ref('earth') });
    expect(result.current).toMatchObject({ canUndo: false, canRedo: true });
  });

  it('redoes an undone edit through the session', async () => {
    const { result } = await renderLoaded();
    await glossEarth(result, 'land');
    await act(async () => {
      await result.current.undo();
    });

    let step: unknown;
    await act(async () => {
      step = await result.current.redo();
    });

    expect(step).toStrictEqual({ location: ref('earth') });
    expect(result.current).toMatchObject({ canUndo: true, canRedo: false });
  });

  it('runs an action grouped as one step at once, the session recording each edit', async () => {
    const { result } = await renderLoaded();

    expect(result.current.asOneStep(() => 3)).toBe(3);
  });

  it("reads the draft as the session's latest read of it stands", async () => {
    const { result } = await renderLoaded();

    expect(result.current.getDraftSnapshot()).toBe(result.current.draft);
  });

  it('finds nothing to undo in a fresh session', async () => {
    const { result } = await renderLoaded();

    let step: unknown = 'none yet';
    await act(async () => {
      step = await result.current.undo();
    });

    expect(step).toBeUndefined();
    expect(result.current.canUndo).toBe(false);
  });

  it('tells each history listener when the history moves, until it unsubscribes', async () => {
    const { result } = await renderLoaded();
    const listener = jest.fn();
    const unsubscribe = result.current.subscribeToHistoryRevisions(listener);
    const before = result.current.getHistoryRevision();

    await glossEarth(result, 'land');
    unsubscribe();
    await glossEarth(result, 'soil');

    expect(listener).toHaveBeenCalledTimes(1);
    expect(result.current.getHistoryRevision()).toBeGreaterThan(before);
  });

  it('logs an undo the session refuses', async () => {
    const { result } = await renderLoaded();
    jest.mocked(papi.commands.sendCommand).mockRejectedValueOnce(new Error('read-only'));

    await act(async () => {
      await result.current.undo();
    });

    expect(logger.error).toHaveBeenCalledWith(
      'Interlinearizer: failed to interlinearizer.undoEdit',
      expect.any(Error),
    );
  });

  it('keeps the edit to undo when an undo fails', async () => {
    const { result } = await renderLoaded();
    await glossEarth(result, 'land');
    jest.mocked(papi.commands.sendCommand).mockRejectedValueOnce(new Error('closed'));

    await act(async () => {
      await result.current.undo();
    });

    expect(result.current).toMatchObject({ canUndo: true, canRedo: false });
  });

  it('keeps the edit to undo when there is nothing to redo', async () => {
    const { result } = await renderLoaded();
    await glossEarth(result, 'land');

    let step: unknown = 'none yet';
    await act(async () => {
      step = await result.current.redo();
    });

    expect(step).toBeUndefined();
    expect(result.current).toMatchObject({ canUndo: true, canRedo: false });
  });
});

describe('useSessionProject saving', () => {
  it('saves the draft as it stands through its session, reading it again once saved', async () => {
    const { result } = await renderLoaded();
    await glossEarth(result, 'land');
    const copy = jest.fn(async () => true);

    let saved: boolean | undefined;
    await act(async () => {
      saved = await result.current.commitDraft(copy);
    });

    expect(saved).toBe(true);
    expect(copy).toHaveBeenCalledWith(
      expect.objectContaining({ sourceProjectId: 'src' }),
      result.current.session?.sessionId,
    );
    expect(result.current.isSaving).toBe(false);
  });

  it('reports a copy that did not land as unsaved', async () => {
    const { result } = await renderLoaded();

    let saved: boolean | undefined;
    await act(async () => {
      saved = await result.current.commitDraft(async () => false);
    });

    expect(saved).toBe(false);
  });

  it('holds a second save while one runs', async () => {
    const { result } = await renderLoaded();
    let finish: (copied: boolean) => void = () => {};
    let first: Promise<boolean> | undefined;
    act(() => {
      first = result.current.commitDraft(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
    });
    expect(result.current.isSaving).toBe(true);

    let second: boolean | undefined;
    await act(async () => {
      second = await result.current.commitDraft(async () => true);
    });
    await act(async () => {
      finish(true);
      await first;
    });

    expect(second).toBe(false);
  });
});

describe('useSessionProject starting over', () => {
  it('opens a fresh session on a new, empty draft', async () => {
    const { result } = await renderLoaded();
    const { sessionId } = result.current.session ?? {};
    const version = result.current.draftVersion;
    await glossEarth(result, 'land');

    await act(async () => {
      result.current.newDraft({ analysisLanguages: ['fr'], suggestedName: 'N' });
    });

    await waitFor(() => expect(result.current.session?.sessionId).not.toBe(sessionId));
    await waitFor(() => expect(result.current.draft?.analysisLanguages).toStrictEqual(['fr']));
    expect(result.current.draft?.analysis.tokenAnalyses).toStrictEqual([]);
    expect(result.current.draftVersion).toBeGreaterThan(version);
    expect(result.current.canUndo).toBe(false);
  });

  it("opens a fresh session on a project's content", async () => {
    const { result } = await renderLoaded();
    const { sessionId } = result.current.session ?? {};

    await act(async () => {
      result.current.loadFromProject({
        analysis: emptyAnalysis(),
        analysisLanguages: ['de'],
        targetProjectId: 'tgt',
        segmentation: { removedVerseStarts: [], addedStarts: [] },
      });
    });

    await waitFor(() => expect(result.current.session?.sessionId).not.toBe(sessionId));
    await waitFor(() =>
      expect(result.current.draft).toMatchObject({
        analysisLanguages: ['de'],
        targetProjectId: 'tgt',
      }),
    );
  });

  it('keeps the description a new draft was started with, for Save As to suggest', async () => {
    const { result } = await renderLoaded();

    await act(async () => {
      result.current.newDraft({ analysisLanguages: ['fr'], suggestedDescription: 'D' });
    });

    await waitFor(() => expect(result.current.draft?.suggestedDescription).toBe('D'));
  });

  it('logs a draft it could not start over, and opens the session again on what is stored', async () => {
    const { result } = await renderLoaded();
    const { sessionId } = result.current.session ?? {};
    jest.mocked(papi.commands.sendCommand).mockRejectedValueOnce(new Error('disk full'));

    await act(async () => {
      result.current.newDraft({ analysisLanguages: ['fr'] });
    });

    await waitFor(() => expect(result.current.session?.sessionId).not.toBe(sessionId));
    expect(logger.error).toHaveBeenCalledWith(
      'Interlinearizer: failed to start the draft of src over',
      expect.any(Error),
    );
  });

  it('retargets its session, keeping it open, when the project the draft saves to changes', async () => {
    await fakeHost();
    const { result, rerender } = renderProject();
    await waitFor(() => expect(result.current.session).toBeDefined());
    const { sessionId } = result.current.session ?? {};

    rerender({ saveTargetId: 'proj-2' });

    await waitFor(() =>
      expect(papi.commands.sendCommand).toHaveBeenCalledWith('interlinearizer.setSaveTarget', {
        sessionId,
        interlinearProjectId: 'proj-2',
      }),
    );
    expect(result.current.session?.sessionId).toBe(sessionId);
  });

  it('opens the fresh session on a save target that changed while starting over', async () => {
    const { result, rerender } = await renderLoaded();
    const { sessionId } = result.current.session ?? {};

    await act(async () => {
      result.current.loadFromProject({
        analysis: emptyAnalysis(),
        analysisLanguages: ['de'],
        segmentation: { removedVerseStarts: [], addedStarts: [] },
      });
      rerender({ saveTargetId: 'proj-2' });
    });

    await waitFor(() =>
      expect(papi.commands.sendCommand).toHaveBeenCalledWith('interlinearizer.openSession', {
        sourceProjectId: 'src',
        interlinearProjectId: 'proj-2',
      }),
    );
    expect(papi.commands.sendCommand).not.toHaveBeenCalledWith(
      'interlinearizer.setSaveTarget',
      expect.objectContaining({ sessionId }),
    );
  });

  it('opens a fresh session when the view moves to a Paratext 9 import', async () => {
    await fakeHost();
    const { result, rerender } = renderProject();
    await waitFor(() => expect(result.current.session).toBeDefined());

    rerender({ importProjectId: 'import-1' });

    await waitFor(() =>
      expect(papi.commands.sendCommand).toHaveBeenCalledWith('interlinearizer.openSession', {
        sourceProjectId: 'src',
        interlinearProjectId: 'import-1',
      }),
    );
  });

  it('logs a save target the session refuses', async () => {
    await fakeHost(async (command) => {
      if (command === 'interlinearizer.setSaveTarget') throw new Error('no such project');
      return undefined;
    });
    const { result, rerender } = renderProject();
    await waitFor(() => expect(result.current.session).toBeDefined());

    rerender({ saveTargetId: 'gone' });

    await waitFor(() =>
      expect(logger.error).toHaveBeenCalledWith(
        'Interlinearizer: failed to save the draft to gone',
        expect.any(Error),
      ),
    );
  });

  it('detaches its session from a deleted project, reading the draft again', async () => {
    const { result } = await renderLoaded();
    await glossEarth(result, 'land');

    await act(async () => {
      await result.current.detachFromProject();
    });

    expect(papi.commands.sendCommand).toHaveBeenCalledWith('interlinearizer.detachFromProject', {
      sessionId: result.current.session?.sessionId,
    });
  });

  it('logs a detach the session refuses', async () => {
    const { result } = await renderLoaded();
    jest.mocked(papi.commands.sendCommand).mockRejectedValueOnce(new Error('closed'));

    await act(async () => {
      await result.current.detachFromProject();
    });

    expect(logger.error).toHaveBeenCalledWith(
      'Interlinearizer: failed to detach the draft from its project',
      expect.any(Error),
    );
  });

  it('closes, without logging, a session whose draft fails to load after the view moved on', async () => {
    let failLoad: () => void = () => {};
    await fakeHost(undefined, (command) =>
      command === 'interlinearizer.getFullAnalysis'
        ? new Promise((_resolve, reject) => {
            failLoad = () => reject(new Error('session closed'));
          })
        : undefined,
    );
    const { unmount } = renderProject();
    await waitFor(() =>
      expect(papi.commands.sendCommand).toHaveBeenCalledWith(
        'interlinearizer.getFullAnalysis',
        expect.anything(),
      ),
    );

    unmount();
    await act(async () => failLoad());

    await waitFor(() =>
      expect(papi.commands.sendCommand).toHaveBeenCalledWith(
        'interlinearizer.closeSession',
        expect.anything(),
      ),
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs a session that fails to open', async () => {
    jest.mocked(papi.commands.sendCommand).mockRejectedValue(new Error('no draft'));

    renderProject();

    await waitFor(() =>
      expect(logger.error).toHaveBeenCalledWith(
        'Interlinearizer: failed to open a session on src',
        expect.any(Error),
      ),
    );
  });
});

describe('useSessionProject edits sent to the session', () => {
  /** Renders the hook over a host that answers each edit in this suite with {@link EMPTY_REPLY}. */
  async function renderAnswering() {
    const host = await fakeHost(async (command) =>
      command === 'interlinearizer.getTextReadStatus' ? undefined : EMPTY_REPLY,
    );
    const rendered = renderProject();
    await waitFor(() => expect(rendered.result.current.session?.client).toBeDefined());
    return { host, ...rendered };
  }

  it.each([
    [
      'discardBook',
      (project: ReturnType<typeof useSessionProject>) => project.discardBook('GEN'),
      { bookCode: 'GEN' },
    ],
    ['discardAll', (project: ReturnType<typeof useSessionProject>) => project.discardAll(), {}],
  ])('sends %s, replacing the draft', async (command, discard, fields) => {
    const { result } = await renderAnswering();
    const version = result.current.draftVersion;

    await act(async () => {
      await discard(result.current);
    });

    expect(papi.commands.sendCommand).toHaveBeenCalledWith(`interlinearizer.${command}`, {
      sessionId: result.current.session?.sessionId,
      changeId: expect.any(String),
      ...fields,
    });
    expect(result.current.draftVersion).toBe(version + 1);
    expect(result.current.session?.hasFreeTranslations).toBe(true);
  });

  it.each([
    [
      'mergeSegments',
      (project: ReturnType<typeof useSessionProject>) =>
        project.session?.boundaries.merge('GEN 1:2:0'),
      { secondSegmentStartRef: 'GEN 1:2:0' },
    ],
    [
      'splitSegment',
      (project: ReturnType<typeof useSessionProject>) =>
        project.session?.boundaries.split('GEN 1:1:2'),
      { tokenRef: 'GEN 1:1:2' },
    ],
    [
      'moveBoundary',
      (project: ReturnType<typeof useSessionProject>) =>
        project.session?.boundaries.move('GEN 1:2:0', 'GEN 1:2:1'),
      { fromRef: 'GEN 1:2:0', toRef: 'GEN 1:2:1' },
    ],
  ])('sends %s to the session', async (command, edit, fields) => {
    const { result } = await renderAnswering();

    await act(async () => {
      edit(result.current);
      await result.current.session?.client?.settled();
    });

    await waitFor(() =>
      expect(papi.commands.sendCommand).toHaveBeenCalledWith(`interlinearizer.${command}`, {
        sessionId: result.current.session?.sessionId,
        changeId: expect.any(String),
        ...fields,
      }),
    );
  });

  it("sets the session's analysis language", async () => {
    const { result } = await renderLoaded();

    await act(async () => result.current.session?.setAnalysisLanguage('fr'));

    expect(papi.commands.sendCommand).toHaveBeenCalledWith('interlinearizer.setAnalysisLanguage', {
      sessionId: result.current.session?.sessionId,
      analysisLanguage: 'fr',
    });
  });

  it('logs a language the session refuses', async () => {
    const { result } = await renderLoaded();
    jest.mocked(papi.commands.sendCommand).mockRejectedValueOnce(new Error('closed'));

    await act(async () => result.current.session?.setAnalysisLanguage('fr'));

    expect(logger.error).toHaveBeenCalledWith(
      'Interlinearizer: failed to set the language to fr',
      expect.any(Error),
    );
  });
});

describe('useSessionProject whole-text read', () => {
  /** Renders the hook over a host whose whole-text read stands at `status`. */
  async function renderReading(status: object) {
    const host = await fakeHost(async (command) =>
      command === 'interlinearizer.getTextReadStatus' ? JSON.stringify(status) : undefined,
    );
    const rendered = renderProject();
    await waitFor(() => expect(rendered.result.current.session).toBeDefined());
    return { host, ...rendered };
  }

  it('covers the whole draft once every book is read', async () => {
    const { result } = await renderReading({ booksRead: 2, bookCount: 2, failedBookIds: [] });

    await waitFor(() => expect(result.current.session?.staleCoversDraft).toBe(true));
  });

  it('does not cover the whole draft while books are unread', async () => {
    const { result } = await renderReading({ booksRead: 1, bookCount: 2, failedBookIds: [] });

    await waitFor(() =>
      expect(papi.commands.sendCommand).toHaveBeenCalledWith('interlinearizer.getTextReadStatus', {
        sessionId: result.current.session?.sessionId,
      }),
    );
    expect(result.current.session?.staleCoversDraft).toBe(false);
  });

  it('does not cover the whole draft when a book failed to read', async () => {
    const { result } = await renderReading({ booksRead: 2, bookCount: 2, failedBookIds: ['EXO'] });

    await waitFor(() =>
      expect(papi.commands.sendCommand).toHaveBeenCalledWith(
        'interlinearizer.getTextReadStatus',
        expect.anything(),
      ),
    );
    expect(result.current.session?.staleCoversDraft).toBe(false);
  });
});

describe('useSessionProject boundaries', () => {
  it('counts a change of the draft boundaries as a new segmentation', async () => {
    const { result, host } = await renderLoaded();
    const before = result.current.segmentationVersion;

    await act(async () => {
      await result.current.session?.client?.send(async (changeId) =>
        JSON.parse(
          JSON.stringify(
            await host.sessions.edit(
              result.current.session?.sessionId ?? '',
              'split',
              async (buffer) => {
                buffer.putScope({
                  ...(await buffer.getScope()),
                  segmentation: {
                    removedVerseStarts: [],
                    addedStarts: [{ tokenRef: ref('beginning'), surfaceText: 'beginning' }],
                  },
                });
              },
              { changeId },
            ),
          ),
        ),
      );
    });

    await waitFor(() => expect(result.current.segmentationVersion).toBe(before + 1));
  });
});
