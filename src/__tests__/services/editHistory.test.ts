/// <reference types="jest" />

import type { Book, TokenAnalysis, TokenAnalysisLink } from 'interlinearizer';
import { DraftRepository } from '../../services/draftRepository';
import { EditHistory, type ReanchorBooks } from '../../services/editHistory';
import type { ChangeSet } from '../../types/analysis-repository';
import { mergeChangeSets } from '../../utils/change-set';
import { reanchorChangesForBook } from '../../utils/reanchor-changes';
import { MAX_UNDO_STEPS } from '../../utils/undo-history';
import {
  FIXTURE_STAMPS,
  makeTokenLink,
  makeVerseBook,
  memoryStorage,
  silentLogger,
} from '../test-helpers';

function payload(id: string): TokenAnalysis {
  return { id, ...FIXTURE_STAMPS, surfaceText: id };
}

function putting(id: string): ChangeSet {
  return { intent: `put ${id}`, tokenAnalyses: { puts: [payload(id)], deletes: [] } };
}

/** A history over an empty draft in memory, with a way to read back the stored payload ids. */
function makeHistory() {
  const { storage } = memoryStorage();
  const repository = new DraftRepository(storage, 'src', silentLogger());
  const storedIds = async () =>
    (
      await new DraftRepository(storage, 'src', silentLogger()).exportAll()
    ).draft.analysis.tokenAnalyses
      .map(({ id }) => id)
      .sort();
  return { history: new EditHistory(repository), repository, storedIds };
}

describe('EditHistory', () => {
  it('applies an edit through its repository', async () => {
    const { history, storedIds } = makeHistory();

    await history.apply(putting('a'));

    await expect(storedIds()).resolves.toStrictEqual(['a']);
  });

  it('undoes edits latest first, returning what reverted each', async () => {
    const { history, storedIds } = makeHistory();
    await history.apply(putting('a'));
    await history.apply(putting('b'));

    await expect(history.undo()).resolves.toStrictEqual({
      intent: 'put b',
      tokenAnalyses: { puts: [], deletes: ['b'] },
    });
    await expect(storedIds()).resolves.toStrictEqual(['a']);
    await history.undo();
    await expect(storedIds()).resolves.toStrictEqual([]);
  });

  it('redoes undone edits latest undone first, returning what made each again', async () => {
    const { history, storedIds } = makeHistory();
    await history.apply(putting('a'));
    await history.apply(putting('b'));
    await history.undo();
    await history.undo();

    await expect(history.redo()).resolves.toStrictEqual({
      intent: 'put a',
      tokenAnalyses: { puts: [payload('a')], deletes: [] },
    });
    await expect(storedIds()).resolves.toStrictEqual(['a']);
    await history.redo();
    await expect(storedIds()).resolves.toStrictEqual(['a', 'b']);
  });

  it('has nothing to undo before any edit', async () => {
    await expect(makeHistory().history.undo()).resolves.toBeUndefined();
  });

  it('has nothing to redo before any undo', async () => {
    const { history } = makeHistory();
    await history.apply(putting('a'));

    await expect(history.redo()).resolves.toBeUndefined();
  });

  it(`forgets the oldest edit once more than ${MAX_UNDO_STEPS} are undoable`, async () => {
    const { history, storedIds } = makeHistory();
    const times = (count: number, step: (i: number) => Promise<unknown>) =>
      Array.from({ length: count }).reduce<Promise<unknown>>(
        (previous, _, i) => previous.then(() => step(i)),
        Promise.resolve(),
      );
    await times(MAX_UNDO_STEPS + 1, (i) => history.apply(putting(`p${i}`)));
    await times(MAX_UNDO_STEPS, () => history.undo());

    await expect(history.undo()).resolves.toBeUndefined();
    await expect(storedIds()).resolves.toStrictEqual(['p0']);
  });

  it('drops the undone edits when a new edit is applied', async () => {
    const { history, storedIds } = makeHistory();
    await history.apply(putting('a'));
    await history.undo();

    await history.apply(putting('b'));

    await expect(history.redo()).resolves.toBeUndefined();
    await expect(storedIds()).resolves.toStrictEqual(['b']);
  });

  it('records no step for an edit that fails', async () => {
    const { history, repository } = makeHistory();
    jest.spyOn(repository, 'apply').mockRejectedValueOnce(new Error('disk full'));

    await expect(history.apply(putting('a'))).rejects.toThrow('disk full');

    await expect(history.undo()).resolves.toBeUndefined();
  });

  it('keeps an edit to undo when undoing it fails', async () => {
    const { history, repository, storedIds } = makeHistory();
    await history.apply(putting('a'));
    jest.spyOn(repository, 'apply').mockRejectedValueOnce(new Error('disk full'));

    await expect(history.undo()).rejects.toThrow('disk full');

    await history.undo();
    await expect(storedIds()).resolves.toStrictEqual([]);
  });

  it('keeps an undone edit to redo when redoing it fails', async () => {
    const { history, repository, storedIds } = makeHistory();
    await history.apply(putting('a'));
    await history.undo();
    jest.spyOn(repository, 'apply').mockRejectedValueOnce(new Error('disk full'));

    await expect(history.redo()).rejects.toThrow('disk full');

    await history.redo();
    await expect(storedIds()).resolves.toStrictEqual(['a']);
  });
});

describe('EditHistory re-anchoring', () => {
  /** A book of one verse reading `text`, versioned by its text as a book's content hash would. */
  function verseBook(sid: string, text: string): Book {
    return { ...makeVerseBook([{ sid, text }]), textVersion: text };
  }

  function genesis(text: string): Book {
    return verseBook('GEN 1:1', text);
  }

  /** The ref of the token reading `surfaceText` in `book`. */
  function refOf(book: Book, surfaceText: string): string {
    const token = book.segments[0].tokens.find((t) => t.surfaceText === surfaceText);
    if (!token) throw new Error(`fixture missing token ${surfaceText}`);
    return token.ref;
  }

  /** A link to the payload `analysisId` on the word `beta` where `book` has it. */
  function betaLink(book: Book, analysisId: string): TokenAnalysisLink {
    return makeTokenLink(analysisId, refOf(book, 'beta'), { surfaceText: 'beta', id: 'tl-beta' });
  }

  function linking(link: TokenAnalysisLink): ChangeSet {
    return { intent: `link ${link.analysisId}`, tokenAnalysisLinks: { puts: [link], deletes: [] } };
  }

  /**
   * A history over a draft in memory whose re-anchoring applies each book's pass in turn, with a
   * way to run a pass the history records, as the session does, and to read back the stored link.
   */
  function makeReanchoringHistory() {
    const { storage } = memoryStorage();
    const repository = new DraftRepository(storage, 'src', silentLogger());
    const reanchorBooks = jest.fn<ReturnType<ReanchorBooks>, Parameters<ReanchorBooks>>((books) =>
      books.reduce<Promise<ChangeSet | undefined>>(async (previous, book) => {
        const applied = await previous;
        const changes = reanchorChangesForBook((await repository.exportAll()).draft, book);
        if (!changes) return applied;
        await repository.apply(changes);
        return applied ? mergeChangeSets(applied, changes) : changes;
      }, Promise.resolve(undefined)),
    );
    const history = new EditHistory(repository, reanchorBooks);
    const pass = async (book: Book) => {
      await reanchorBooks([book]);
      history.recordPass(book);
      reanchorBooks.mockClear();
    };
    const storedLink = async () =>
      (await new DraftRepository(storage, 'src', silentLogger()).exportAll()).draft.analysis
        .tokenAnalysisLinks[0];
    return { history, reanchorBooks, pass, storedLink };
  }

  it('undoes an edit to the text a pass re-anchored to since', async () => {
    const { history, pass, storedLink } = makeReanchoringHistory();
    const before = genesis('alpha beta');
    const after = genesis('new alpha beta');
    await history.apply(linking(betaLink(before, 'ta-1')));
    await history.apply(linking(betaLink(before, 'ta-2')));
    await pass(after);

    await history.undo();

    const restored = await storedLink();
    expect(restored.analysisId).toBe('ta-1');
    expect(restored.token.tokenRef).toBe(refOf(after, 'beta'));
  });

  it('redoes an edit to the text a pass re-anchored to since the undo', async () => {
    const { history, pass, storedLink } = makeReanchoringHistory();
    const before = genesis('alpha beta');
    const after = genesis('new alpha beta');
    await history.apply(linking(betaLink(before, 'ta-1')));
    await history.apply(linking(betaLink(before, 'ta-2')));
    await history.undo();
    await pass(after);

    await history.redo();

    const restored = await storedLink();
    expect(restored.analysisId).toBe('ta-2');
    expect(restored.token.tokenRef).toBe(refOf(after, 'beta'));
  });

  it('returns the changes that reverted the edit with those that re-anchored them', async () => {
    const { history, pass } = makeReanchoringHistory();
    const before = genesis('alpha beta');
    const after = genesis('new alpha beta');
    await history.apply(linking(betaLink(before, 'ta-1')));
    await history.apply(linking(betaLink(before, 'ta-2')));
    await pass(after);

    const undone = await history.undo();

    expect(undone?.intent).toBe('link ta-2');
    expect(undone?.tokenAnalysisLinks?.puts).toEqual([
      expect.objectContaining({
        analysisId: 'ta-1',
        token: { tokenRef: refOf(after, 'beta'), surfaceText: 'beta' },
      }),
    ]);
  });

  it('re-anchors nothing for a pass the undone step already reflects', async () => {
    const { history, reanchorBooks, pass } = makeReanchoringHistory();
    const before = genesis('alpha beta');
    const after = genesis('new alpha beta');
    await history.apply(linking(betaLink(before, 'ta-1')));
    await pass(after);
    await history.apply(linking(betaLink(after, 'ta-2')));

    await history.undo();

    expect(reanchorBooks).not.toHaveBeenCalled();
  });

  it('records no pass run while there is nothing to undo or redo', async () => {
    const { history, reanchorBooks, pass } = makeReanchoringHistory();
    await pass(genesis('new alpha beta'));
    await history.apply(linking(betaLink(genesis('new alpha beta'), 'ta-1')));

    await history.undo();

    expect(reanchorBooks).not.toHaveBeenCalled();
  });

  it("re-anchors to each book's latest text, in the order the passes ran", async () => {
    const { history, reanchorBooks, pass } = makeReanchoringHistory();
    const exodus = verseBook('EXO 1:1', 'delta');
    const latest = genesis('newer alpha beta');
    await history.apply(linking(betaLink(genesis('alpha beta'), 'ta-1')));
    await pass(genesis('new alpha beta'));
    await pass(exodus);
    await pass(latest);

    await history.undo();

    expect(reanchorBooks).toHaveBeenCalledWith([exodus, latest]);
  });

  it('records nothing for a pass over text the book last read', async () => {
    const { history, reanchorBooks, pass } = makeReanchoringHistory();
    const exodus = verseBook('EXO 1:1', 'delta');
    await history.apply(linking(betaLink(genesis('alpha beta'), 'ta-1')));
    await pass(genesis('new alpha beta'));
    await pass(exodus);
    await pass(genesis('new alpha beta'));

    await history.undo();

    expect(reanchorBooks.mock.calls[0][0].map(({ bookRef }) => bookRef)).toEqual(['GEN', 'EXO']);
  });

  it('forgets a pass once no step to undo or redo predates it', async () => {
    const { history, reanchorBooks, pass } = makeReanchoringHistory();
    await history.apply(linking(betaLink(genesis('alpha beta'), 'ta-1')));
    await pass(genesis('new alpha beta'));
    await history.undo();
    reanchorBooks.mockClear();

    await history.apply(linking(betaLink(genesis('new alpha beta'), 'ta-2')));
    await history.undo();

    expect(reanchorBooks).not.toHaveBeenCalled();
  });

  it('undoes the edit when re-anchoring what it restores fails', async () => {
    const { history, reanchorBooks, pass, storedLink } = makeReanchoringHistory();
    const before = genesis('alpha beta');
    await history.apply(linking(betaLink(before, 'ta-1')));
    await history.apply(linking(betaLink(before, 'ta-2')));
    await pass(genesis('new alpha beta'));
    reanchorBooks.mockRejectedValueOnce(new Error('disk full'));

    await expect(history.undo()).rejects.toThrow('disk full');

    expect((await storedLink()).analysisId).toBe('ta-1');
    await history.redo();
    expect((await storedLink()).analysisId).toBe('ta-2');
  });

  it('re-anchors nothing restored when it has no way to', async () => {
    const { storage } = memoryStorage();
    const history = new EditHistory(new DraftRepository(storage, 'src', silentLogger()));
    await history.apply(linking(betaLink(genesis('alpha beta'), 'ta-1')));
    history.recordPass(genesis('new alpha beta'));

    await expect(history.undo()).resolves.toStrictEqual({
      intent: 'link ta-1',
      tokenAnalysisLinks: { puts: [], deletes: ['tl-beta'] },
    });
  });
});
