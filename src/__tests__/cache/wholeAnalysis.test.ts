/// <reference types="jest" />

import type { DraftProject } from 'interlinearizer';
import { WholeAnalysis } from '../../cache/wholeAnalysis';
import { emptyAnalysis, emptyDraft } from '../../types/empty-factories';
import { FIXTURE_STAMPS } from '../test-helpers';

/** A draft whose analysis holds one payload with id `id`. */
const holding = (id: string): DraftProject => ({
  ...emptyDraft('src'),
  analysis: { ...emptyAnalysis(), tokenAnalyses: [{ id, ...FIXTURE_STAMPS, surfaceText: id }] },
});

/** A fetch whose calls each wait until `resolveNext` hands them a draft. */
function heldFetch() {
  const waiting: ((analysis: DraftProject) => void)[] = [];
  const fetch = jest.fn(
    () =>
      new Promise<DraftProject>((resolve) => {
        waiting.push(resolve);
      }),
  );
  /** Hands `analysis` to the oldest waiting call, once any queued refresh has called the fetch. */
  const resolveNext = async (analysis: DraftProject) => {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    waiting.shift()?.(analysis);
  };
  return { fetch, resolveNext };
}

describe('WholeAnalysis', () => {
  it('holds an empty analysis, and no draft, before its first fetch lands', () => {
    const whole = new WholeAnalysis(async () => holding('a'));

    expect(whole.current).toStrictEqual(emptyAnalysis());
    expect(whole.draft).toBeUndefined();
  });

  it('holds what its latest fetch got, telling its listeners', async () => {
    const whole = new WholeAnalysis(async () => holding('a'));
    const listener = jest.fn();
    whole.subscribe(listener);

    await whole.refresh();

    expect(whole.draft).toStrictEqual(holding('a'));
    expect(whole.current).toStrictEqual(holding('a').analysis);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('fetches once more after a fetch under way, however often it is asked meanwhile', async () => {
    const { fetch, resolveNext } = heldFetch();
    const whole = new WholeAnalysis(fetch);
    const first = whole.refresh();
    const second = whole.refresh();
    const third = whole.refresh();

    await resolveNext(holding('a'));
    await resolveNext(holding('b'));
    await Promise.all([first, second, third]);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(whole.draft).toStrictEqual(holding('b'));
  });

  it('keeps what it held when a fetch fails, and rejects that refresh', async () => {
    const fetch = jest
      .fn<Promise<DraftProject>, []>()
      .mockResolvedValueOnce(holding('a'))
      .mockRejectedValueOnce(new Error('gone'));
    const whole = new WholeAnalysis(fetch);
    await whole.refresh();

    await expect(whole.refresh()).rejects.toThrow('gone');

    expect(whole.draft).toStrictEqual(holding('a'));
  });

  it('applies the changes it takes in to the held draft, telling its listeners', async () => {
    const whole = new WholeAnalysis(async () => holding('a'));
    await whole.refresh();
    const listener = jest.fn();
    whole.subscribe(listener);

    whole.take({
      intent: 'x',
      tokenAnalyses: { puts: holding('b').analysis.tokenAnalyses, deletes: ['a'] },
    });

    expect(whole.current.tokenAnalyses.map(({ id }) => id)).toStrictEqual(['b']);
    expect(whole.draft?.dirty).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('holds no draft for changes taken in before its first fetch lands', () => {
    const whole = new WholeAnalysis(async () => holding('a'));

    whole.take({ intent: 'x', tokenAnalyses: { puts: [], deletes: ['a'] } });

    expect(whole.draft).toBeUndefined();
  });

  it('lands a fetch with the changes taken in while it was under way applied over it', async () => {
    const { fetch, resolveNext } = heldFetch();
    const whole = new WholeAnalysis(fetch);
    const refreshed = whole.refresh();

    whole.take({
      intent: 'x',
      tokenAnalyses: { puts: holding('b').analysis.tokenAnalyses, deletes: [] },
    });
    await resolveNext(holding('a'));
    await refreshed;

    expect(whole.current.tokenAnalyses.map(({ id }) => id)).toStrictEqual(['a', 'b']);
  });

  it('stops telling a listener once it unsubscribes', async () => {
    const whole = new WholeAnalysis(async () => holding('a'));
    const listener = jest.fn();
    whole.subscribe(listener)();

    await whole.refresh();

    expect(listener).not.toHaveBeenCalled();
  });
});
