/// <reference types="jest" />

import type { DraftEnvelope } from 'interlinearizer';
import { DraftEnvelopeStore } from '../../cache/draftEnvelope';
import type { AppliedChangeSet, ScopeRecord } from '../../types/analysis-repository';
import { emptyDraft } from '../../types/empty-factories';
import { envelopeOf as draftEnvelopeOf } from '../../types/draft-envelope';
import { scopeRecordOf } from '../../utils/change-set';

/** The envelope of a draft for the source `src`, saved unless `dirty`. */
function envelopeOf(dirty = false, analysisLanguages = ['en']): DraftEnvelope {
  return { ...draftEnvelopeOf(scopeRecordOf(emptyDraft('src')), dirty), analysisLanguages };
}

/** The scope record of a draft for the source `src` that lists `analysisLanguages`. */
function scopeWith(analysisLanguages: string[]): ScopeRecord {
  return { ...scopeRecordOf(emptyDraft('src')), analysisLanguages };
}

/** Changes that delete a payload. */
const CHANGES: AppliedChangeSet = { intent: 'x', tokenAnalyses: { puts: [], deletes: ['a'] } };

/** A fetch whose calls each wait until `resolveNext` hands them an envelope. */
function heldFetch() {
  const waiting: ((envelope: DraftEnvelope) => void)[] = [];
  const fetch = jest.fn(
    () =>
      new Promise<DraftEnvelope>((resolve) => {
        waiting.push(resolve);
      }),
  );
  /** Hands `envelope` to the oldest waiting call, once any queued refresh has called the fetch. */
  const resolveNext = async (envelope: DraftEnvelope) => {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    waiting.shift()?.(envelope);
  };
  return { fetch, resolveNext };
}

describe('DraftEnvelopeStore', () => {
  it('holds no envelope before its first fetch lands', () => {
    const store = new DraftEnvelopeStore(async () => envelopeOf());

    expect(store.envelope).toBeUndefined();
  });

  it('holds what its latest fetch got, telling its listeners', async () => {
    const store = new DraftEnvelopeStore(async () => envelopeOf());
    const listener = jest.fn();
    store.subscribe(listener);

    await store.refresh();

    expect(store.envelope).toStrictEqual(envelopeOf());
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps the envelope it holds, telling no listener, when a fetch gets the same again', async () => {
    const store = new DraftEnvelopeStore(async () => envelopeOf());
    await store.refresh();
    const held = store.envelope;
    const listener = jest.fn();
    store.subscribe(listener);

    await store.refresh();

    expect(store.envelope).toBe(held);
    expect(listener).not.toHaveBeenCalled();
  });

  it('fetches once more after a fetch under way, however often it is asked meanwhile', async () => {
    const { fetch, resolveNext } = heldFetch();
    const store = new DraftEnvelopeStore(fetch);
    const first = store.refresh();
    const second = store.refresh();
    const third = store.refresh();

    await resolveNext(envelopeOf(false, ['en']));
    await resolveNext(envelopeOf(false, ['fr']));
    await Promise.all([first, second, third]);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(store.envelope?.analysisLanguages).toStrictEqual(['fr']);
  });

  it('keeps what it held when a fetch fails, and rejects that refresh', async () => {
    const fetch = jest
      .fn<Promise<DraftEnvelope>, []>()
      .mockResolvedValueOnce(envelopeOf())
      .mockRejectedValueOnce(new Error('gone'));
    const store = new DraftEnvelopeStore(fetch);
    await store.refresh();

    await expect(store.refresh()).rejects.toThrow('gone');

    expect(store.envelope).toStrictEqual(envelopeOf());
  });

  it('marks the draft unsaved for changes it takes in, telling its listeners', async () => {
    const store = new DraftEnvelopeStore(async () => envelopeOf());
    await store.refresh();
    const listener = jest.fn();
    store.subscribe(listener);

    store.take(CHANGES);

    expect(store.envelope?.dirty).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('marks the draft saved when told the changes left it saved', async () => {
    const store = new DraftEnvelopeStore(async () => envelopeOf(true));
    await store.refresh();

    store.take(CHANGES, false);

    expect(store.envelope?.dirty).toBe(false);
  });

  it('keeps the draft as saved as it was when told the changes kept its mark', async () => {
    const store = new DraftEnvelopeStore(async () => envelopeOf());
    await store.refresh();

    store.take(CHANGES, 'kept');

    expect(store.envelope?.dirty).toBe(false);
  });

  it('lands a fetch with its own mark under changes taken in meanwhile that kept the mark', async () => {
    const { fetch, resolveNext } = heldFetch();
    const store = new DraftEnvelopeStore(fetch);
    const refreshed = store.refresh();

    store.take(CHANGES, 'kept');
    await resolveNext(envelopeOf(true));
    await refreshed;

    expect(store.envelope?.dirty).toBe(true);
  });

  it('lands a fetch with the mark that the changes taken in meanwhile left', async () => {
    const { fetch, resolveNext } = heldFetch();
    const store = new DraftEnvelopeStore(fetch);
    const refreshed = store.refresh();

    store.take(CHANGES, false);
    await resolveNext(envelopeOf(true));
    await refreshed;

    expect(store.envelope?.dirty).toBe(false);
  });

  it('leaves the draft saved, telling no listener, for changes that change no record', async () => {
    const store = new DraftEnvelopeStore(async () => envelopeOf());
    await store.refresh();
    const listener = jest.fn();
    store.subscribe(listener);

    store.take({ intent: 'x' });

    expect(store.envelope).toStrictEqual(envelopeOf());
    expect(listener).not.toHaveBeenCalled();
  });

  it('lands a fetch saved when the changes taken in meanwhile change no record', async () => {
    const { fetch, resolveNext } = heldFetch();
    const store = new DraftEnvelopeStore(fetch);
    const refreshed = store.refresh();

    store.take({ intent: 'x' });
    await resolveNext(envelopeOf());
    await refreshed;

    expect(store.envelope).toStrictEqual(envelopeOf());
  });

  it('takes in the fields of a scope record the changes put, telling its listeners', async () => {
    const store = new DraftEnvelopeStore(async () => envelopeOf(false, ['en']));
    await store.refresh();
    const listener = jest.fn();
    store.subscribe(listener);

    store.take({ intent: 'x', scope: scopeWith(['fr', 'en']) }, false);

    expect(store.envelope).toStrictEqual(envelopeOf(false, ['fr', 'en']));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps the envelope it holds, telling no listener, for a scope record that changes no field', async () => {
    const store = new DraftEnvelopeStore(async () => envelopeOf(false, ['en']));
    await store.refresh();
    const held = store.envelope;
    const listener = jest.fn();
    store.subscribe(listener);

    store.take({ intent: 'x', scope: scopeWith(['en']) }, 'kept');

    expect(store.envelope).toBe(held);
    expect(listener).not.toHaveBeenCalled();
  });

  it('keeps the languages it holds for a scope record that lists none', async () => {
    const store = new DraftEnvelopeStore(async () => envelopeOf(false, ['en']));
    await store.refresh();
    const held = store.envelope;

    store.take({ intent: 'x', scope: scopeWith([]) }, false);

    expect(store.envelope).toBe(held);
  });

  it('lands a fetch with the scope record that the changes taken in meanwhile put', async () => {
    const { fetch, resolveNext } = heldFetch();
    const store = new DraftEnvelopeStore(fetch);
    const refreshed = store.refresh();

    store.take({ intent: 'x', scope: scopeWith(['fr']) });
    await resolveNext(envelopeOf(false, ['en']));
    await refreshed;

    expect(store.envelope).toStrictEqual(envelopeOf(true, ['fr']));
  });

  it('holds no envelope for changes taken in before its first fetch lands', () => {
    const store = new DraftEnvelopeStore(async () => envelopeOf());

    store.take(CHANGES);

    expect(store.envelope).toBeUndefined();
  });

  it('stops telling a listener once it unsubscribes', async () => {
    const store = new DraftEnvelopeStore(async () => envelopeOf());
    const listener = jest.fn();
    store.subscribe(listener)();

    await store.refresh();

    expect(listener).not.toHaveBeenCalled();
  });
});
