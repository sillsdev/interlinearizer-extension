/**
 * Syntactic shape of a registered-language BCP 47 tag: a 2-3 letter primary language subtag
 * followed by optional 1-8 character alphanumeric subtags. Deliberately excludes the reserved 4-8
 * letter primary subtags, so legacy language names like `English` fall through to the verbatim
 * fallback instead of masquerading as tags.
 */
const BCP47_RE = /^[a-z]{2,3}(-[a-z0-9]{1,8})*$/i;

/** A resolved gloss-language identifier. */
export interface ResolvedGlossLanguage {
  /** The tag to key this language's glosses by. */
  tag: string;
  /** True when `tag` is the raw value passed through verbatim rather than a valid BCP 47 tag. */
  isFallback: boolean;
}

/**
 * Normalizes one subtag to conventional BCP 47 casing by position-independent shape: 4-letter
 * subtags (scripts) are titlecased, 2-letter subtags (regions) are uppercased, everything else is
 * lowercased.
 */
function normalizeSubtag(subtag: string, index: number): string {
  const lower = subtag.toLowerCase();
  if (index === 0) return lower;
  if (/^[a-z]{4}$/.test(lower)) return lower[0].toUpperCase() + lower.slice(1);
  if (/^[a-z]{2}$/.test(lower)) return lower.toUpperCase();
  return lower;
}

/**
 * Resolves a PT9 `GlossLanguage` value to the tag its glosses are keyed by: a syntactically valid
 * BCP 47 value is case-normalized and used as-is; anything else (legacy language names like
 * `English`) passes through verbatim and is flagged as a fallback.
 */
export function resolveGlossLanguageTag(rawLanguage: string): ResolvedGlossLanguage {
  if (!BCP47_RE.test(rawLanguage)) return { tag: rawLanguage, isFallback: true };
  return { tag: rawLanguage.split('-').map(normalizeSubtag).join('-'), isFallback: false };
}
