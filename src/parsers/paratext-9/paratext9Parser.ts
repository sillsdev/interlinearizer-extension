import { X2jOptions, XMLParser } from 'fast-xml-parser';
import type {
  LexemeData,
  PunctuationData,
  ClusterData,
  StringRange,
  InterlinearData,
  VerseData,
} from './paratext-9-types';

/** Range: Index and Length attributes. */
interface ParsedRange {
  /** Start index in source text (FXP attribute Index). */
  ['@_Index']: string;
  /** Length of range (FXP attribute Length). */
  ['@_Length']: string;
}

/** Lexeme: Id (required), optional GlossId. */
interface ParsedLexeme {
  /** Lexeme id (FXP attribute Id). */
  ['@_Id']: string;
  /** Sense/gloss id (FXP attribute GlossId). */
  ['@_GlossId']?: string;
}

/** Cluster: optional Range, optional Lexeme[], optional Excluded. */
interface ParsedCluster {
  /** Range element (Index, Length). */
  Range?: ParsedRange;
  /** Lexeme elements in this cluster. */
  Lexeme?: ParsedLexeme[];
  /** Excluded flag (optional). See [pt9-xml.md](pt9-xml.md) for details. */
  Excluded?: string;
}

/** Punctuation: optional Range, BeforeText, AfterText. */
interface ParsedPunctuation {
  /** Range element for this punctuation. */
  Range?: ParsedRange;
  /** Text before change (tag value). */
  BeforeText?: string;
  /** Text after change (tag value). */
  AfterText?: string;
}

/** VerseData: optional Hash, Cluster[], Punctuation[]. */
interface ParsedVerseData {
  /** Approval hash (FXP attribute Hash). */
  ['@_Hash']?: string;
  /** Cluster elements in this verse. */
  Cluster?: ParsedCluster[];
  /** Punctuation elements in this verse. */
  Punctuation?: ParsedPunctuation[];
}

/** Single entry in Verses: verse key (string), VerseData. */
interface ParsedVersesItem {
  /** Verse reference key (e.g. "RUT 3:1"). */
  string?: string;
  /** Verse data for this key. */
  VerseData?: ParsedVerseData;
}

/** Root element: GlossLanguage, BookId, Verses (with item[]). */
interface ParsedInterlinearDataRoot {
  /** Gloss language (FXP attribute GlossLanguage). */
  ['@_GlossLanguage']?: string;
  /** Book id (FXP attribute BookId). */
  ['@_BookId']?: string;
  /** Verses container; item array holds key/value pairs. */
  Verses?: { item?: ParsedVersesItem[] };
}

/** Root document: InterlinearData. */
interface ParsedInterlinearXml {
  /** Root InterlinearData element. */
  InterlinearData?: ParsedInterlinearDataRoot;
}

/**
 * Maps a parsed Cluster's Lexeme array to {@link LexemeData} array.
 *
 * @param clusterElement - Parsed Cluster from fast-xml-parser (may have Lexeme array or none).
 * @returns Array of LexemeData with LexemeId (from Id) and SenseId (from GlossId, or '').
 * @throws {Error} If any Lexeme element is missing the required Id attribute.
 */
function extractLexemesFromCluster(clusterElement: ParsedCluster): LexemeData[] {
  const elements = clusterElement.Lexeme ?? [];

  return elements.map((el) => {
    const lexemeId = el['@_Id'];
    if (!lexemeId) {
      throw new Error('Invalid XML: Lexeme missing required Id attribute');
    }
    return { lexemeId, senseId: el['@_GlossId'] ?? '' };
  });
}

/**
 * Maps a parsed VerseData's Punctuation array to {@link PunctuationData} array.
 *
 * Punctuations without a valid Range (or missing Index/Length) are filtered out rather than causing
 * a parse error. Punctuations are optional/non-critical to the interlinear display; clusters are
 * required and validated strictly in {@link extractClustersFromVerse}.
 *
 * @param verseDataElement - Parsed VerseData from fast-xml-parser (may have Punctuation array or
 *   none).
 * @returns Array of PunctuationData (TextRange from Range Index/Length, BeforeText, AfterText).
 *   Entries without a valid Range element are skipped.
 */
function extractPunctuationsFromVerse(verseDataElement: ParsedVerseData): PunctuationData[] {
  const elements = verseDataElement.Punctuation ?? [];

  return elements.flatMap((el) => {
    const rangeElement = el.Range;
    if (!rangeElement) return [];
    const index = Number(rangeElement['@_Index']);
    const length = Number(rangeElement['@_Length']);
    if (!Number.isFinite(index) || !Number.isFinite(length)) return [];
    return [
      {
        textRange: { index, length },
        beforeText: el.BeforeText ?? '',
        afterText: el.AfterText ?? '',
      },
    ];
  });
}

/**
 * Maps a parsed VerseData's Cluster array to {@link ClusterData} array.
 *
 * @param verseDataElement - Parsed VerseData from fast-xml-parser (may have Cluster array or none).
 * @returns Array of ClusterData: TextRange from Cluster's Range, Lexemes from Lexeme children,
 *   LexemesId (slash-joined), Id (LexemesId/Index-Length or Index-Length when no lexemes).
 * @throws {Error} If a Cluster is missing its Range element or Range is missing Index or Length.
 */
function extractClustersFromVerse(verseDataElement: ParsedVerseData): ClusterData[] {
  const clusterElements = verseDataElement.Cluster ?? [];

  return clusterElements.map((el) => {
    const rangeElement = el.Range;
    if (!rangeElement) {
      throw new Error('Invalid XML: Cluster missing required Range element');
    }

    const index = Number(rangeElement['@_Index']);
    const length = Number(rangeElement['@_Length']);
    if (!Number.isFinite(index) || !Number.isFinite(length)) {
      throw new Error('Invalid XML: Range missing required Index or Length attributes');
    }

    const textRange: StringRange = { index, length };
    const lexemes = extractLexemesFromCluster(el);

    // Join with "/"; lexeme IDs may contain "/", so do not split LexemesId elsewhere.
    const lexemesId = lexemes.map((l) => l.lexemeId).join('/');
    /** Cluster Id: LexemesId/Index-Length when lexemes present; Index-Length when none. */
    const id = lexemesId ? `${lexemesId}/${index}-${length}` : `${index}-${length}`;
    const excluded = el.Excluded === 'true';

    return {
      textRange,
      lexemes,
      lexemesId,
      id,
      excluded,
    };
  });
}

/**
 * Parses interlinear XML strings into {@link InterlinearData} using fast-xml-parser.
 *
 * Input is a raw XML string (caller is responsible for obtaining it, e.g. from file or network).
 * Output matches the types in `paratext-9-types`; no extra conversion is done. Expects the Paratext
 * 9 Interlinear XML schema described in [pt9-xml.md](pt9-xml.md).
 */
export class Paratext9Parser {
  private readonly parser: XMLParser;

  /**
   * Creates a parser configured for interlinear XML: attribute prefix `@_`, and array paths for
   * Verses items, Cluster, Punctuation, and Lexeme.
   */
  constructor() {
    const arrayPaths = new Set([
      'InterlinearData.Verses.item',
      'InterlinearData.Verses.item.VerseData.Cluster',
      'InterlinearData.Verses.item.VerseData.Punctuation',
      'InterlinearData.Verses.item.VerseData.Cluster.Lexeme',
    ]);

    const options: Partial<X2jOptions> = {
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      ignoreDeclaration: true,
      ignorePiTags: true,
      trimValues: false,
      parseTagValue: false,
      parseAttributeValue: false,
      isArray: (_tagName, jPath) => arrayPaths.has(jPath),
    };
    this.parser = new XMLParser(options);
  }

  /**
   * Parses an interlinear XML string into {@link InterlinearData}.
   *
   * @param xml - Raw XML string (e.g. file contents). Must be valid interlinear XML with
   *   InterlinearData root, GlossLanguage and BookId attributes, and Verses containing item
   *   entries.
   * @returns Parsed interlinear data: GlossLanguage, BookId, and Verses (record of verse key to
   *   {@link VerseData} with Hash, Clusters, Punctuations).
   * @throws {Error} If the root element, required attributes (GlossLanguage, BookId), required
   *   structure (Verses, Cluster Range, Lexeme Id), or duplicate verse reference is present.
   */
  parse(xml: string): InterlinearData {
    const parsed: ParsedInterlinearXml = this.parser.parse(xml);
    const root = parsed.InterlinearData;
    if (!root) {
      throw new Error('Invalid XML: Missing InterlinearData root element');
    }

    const glossLanguage = root['@_GlossLanguage'] ?? '';
    const bookId = root['@_BookId'] ?? '';
    if (!glossLanguage || !bookId) {
      throw new Error('Invalid XML: Missing required attributes GlossLanguage or BookId');
    }

    const versesElement = root.Verses;
    if (!versesElement) {
      throw new Error('Invalid XML: Missing Verses element');
    }

    const items = versesElement.item ?? [];

    const verses = items.reduce<Record<string, VerseData>>((acc, item) => {
      const verseKey = item.string;
      if (!verseKey) return acc;

      if (verseKey in acc) {
        throw new Error(
          `Invalid XML: Duplicate verse reference "${verseKey}". At most one VerseData per reference is allowed.`,
        );
      }

      const verseDataElement = item.VerseData;
      if (!verseDataElement) {
        acc[verseKey] = { hash: '', clusters: [], punctuations: [] };
        return acc;
      }

      acc[verseKey] = {
        hash: verseDataElement['@_Hash'] ?? '',
        clusters: extractClustersFromVerse(verseDataElement),
        punctuations: extractPunctuationsFromVerse(verseDataElement),
      };
      return acc;
    }, {});

    return {
      glossLanguage,
      bookId,
      verses,
    };
  }
}
