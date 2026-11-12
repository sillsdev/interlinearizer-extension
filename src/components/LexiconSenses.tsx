import type { SenseRef } from 'interlinearizer';
import type { ResolvedSense, SenseCandidate } from 'interlinearizer/lexicon';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { createLexiconRegistry, type LexiconRegistry } from '../utils/lexicon-resolvers';
import { multiStringTextByLanguage } from '../utils/multi-string';
import { createSenseCache, type SenseCache } from '../utils/sense-cache';

/** Answers for a tree with no lexicon above it, where every sense misses. */
const NO_LEXICON_SENSES = createSenseCache(async () => undefined);

const LexiconSensesContext = createContext<SenseCache>(NO_LEXICON_SENSES);

/** The lexicons connected beneath {@link LexiconSensesProvider}, none where there is no provider. */
const LexiconRegistryContext = createContext<LexiconRegistry>(createLexiconRegistry([]));

/**
 * Resolves lexicon senses through `registry` for everything beneath this provider. A new registry
 * starts over with no senses resolved. The registry changes when a project's lexicon is chosen or
 * switched, and when lexicon software arrives or leaves.
 */
export function LexiconSensesProvider({
  registry,
  children,
}: Readonly<{ registry: LexiconRegistry; children: ReactNode }>) {
  const senses = useMemo(() => createSenseCache(registry.resolveSense), [registry]);
  return (
    <LexiconRegistryContext.Provider value={registry}>
      <LexiconSensesContext.Provider value={senses}>{children}</LexiconSensesContext.Provider>
    </LexiconRegistryContext.Provider>
  );
}

/** A gloss as it is shown. */
export type DisplayedGloss = Readonly<{
  /** The gloss text, `''` when there is none to show. */
  text: string;
  /** Whether `text` is the gloss of the referenced sense, rather than the analysis's own gloss. */
  fromLexicon: boolean;
}>;

/**
 * The gloss to show in `language` for an analysis that stores `gloss` and carries `senseRef`. That
 * is the stored gloss where there is one, else the gloss of the sense `senseRef` points to, else
 * none.
 *
 * A ref that cannot be resolved shows the same as no ref. That covers an unreachable lexicon, a
 * sense that is gone, and a lexicon that is not connected. The ref itself is never changed.
 *
 * The sense is asked for only while no stored gloss covers it. Its gloss is read as
 * {@link multiStringTextByLanguage} reads it.
 */
export function useDisplayedGloss(
  gloss: string,
  senseRef: SenseRef | undefined,
  language: string,
): DisplayedGloss {
  const sense = useLexiconSense(gloss ? undefined : senseRef);

  if (gloss) return { text: gloss, fromLexicon: false };
  const resolved = multiStringTextByLanguage(sense?.gloss, language);
  return { text: resolved, fromLexicon: resolved !== '' };
}

/** A gloss as it is shown, set beside the lexicon sense its analysis links to. */
export type LinkedGloss = DisplayedGloss &
  Readonly<{
    /** The linked sense's gloss in the language asked for, `''` when there is none. */
    senseGloss: string;
    /**
     * Whether the analysis's own gloss and the sense's gloss are both present and say different
     * things. Not an error: a typed gloss takes precedence over the sense.
     */
    differs: boolean;
    /**
     * Whether a connected lexicon has answered for the ref, with a sense or with none. False with
     * no ref, for a ref no connected lexicon answers for, and while the look-up is pending or
     * failed.
     */
    lexiconAnswered: boolean;
  }>;

/**
 * The gloss to show in `language` for an analysis that stores `gloss` and carries `senseRef`, along
 * with the sense's own gloss.
 *
 * The stored gloss is shown when present; otherwise the sense's gloss is shown. The sense's gloss
 * is returned even where a stored gloss takes precedence, so that the two glosses can be compared.
 * It is read as {@link multiStringTextByLanguage} reads it, since a lexicon keys glosses by its own
 * writing systems rather than by the project's tag.
 */
export function useLinkedGloss(
  gloss: string,
  senseRef: SenseRef | undefined,
  language: string,
): LinkedGloss {
  const sense = useLexiconSense(senseRef);
  const senses = useContext(LexiconSensesContext);
  const registry = useContext(LexiconRegistryContext);
  const answered = useSyncExternalStore(senses.subscribe, () =>
    senseRef ? senses.hasAnswer(senseRef) : false,
  );
  const lexiconAnswered = senseRef !== undefined && !registry.isForeign(senseRef) && answered;
  const senseGloss = multiStringTextByLanguage(sense?.gloss, language);

  if (gloss)
    return {
      text: gloss,
      fromLexicon: false,
      senseGloss,
      differs: senseGloss !== '' && senseGloss.trim() !== gloss.trim(),
      lexiconAnswered,
    };
  return {
    text: senseGloss,
    fromLexicon: senseGloss !== '',
    senseGloss,
    differs: false,
    lexiconAnswered,
  };
}

/**
 * Searches the connected lexicon for the senses a form could link to.
 *
 * @returns The search, bound to the first connected lexicon that can search; `undefined` when none
 *   can. The function keeps its identity while that lexicon stays the same.
 */
export function useLexiconSearch(): ((form: string) => Promise<SenseCandidate[]>) | undefined {
  const resolver = useContext(LexiconRegistryContext).resolverWith('search');
  return useMemo(
    () => (resolver ? (form: string) => resolver.searchByForm(form) : undefined),
    [resolver],
  );
}

/** Asks for the sense `senseRef` points to, and reads it once it arrives. */
function useLexiconSense(senseRef: SenseRef | undefined): ResolvedSense | undefined {
  const senses = useContext(LexiconSensesContext);

  useEffect(() => {
    if (senseRef) senses.request(senseRef);
  }, [senses, senseRef]);

  return useSyncExternalStore(senses.subscribe, () =>
    senseRef ? senses.peek(senseRef) : undefined,
  );
}
