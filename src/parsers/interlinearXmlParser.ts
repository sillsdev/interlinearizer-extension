import { X2jOptions, XMLParser } from 'fast-xml-parser';
import {
  LexemeData,
  PunctuationData,
  ClusterData,
  StringRange,
  InterlinearData,
  VerseData,
} from 'interlinearizer';

// ---------------------------------------------------------------------------
// Internal types: raw shape from fast-xml-parser with attributeNamePrefix: '@_'.
// Public API types (InterlinearData, VerseData, etc.) live in interlinearizer.
// ---------------------------------------------------------------------------

/**
 * Range: Index and Length attributes from fast-xml-parser. We set parseAttributeValue: true so
 * numeric attributes (Index, Length) are parsed as numbers; no manual Number() at use sites.
 */
interface ParsedRange {
  /** Start index in source text (FXP attribute Index). */
  ['@_Index']: number;
  /** Length of range (FXP attribute Length). */
  ['@_Length']: number;
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
  /** When true, cluster is excluded from interlinear (FXP attribute Excluded). */
  ['@_Excluded']?: boolean;
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

/** Root element: ScrTextName, GlossLanguage, BookId, Verses (with item[]). */
interface ParsedInterlinearDataRoot {
  /** Source text name (FXP attribute ScrTextName). */
  ['@_ScrTextName']?: string;
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
    return { LexemeId: lexemeId, SenseId: el['@_GlossId'] ?? '' };
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

  return elements
    .filter((el): el is ParsedPunctuation & { Range: ParsedRange } => {
      const rangeElement = el.Range;
      if (!rangeElement) return false;
      const indexRaw = rangeElement['@_Index'];
      const lengthRaw = rangeElement['@_Length'];
      return indexRaw !== undefined && lengthRaw !== undefined;
    })
    .map((el) => {
      const rangeElement = el.Range;
      return {
        TextRange: {
          Index: rangeElement['@_Index'],
          Length: rangeElement['@_Length'],
        },
        BeforeText: el.BeforeText ?? '',
        AfterText: el.AfterText ?? '',
      };
    });
}

/**
 * Maps a parsed VerseData's Cluster array to {@link ClusterData} array.
 *
 * @param verseDataElement - Parsed VerseData from fast-xml-parser (may have Cluster array or none).
 * @returns Array of ClusterData: TextRange from Cluster's Range, Lexemes from Lexeme children,
 *   Excluded from attribute, LexemesId (slash-joined LexemeIds), Id (LexemesId/Index-Length, or
 *   Index-Length when the cluster has no lexemes so Id never starts with a slash).
 * @throws {Error} If a Cluster is missing its Range element or Range is missing Index or Length.
 */
function extractClustersFromVerse(verseDataElement: ParsedVerseData): ClusterData[] {
  const clusterElements = verseDataElement.Cluster ?? [];

  return clusterElements.map((el) => {
    const rangeElement = el.Range;
    if (!rangeElement) {
      throw new Error('Invalid XML: Cluster missing required Range element');
    }

    const index = rangeElement['@_Index'];
    const length = rangeElement['@_Length'];
    if (index === undefined || length === undefined) {
      throw new Error('Invalid XML: Range missing required Index or Length attributes');
    }

    const textRange: StringRange = { Index: index, Length: length };
    const lexemes = extractLexemesFromCluster(el);
    const excluded = el['@_Excluded'] === true;

    const lexemesId = lexemes.map((l) => l.LexemeId).join('/');
    /**
     * Id format: "LexemesId/Index-Length", or "Index-Length" when cluster has no lexemes (avoids
     * leading slash).
     */
    const id = lexemesId ? `${lexemesId}/${index}-${length}` : `${index}-${length}`;

    return {
      TextRange: textRange,
      Lexemes: lexemes,
      Excluded: excluded,
      LexemesId: lexemesId,
      Id: id,
    };
  });
}

/**
 * Parses interlinear XML strings into {@link InterlinearData} using fast-xml-parser.
 *
 * Input is a raw XML string (caller is responsible for obtaining it, e.g. from file or network).
 * Output matches the types in `interliniearizer`; no extra conversion is done. Expects the
 * interlinear XML schema described in the project README.
 */
export class InterlinearXmlParser {
  private readonly parser: XMLParser;

  /**
   * Creates a parser configured for interlinear XML: attribute prefix `@_`, numeric attributes
   * parsed as numbers, and array paths for Verses items, Cluster, Punctuation, and Lexeme.
   */
  constructor() {
    const options: Partial<X2jOptions> = {
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      ignoreDeclaration: true,
      ignorePiTags: true,
      trimValues: true,
      parseTagValue: false,
      parseAttributeValue: true,
      isArray: (_tagName, jPath) => {
        const arrayPaths = [
          'InterlinearData.Verses.item',
          'item',
          'Cluster',
          'Punctuation',
          'Lexeme',
        ];
        return arrayPaths.some((path) => jPath.endsWith(path));
      },
    };
    this.parser = new XMLParser(options);
  }

  /**
   * Parses an interlinear XML string into {@link InterlinearData}.
   *
   * @param xml - Raw XML string (e.g. file contents). Must be valid interlinear XML with
   *   InterlinearData root, GlossLanguage and BookId attributes, and Verses containing item
   *   entries.
   * @returns Parsed interlinear data: ScrTextName, GlossLanguage, BookId, and Verses (record of
   *   verse key to {@link VerseData} with Hash, Clusters, Punctuations).
   * @throws {Error} If the root element, required attributes (GlossLanguage, BookId), or required
   *   structure (Verses, Cluster Range, Lexeme Id) are missing.
   */
  parse(xml: string): InterlinearData {
    const parsed: ParsedInterlinearXml = this.parser.parse(xml);
    const root = parsed.InterlinearData;
    if (!root) {
      throw new Error('Invalid XML: Missing InterlinearData root element');
    }

    const scrTextName = root['@_ScrTextName'] ?? '';
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

      const verseDataElement = item.VerseData;
      if (!verseDataElement) {
        acc[verseKey] = { Hash: '', Clusters: [], Punctuations: [] };
        return acc;
      }

      acc[verseKey] = {
        Hash: verseDataElement['@_Hash'] ?? '',
        Clusters: extractClustersFromVerse(verseDataElement),
        Punctuations: extractPunctuationsFromVerse(verseDataElement),
      };
      return acc;
    }, {});

    return {
      ScrTextName: scrTextName,
      GlossLanguage: glossLanguage,
      BookId: bookId,
      Verses: verses,
    };
  }
}
