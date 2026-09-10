/// <reference types="jest" />

import papi from '@papi/frontend';
import type { SenseRef } from 'interlinearizer';
import type { LexiconEntry } from '../../types/lexicon-extension';
import { fwLiteLexiconProvider, resetEntryServiceForTesting } from '../../utils/fw-lite-lexicon';
import { FW_LITE_AUTHORITY } from '../../utils/lexicon-authorities';
import {
  getMockedNetworkObjectGet,
  getMockedPdpGet,
  getMockedWaitForNetworkObject,
} from '../test-helpers';

const LEXICON = 'my-lexicon';

const mockNetworkObjectGet = getMockedNetworkObjectGet(papi);
const mockWaitForNetworkObject = getMockedWaitForNetworkObject(papi);
const mockPdpGet = getMockedPdpGet(papi);

/**
 * The subset of the entry service a test drives, with every call observable. `dispose()` fires the
 * handler the provider registers, as the platform does when the Lexicon extension disposes the
 * object.
 */
function stubService(
  overrides: Partial<Record<'getSense' | 'getEntries' | 'addEntry', jest.Mock>>,
) {
  const handlers: (() => void)[] = [];
  return {
    getSense: jest.fn(async () => undefined),
    getEntries: jest.fn(async () => undefined),
    addEntry: jest.fn(async () => undefined),
    onDidDispose: jest.fn((handler: () => void) => {
      handlers.push(handler);
      return () => true;
    }),
    dispose: () => handlers.forEach((handler) => handler()),
    ...overrides,
  };
}

/** Registers `service` as the lexicon entry service the provider will find. */
function serve(service: object) {
  mockWaitForNetworkObject.mockResolvedValue({ id: 'lexicon.entryService' });
  mockNetworkObjectGet.mockResolvedValue(service);
}

/** Leaves nothing registered, as when the Lexicon extension is not installed. */
function serveNothing() {
  mockWaitForNetworkObject.mockRejectedValue(new Error('timed out'));
}

function entry(overrides?: Partial<LexiconEntry>): LexiconEntry {
  return {
    id: 'e-1',
    lexemeForm: { hbo: 'mayim' },
    senses: [{ id: 's-1', gloss: { en: 'water' } }],
    ...overrides,
  };
}

function senseRef(projectId?: string): SenseRef {
  return { authority: FW_LITE_AUTHORITY, projectId, senseId: 's-1' };
}

beforeEach(() => {
  resetEntryServiceForTesting();
});

describe('fwLiteLexiconProvider', () => {
  it('declares the FieldWorks Lite id space', () => {
    expect(fwLiteLexiconProvider.authority).toBe(FW_LITE_AUTHORITY);
  });

  describe('isAvailable', () => {
    it('is available once the lexicon service is registered', async () => {
      serve(stubService({}));

      await expect(fwLiteLexiconProvider.isAvailable()).resolves.toBe(true);
    });

    it('is unavailable when nothing registers the service in time', async () => {
      serveNothing();

      await expect(fwLiteLexiconProvider.isAvailable()).resolves.toBe(false);
    });

    it('is unavailable when the service is announced but cannot be fetched', async () => {
      mockWaitForNetworkObject.mockResolvedValue({ id: 'x' });
      mockNetworkObjectGet.mockResolvedValue(undefined);

      await expect(fwLiteLexiconProvider.isAvailable()).resolves.toBe(false);
    });

    it('waits for the service once, so a second lexicon action does not pay the wait again', async () => {
      serve(stubService({}));

      await fwLiteLexiconProvider.isAvailable();
      await fwLiteLexiconProvider.isAvailable();

      expect(mockWaitForNetworkObject).toHaveBeenCalledTimes(1);
    });

    it('looks the service up again once the one it held was disposed', async () => {
      // The platform revokes the proxy on dispose, so holding on to it would throw on every call
      // rather than miss. The replacement is found by starting over.
      const first = stubService({});
      serve(first);
      await fwLiteLexiconProvider.isAvailable();

      first.dispose();
      serve(stubService({}));

      await expect(fwLiteLexiconProvider.isAvailable()).resolves.toBe(true);
      expect(mockWaitForNetworkObject).toHaveBeenCalledTimes(2);
    });

    it('reports unavailable once the service it held was disposed and none replaced it', async () => {
      const first = stubService({});
      serve(first);
      await fwLiteLexiconProvider.isAvailable();

      first.dispose();
      serveNothing();

      await expect(fwLiteLexiconProvider.isAvailable()).resolves.toBe(false);
    });
  });

  describe('connected to no lexicon', () => {
    it('still declares the authority, so a ref FieldWorks Lite minted is not foreign', () => {
      expect(fwLiteLexiconProvider.connect().authorities).toEqual([FW_LITE_AUTHORITY]);
    });

    it('offers no capability, so nothing invites use of a lexicon that is not linked', () => {
      expect(fwLiteLexiconProvider.connect().capabilities).toEqual({
        search: false,
        create: false,
        allomorphs: false,
        msas: false,
      });
    });

    it('resolves no sense', async () => {
      await expect(
        fwLiteLexiconProvider.connect().resolveSense(senseRef()),
      ).resolves.toBeUndefined();
    });

    it('finds nothing to gloss a form with', async () => {
      await expect(fwLiteLexiconProvider.connect().searchByForm('mayim')).resolves.toEqual([]);
    });

    it('refuses to create an entry rather than reporting one it did not create', async () => {
      await expect(
        fwLiteLexiconProvider.connect().createEntry({ form: 'mayim', writingSystem: 'hbo' }),
      ).rejects.toThrow('No lexicon is connected');
    });
  });

  describe('connected to a lexicon', () => {
    it('can be searched and added to, and holds no allomorphs or analyses', () => {
      expect(fwLiteLexiconProvider.connect(LEXICON).capabilities).toEqual({
        search: true,
        create: true,
        allomorphs: false,
        msas: false,
      });
    });

    describe('resolveSense', () => {
      it('resolves a sense of the connected lexicon to its gloss', async () => {
        const service = stubService({
          getSense: jest.fn(async () => ({ id: 's-1', gloss: { en: 'water' } })),
        });
        serve(service);

        await expect(
          fwLiteLexiconProvider.connect(LEXICON).resolveSense(senseRef(LEXICON)),
        ).resolves.toEqual({ gloss: { en: 'water' } });
        expect(service.getSense).toHaveBeenCalledWith(LEXICON, 's-1');
      });

      it('misses a ref naming another lexicon, and never asks that lexicon for it', async () => {
        const service = stubService({});
        serve(service);

        await expect(
          fwLiteLexiconProvider.connect(LEXICON).resolveSense(senseRef('other-lexicon')),
        ).resolves.toBeUndefined();
        expect(service.getSense).not.toHaveBeenCalled();
      });

      it('misses a ref that names no lexicon, rather than taking the connected one as meant', async () => {
        const service = stubService({});
        serve(service);

        await expect(
          fwLiteLexiconProvider.connect(LEXICON).resolveSense(senseRef()),
        ).resolves.toBeUndefined();
        expect(service.getSense).not.toHaveBeenCalled();
      });

      it('misses a sense the lexicon does not have', async () => {
        serve(stubService({}));

        await expect(
          fwLiteLexiconProvider.connect(LEXICON).resolveSense(senseRef(LEXICON)),
        ).resolves.toBeUndefined();
      });

      it('misses while the lexicon is unreachable', async () => {
        serveNothing();

        await expect(
          fwLiteLexiconProvider.connect(LEXICON).resolveSense(senseRef(LEXICON)),
        ).resolves.toBeUndefined();
      });
    });

    describe('searchByForm', () => {
      it('names every sense of every matching entry, alongside the form it is listed under', async () => {
        const service = stubService({
          getEntries: jest.fn(async () => [
            entry({
              senses: [
                { id: 's-1', gloss: { en: 'water' } },
                { id: 's-2', gloss: { en: 'waters' } },
              ],
            }),
          ]),
        });
        serve(service);

        await expect(fwLiteLexiconProvider.connect(LEXICON).searchByForm('mayim')).resolves.toEqual(
          [
            {
              gloss: { en: 'water' },
              lexemeForm: { hbo: 'mayim' },
              ref: { authority: FW_LITE_AUTHORITY, projectId: LEXICON, senseId: 's-1' },
            },
            {
              gloss: { en: 'waters' },
              lexemeForm: { hbo: 'mayim' },
              ref: { authority: FW_LITE_AUTHORITY, projectId: LEXICON, senseId: 's-2' },
            },
          ],
        );
        expect(service.getEntries).toHaveBeenCalledWith(LEXICON, { surfaceForm: 'mayim' });
      });

      it('drops an entry holding no form in the writing system asked for', async () => {
        serve(
          stubService({
            getEntries: jest.fn(async () => [
              entry(),
              entry({ id: 'e-2', lexemeForm: { el: 'hydor' } }),
            ]),
          }),
        );

        const candidates = await fwLiteLexiconProvider
          .connect(LEXICON)
          .searchByForm('mayim', { writingSystem: 'hbo' });

        expect(candidates).toHaveLength(1);
        expect(candidates[0].lexemeForm).toEqual({ hbo: 'mayim' });
      });

      it('caps the candidates at the count asked for', async () => {
        serve(
          stubService({
            getEntries: jest.fn(async () => [entry(), entry({ id: 'e-2' })]),
          }),
        );

        await expect(
          fwLiteLexiconProvider.connect(LEXICON).searchByForm('mayim', { limit: 1 }),
        ).resolves.toHaveLength(1);
      });

      it('finds nothing when the lexicon cannot be read', async () => {
        serve(stubService({}));

        await expect(fwLiteLexiconProvider.connect(LEXICON).searchByForm('mayim')).resolves.toEqual(
          [],
        );
      });
    });

    describe('createEntry', () => {
      it('creates the entry under one sense, so a gloss has a sense to link to', async () => {
        const service = stubService({
          addEntry: jest.fn(async () => entry()),
        });
        serve(service);

        await expect(
          fwLiteLexiconProvider
            .connect(LEXICON)
            .createEntry({ form: 'mayim', writingSystem: 'hbo', gloss: { en: 'water' } }),
        ).resolves.toEqual({
          entryRef: { authority: FW_LITE_AUTHORITY, projectId: LEXICON, entryId: 'e-1' },
          senseRef: { authority: FW_LITE_AUTHORITY, projectId: LEXICON, senseId: 's-1' },
        });
        expect(service.addEntry).toHaveBeenCalledWith(LEXICON, {
          lexemeForm: { hbo: 'mayim' },
          senses: [{ gloss: { en: 'water' } }],
        });
      });

      it('creates a sense for an entry drafted without a gloss', async () => {
        const service = stubService({ addEntry: jest.fn(async () => entry()) });
        serve(service);

        await fwLiteLexiconProvider
          .connect(LEXICON)
          .createEntry({ form: 'mayim', writingSystem: 'hbo' });

        expect(service.addEntry).toHaveBeenCalledWith(LEXICON, {
          lexemeForm: { hbo: 'mayim' },
          senses: [{ gloss: {} }],
        });
      });

      it('refuses when the lexicon is unreachable', async () => {
        serveNothing();

        await expect(
          fwLiteLexiconProvider
            .connect(LEXICON)
            .createEntry({ form: 'mayim', writingSystem: 'hbo' }),
        ).rejects.toThrow('unreachable');
      });

      it('refuses when the lexicon reports no entry', async () => {
        serve(stubService({}));

        await expect(
          fwLiteLexiconProvider
            .connect(LEXICON)
            .createEntry({ form: 'mayim', writingSystem: 'hbo' }),
        ).rejects.toThrow('no entry and sense');
      });

      it('refuses when the created entry carries no sense a gloss could link to', async () => {
        serve(stubService({ addEntry: jest.fn(async () => entry({ senses: [] })) }));

        await expect(
          fwLiteLexiconProvider
            .connect(LEXICON)
            .createEntry({ form: 'mayim', writingSystem: 'hbo' }),
        ).rejects.toThrow('no entry and sense');
      });
    });
  });
});

describe('fwLiteLexiconProvider searchByForm limits', () => {
  it('caps at none for a limit below zero, rather than trimming from the end', async () => {
    serve(stubService({ getEntries: jest.fn(async () => [entry(), entry({ id: 'e-2' })]) }));

    const candidates = await fwLiteLexiconProvider
      .connect(LEXICON)
      .searchByForm('mayim', { limit: -1 });

    expect(candidates).toEqual([]);
  });

  it('caps at none for a limit of zero', async () => {
    serve(stubService({ getEntries: jest.fn(async () => [entry()]) }));

    const candidates = await fwLiteLexiconProvider
      .connect(LEXICON)
      .searchByForm('mayim', { limit: 0 });

    expect(candidates).toEqual([]);
  });
});

describe('fwLiteLexiconProvider searchByForm writing systems', () => {
  it('drops an entry whose queried text sits under another writing system', async () => {
    // The backend searches every writing system it holds forms in, so it matched this entry on its
    // English form. Asked for Hebrew, the Hebrew form is the one that has to match.
    const multilingual = entry({ lexemeForm: { en: 'water', hbo: 'mayim' } });
    serve(stubService({ getEntries: jest.fn(async () => [multilingual]) }));

    const candidates = await fwLiteLexiconProvider
      .connect(LEXICON)
      .searchByForm('water', { writingSystem: 'hbo' });

    expect(candidates).toEqual([]);
  });

  it('keeps an entry whose form in the requested writing system matches', async () => {
    const multilingual = entry({ lexemeForm: { en: 'water', hbo: 'mayim' } });
    serve(stubService({ getEntries: jest.fn(async () => [multilingual]) }));

    const candidates = await fwLiteLexiconProvider
      .connect(LEXICON)
      .searchByForm('mayim', { writingSystem: 'hbo' });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.lexemeForm).toEqual({ en: 'water', hbo: 'mayim' });
  });

  it('keeps a match the lexicon made on a pointed form, which the fold reaches', async () => {
    const pointed = entry({ lexemeForm: { hbo: '\u05de\u05b7\u05d9\u05b4\u05dd' } });
    serve(stubService({ getEntries: jest.fn(async () => [pointed]) }));

    const candidates = await fwLiteLexiconProvider
      .connect(LEXICON)
      .searchByForm('\u05de\u05d9\u05dd', { writingSystem: 'hbo' });

    expect(candidates).toHaveLength(1);
  });

  it('searches every writing system when none is asked for', async () => {
    const multilingual = entry({ lexemeForm: { en: 'water', hbo: 'mayim' } });
    serve(stubService({ getEntries: jest.fn(async () => [multilingual]) }));

    const candidates = await fwLiteLexiconProvider.connect(LEXICON).searchByForm('water');

    expect(candidates).toHaveLength(1);
  });
});

describe('fwLiteLexiconProvider.subscribeToLink', () => {
  /** A project data provider whose setting watch is observable, holding the watch's callback. */
  function stubPdp(unsubscribe = jest.fn(async () => true)) {
    const watch: { report?: (value: unknown) => void } = {};
    return {
      subscribeSetting: jest.fn(async (_key: string, callback: (value: unknown) => void) => {
        watch.report = callback;
        return unsubscribe;
      }),
      watch,
      unsubscribe,
    };
  }

  it("watches the Lexicon extension's record for the project asked about", async () => {
    const pdp = stubPdp();
    mockPdpGet.mockResolvedValue(pdp);
    const callback = jest.fn();

    await fwLiteLexiconProvider.subscribeToLink('project-1', callback);

    expect(mockPdpGet).toHaveBeenCalledWith('platform.base', 'project-1');
    expect(pdp.subscribeSetting).toHaveBeenCalledWith('lexicon.lexiconCode', expect.any(Function));
  });

  it.each<[string, unknown, string | undefined]>([
    ['a stored lexicon code', LEXICON, LEXICON],
    ['a cleared setting', '', undefined],
    [
      'a setting the platform could not read',
      { platformErrorVersion: 1, message: 'nope' },
      undefined,
    ],
  ])('reports %s', async (_case, value, expected) => {
    const pdp = stubPdp();
    mockPdpGet.mockResolvedValue(pdp);
    const callback = jest.fn();
    await fwLiteLexiconProvider.subscribeToLink('project-1', callback);

    pdp.watch.report?.(value);

    expect(callback).toHaveBeenLastCalledWith(expected);
  });

  it('hands back the watch so the caller can close it', async () => {
    const pdp = stubPdp();
    mockPdpGet.mockResolvedValue(pdp);

    const unsubscribe = await fwLiteLexiconProvider.subscribeToLink('project-1', jest.fn());
    await unsubscribe();

    expect(pdp.unsubscribe).toHaveBeenCalled();
  });

  it('reports no link for a project whose setting cannot be reached', async () => {
    mockPdpGet.mockRejectedValue(new Error('no such project'));
    const callback = jest.fn();

    const unsubscribe = await fwLiteLexiconProvider.subscribeToLink('project-1', callback);

    expect(callback).toHaveBeenCalledWith(undefined);
    await expect(unsubscribe()).resolves.toBe(true);
  });
});
