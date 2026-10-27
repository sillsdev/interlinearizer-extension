import type { SenseRef } from 'interlinearizer';
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

/** Shows every gloss beneath it as stored, resolving no lexicon sense. */
export function WithoutLexiconSenses({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <LexiconSensesContext.Provider value={NO_LEXICON_SENSES}>
      {children}
    </LexiconSensesContext.Provider>
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
 * The sense is asked for only while no stored gloss covers it.
 */
export function useDisplayedGloss(
  gloss: string,
  senseRef: SenseRef | undefined,
  language: string,
): DisplayedGloss {
  const senses = useContext(LexiconSensesContext);
  const wanted = gloss ? undefined : senseRef;

  useEffect(() => {
    if (wanted) senses.request(wanted);
  }, [senses, wanted]);

  const sense = useSyncExternalStore(senses.subscribe, () =>
    wanted ? senses.peek(wanted) : undefined,
  );

  if (gloss) return { text: gloss, fromLexicon: false };
  const resolved = multiStringText(sense?.gloss, language);
  return { text: resolved, fromLexicon: resolved !== '' };
}
