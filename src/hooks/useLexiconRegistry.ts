import type { LexiconRegistry } from '../utils/lexicon-resolvers';
import { createLexiconRegistry, nullLexiconResolver } from '../utils/lexicon-resolvers';

/** Assembled once for the session, so its answers never vary by component or by render. */
const sessionRegistry = createLexiconRegistry([nullLexiconResolver]);

/**
 * The one place the UI asks about the lexicon, so no component asks whether one particular lexicon
 * is connected.
 */
export default function useLexiconRegistry(): LexiconRegistry {
  return sessionRegistry;
}
