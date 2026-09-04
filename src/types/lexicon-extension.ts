/**
 * @file The slice of the Lexicon extension's network service this extension reaches for. Its own
 *   type declarations reach a build only where that extension is installed, which neither CI nor a
 *   fresh clone can assume, so the shapes are restated here.
 *
 *   These are structural, and the Lexicon extension's declarations remain the standard: a shape that
 *   drifts from them shows up as a value that never arrives rather than as a build error, so the
 *   two are changed together.
 */

/** A string value keyed by BCP 47 writing-system tag. */
export type LexiconMultiString = Record<string, string>;

/** One sense of a lexicon entry, narrowed to what a gloss is resolved from. */
export interface LexiconSense {
  id: string;
  gloss: LexiconMultiString;
}

/** One lexicon entry, narrowed to what a gloss is resolved from. */
export interface LexiconEntry {
  id: string;

  /** The form the entry is listed under. */
  lexemeForm: LexiconMultiString;

  senses: LexiconSense[];
}

/** A new entry, carrying only the fields this extension sets and leaving the rest to the lexicon. */
export interface PartialLexiconEntry {
  lexemeForm?: LexiconMultiString;
  senses?: { gloss?: LexiconMultiString }[];
}

/**
 * Narrows an entry search. A query narrowing by neither a surface form nor a semantic domain
 * matches nothing rather than everything.
 */
export interface LexiconEntryQuery {
  readonly surfaceForm?: string;
  readonly exactMatch?: boolean;
  readonly partOfSpeech?: string;
  readonly semanticDomain?: string;
}

/**
 * Reads and writes one lexicon at a time, named by its FW Lite lexicon code. The service holds no
 * notion of a Paratext project, so which lexicon a project is linked to is this extension's own
 * record to keep.
 */
export interface LexiconEntryService {
  /** @returns The matching entries, or `undefined` when the lexicon cannot be read. */
  getEntries(lexiconCode: string, query: LexiconEntryQuery): Promise<LexiconEntry[] | undefined>;

  /** @returns The sense, or `undefined` when the lexicon has no such sense. */
  getSense(lexiconCode: string, id: string): Promise<LexiconSense | undefined>;

  /**
   * Adds an entry to the lexicon.
   *
   * @returns The created entry, carrying the ids the lexicon minted for it, or `undefined` when the
   *   lexicon cannot be written to.
   */
  addEntry(lexiconCode: string, entry: PartialLexiconEntry): Promise<LexiconEntry | undefined>;
}
