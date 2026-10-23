/// <reference types="jest" />

import type { TokenAnalysis } from 'interlinearizer';
import { DraftRepository } from '../../services/draftRepository';
import { EditHistory } from '../../services/editHistory';
import type { ChangeSet } from '../../types/analysis-repository';
import { MAX_UNDO_STEPS } from '../../utils/undo-history';
import { FIXTURE_STAMPS, memoryStorage, silentLogger } from '../test-helpers';

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
