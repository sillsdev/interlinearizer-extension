import type { SenseRef } from 'interlinearizer';
import type { ResolvedSense } from 'interlinearizer/lexicon';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type { LexiconRegistry } from '../utils/lexicon-resolvers';
import { multiStringText } from '../utils/multi-string';
import { createSenseCache, type SenseCache } from '../utils/sense-cache';

/** Answers for a tree with no lexicon above it, where every sense misses. */
const NO_LEXICON_SENSES = createSenseCache(async () => undefined);

const LexiconSensesContext = createContext<SenseCache>(NO_LEXICON_SENSES);

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
  return <LexiconSensesContext.Provider value={senses}>{children}</LexiconSensesContext.Provider>;
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
 * The sense is asked for only while no stored gloss covers it.
 */
export function useDisplayedGloss(
  gloss: string,
  senseRef: SenseRef | undefined,
  language: string,
): DisplayedGloss {
  const sense = useLexiconSense(gloss ? undefined : senseRef);

  if (gloss) return { text: gloss, fromLexicon: false };
  const resolved = multiStringText(sense?.gloss, language);
  return { text: resolved, fromLexicon: resolved !== '' };
}

/** A gloss as it is shown, set beside the lexicon sense its analysis links to. */
export type LinkedGloss = DisplayedGloss &
  Readonly<{
    /** The linked sense, `undefined` while it is unresolved or when nothing is linked. */
    sense?: ResolvedSense;
    /** The linked sense's gloss in the language asked for, `''` when there is none. */
    senseGloss: string;
    /**
     * Whether the analysis's own gloss and the sense's gloss are both present and say different
     * things. Not an error: a typed gloss takes precedence over the sense.
     */
    differs: boolean;
  }>;

/**
 * The gloss to show in `language` for an analysis that stores `gloss` and carries `senseRef`, as
 * {@link useDisplayedGloss} gives it, along with the sense itself. The sense is asked for even where
 * a stored gloss covers it, so that the two glosses can be compared.
 */
export function useLinkedGloss(
  gloss: string,
  senseRef: SenseRef | undefined,
  language: string,
): LinkedGloss {
  const sense = useLexiconSense(senseRef);
  const senseGloss = multiStringText(sense?.gloss, language);

  if (gloss)
    return {
      text: gloss,
      fromLexicon: false,
      sense,
      senseGloss,
      differs: senseGloss !== '' && senseGloss.trim() !== gloss.trim(),
    };
  return { text: senseGloss, fromLexicon: senseGloss !== '', sense, senseGloss, differs: false };
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
