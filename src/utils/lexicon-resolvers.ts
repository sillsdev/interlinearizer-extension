import type { LexiconAuthority, LexiconRef, SenseRef } from 'interlinearizer';
import type {
  LexiconCapability,
  LexiconProvider,
  LexiconResolver,
  ResolvedSense,
} from 'interlinearizer/lexicon';

/** The lexicon that holds nothing: the shape of the Interlinearizer running with no lexicon. */
export const nullLexiconResolver: LexiconResolver = {
  authorities: [],
  capabilities: { search: false, create: false, allomorphs: false, msas: false },
  resolveSense: async () => undefined,
  searchByForm: async () => [],
  createEntry: async () => {
    throw new Error('No lexicon is connected to create an entry in.');
  },
};

/**
 * The lexicons connected for one project. Ordinarily there is one, and a project with none
 * connected is supported.
 *
 * A connection is not what decides where a ref goes; the authority stamped on the ref is, because a
 * project keeps the refs of whatever lexicon glossed it whether or not that lexicon is connected. A
 * ref never reaches a lexicon that did not mint it.
 */
export type LexiconRegistry = {
  /**
   * Whether `ref` names an authority no connected lexicon answers for, leaving it to render as the
   * free-form gloss stored beside it.
   */
  isForeign: (ref: LexiconRef) => boolean;

  /**
   * Names the lexicon an affordance (a piece of UI the user can act on) is both rendered behind and
   * served by, so an affordance no connected lexicon can serve is never rendered.
   *
   * @returns The first connected lexicon that can do `capability`, or `undefined` when none can.
   */
  resolverWith: (capability: LexiconCapability) => LexiconResolver | undefined;

  /**
   * Resolves `ref` through the lexicon whose authority minted it.
   *
   * @returns The sense, or `undefined` when the ref is foreign or its lexicon has no such sense.
   */
  resolveSense: (ref: SenseRef) => Promise<ResolvedSense | undefined>;

  /**
   * Opens the way to choose a lexicon for this project, or `undefined` where there is none to
   * offer: no lexicon software that can be reached offers one, or every one that does has already
   * linked this project.
   *
   * Linking is offered only where there is no link. Changing one strands every ref it minted -
   * those glosses fall back to the free-form text stored beside them - so the software that owns
   * the link owns the changing of it too.
   */
  openChooser: (() => Promise<boolean>) | undefined;
};

/**
 * Assembles the registry over the connected lexicons. Two of them declaring one authority is a
 * misconfiguration rather than a case to serve, so the earlier answers for it and the later's claim
 * on it is dropped.
 */
export function createLexiconRegistry(
  resolvers: readonly LexiconResolver[],
  openChooser?: () => Promise<boolean>,
): LexiconRegistry {
  const resolversByAuthority = new Map<LexiconAuthority, LexiconResolver>();
  resolvers.forEach((resolver) => {
    resolver.authorities.forEach((authority) => {
      if (!resolversByAuthority.has(authority)) resolversByAuthority.set(authority, resolver);
    });
  });

  return {
    isForeign: (ref) => !resolversByAuthority.has(ref.authority),
    resolverWith: (capability) => resolvers.find((resolver) => resolver.capabilities[capability]),
    resolveSense: async (ref) => resolversByAuthority.get(ref.authority)?.resolveSense(ref),
    openChooser,
  };
}

/**
 * The lexicon each provider's own record links this project to, keyed by the linking provider's
 * authority. A provider with no entry is linked to nothing.
 */
export type LexiconLinks = Readonly<Record<LexiconAuthority, string>>;

/**
 * Assembles the registry for one project over the software that can be reached, each provider
 * connected to the lexicon its own record links this project to.
 *
 * Availability and connection are separate. Software that is reachable but holds no lexicon for
 * this project still answers for its authority, which is what tells a project that has been
 * relinked apart from one glossed by a lexicon nobody here has.
 *
 * A link is the linking provider's to keep, so two providers may report one each and nothing here
 * arbitrates. Refs still route by the authority that minted them, and an affordance goes to the
 * first provider in `availableProviders` that can serve it.
 *
 * The chooser follows that same rule and one more: a provider this project is already linked to
 * offers none, since linking is offered only where there is no link. The project is named here
 * rather than passed in later so a registry can never open a chooser for a project other than the
 * one it was assembled for.
 */
export function connectLexiconRegistry(
  projectId: string,
  availableProviders: readonly LexiconProvider[],
  links: LexiconLinks,
): LexiconRegistry {
  const unlinkedChooser = availableProviders.find(
    ({ authority, openChooser }) => openChooser && !links[authority],
  );
  const { openChooser } = unlinkedChooser ?? {};
  return createLexiconRegistry(
    availableProviders.map((provider) => provider.connect(links[provider.authority])),
    openChooser ? () => openChooser(projectId) : undefined,
  );
}
