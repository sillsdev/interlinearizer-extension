import type { LexiconAuthority, LexiconRef, SenseRef } from 'interlinearizer';
import type {
  LexiconCapability,
  LexiconProvider,
  LexiconResolver,
  ResolvedSense,
  SenseCandidate,
} from 'interlinearizer/lexicon';

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
   * @returns The sense, or `undefined` when the ref is foreign, its lexicon has no such sense, or
   *   no software is there to ask.
   * @throws When asking the software of the lexicon that minted `ref` fails, a lost connection
   *   included.
   */
  resolveSense: (ref: SenseRef) => Promise<ResolvedSense | undefined>;

  /**
   * Lists every sense of the entry owning the sense named by `ref`, through the lexicon whose
   * authority minted `ref`.
   *
   * @returns The senses, or `undefined` when the ref is foreign, its lexicon has no such sense, or
   *   no software is there to ask.
   * @throws When asking the software of the lexicon that minted `ref` fails, a lost connection
   *   included.
   */
  listEntrySenses: (ref: SenseRef) => Promise<SenseCandidate[] | undefined>;

  /**
   * Opens the way to choose a lexicon for this project, or `undefined` where there is none to
   * offer: no lexicon software that can be reached offers one, or every one that does has already
   * linked this project or has not yet reported whether it has.
   *
   * Only an unlinked project is offered a chooser, because replacing a link breaks every sense ref
   * made against the old lexicon. Those glosses would show only their free-form text. Changing a
   * link is left to the software that owns it.
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
    listEntrySenses: async (ref) => resolversByAuthority.get(ref.authority)?.listEntrySenses(ref),
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
 * The chooser follows that rule too, but only from a provider that has reported this project has no
 * link to it. A provider missing from `linksRead` has not reported yet, so its absence from `links`
 * says nothing, and offering its chooser could replace a link. The registry opens a chooser only
 * for `projectId`.
 */
export function connectLexiconRegistry(
  projectId: string,
  availableProviders: readonly LexiconProvider[],
  links: LexiconLinks,
  linksRead: ReadonlySet<LexiconAuthority>,
): LexiconRegistry {
  const unlinkedChooser = availableProviders.find(
    ({ authority, openChooser }) => openChooser && linksRead.has(authority) && !links[authority],
  );
  const { openChooser } = unlinkedChooser ?? {};
  return createLexiconRegistry(
    availableProviders.map((provider) => provider.connect(links[provider.authority])),
    openChooser ? () => openChooser(projectId) : undefined,
  );
}
