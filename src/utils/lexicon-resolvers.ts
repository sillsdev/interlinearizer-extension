import type { LexiconAuthority, LexiconRef, SenseRef } from 'interlinearizer';
import type {
  LexiconCapability,
  LexiconLink,
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
 * The lexicons connected for one project, ordinarily one, and none is a supported configuration.
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
};

/**
 * Assembles the registry over the lexicons connected for the session. Two of them declaring one
 * authority is a misconfiguration rather than a case to serve, so the earlier answers for it and
 * the later's claim on it is dropped.
 */
export function createLexiconRegistry(resolvers: readonly LexiconResolver[]): LexiconRegistry {
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
  };
}

/**
 * Assembles the registry for one project over the software that can be reached, with the lexicon
 * the project is linked to connected.
 *
 * Availability and connection are separate: software that is reachable but holds no lexicon for
 * this project still answers for its authority, so the refs it minted read as misses rather than as
 * foreign - which is what tells a project that has been relinked apart from one glossed by a
 * lexicon nobody here has.
 *
 * @param link - Omitted for a project linked to no lexicon.
 */
export function connectLexiconRegistry(
  availableProviders: readonly LexiconProvider[],
  link?: LexiconLink,
): LexiconRegistry {
  return createLexiconRegistry(
    availableProviders.map((provider) =>
      provider.connect(provider.authority === link?.authority ? link.lexiconId : undefined),
    ),
  );
}
