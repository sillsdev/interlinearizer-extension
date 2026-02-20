/** Character range in source text (Index, Length). */
export interface StringRange {
  /** Start index of the range in the source text (0-based). */
  index: number;
  /** Number of characters in the range. */
  length: number;
}

/** Data on the interlinearization of a single lexeme. */
export interface LexemeData {
  /** ID of the lexeme (e.g. from Lexicon; XML attribute Id). */
  lexemeId: string;
  /** ID of the sense/gloss used for this lexeme (XML attribute GlossId). */
  senseId: string;
}

/** Data on the interlinearization of a cluster. */
export interface ClusterData {
  /** Character range this cluster occupies in the verse text. */
  textRange: StringRange;
  /** Lexemes in this cluster, in order. */
  lexemes: LexemeData[];
  /** Slash-joined LexemeIds for this cluster (e.g. "Word:a/Word:b"). */
  lexemesId: string;
  /** Unique cluster id: LexemesId plus TextRange (e.g. "Word:a/Word:b/21-3"). */
  id: string;
  /** Excluded flag. See [pt9-xml.md](pt9-xml.md) for details. */
  excluded: boolean;
}

/** Data on punctuation change. */
export interface PunctuationData {
  /** Character range this punctuation occupies in the verse text. */
  textRange: StringRange;
  /** Punctuation text before the change (or empty). */
  beforeText: string;
  /** Punctuation text after the change (or empty). */
  afterText: string;
}

/** Interlinear data for a single verse. */
export interface VerseData {
  /** Hash of verse text when approved; empty string if not approved. */
  hash: string;
  /** Lexeme clusters in this verse. */
  clusters: ClusterData[];
  /** Punctuation changes in this verse. */
  punctuations: PunctuationData[];
}

/** Root interlinear data: book + verses. */
export interface InterlinearData {
  /** Language code or name for the glosses. */
  glossLanguage: string;
  /** Book id (e.g. "RUT", "MAT"). */
  bookId: string;
  /**
   * Verse data keyed by verse reference (e.g. "RUT 3:1"). Exactly one entry per reference; the
   * parser rejects XML that contains duplicate verse references.
   */
  verses: Record<string, VerseData>;
}
