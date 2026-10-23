/// <reference types="jest" />

import { logger } from '@papi/frontend';
import type { SenseRef } from 'interlinearizer';
import type { ResolvedSense } from 'interlinearizer/lexicon';
import { createSenseCache } from '../../utils/sense-cache';

const WATER: ResolvedSense = { gloss: { en: 'water' } };

function ref(senseId: string, projectId?: string): SenseRef {
  return { authority: 'fw-lite', projectId, senseId };
}

/** Lets pending look-ups settle. */
async function flush() {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe('createSenseCache', () => {
  it('knows nothing of a sense no one has asked for', () => {
    const resolveSense = jest.fn(async () => WATER);
    const cache = createSenseCache(resolveSense);

    expect(cache.peek(ref('s-1'))).toBeUndefined();
    expect(resolveSense).not.toHaveBeenCalled();
  });

  it('holds a sense once the lexicon answers, and tells its watchers', async () => {
    const cache = createSenseCache(async () => WATER);
    const listener = jest.fn();
    cache.subscribe(listener);

    cache.request(ref('s-1'));
    expect(cache.peek(ref('s-1'))).toBeUndefined();
    await flush();

    expect(cache.peek(ref('s-1'))).toBe(WATER);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('asks the lexicon once for refs equal in every field', async () => {
    const resolveSense = jest.fn(async () => WATER);
    const cache = createSenseCache(resolveSense);

    cache.request(ref('s-1', 'lex'));
    cache.request(ref('s-1', 'lex'));
    await flush();
    cache.request(ref('s-1', 'lex'));

    expect(resolveSense).toHaveBeenCalledTimes(1);
  });

  it('asks separately for the same sense id in another lexicon project', async () => {
    const resolveSense = jest.fn(async ({ projectId }: SenseRef) =>
      projectId === 'lex' ? WATER : undefined,
    );
    const cache = createSenseCache(resolveSense);

    cache.request(ref('s-1', 'lex'));
    cache.request(ref('s-1'));
    await flush();

    expect(resolveSense).toHaveBeenCalledTimes(2);
    expect(cache.peek(ref('s-1', 'lex'))).toBe(WATER);
    expect(cache.peek(ref('s-1'))).toBeUndefined();
  });

  it('keeps a miss without telling its watchers or asking again', async () => {
    const resolveSense = jest.fn(async () => undefined);
    const cache = createSenseCache(resolveSense);
    const listener = jest.fn();
    cache.subscribe(listener);

    cache.request(ref('s-1'));
    await flush();
    cache.request(ref('s-1'));

    expect(listener).not.toHaveBeenCalled();
    expect(resolveSense).toHaveBeenCalledTimes(1);
  });

  it('asks again after a lookup that could not get an answer', async () => {
    const resolveSense = jest
      .fn<Promise<ResolvedSense | undefined>, [SenseRef]>()
      .mockRejectedValueOnce(new Error('unreachable'))
      .mockResolvedValueOnce(WATER);
    const cache = createSenseCache(resolveSense);

    cache.request(ref('s-1'));
    await flush();
    expect(cache.peek(ref('s-1'))).toBeUndefined();
    expect(jest.mocked(logger).debug).toHaveBeenCalled();

    cache.request(ref('s-1'));
    await flush();

    expect(cache.peek(ref('s-1'))).toBe(WATER);
  });

  it('stops telling a watcher once it unsubscribes', async () => {
    const cache = createSenseCache(async () => WATER);
    const listener = jest.fn();
    const unsubscribe = cache.subscribe(listener);

    unsubscribe();
    cache.request(ref('s-1'));
    await flush();

    expect(listener).not.toHaveBeenCalled();
  });
});
