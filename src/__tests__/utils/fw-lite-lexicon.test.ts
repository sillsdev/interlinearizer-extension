/// <reference types="jest" />

import papi from '@papi/frontend';
import type { SenseRef } from 'interlinearizer';
import type { LexiconEntry } from '../../types/lexicon-extension';
import { fwLiteLexiconProvider, resetEntryServiceForTesting } from '../../utils/fw-lite-lexicon';
import { FW_LITE_AUTHORITY } from '../../utils/lexicon-authorities';
import { getMockedNetworkObjectGet, getMockedWaitForNetworkObject } from '../test-helpers';

const LEXICON = 'my-lexicon';

const mockNetworkObjectGet = getMockedNetworkObjectGet(papi);
const mockWaitForNetworkObject = getMockedWaitForNetworkObject(papi);

/** The subset of the entry service a test drives, with every call observable. */
function stubService(
  overrides: Partial<Record<'getSense' | 'getEntries' | 'addEntry', jest.Mock>>,
) {
  return {
    getSense: jest.fn(async () => undefined),
    getEntries: jest.fn(async () => undefined),
    addEntry: jest.fn(async () => undefined),
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
