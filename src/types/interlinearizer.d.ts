/**
 * @file Extension type declaration file. Platform.Bible shares this with other extensions. Types
 *   exposed here (and in papi-shared-types) are available to other extensions.
 */
/**
 * Interlinear types (InterlinearData, VerseData, ClusterData, etc.) are the public API for
 * interlinear data. The XML parser in src/parsers/interlinearXmlParser.ts consumes raw
 * fast-xml-parser output internally and returns objects conforming to these types.
 */
declare module 'interlinearizer' {
  /** Character range in source text (Index, Length). */
  export interface StringRange {
    /** Start index of the range in the source text (0-based). */
    Index: number;
    /** Number of characters in the range. */
    Length: number;
  }

  /** Data on the interlinearization of a single lexeme. */
  export interface LexemeData {
    /** ID of the lexeme (e.g. from Lexicon; XML attribute Id). */
    LexemeId: string;
    /** ID of the sense/gloss used for this lexeme (XML attribute GlossId). */
    SenseId: string;
  }

  /** Data on the interlinearization of a cluster. */
  export interface ClusterData {
    /** Character range this cluster occupies in the verse text. */
    TextRange: StringRange;
    /** Lexemes in this cluster, in order. */
    Lexemes: LexemeData[];
    /** Slash-joined LexemeIds for this cluster (e.g. "Word:a/Word:b"). */
    LexemesId: string;
    /** Unique cluster id: LexemesId plus TextRange (e.g. "Word:a/Word:b/21-3"). */
    Id: string;
    /** Excluded flag. See [pt9-xml.md](../parsers/pt9-xml.md) for details. */
    Excluded: boolean;
  }

  /** Data on punctuation change. */
  export interface PunctuationData {
    /** Character range this punctuation occupies in the verse text. */
    TextRange: StringRange;
    /** Punctuation text before the change (or empty). */
    BeforeText: string;
    /** Punctuation text after the change (or empty). */
    AfterText: string;
  }

  /** Interlinear data for a single verse. */
  export interface VerseData {
    /** Hash of verse text when approved; empty string if not approved. */
    Hash: string;
    /** Lexeme clusters in this verse. */
    Clusters: ClusterData[];
    /** Punctuation changes in this verse. */
    Punctuations: PunctuationData[];
  }

  /** Root interlinear data: book + verses. */
  export interface InterlinearData {
    /** Source text / project name (e.g. from InterlinearData ScrTextName attribute). */
    ScrTextName: string;
    /** Language code or name for the glosses. */
    GlossLanguage: string;
    /** Book id (e.g. "RUT", "MAT"). */
    BookId: string;
    /**
     * Verse data keyed by verse reference (e.g. "RUT 3:1"). Exactly one entry per reference; the
     * parser rejects XML that contains duplicate verse references.
     */
    Verses: Record<string, VerseData>;
  }
}
