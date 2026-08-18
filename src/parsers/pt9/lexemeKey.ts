/**
 * A PT9 lexeme key: the identity of a lexicon entry. Appears in PT9's XML in two shapes — as a
 * composed id string (e.g. `"Stem:exauc"`, `"Word:a:2"`) and as an attribute triple on `Lexeme`
 * elements — both of which this type represents.
 */
export interface LexemeKeyData {
  /** Lexeme type name (e.g. `"Word"`, `"Stem"`). PT9 may add names, so unknown values are legal. */
  Type: string;
  /** Lexical form as written in the file. */
  Form: string;
  /**
   * Homograph number. Absent when the XML carries none (an id without a homograph suffix, or a
   * `Lexeme` element without the attribute); PT9 treats absence as homograph 1.
   */
  Homograph?: number;
}

/**
 * Lexeme type names PT9 defines. Ids in the wild are expected to use these, but parsing does not
 * require it — PT9 treats its type list as append-only, so unknown names must survive.
 */
export const KNOWN_LEXEME_TYPES = [
  'Phrase',
  'Word',
  'Lemma',
  'Stem',
  'Prefix',
  'Suffix',
  'Infix',
] as const;

/**
 * PT9's id grammar: `Type:Form` with an optional `:digits` homograph suffix. The lazy form group
 * lets forms contain colons, while a trailing `:digits` always reads as the homograph — matching
 * PT9's own parsing of ambiguous ids.
 */
const LEXEME_KEY_ID_RE = /^(\w+):(.*?)(?::([0-9]+))?$/;

/**
 * Parses a composed lexeme-key id string.
 *
 * @returns The parsed key, or `undefined` when the string does not match PT9's id grammar. A
 *   trailing `:digits` segment is returned as `Homograph`; without one, `Homograph` is absent.
 */
export function parseLexemeKeyId(id: string): LexemeKeyData | undefined {
  const match = LEXEME_KEY_ID_RE.exec(id);
  if (!match) return undefined;
  const [, type, form, homograph] = match;
  return {
    Type: type,
    Form: form,
    ...(homograph !== undefined && { Homograph: Number.parseInt(homograph, 10) }),
  };
}

/**
 * Composes a lexeme key into its id string, omitting homograph 1 the way PT9 does.
 *
 * A form whose text ends in `:digits` produces an id that parses back with that tail read as the
 * homograph — the ambiguity is inherent to PT9's id grammar, not avoidable here.
 */
export function composeLexemeKeyId(key: LexemeKeyData): string {
  const homograph = key.Homograph ?? 1;
  const base = `${key.Type}:${key.Form}`;
  return homograph === 1 ? base : `${base}:${homograph}`;
}

/** Compares two keys by identity, treating an absent homograph as homograph 1. */
export function lexemeKeysEqual(a: LexemeKeyData, b: LexemeKeyData): boolean {
  return a.Type === b.Type && a.Form === b.Form && (a.Homograph ?? 1) === (b.Homograph ?? 1);
}
