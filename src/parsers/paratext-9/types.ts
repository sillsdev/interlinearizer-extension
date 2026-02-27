/** Character range in source text (Index, Length). */
export interface StringRange {
  /** Start index of the range in the source text (0-based). */
  index: number;
  /** Number of characters in the range. */
  length: number;
}

/** Data on the interlinearization of a single lexeme. */
export interface LexemeData {
  /**
   * Source-word/wordParse ID from Interlinear XML (attribute Id). Identifies the word or morpheme
   * in the source text at this position (e.g. "Word:In", "Stem:begin"); not from the Lexicon.
   */
  lexemeId: string;
  /**
   * ID of the target-language sense used for the gloss (Interlinear XML attribute GlossId).
   * References Lexicon Sense Id; the Lexicon holds the gloss-language words/senses/glosses.
   */
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
  /** Excluded flag. See [xml-schema.md](xml-schema.md) for details. */
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

/**
 * Morphological type of a lexeme. Matches Paratext LexemeType (LexemeKey.Type). Id format:
 * "Type:LexicalForm" or "Type:LexicalForm:Homograph".
 */
export type LexemeType = 'Word' | 'Stem' | 'Suffix' | 'Prefix' | 'Infix' | 'Lemma' | 'Phrase';

/**
 * Key for a single lexeme in the lexicon. Mirrors Paratext LexemeKey (Type, Form, Homograph). Id =
 * "Type:LexicalForm" (or "Type:LexicalForm:Homograph" when homograph > 1).
 */
export interface LexemeKey {
  /** Morphological type. */
  type: LexemeType;
  /** Lexical form (e.g. stem without affixes, or word). */
  lexicalForm: string;
  /** Homograph number; typically 1. */
  homograph: number;
}

/** Gloss for a sense in a target language. Mirrors XmlLexiconGloss (Language, Text). */
export interface LexiconGloss {
  /** Language code (e.g. "en"). */
  language: string;
  /** Gloss text. */
  text: string;
}

/** Sense of a lexeme. Mirrors XmlLexiconSense (Id, Glosses). */
export interface LexiconSense {
  /** Sense id; matches GlossId in Interlinear XML. */
  id: string;
  /** Glosses by language. */
  glosses: LexiconGloss[];
}

/** Lexicon entry for one lexeme. Mirrors XmlLexiconEntry (Key → Senses). */
export interface LexiconEntry {
  /** Lexeme key (Type, Form, Homograph). */
  key: LexemeKey;
  /** Senses for this lexeme. */
  senses: LexiconSense[];
}

/** Word form → list of LexemeKeys (morphological analysis). Mirrors LexiconData.Analyses. */
export type WordAnalyses = Record<string, LexemeKey[]>;

/** Parsed Lexicon. Mirrors Paratext LexiconData: Language, FontName, FontSize, Entries, Analyses. */
export interface LexiconData {
  /** Language of the lexicon. */
  language: string;
  /** Default font name. */
  fontName: string;
  /** Default font size. */
  fontSize: number;
  /** Entries keyed by lexeme Id (e.g. "Word:beginning", "Stem:begin"). */
  entries: Record<string, LexiconEntry>;
  /** Optional: word form → morphological analysis (list of lexeme keys). */
  analyses?: WordAnalyses;
}
