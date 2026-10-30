/// <reference types="jest" />

import type { Book, TokenAnalysis, TokenAnalysisLink } from 'interlinearizer';
import { DraftRepository } from '../../services/draftRepository';
import { EditHistory, type ReanchorBooks } from '../../services/editHistory';
import type { ChangeSet } from '../../types/analysis-repository';
import { emptyDraft } from '../../types/empty-factories';
import { applyChangeSet, mergeChangeSets } from '../../utils/change-set';
import { reanchorChangesForBook } from '../../utils/reanchor-changes';
import { MAX_UNDO_STEPS } from '../../services/editHistory';
import {
  FIXTURE_STAMPS,
  makeTokenLink,
  makeVerseBook,
  memoryStorage,
  silentLogger,
  tokenRefOf,
} from '../test-helpers';

function payload(id: string): TokenAnalysis {
  return { id, ...FIXTURE_STAMPS, surfaceText: id };
}

function putting(id: string): ChangeSet {
  return { intent: `put ${id}`, tokenAnalyses: { puts: [payload(id)], deletes: [] } };
}

/**
 * A history over an empty draft in memory, with ways to read back the stored payload ids and
 * whether the stored draft is marked unsaved.
 */
function makeHistory() {
  const { storage } = memoryStorage();
  const repository = new DraftRepository(storage, 'src', silentLogger());
  const stored = async () =>
    (await new DraftRepository(storage, 'src', silentLogger()).exportAll()).draft;
  const storedIds = async () => (await stored()).analysis.tokenAnalyses.map(({ id }) => id).sort();
  const storedDirty = async () => (await stored()).dirty;
  return { history: new EditHistory(repository), repository, storedIds, storedDirty };
}

describe('EditHistory', () => {
  it('applies an edit through its repository', async () => {
    const { history, storedIds } = makeHistory();

    await history.apply(putting('a'));

    await expect(storedIds()).resolves.toStrictEqual(['a']);
  });

  it('returns what reverts an edit it applies', async () => {
    const { history } = makeHistory();

    await expect(history.apply(putting('a'))).resolves.toStrictEqual({
      intent: 'put a',
      tokenAnalyses: { puts: [], deletes: ['a'] },
    });
  });

  it('marks the draft unsaved', async () => {
    const { history, storedDirty } = makeHistory();

    await history.apply(putting('a'));

    await expect(storedDirty()).resolves.toBe(true);
  });

  it('leaves the draft saved when the edit keeps the mark', async () => {
    const { history, storedDirty } = makeHistory();

    await history.apply(putting('a'), { unsavedMark: 'keep' });

    await expect(storedDirty()).resolves.toBe(false);
  });

  it('marks the draft saved when the edit clears the mark', async () => {
    const { history, repository, storedDirty } = makeHistory();
    await repository.replaceAll({ ...emptyDraft('src'), dirty: true });

    await history.apply(putting('a'), { unsavedMark: 'clear' });

    await expect(storedDirty()).resolves.toBe(false);
  });

  it('undoes edits latest first, returning what reverted each and what reverts that', async () => {
    const { history, storedIds } = makeHistory();
    await history.apply(putting('a'));
    await history.apply(putting('b'));

    await expect(history.undo()).resolves.toStrictEqual({
      changes: { intent: 'put b', tokenAnalyses: { puts: [], deletes: ['b'] } },
      inverse: putting('b'),
    });
    await expect(storedIds()).resolves.toStrictEqual(['a']);
    await history.undo();
    await expect(storedIds()).resolves.toStrictEqual([]);
  });

  it('redoes undone edits latest undone first, returning what made each again and what reverts that', async () => {
    const { history, storedIds } = makeHistory();
    await history.apply(putting('a'));
    await history.apply(putting('b'));
    await history.undo();
    await history.undo();

    await expect(history.redo()).resolves.toStrictEqual({
      changes: { intent: 'put a', tokenAnalyses: { puts: [payload('a')], deletes: [] } },
      inverse: { intent: 'put a', tokenAnalyses: { puts: [], deletes: ['a'] } },
    });
    await expect(storedIds()).resolves.toStrictEqual(['a']);
    await history.redo();
    await expect(storedIds()).resolves.toStrictEqual(['a', 'b']);
  });

  it('returns with an undo and its redo the step the edit was applied as', async () => {
    const { history } = makeHistory();
    const step = { location: 'GEN 1:1:0' };
    await history.apply(putting('a'), { step });
    await history.apply(putting('b'));

    await history.undo();
    await expect(history.undo()).resolves.toMatchObject({ step });
    await expect(history.redo()).resolves.toMatchObject({ step });
    await expect(history.redo()).resolves.not.toHaveProperty('step');
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

describe("EditHistory's count of applies", () => {
  it('counts each edit, undo and redo it applies', async () => {
    const { history } = makeHistory();

    await history.apply(putting('a'));
    await history.undo();
    await history.redo();

    expect(history.applied).toBe(3);
  });

  it('counts an edit whose marking the draft saved fails', async () => {
    const { history, repository } = makeHistory();
    jest.spyOn(repository, 'markClean').mockRejectedValue(new Error('disk full'));

    await expect(history.apply(putting('a'), { unsavedMark: 'clear' })).rejects.toThrow(
      'disk full',
    );

    expect(history.applied).toBe(1);
  });

  it('counts no edit that fails to apply', async () => {
    const { history, repository } = makeHistory();
    jest.spyOn(repository, 'apply').mockRejectedValue(new Error('disk full'));

    await expect(history.apply(putting('a'))).rejects.toThrow('disk full');

    expect(history.applied).toBe(0);
  });

  it('counts no undo when there is nothing to undo', async () => {
    const { history } = makeHistory();

    await history.undo();

    expect(history.applied).toBe(0);
  });
});

describe("EditHistory's unsaved mark", () => {
  it('marks the draft saved when an undo leads back to content it was saved with', async () => {
    const { history, storedDirty } = makeHistory();
    await history.apply(putting('a'));

    await history.undo();

    await expect(storedDirty()).resolves.toBe(false);
  });

  it('marks the draft unsaved when an undo leads away from content it was saved with', async () => {
    const { history, repository, storedDirty } = makeHistory();
    await repository.replaceAll({ ...emptyDraft('src'), dirty: true });
    await history.apply(putting('a'), { unsavedMark: 'clear' });

    await history.undo();

    await expect(storedDirty()).resolves.toBe(true);
  });

  it('marks the draft saved when a redo leads back to content an edit cleared the mark on', async () => {
    const { history, repository, storedDirty } = makeHistory();
    await repository.replaceAll({ ...emptyDraft('src'), dirty: true });
    await history.apply(putting('a'), { unsavedMark: 'clear' });
    await history.undo();

    await history.redo();

    await expect(storedDirty()).resolves.toBe(false);
  });

  it('marks the draft saved when an undo or redo crosses an edit that kept the saved mark', async () => {
    const { history, storedDirty } = makeHistory();
    await history.apply(putting('a'), { unsavedMark: 'keep' });

    await history.undo();
    await expect(storedDirty()).resolves.toBe(false);
    await history.redo();
    await expect(storedDirty()).resolves.toBe(false);
  });

  it('marks the draft saved when an undo leads back to content that markClean marked saved', async () => {
    const { history, storedDirty } = makeHistory();
    await history.apply(putting('a'));
    await history.markClean();
    await history.apply(putting('b'));

    await history.undo();

    await expect(storedDirty()).resolves.toBe(false);
  });

  it('marks the draft unsaved when an undo leads back to content saved before a later save', async () => {
    const { history, storedDirty } = makeHistory();
    await history.apply(putting('a'));
    await history.markClean();
    await history.apply(putting('b'));
    await history.markClean();

    await history.undo();

    await expect(storedDirty()).resolves.toBe(true);
  });

  it('marks the draft saved when an undo leads back to content saved before an edit cleared the mark', async () => {
    const { history, storedDirty } = makeHistory();
    await history.apply(putting('a'));
    await history.markClean();
    await history.apply(putting('b'));
    await history.apply(putting('c'), { unsavedMark: 'clear' });

    await history.undo();
    await history.undo();

    await expect(storedDirty()).resolves.toBe(false);
  });

  it('marks the draft saved when an undo leads back to content saved before markRestoredClean', async () => {
    const { history, storedDirty } = makeHistory();
    await history.apply(putting('a'));
    await history.markClean();
    await history.apply(putting('b'));
    await history.markRestoredClean();
    await expect(storedDirty()).resolves.toBe(false);

    await history.undo();

    await expect(storedDirty()).resolves.toBe(false);
  });

  it('marks the draft saved when an undo crosses an edit that kept the saved mark before markClean', async () => {
    const { history, storedDirty } = makeHistory();
    await history.apply(putting('a'), { unsavedMark: 'keep' });
    await history.markClean();

    await history.undo();

    await expect(storedDirty()).resolves.toBe(false);
  });

  it('takes a save made outside the history as the only saved content once it next applies', async () => {
    const { history, repository, storedDirty } = makeHistory();
    await history.apply(putting('a'));
    await repository.markClean();

    await history.undo();
    await expect(storedDirty()).resolves.toBe(true);
    await history.redo();
    await expect(storedDirty()).resolves.toBe(false);
  });

  it('keeps an undo applied, and the draft unsaved, when marking the draft saved fails', async () => {
    const { history, repository, storedIds, storedDirty } = makeHistory();
    await history.apply(putting('a'));
    jest.spyOn(repository, 'markClean').mockRejectedValueOnce(new Error('disk full'));

    await expect(history.undo()).rejects.toThrow('disk full');

    await expect(storedIds()).resolves.toStrictEqual([]);
    await expect(storedDirty()).resolves.toBe(true);
    await expect(history.redo()).resolves.toBeDefined();
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

  /** A link to the payload `analysisId` on the word `beta` where `book` has it. */
  function betaLink(book: Book, analysisId: string): TokenAnalysisLink {
    return makeTokenLink(analysisId, tokenRefOf(book, 'beta'), {
      surfaceText: 'beta',
      id: 'tl-beta',
    });
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
    const reanchorBooks = jest.fn<ReturnType<ReanchorBooks>, Parameters<ReanchorBooks>>(
      async (changes, books) => {
        let { draft } = applyChangeSet((await repository.exportAll()).draft, changes);
        let reanchored: ChangeSet | undefined;
        books.forEach((book) => {
          const bookChanges = reanchorChangesForBook(draft, book);
          if (!bookChanges) return;
          draft = applyChangeSet(draft, bookChanges).draft;
          reanchored = reanchored ? mergeChangeSets(reanchored, bookChanges) : bookChanges;
        });
        return reanchored;
      },
    );
    const history = new EditHistory(repository, reanchorBooks);
    const pass = async (book: Book) => {
      const changes = reanchorChangesForBook((await repository.exportAll()).draft, book);
      if (changes) await repository.apply(changes);
      history.recordPass(book);
    };
    const storedLink = async () =>
      (await new DraftRepository(storage, 'src', silentLogger()).exportAll()).draft.analysis
        .tokenAnalysisLinks[0];
    return { history, repository, reanchorBooks, pass, storedLink };
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
    expect(restored.token.tokenRef).toBe(tokenRefOf(after, 'beta'));
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
    expect(restored.token.tokenRef).toBe(tokenRefOf(after, 'beta'));
  });

  it('returns the changes that reverted the edit with those that re-anchored them', async () => {
    const { history, pass } = makeReanchoringHistory();
    const before = genesis('alpha beta');
    const after = genesis('new alpha beta');
    await history.apply(linking(betaLink(before, 'ta-1')));
    await history.apply(linking(betaLink(before, 'ta-2')));
    await pass(after);

    const undone = (await history.undo())?.changes;

    expect(undone?.intent).toBe('link ta-2');
    expect(undone?.tokenAnalysisLinks?.puts).toEqual([
      expect.objectContaining({
        analysisId: 'ta-1',
        token: { tokenRef: tokenRefOf(after, 'beta'), surfaceText: 'beta' },
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

    expect(reanchorBooks).toHaveBeenCalledWith(expect.anything(), [exodus, latest]);
  });

  it('records nothing for a pass over text the book last read', async () => {
    const { history, reanchorBooks, pass } = makeReanchoringHistory();
    const exodus = verseBook('EXO 1:1', 'delta');
    await history.apply(linking(betaLink(genesis('alpha beta'), 'ta-1')));
    await pass(genesis('new alpha beta'));
    await pass(exodus);
    await pass(genesis('new alpha beta'));

    await history.undo();

    expect(reanchorBooks.mock.calls[0][1].map(({ bookRef }) => bookRef)).toEqual(['GEN', 'EXO']);
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

  it('applies nothing and keeps the edit to undo when re-anchoring what it restores fails', async () => {
    const { history, reanchorBooks, pass, storedLink } = makeReanchoringHistory();
    const before = genesis('alpha beta');
    const after = genesis('new alpha beta');
    await history.apply(linking(betaLink(before, 'ta-1')));
    await history.apply(linking(betaLink(before, 'ta-2')));
    await pass(after);
    reanchorBooks.mockRejectedValueOnce(new Error('busy'));

    await expect(history.undo()).rejects.toThrow('busy');

    expect((await storedLink()).analysisId).toBe('ta-2');
    await history.undo();
    expect(await storedLink()).toEqual(
      expect.objectContaining({
        analysisId: 'ta-1',
        token: { tokenRef: tokenRefOf(after, 'beta'), surfaceText: 'beta' },
      }),
    );
  });

  it('applies the edit and its re-anchoring as one', async () => {
    const { history, pass, repository } = makeReanchoringHistory();
    const before = genesis('alpha beta');
    await history.apply(linking(betaLink(before, 'ta-1')));
    await history.apply(linking(betaLink(before, 'ta-2')));
    await pass(genesis('new alpha beta'));
    const apply = jest.spyOn(repository, 'apply');

    await history.undo();

    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('re-anchors what it restores from the draft as the step would leave it', async () => {
    const { history, reanchorBooks, pass } = makeReanchoringHistory();
    const before = genesis('alpha beta');
    await history.apply(linking(betaLink(before, 'ta-1')));
    await history.apply(linking(betaLink(before, 'ta-2')));
    await pass(genesis('new alpha beta'));

    await history.undo();

    expect(reanchorBooks).toHaveBeenCalledWith(
      {
        intent: 'link ta-2',
        tokenAnalysisLinks: { puts: [betaLink(before, 'ta-1')], deletes: [] },
      },
      [genesis('new alpha beta')],
    );
  });

  it('re-anchors nothing restored when it has no way to', async () => {
    const { storage } = memoryStorage();
    const history = new EditHistory(new DraftRepository(storage, 'src', silentLogger()));
    await history.apply(linking(betaLink(genesis('alpha beta'), 'ta-1')));
    history.recordPass(genesis('new alpha beta'));

    await expect(history.undo()).resolves.toMatchObject({
      changes: { intent: 'link ta-1', tokenAnalysisLinks: { puts: [], deletes: ['tl-beta'] } },
    });
  });
});
