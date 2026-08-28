import type { LexiconAuthority, LexiconRef, SenseRef } from 'interlinearizer';
import type { LexiconCapability, LexiconResolver, ResolvedSense } from 'interlinearizer/lexicon';

/** The lexicon that holds nothing: the shape of the Interlinearizer running with no lexicon. */
export const nullLexiconResolver: LexiconResolver = {
  authorities: [],
  capabilities: { search: false, create: false, allomorphs: false, msas: false },
  resolveSense: async () => undefined,
  searchByForm: async () => [],
  createEntry: async () => {
    throw new Error('No lexicon is registered to create an entry in.');
  },
};

/**
 * The lexicons available for the session, asked about together rather than one at a time.
 *
 * Which lexicon a ref belongs to is answered here and not by the caller, so a ref reaches only the
 * lexicon whose authority minted it.
 */
export type LexiconRegistry = {
  /**
   * Whether `ref` names an authority no registered lexicon answers for, leaving it to render as the
   * free-form gloss stored beside it.
   */
  isForeign: (ref: LexiconRef) => boolean;

  /**
   * Whether some registered lexicon can do `capability`, which is what an affordance (a piece of UI
   * the user can act on) is gated on: an affordance no lexicon can serve is not rendered at all.
   */
  can: (capability: LexiconCapability) => boolean;

  /**
   * Resolves `ref` through the lexicon whose authority minted it.
   *
   * @returns The sense, or `undefined` when the ref is foreign or its lexicon has no such sense.
   */
  resolveSense: (ref: SenseRef) => Promise<ResolvedSense | undefined>;
};

/**
 * Assembles the registry for a set of lexicons. Where two of them declare one authority, the
 * earlier answers for it.
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
    can: (capability) => resolvers.some((resolver) => resolver.capabilities[capability]),
    resolveSense: async (ref) => resolversByAuthority.get(ref.authority)?.resolveSense(ref),
  };
}
