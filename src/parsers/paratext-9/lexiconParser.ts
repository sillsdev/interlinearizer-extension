/**
 * @file Parses Paratext 9 Lexicon XML into a structure aligned with Paratext LexiconData
 *   (LexiconData.cs). Provides (senseId, language) → gloss lookup and word-level gloss lookup for a
 *   word form (from Word entries) for use in PT9 → interlinearizer conversion.
 */

import { X2jOptions, XMLParser } from 'fast-xml-parser';
import type {
  LexiconData,
  LexiconEntry,
  LexiconGloss,
  LexiconSense,
  LexemeKey,
  LexemeType,
} from './types';

/** Separator used in the internal gloss map key (senseId + language). */
const GLOSS_KEY_SEP = '\t';

/** Language used when no Language attribute is set; fallback in lookup. */
const DEFAULT_LANGUAGE = '*';

/** Lexeme Id from key. Matches Paratext LexemeKey.Id: "Type:LexicalForm" or "Type:LexicalForm:H". */
export function lexemeKeyId(key: LexemeKey): string {
  if (key.homograph <= 1) return `${key.type}:${key.lexicalForm}`;
  return `${key.type}:${key.lexicalForm}:${key.homograph}`;
}

/** Lookup: (senseId, language) → gloss text. Empty string when sense exists but gloss blank. */
export type LexiconGlossLookup = (senseId: string, language: string) => string | undefined;

/**
 * Lookup: (wordForm, language) → word-level gloss when Lexicon has a Word entry for that form. Used
 * for WordParse-only occurrences so the Gloss row shows the surface word gloss from the Lexicon
 * instead of leaving it blank.
 */
export type WordLevelGlossLookup = (wordForm: string, language: string) => string | undefined;

/** Parsed Gloss element. */
interface ParsedGloss {
  ['@_Language']?: string;
  ['#text']?: string;
}

/** Parsed Sense element. */
interface ParsedSense {
  ['@_Id']?: string;
  Gloss?: ParsedGloss | string | (ParsedGloss | string)[];
}

/** Parsed Entry. */
interface ParsedEntry {
  Sense?: ParsedSense | ParsedSense[];
}

/** Parsed Entries.item (Lexeme + Entry). */
interface ParsedLexiconItem {
  Lexeme?: {
    ['@_Type']?: string;
    ['@_Form']?: string;
    ['@_Homograph']?: string;
  };
  Entry?: ParsedEntry;
}

/** Parsed root. */
interface ParsedLexiconRoot {
  Language?: string;
  FontName?: string;
  FontSize?: number;
  Entries?: { item?: ParsedLexiconItem | ParsedLexiconItem[] };
  Analyses?: unknown;
}

interface ParsedLexiconXml {
  Lexicon?: ParsedLexiconRoot;
}

export function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function glossKey(senseId: string, language: string): string {
  return `${senseId}${GLOSS_KEY_SEP}${language}`;
}

export function normalizeGloss(gloss: ParsedGloss | string): { lang: string; text: string } {
  if (typeof gloss === 'string') {
    return { lang: DEFAULT_LANGUAGE, text: gloss };
  }
  const lang = String(gloss['@_Language'] ?? '') || DEFAULT_LANGUAGE;
  const text = String(gloss['#text'] ?? '');
  return { lang, text };
}

function parseSense(sense: ParsedSense): LexiconSense | undefined {
  const id = sense['@_Id'] ?? '';
  if (!id) return undefined;
  const glosses: LexiconGloss[] = toArray(sense.Gloss).map((g) => {
    const { lang, text } = normalizeGloss(g);
    return { language: lang, text };
  });
  return { id, glosses };
}

const VALID_LEXEME_TYPES: readonly LexemeType[] = [
  'Word',
  'Stem',
  'Suffix',
  'Prefix',
  'Infix',
  'Lemma',
  'Phrase',
];

function parseLexemeType(s: string): LexemeType {
  const i = VALID_LEXEME_TYPES.findIndex((t) => t === s);
  return i >= 0 ? VALID_LEXEME_TYPES[i] : 'Word';
}

function parseItem(item: ParsedLexiconItem): LexiconEntry | undefined {
  const lex = item.Lexeme;
  const entry = item.Entry;
  if (!lex || !entry) return undefined;
  const typeStr = String(lex['@_Type'] ?? 'Word').trim() || 'Word';
  const type = parseLexemeType(typeStr);
  const lexicalForm = String(lex['@_Form'] ?? '').trim();
  const homograph = Math.max(1, parseInt(String(lex['@_Homograph'] ?? '1'), 10) || 1);
  const key: LexemeKey = { type, lexicalForm, homograph };
  const senses: LexiconSense[] = toArray(entry.Sense)
    .map(parseSense)
    .filter((s): s is LexiconSense => s !== undefined);
  return { key, senses };
}

/**
 * Parses Lexicon XML into LexiconData (PT9-aligned). Entries are keyed by lexeme Id (e.g.
 * "Word:beginning", "Stem:begin").
 *
 * @param xml - Raw Lexicon XML string.
 * @returns LexiconData with entries keyed by lexeme Id.
 * @throws {Error} If root element is not Lexicon.
 */
export function parseLexicon(xml: string): LexiconData {
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

  const entries: Record<string, LexiconEntry> = {};
  toArray(root.Entries?.item).forEach((item) => {
    const lexiconEntry = parseItem(item);
    if (!lexiconEntry) return;
    const id = lexemeKeyId(lexiconEntry.key);
    entries[id] = lexiconEntry;
  });

  return {
    language: String(root.Language ?? '').trim(),
    fontName: String(root.FontName ?? 'Arial').trim() || 'Arial',
    fontSize: Math.max(0, parseInt(String(root.FontSize ?? '10'), 10) || 10),
    entries,
  };
}

/**
 * Returns word-level gloss for a word form when the Lexicon has a Word entry for that form. Uses
 * first sense and requested language (or default). Used for WordParse-only occurrences.
 *
 * @param lexicon - Parsed LexiconData.
 * @param wordForm - Surface word form (e.g. "beginning").
 * @param language - Gloss language code.
 * @returns Gloss text or undefined if no Word entry or no gloss for that language.
 */
export function getWordLevelGlossForForm(
  lexicon: LexiconData,
  wordForm: string,
  language: string,
): string | undefined {
  const id = `Word:${wordForm}`;
  const entry = lexicon.entries[id];
  if (!entry?.senses?.length) return undefined;
  const sense = entry.senses[0];
  const exact = sense.glosses.find((g) => g.language === language);
  if (exact !== undefined) return exact.text;
  const fallback = sense.glosses.find((g) => !g.language || g.language === DEFAULT_LANGUAGE);
  return fallback?.text;
}

/**
 * Builds a (senseId, language) → gloss lookup from parsed LexiconData. Preserves existing behaviour
 * for createAnalyses.
 *
 * @param lexicon - Parsed LexiconData (from parseLexicon).
 * @returns LexiconGlossLookup.
 */
export function buildGlossLookupFromLexicon(lexicon: LexiconData): LexiconGlossLookup {
  const glossMap = new Map<string, string>();
  Object.values(lexicon.entries).forEach((entry) => {
    entry.senses.forEach((sense) => {
      sense.glosses.forEach((g) => {
        glossMap.set(glossKey(sense.id, g.language), g.text);
      });
    });
  });
  return (senseId: string, language: string): string | undefined => {
    if (!senseId) return undefined;
    const exact = glossMap.get(glossKey(senseId, language));
    if (exact !== undefined) return exact;
    return glossMap.get(glossKey(senseId, DEFAULT_LANGUAGE));
  };
}

/**
 * Builds (wordForm, language) → word-level gloss lookup from parsed LexiconData.
 *
 * @param lexicon - Parsed LexiconData.
 * @returns WordLevelGlossLookup.
 */
export function buildWordLevelGlossLookup(lexicon: LexiconData): WordLevelGlossLookup {
  return (wordForm: string, language: string) =>
    getWordLevelGlossForForm(lexicon, wordForm, language);
}

/**
 * Parses Lexicon XML and returns a (senseId, language) → gloss lookup. Kept for backward
 * compatibility; prefer parseLexicon + buildGlossLookupFromLexicon when you also need word-level
 * gloss or LexiconData.
 *
 * @param xml - Raw Lexicon XML string.
 * @returns LexiconGlossLookup.
 */
export function parseLexiconAndBuildGlossLookup(xml: string): LexiconGlossLookup {
  const lexicon = parseLexicon(xml);
  return buildGlossLookupFromLexicon(lexicon);
}
