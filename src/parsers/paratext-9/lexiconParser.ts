/**
 * @file Parses Paratext 9 Lexicon XML and builds a gloss lookup for use in PT9 → interlinearizer
 *   conversion. Interlinear XML references senses by GlossId (Sense Id); the Lexicon stores gloss
 *   text per Sense and language in <Gloss Language="...">. This module provides a (senseId,
 *   language) → glossText lookup so {@link createAnalyses} can fill in glossText instead of
 *   placeholders.
 */

import { X2jOptions, XMLParser } from 'fast-xml-parser';

/** Separator used in the internal map key (senseId + language). */
const GLOSS_KEY_SEP = '\t';

/** Language used in Lexicon when no Language attribute is set; used as fallback in lookup. */
const DEFAULT_LANGUAGE = '*';

/**
 * Lookup function: (senseId, language) → gloss text when present in the Lexicon. Empty string is
 * returned for missing or blank glosses when the sense exists, so callers can distinguish "no
 * entry" (undefined) from "entry with no text" ("").
 */
export type LexiconGlossLookup = (senseId: string, language: string) => string | undefined;

/** Parsed Gloss element: Language attribute and text content. */
interface ParsedGloss {
  ['@_Language']?: string;
  ['#text']?: string;
}

/** Parsed Sense element: Id attribute and zero or more Gloss children. */
interface ParsedSense {
  ['@_Id']?: string;
  Gloss?: ParsedGloss | string | (ParsedGloss | string)[];
}

/** Parsed Entry: zero or more Sense children. */
interface ParsedEntry {
  Sense?: ParsedSense | ParsedSense[];
}

/** Parsed Lexicon item: Lexeme and Entry. */
interface ParsedLexiconItem {
  Lexeme?: {
    ['@_Type']?: string;
    ['@_Form']?: string;
    ['@_Homograph']?: string;
  };
  Entry?: ParsedEntry;
}

/** Root Lexicon element. */
interface ParsedLexiconRoot {
  Language?: string;
  Entries?: { item?: ParsedLexiconItem | ParsedLexiconItem[] };
}

/** Full document: Lexicon root. */
interface ParsedLexiconXml {
  Lexicon?: ParsedLexiconRoot;
}

/**
 * Normalizes a possibly-array, possibly-undefined value to an array. Used for parser output where a
 * single child is an object and multiple children are an array.
 *
 * @param value - Single item, array of items, or undefined.
 * @returns Empty array if undefined, otherwise the array (or single item wrapped in an array).
 * @internal Exported for unit-test coverage of the single-object branch (FXP with isArray always returns arrays).
 */
export function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Builds the internal map key for a (senseId, language) pair. Must match the key used when
 * populating the gloss map.
 *
 * @param senseId - Sense Id (GlossId from Interlinear XML).
 * @param language - Gloss language code.
 * @returns Opaque key string.
 */
function glossKey(senseId: string, language: string): string {
  return `${senseId}${GLOSS_KEY_SEP}${language}`;
}

/**
 * Normalizes a single Gloss item from the parser into language and text.
 *
 * @param gloss - Single Gloss from ParsedSense.Gloss (object or string).
 * @returns Language (or {@link DEFAULT_LANGUAGE} when missing) and text.
 * @internal Exported so tests can cover the object branch when @_Language is undefined (parser
 *   may return a string for single Gloss with no attributes, so that branch is not reachable via XML).
 */
export function normalizeGloss(gloss: ParsedGloss | string): { lang: string; text: string } {
  if (typeof gloss === 'string') {
    return { lang: DEFAULT_LANGUAGE, text: gloss };
  }
  const lang = String(gloss['@_Language'] ?? '') || DEFAULT_LANGUAGE;
  const text = String(gloss['#text'] ?? '');
  return { lang, text };
}

/**
 * Extracts (key, text) pairs from a single Sense: one pair per Gloss child.
 *
 * @param sense - Parsed Sense element.
 * @returns Zero or more { key, text } objects; senseId comes from Sense Id, language from Gloss.
 */
function glossPairsFromSense(sense: ParsedSense): Array<{ key: string; text: string }> {
  const senseId = sense['@_Id'] ?? '';
  if (!senseId) return [];

  const glosses = toArray(sense.Gloss);
  return glosses.map((g) => {
    const { lang, text } = normalizeGloss(g);
    return { key: glossKey(senseId, lang), text };
  });
}

/**
 * Extracts (key, text) pairs from a single Lexicon item (one Entry with zero or more Senses).
 *
 * @param item - Parsed Entries.item element.
 * @returns Zero or more { key, text } objects.
 */
function glossPairsFromItem(item: ParsedLexiconItem): Array<{ key: string; text: string }> {
  const entry = item.Entry;
  if (!entry) return [];

  return toArray(entry.Sense).flatMap(glossPairsFromSense);
}

/**
 * Builds a gloss lookup map from parsed Lexicon entries. Iterates all Entries.item → Entry → Sense
 * → Gloss and indexes by (senseId, language). Later entries overwrite earlier ones for the same
 * key.
 *
 * @param root - Parsed Lexicon root (Lexicon element).
 * @returns Map keyed by glossKey(senseId, language) to gloss text (empty string allowed).
 */
function buildGlossMap(root: ParsedLexiconRoot): Map<string, string> {
  const items = toArray(root.Entries?.item);
  const pairs = items.flatMap(glossPairsFromItem);
  return new Map(pairs.map(({ key, text }) => [key, text]));
}

/**
 * Parses a Paratext 9 Lexicon XML string and returns a lookup function that returns gloss text for
 * a given (senseId, language). The Sense Id in the Lexicon matches the GlossId used in Interlinear
 * XML; the language should match the interlinear's GlossLanguage when resolving word-level
 * glosses.
 *
 * @param xml - Raw Lexicon XML string (e.g. file contents).
 * @returns A {@link LexiconGlossLookup} that returns the gloss string when the Lexicon has a
 *   matching Sense and Gloss for that language, or undefined when no such entry exists. Returns the
 *   empty string when the Lexicon has a Sense+Language entry but the gloss text is blank.
 * @throws {Error} If the root element is not Lexicon.
 */
export function parseLexiconAndBuildGlossLookup(xml: string): LexiconGlossLookup {
  const arrayPaths = new Set([
    'Lexicon.Entries.item',
    'Lexicon.Entries.item.Entry.Sense',
    'Lexicon.Entries.item.Entry.Sense.Gloss',
  ]);
  const options: Partial<X2jOptions> = {
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    ignoreDeclaration: true,
    ignorePiTags: true,
    trimValues: false,
    parseTagValue: false,
    isArray: (_tagName, jPath) => arrayPaths.has(jPath),
  };
  const parser = new XMLParser(options);
  const parsed: ParsedLexiconXml = parser.parse(xml);
  const root = parsed.Lexicon;
  if (!root) {
    throw new Error('Invalid XML: Missing Lexicon root element');
  }
  const map = buildGlossMap(root);
  return (senseId: string, language: string): string | undefined => {
    if (!senseId) return undefined;
    const exact = map.get(glossKey(senseId, language));
    if (exact !== undefined) return exact;
    return map.get(glossKey(senseId, DEFAULT_LANGUAGE));
  };
}
