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

/** The project a connected registry answers for, and the one its chooser must be opened with. */
const PROJECT_ID = 'project-1';

/**
 * A provider whose connections are observable, so a test can assert which lexicon it was given.
 * Passing `openChooser` makes it one that offers a way to choose a lexicon; omitting it makes one
 * that offers none.
 */
function stubProvider(
  authority: string,
  openChooser?: LexiconProvider['openChooser'],
): LexiconProvider & { connect: jest.Mock } {
  return {
    authority,
    isAvailable: jest.fn(async () => true),
    subscribeToLink: jest.fn(async () => async () => true),
    connect: jest.fn((lexiconId?: string) =>
      stubResolver([authority], { ...NO_CAPABILITIES, search: !!lexiconId }),
    ),
    ...(openChooser ? { openChooser } : {}),
  };
}

/** Both stub providers have reported their link, so a missing one means none. */
const BOTH_LINKS_READ: ReadonlySet<string> = new Set(['mine', 'other']);

describe('connectLexiconRegistry', () => {
  it('connects a provider to the lexicon its own link names', () => {
    const mine = stubProvider('mine');

    connectLexiconRegistry(PROJECT_ID, [mine], { mine: 'lex-1' }, BOTH_LINKS_READ);

    expect(mine.connect).toHaveBeenCalledWith('lex-1');
  });

  it('connects a provider that reported no link to no lexicon', () => {
    const other = stubProvider('other');

    connectLexiconRegistry(PROJECT_ID, [other], { mine: 'lex-1' }, BOTH_LINKS_READ);

    expect(other.connect).toHaveBeenCalledWith(undefined);
  });

  it('connects every provider to no lexicon when none reported a link', () => {
    const mine = stubProvider('mine');

    connectLexiconRegistry(PROJECT_ID, [mine], {}, BOTH_LINKS_READ);

    expect(mine.connect).toHaveBeenCalledWith(undefined);
  });

  it('connects each provider to its own lexicon when two report a link', () => {
    const mine = stubProvider('mine');
    const other = stubProvider('other');

    connectLexiconRegistry(
      PROJECT_ID,
      [mine, other],
      { mine: 'lex-1', other: 'lex-2' },
      BOTH_LINKS_READ,
    );

    expect(mine.connect).toHaveBeenCalledWith('lex-1');
    expect(other.connect).toHaveBeenCalledWith('lex-2');
  });

  it('serves an affordance from the first provider that can, when two are linked', () => {
    const mine = stubProvider('mine');
    const other = stubProvider('other');

    const registry = connectLexiconRegistry(
      PROJECT_ID,
      [mine, other],
      { mine: 'lex-1', other: 'lex-2' },
      BOTH_LINKS_READ,
    );

    expect(registry.resolverWith('search')?.authorities).toEqual(['mine']);
  });

  it('answers for an available provider connected to nothing, so its refs are not foreign', () => {
    const registry = connectLexiconRegistry(
      PROJECT_ID,
      [stubProvider('mine')],
      {},
      BOTH_LINKS_READ,
    );

    expect(registry.isForeign(senseRef('mine'))).toBe(false);
  });

  it('calls a ref foreign when no available provider declares its authority', () => {
    const registry = connectLexiconRegistry(
      PROJECT_ID,
      [stubProvider('mine')],
      {},
      BOTH_LINKS_READ,
    );

    expect(registry.isForeign(senseRef('other'))).toBe(true);
  });

  it('offers the capabilities of a provider connected to a lexicon', () => {
    const registry = connectLexiconRegistry(
      PROJECT_ID,
      [stubProvider('mine')],
      { mine: 'lex-1' },
      BOTH_LINKS_READ,
    );

    expect(registry.resolverWith('search')).toBeDefined();
  });

  it('offers nothing while no provider can be reached', () => {
    const registry = connectLexiconRegistry(PROJECT_ID, [], {}, BOTH_LINKS_READ);

    expect(registry.resolverWith('search')).toBeUndefined();
    expect(registry.isForeign(senseRef('mine'))).toBe(true);
  });

  describe('the chooser', () => {
    it('opens the chooser of a reachable provider this project has no link to', async () => {
      const openChooser = jest.fn(async () => true);

      await connectLexiconRegistry(
        PROJECT_ID,
        [stubProvider('mine', openChooser)],
        {},
        BOTH_LINKS_READ,
      ).openChooser?.();

      expect(openChooser).toHaveBeenCalledWith(PROJECT_ID);
    });

    it('reports whether the chooser opened', async () => {
      const registry = connectLexiconRegistry(
        PROJECT_ID,
        [
          stubProvider(
            'mine',
            jest.fn(async () => false),
          ),
        ],
        {},
        BOTH_LINKS_READ,
      );

      await expect(registry.openChooser?.()).resolves.toBe(false);
    });

    it('offers none for a project already linked, since linking is offered only where there is no link', () => {
      const registry = connectLexiconRegistry(
        PROJECT_ID,
        [stubProvider('mine', jest.fn())],
        { mine: 'lex-1' },
        BOTH_LINKS_READ,
      );

      expect(registry.openChooser).toBeUndefined();
    });

    it('offers none before the provider has reported a link, since an unread link may be there', () => {
      const registry = connectLexiconRegistry(
        PROJECT_ID,
        [stubProvider('mine', jest.fn())],
        {},
        new Set(),
      );

      expect(registry.openChooser).toBeUndefined();
    });

    it('passes over a provider yet to report a link for one that reported none', async () => {
      const unread = jest.fn(async () => true);
      const unlinked = jest.fn(async () => true);
      const registry = connectLexiconRegistry(
        PROJECT_ID,
        [stubProvider('mine', unread), stubProvider('other', unlinked)],
        {},
        new Set(['other']),
      );

      await registry.openChooser?.();

      expect(unread).not.toHaveBeenCalled();
      expect(unlinked).toHaveBeenCalledWith(PROJECT_ID);
    });

    it('offers none when the provider that can be reached has no chooser', () => {
      expect(
        connectLexiconRegistry(PROJECT_ID, [stubProvider('mine')], {}, BOTH_LINKS_READ).openChooser,
      ).toBeUndefined();
    });

    it('offers none when no provider can be reached', () => {
      expect(
        connectLexiconRegistry(PROJECT_ID, [], {}, BOTH_LINKS_READ).openChooser,
      ).toBeUndefined();
    });

    it('passes over a linked provider for one this project is not linked to', async () => {
      const linked = jest.fn(async () => true);
      const unlinked = jest.fn(async () => true);
      const registry = connectLexiconRegistry(
        PROJECT_ID,
        [stubProvider('mine', linked), stubProvider('other', unlinked)],
        { mine: 'lex-1' },
        BOTH_LINKS_READ,
      );

      await registry.openChooser?.();

      expect(linked).not.toHaveBeenCalled();
      expect(unlinked).toHaveBeenCalledWith(PROJECT_ID);
    });
  });
});
