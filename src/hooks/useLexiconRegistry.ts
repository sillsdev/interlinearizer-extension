import type { LexiconRegistry } from '../utils/lexicon-resolvers';
import { createLexiconRegistry, nullLexiconResolver } from '../utils/lexicon-resolvers';

/** Assembled once for the session, so its answers never vary by component or by render. */
const sessionRegistry = createLexiconRegistry([nullLexiconResolver]);

/**
 * The one place the UI asks about the lexicon. Reading the session's lexicons through it is what
 * keeps a component from asking whether one particular lexicon is present.
 */
export default function useLexiconRegistry(): LexiconRegistry {
  return sessionRegistry;
}
