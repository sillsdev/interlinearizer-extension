import { X2jOptions, XMLParser } from 'fast-xml-parser';

import { composeLexemeKeyId, LexemeKeyData } from './lexemeKey';

/** One per-language gloss on a sense. */
export interface LexiconGlossData {
  /** BCP 47 tag or legacy language name (XML attribute Language). Absent when the file omits it. */
  Language?: string;
  /** Gloss text; an empty element yields an empty string. */
  Text: string;
}

/** One sense of a lexicon entry. */
export interface LexiconSenseData {
  /**
   * Sense id (XML attribute Id) — 8 chars of Base64 in PT9-written files, so `+` and `/` are legal.
   * Absent when the file omits the attribute; such a sense cannot be referenced by interlinear
   * data.
   */
  Id?: string;
  /** Glosses in document order; empty when the sense has none. */
  Glosses: LexiconGlossData[];
}

/** One lexicon entry: a lexeme key and its senses. */
export interface LexiconEntryData {
  /** Identity of the entry. */
  Key: LexemeKeyData;
  /**
   * Senses in document order; empty for entries with an empty `Entry` element (common for
   * morphemes).
   */
  Senses: LexiconSenseData[];
}

/**
 * Root lexicon data. `Language`, `FontName`, and `FontSize` are preserved as written, but PT9
 * overwrites them from project settings on every load — treat them as informational, not
 * authoritative.
 */
export interface LexiconData {
  /** Project language id or legacy name. */
  Language?: string;
  FontName?: string;
  /** Kept as the raw attribute text rather than a number. */
  FontSize?: string;
  /** Lexicon entries in document order. */
  Entries: LexiconEntryData[];
  /**
   * Legacy word analyses: each surface wordform's ordered morpheme keys, one record entry per
   * wordform in document order. PT9 drains these into `WordAnalyses.xml` on read, but projects
   * untouched since PT8 still carry them here.
   */
  Analyses: Record<string, LexemeKeyData[]>;
}

/** Lexeme key element: Type, Form, optional Homograph attributes. */
interface ParsedLexemeKey {
  ['@_Type']?: string;
  ['@_Form']?: string;
  ['@_Homograph']?: string;
}

/** Gloss: Language attribute plus text content; a text-only element parses as a bare string. */
type ParsedGloss = string | { ['@_Language']?: string; ['#text']?: string };

/** Sense: Id attribute and Gloss children; an empty element parses as a bare string. */
type ParsedSense = string | { ['@_Id']?: string; Gloss?: ParsedGloss[] };

/** Entry: Sense children; an empty element parses as a bare string. */
type ParsedEntry = string | { Sense?: ParsedSense[] };

/** Entries item: the Lexeme key element plus the Entry value. */
interface ParsedEntriesItem {
  Lexeme?: ParsedLexemeKey;
  Entry?: ParsedEntry;
}

/** ArrayOfLexeme: Lexeme key children; an empty element parses as a bare string. */
type ParsedArrayOfLexeme = string | { Lexeme?: ParsedLexemeKey[] };

/** Analyses item: the wordform key plus its lexeme list. */
interface ParsedAnalysesItem {
  string?: string;
  ArrayOfLexeme?: ParsedArrayOfLexeme;
}

/**
 * Root Lexicon element; an empty element parses as a bare string. The string carries no data; it
 * marks the root as present so an empty lexicon parses as valid rather than erroring as a missing
 * root.
 */
type ParsedLexiconRoot =
  | string
  | {
      Language?: string;
      FontName?: string;
      FontSize?: string;
      Entries?: string | { item?: ParsedEntriesItem[] };
      Analyses?: string | { item?: ParsedAnalysesItem[] };
    };

/** Root document: Lexicon. */
interface ParsedLexiconXml {
  Lexicon?: ParsedLexiconRoot;
}

/**
 * Maps a parsed key element to {@link LexemeKeyData}, preserving an absent Homograph attribute as an
 * absent field.
 *
 * @throws {SyntaxError} If the element is missing Type or Form, or Homograph is not a non-negative
 *   integer.
 */
function extractLexemeKey(element: ParsedLexemeKey): LexemeKeyData {
  const type = element['@_Type'];
  const form = element['@_Form'];
  if (!type || form === undefined) {
    throw new SyntaxError('Invalid XML: Lexeme key missing Type or Form attribute');
  }
  const homographRaw = element['@_Homograph'];
  if (homographRaw === undefined) return { Type: type, Form: form };
  if (!/^\d+$/.test(homographRaw)) {
    throw new SyntaxError(
      `Invalid XML: Lexeme key has non-numeric Homograph attribute "${homographRaw}"`,
    );
  }
  return { Type: type, Form: form, Homograph: Number.parseInt(homographRaw, 10) };
}

/** Maps a parsed Gloss to {@link LexiconGlossData}; a bare string is text with no Language. */
function extractGloss(gloss: ParsedGloss): LexiconGlossData {
  if (typeof gloss === 'string') return { Text: gloss };
  const language = gloss['@_Language'];
  return {
    ...(language !== undefined && { Language: language }),
    Text: gloss['#text'] ?? '',
  };
}

/**
 * Maps a parsed Sense to {@link LexiconSenseData}. A bare string is a sense with no id or glosses;
 * nothing can link to such a sense, but it is retained for completeness.
 */
function extractSense(sense: ParsedSense): LexiconSenseData {
  if (typeof sense === 'string') return { Glosses: [] };
  const id = sense['@_Id'];
  return {
    ...(id !== undefined && { Id: id }),
    Glosses: (sense.Gloss ?? []).map(extractGloss),
  };
}

/**
 * Maps a parsed Entries item to {@link LexiconEntryData}. An empty or absent Entry element yields an
 * entry with no senses, the normal state for morpheme lexemes (added to the lexicon when a parse is
 * confirmed, often never glossed).
 *
 * @throws {SyntaxError} If the item has no Lexeme key element (propagated from key extraction for
 *   malformed keys).
 */
function extractEntry(item: ParsedEntriesItem): LexiconEntryData {
  if (!item.Lexeme) {
    throw new SyntaxError('Invalid XML: Entries item missing its Lexeme key element');
  }
  const key = extractLexemeKey(item.Lexeme);
  const entry = item.Entry;
  if (entry === undefined || typeof entry === 'string') return { Key: key, Senses: [] };
  return { Key: key, Senses: (entry.Sense ?? []).map(extractSense) };
}

/**
 * Maps a parsed Analyses item to its ordered morpheme keys. An absent or empty ArrayOfLexeme yields
 * an empty list.
 *
 * @throws {SyntaxError} Propagated from key extraction for malformed lexeme keys.
 */
function extractAnalysisLexemes(item: ParsedAnalysesItem): LexemeKeyData[] {
  const lexemes = item.ArrayOfLexeme;
  if (lexemes === undefined || typeof lexemes === 'string') return [];
  return (lexemes.Lexeme ?? []).map(extractLexemeKey);
}

/**
 * Parses PT9 `Lexicon.xml` strings into {@link LexiconData}.
 *
 * Output is lossless with respect to optional data: absent attributes stay absent, senses without
 * ids and entries without senses are preserved, and the legacy `Analyses` section is parsed
 * alongside `Entries`. Expects the schema described in [pt9-xml.md](pt9-xml.md).
 *
 * Each instance holds a configured `XMLParser`; create one parser and reuse it across multiple
 * `parse()` calls rather than constructing a new instance per file.
 */
export class LexiconXmlParser {
  private readonly parser: XMLParser;

  constructor() {
    const arrayPaths = new Set([
      'Lexicon.Entries.item',
      'Lexicon.Entries.item.Entry.Sense',
      'Lexicon.Entries.item.Entry.Sense.Gloss',
      'Lexicon.Analyses.item',
      'Lexicon.Analyses.item.ArrayOfLexeme.Lexeme',
    ]);

    const options: Partial<X2jOptions> = {
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      ignoreDeclaration: true,
      ignorePiTags: true,
      trimValues: false,
      parseTagValue: false,
      parseAttributeValue: false,
      isArray: (_tagName, jPath) => arrayPaths.has(`${jPath}`),
    };
    this.parser = new XMLParser(options);
  }

  /**
   * Parses a `Lexicon.xml` string into {@link LexiconData}.
   *
   * @throws {SyntaxError} If the `Lexicon` root element is absent.
   * @throws {SyntaxError} If an `Entries` item has no `Lexeme` key element, or an `Analyses` item
   *   has no wordform key.
   * @throws {SyntaxError} If a `Lexeme` key is missing `Type` or `Form`, or its `Homograph` is not
   *   a non-negative integer.
   * @throws {SyntaxError} If two `Entries` items share a key (treating an absent homograph as
   *   homograph 1), or two `Analyses` items share a wordform.
   */
  parse(xml: string): LexiconData {
    const parsed: ParsedLexiconXml = this.parser.parse(xml);
    const root = parsed.Lexicon;
    if (root === undefined) {
      throw new SyntaxError('Invalid XML: Missing Lexicon root element');
    }
    if (typeof root === 'string') return { Entries: [], Analyses: {} };

    const entriesContainer = root.Entries;
    const entryItems =
      entriesContainer === undefined || typeof entriesContainer === 'string'
        ? []
        : (entriesContainer.item ?? []);
    const entries = entryItems.map(extractEntry);
    const seenKeys = new Set<string>();
    entries.forEach((entry) => {
      const id = composeLexemeKeyId(entry.Key);
      if (seenKeys.has(id)) {
        throw new SyntaxError(`Invalid XML: Duplicate lexicon entry key "${id}"`);
      }
      seenKeys.add(id);
    });

    const analysesContainer = root.Analyses;
    const analysisItems =
      analysesContainer === undefined || typeof analysesContainer === 'string'
        ? []
        : (analysesContainer.item ?? []);
    const analyses = analysisItems.reduce<Record<string, LexemeKeyData[]>>((acc, item) => {
      const word = item.string;
      if (!word) {
        throw new SyntaxError('Invalid XML: Analyses item missing its wordform key');
      }
      if (Object.hasOwn(acc, word)) {
        throw new SyntaxError(`Invalid XML: Duplicate analyses wordform "${word}"`);
      }
      acc[word] = extractAnalysisLexemes(item);
      return acc;
    }, {});

    return {
      ...(root.Language !== undefined && { Language: root.Language }),
      ...(root.FontName !== undefined && { FontName: root.FontName }),
      ...(root.FontSize !== undefined && { FontSize: root.FontSize }),
      Entries: entries,
      Analyses: analyses,
    };
  }
}
