/// <reference types="jest" />

import type { SenseRef } from 'interlinearizer';
import type {
  LexiconCapabilities,
  LexiconProvider,
  LexiconResolver,
  ResolvedSense,
} from 'interlinearizer/lexicon';
import {
  connectLexiconRegistry,
  createLexiconRegistry,
  nullLexiconResolver,
} from '../../utils/lexicon-resolvers';

const NO_CAPABILITIES: LexiconCapabilities = {
  search: false,
  create: false,
  allomorphs: false,
  msas: false,
};

const SENSE: ResolvedSense = { gloss: { en: 'water' } };

/** A lexicon whose every call is observable, so a test can assert what did and did not reach it. */
function stubResolver(
  authorities: readonly string[],
  capabilities: LexiconCapabilities = NO_CAPABILITIES,
): LexiconResolver {
  return {
    authorities,
    capabilities,
    resolveSense: jest.fn(async () => SENSE),
    searchByForm: jest.fn(async () => []),
    createEntry: jest.fn(async () => {
      throw new Error('unused');
    }),
  };
}

function senseRef(authority: string): SenseRef {
  return { authority, senseId: 's-1' };
}

describe('nullLexiconResolver', () => {
  it('declares no authority, so every ref is foreign to it', () => {
    expect(nullLexiconResolver.authorities).toEqual([]);
  });

  it('declares no capability, so no lexicon UI is offered', () => {
    expect(nullLexiconResolver.capabilities).toEqual(NO_CAPABILITIES);
  });

  it('resolves no sense', async () => {
    await expect(nullLexiconResolver.resolveSense(senseRef('anything'))).resolves.toBeUndefined();
  });

  it('finds nothing to gloss a form with', async () => {
    await expect(nullLexiconResolver.searchByForm('mayim')).resolves.toEqual([]);
  });

  it('refuses to create an entry rather than reporting one it did not create', async () => {
    await expect(
      nullLexiconResolver.createEntry({ form: 'mayim', writingSystem: 'hbo' }),
    ).rejects.toThrow('No lexicon is connected');
  });
});

describe('createLexiconRegistry', () => {
  it('resolves a ref through the lexicon whose authority minted it', async () => {
    const mine = stubResolver(['mine']);
    const other = stubResolver(['other']);
    const registry = createLexiconRegistry([mine, other]);

    await expect(registry.resolveSense(senseRef('mine'))).resolves.toBe(SENSE);
    expect(mine.resolveSense).toHaveBeenCalledWith(senseRef('mine'));
    expect(other.resolveSense).not.toHaveBeenCalled();
  });

  it('never hands a foreign ref to any lexicon', async () => {
    const mine = stubResolver(['mine']);
    const registry = createLexiconRegistry([mine]);

    await expect(registry.resolveSense(senseRef('unregistered'))).resolves.toBeUndefined();
    expect(mine.resolveSense).not.toHaveBeenCalled();
  });

  it('calls a ref foreign when no connected lexicon declares its authority', () => {
    const registry = createLexiconRegistry([stubResolver(['mine'])]);

    expect(registry.isForeign(senseRef('unregistered'))).toBe(true);
  });

  it('calls a ref native when a connected lexicon declares its authority', () => {
    const registry = createLexiconRegistry([stubResolver(['mine'])]);

    expect(registry.isForeign(senseRef('mine'))).toBe(false);
  });

  it('answers for an authority through the earlier of two lexicons declaring it', async () => {
    const earlier = stubResolver(['shared']);
    const later = stubResolver(['shared']);
    const registry = createLexiconRegistry([earlier, later]);

    await registry.resolveSense(senseRef('shared'));

    expect(earlier.resolveSense).toHaveBeenCalled();
    expect(later.resolveSense).not.toHaveBeenCalled();
  });

  it('names the lexicon that can serve a capability', () => {
    const searchable = stubResolver(['other'], { ...NO_CAPABILITIES, search: true });
    const registry = createLexiconRegistry([stubResolver(['mine']), searchable]);

    expect(registry.resolverWith('search')).toBe(searchable);
  });

  it('names no lexicon for a capability none has', () => {
    const registry = createLexiconRegistry([
      stubResolver(['mine'], { ...NO_CAPABILITIES, search: true }),
    ]);

    expect(registry.resolverWith('create')).toBeUndefined();
  });

  describe('connected to the null lexicon alone', () => {
    it('makes every ref foreign', () => {
      expect(createLexiconRegistry([nullLexiconResolver]).isForeign(senseRef('mine'))).toBe(true);
    });

    it.each<keyof LexiconCapabilities>(['search', 'create', 'allomorphs', 'msas'])(
      'offers no %s',
      (capability) => {
        expect(
          createLexiconRegistry([nullLexiconResolver]).resolverWith(capability),
        ).toBeUndefined();
      },
    );
  });
});

/** A provider whose connections are observable, so a test can assert which lexicon it was given. */
function stubProvider(authority: string): LexiconProvider & { connect: jest.Mock } {
  return {
    authority,
    isAvailable: jest.fn(async () => true),
    subscribeToLink: jest.fn(async () => async () => true),
    connect: jest.fn((lexiconId?: string) =>
      stubResolver([authority], { ...NO_CAPABILITIES, search: !!lexiconId }),
    ),
  };
}

describe('connectLexiconRegistry', () => {
  it('connects a provider to the lexicon its own link names', () => {
    const mine = stubProvider('mine');

    connectLexiconRegistry([mine], { mine: 'lex-1' });

    expect(mine.connect).toHaveBeenCalledWith('lex-1');
  });

  it('connects a provider that reported no link to no lexicon', () => {
    const other = stubProvider('other');

    connectLexiconRegistry([other], { mine: 'lex-1' });

    expect(other.connect).toHaveBeenCalledWith(undefined);
  });

  it('connects every provider to no lexicon when none reported a link', () => {
    const mine = stubProvider('mine');

    connectLexiconRegistry([mine], {});

    expect(mine.connect).toHaveBeenCalledWith(undefined);
  });

  it('connects each provider to its own lexicon when two report a link', () => {
    const mine = stubProvider('mine');
    const other = stubProvider('other');

    connectLexiconRegistry([mine, other], { mine: 'lex-1', other: 'lex-2' });

    expect(mine.connect).toHaveBeenCalledWith('lex-1');
    expect(other.connect).toHaveBeenCalledWith('lex-2');
  });

  it('serves an affordance from the first provider that can, when two are linked', () => {
    const mine = stubProvider('mine');
    const other = stubProvider('other');

    const registry = connectLexiconRegistry([mine, other], { mine: 'lex-1', other: 'lex-2' });

    expect(registry.resolverWith('search')?.authorities).toEqual(['mine']);
  });

  it('answers for an available provider connected to nothing, so its refs are not foreign', () => {
    const registry = connectLexiconRegistry([stubProvider('mine')], {});

    expect(registry.isForeign(senseRef('mine'))).toBe(false);
  });

  it('calls a ref foreign when no available provider declares its authority', () => {
    const registry = connectLexiconRegistry([stubProvider('mine')], {});

    expect(registry.isForeign(senseRef('other'))).toBe(true);
  });

  it('offers the capabilities of a provider connected to a lexicon', () => {
    const registry = connectLexiconRegistry([stubProvider('mine')], { mine: 'lex-1' });

    expect(registry.resolverWith('search')).toBeDefined();
  });

  it('offers nothing while no provider can be reached', () => {
    const registry = connectLexiconRegistry([], {});

    expect(registry.resolverWith('search')).toBeUndefined();
    expect(registry.isForeign(senseRef('mine'))).toBe(true);
  });
});
