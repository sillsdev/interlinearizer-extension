import type { LexiconData, LexiconSenseData } from 'parsers/pt9/lexiconXmlParser';
import { composeLexemeKeyId, LexemeKeyData } from 'parsers/pt9/lexemeKey';

/**
 * How a lexeme's gloss resolved.
 *
 * - `specific`: the cluster carried an explicit sense selection. `text` is absent when the sense is
 *   missing from the lexicon (dangling) or its gloss for the language is empty.
 * - `defaultSingle`: no selection, but the lexeme has exactly one sense with a non-empty gloss in the
 *   language, which is PT9's deterministic default. `senseId` is absent when that sense carries no
 *   id.
 * - `none`: no selection and no single default; PT9's guessing among several glossed senses is never
 *   replicated.
 */
export type Pt9GlossOutcome =
  | { kind: 'specific'; senseId: string; text?: string }
  | { kind: 'defaultSingle'; senseId?: string; text: string }
  | { kind: 'none' };

/** Resolves gloss text for lexemes against one parsed PT9 lexicon. */
export interface Pt9GlossSource {
  /**
   * Resolves the gloss for one lexeme in one gloss language. `senseId` is the cluster's selection;
   * an absent or empty value means no selection (PT9 treats the two alike). `rawLanguage` is the
   * file's GlossLanguage value as written; lexicon gloss languages are matched case-insensitively
   * against it, never against resolved tags.
   */
  resolve(key: LexemeKeyData, senseId: string | undefined, rawLanguage: string): Pt9GlossOutcome;
}

/** The non-empty gloss text a sense carries for a language, or `undefined` when it has none. */
function glossTextFor(sense: LexiconSenseData, rawLanguageFolded: string): string | undefined {
  const gloss = sense.Glosses.find((g) => g.Language?.toLowerCase() === rawLanguageFolded);
  if (gloss === undefined || gloss.Text === '') return undefined;
  return gloss.Text;
}

/**
 * Builds a {@link Pt9GlossSource} over a parsed lexicon. With no lexicon, every lookup with a
 * selection resolves to a text-less `specific` outcome and every lookup without one to `none`.
 */
export function createPt9GlossSource(lexicon: LexiconData | undefined): Pt9GlossSource {
  const entriesByKeyId = new Map(
    (lexicon?.Entries ?? []).map((entry) => [composeLexemeKeyId(entry.Key), entry]),
  );

  return {
    resolve(key, senseId, rawLanguage) {
      const entry = entriesByKeyId.get(composeLexemeKeyId(key));
      const rawFolded = rawLanguage.toLowerCase();

      const selected = senseId !== undefined && senseId !== '' ? senseId : undefined;
      if (selected !== undefined) {
        const sense = entry?.Senses.find((s) => s.Id === selected);
        if (sense === undefined) return { kind: 'specific', senseId: selected };
        const text = glossTextFor(sense, rawFolded);
        return { kind: 'specific', senseId: selected, ...(text !== undefined && { text }) };
      }

      if (entry === undefined) return { kind: 'none' };
      const glossed = entry.Senses.flatMap((sense) => {
        const text = glossTextFor(sense, rawFolded);
        return text === undefined ? [] : [{ sense, text }];
      });
      if (glossed.length !== 1) return { kind: 'none' };
      const [single] = glossed;
      return {
        kind: 'defaultSingle',
        ...(single.sense.Id !== undefined && { senseId: single.sense.Id }),
        text: single.text,
      };
    },
  };
}
