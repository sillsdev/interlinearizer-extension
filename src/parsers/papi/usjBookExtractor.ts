/** @file Extracts {@link RawBook} from a papi USJ book response. */

/** Plain text of a single verse extracted from a USJ document, ready to be tokenized. */
export interface RawVerse {
  /** SID from the USJ verse marker, e.g. `"GEN 1:1"`. Parsed into `Segment.startRef` / `endRef`. */
  sid: string;
  /**
   * Accumulated plain-text content of the verse. Note and footnote content is excluded. Becomes
   * `Segment.baselineText`; token `charStart` / `charEnd` are expressed relative to this string.
   */
  text: string;
}

/**
 * Raw book data captured from a papi USJ response. Self-contained — everything the tokenizer needs
 * to produce `Book → Segment → Token`.
 */
export interface RawBook {
  /** 3-letter book code, e.g. `"GEN"`. */
  bookCode: string;
  /** BCP 47 writing system tag for the baseline text, from `platform.languageTag`. */
  writingSystem: string;
  /** FNV-1a hash of the serialized USJ content. Becomes `Book.textVersion`. */
  contentHash: string;
  /** Verse entries in document order, one per USJ `verse` marker. */
  verses: RawVerse[];
}

// ---------------------------------------------------------------------------
// Minimal local types for USJ traversal.
// @eten-tech-foundation/scripture-utilities is not a direct dependency of this
// extension, so we define the subset we need here.
// ---------------------------------------------------------------------------

/** A USJ content item: either a plain text string or a marker node. */
type MarkerContent = string | UsjNode;

/** A USJ marker node. Only the fields used during extraction are declared. */
interface UsjNode {
  type: string;
  marker?: string;
  number?: string;
  code?: string;
  sid?: string;
  content?: MarkerContent[];
}

/** Minimal shape of a USJ document as returned by the papi `platformScripture.USJ_Book` provider. */
export interface UsjDocument {
  content: MarkerContent[];
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/** Mutable state threaded through the recursive USJ traversal. */
interface TraversalState {
  bookCode: string;
  currentVerse: { sid: string; text: string } | undefined;
  verses: RawVerse[];
}

/**
 * Recursively walks a USJ content array, accumulating verse text into `state`.
 *
 * @param nodes - Content items to walk (`string` or {@link UsjNode}).
 * @param state - Shared mutable state updated in place during traversal.
 * @throws {Error} If a `verse` node is missing its `sid` attribute.
 */
function traverse(nodes: MarkerContent[], state: TraversalState): void {
  nodes.forEach((node) => {
    if (typeof node === 'string') {
      if (state.currentVerse !== undefined) state.currentVerse.text += node;
    } else if (node.type === 'book') {
      if (node.code) state.bookCode = node.code;
      if (node.content) traverse(node.content, state);
    } else if (node.type === 'chapter') {
      if (state.currentVerse !== undefined) {
        state.verses.push(state.currentVerse);
        state.currentVerse = undefined;
      }
      if (node.content) traverse(node.content, state);
    } else if (node.type === 'verse') {
      if (state.currentVerse !== undefined) state.verses.push(state.currentVerse);
      if (!node.sid) throw new Error('Invalid USJ: verse marker missing required sid attribute');
      state.currentVerse = { sid: node.sid, text: '' };
      if (node.content) traverse(node.content, state);
    } else if (node.type === 'note') {
      // Skip note and footnote content — not part of the baseline text.
    } else if (node.type === 'para') {
      if (
        state.currentVerse !== undefined &&
        state.currentVerse.text.length > 0 &&
        !state.currentVerse.text.endsWith(' ')
      )
        state.currentVerse.text += ' ';
      if (node.content) traverse(node.content, state);
    } else if (node.content) {
      traverse(node.content, state);
    }
  });
}

/**
 * Deterministic JSON serialization with keys sorted by UTF-16 code-unit order.
 *
 * Produces the same output regardless of engine locale, making the result safe to feed into a hash
 * function. Arrays preserve their original order; only object keys are sorted.
 *
 * @param value - Any JSON-serializable value.
 * @returns A stable JSON string with object keys in UTF-16 code-unit order.
 */
function stableStringify(value: unknown): string {
  if (!(value instanceof Object)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const sorted = Object.entries(value)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${sorted.join(',')}}`;
}

/**
 * FNV-1a 32-bit hash — sufficient for one-way internal content versioning.
 *
 * Iterates over UTF-16 code units (matching `String.prototype.charCodeAt`) rather than Unicode code
 * points. This is intentional: the hash only needs to be stable within a single JS runtime, not
 * portable across languages.
 *
 * @param s - String to hash.
 * @returns Lowercase hex string of the unsigned 32-bit FNV-1a digest.
 */
function fnv1a32(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    // eslint-disable-next-line no-bitwise
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  // eslint-disable-next-line no-bitwise
  return (h >>> 0).toString(16);
}

/**
 * Extracts a {@link RawBook} from a papi USJ book response.
 *
 * Each `verse` marker in the USJ document becomes one {@link RawVerse}. Text strings within the
 * verse scope are accumulated into `RawVerse.text`; `note` nodes are skipped entirely. Verse
 * markers with no following text produce an empty `RawVerse` (`text: ""`).
 *
 * @param usj - USJ document returned by `useProjectData('platformScripture.USJ_Book', ...)`.
 * @param writingSystem - BCP 47 tag for the baseline, from `platform.languageTag`.
 * @throws {Error} If no `book` marker with a `code` attribute is found in the document.
 */
export function extractBookFromUsj(usj: UsjDocument, writingSystem: string): RawBook {
  const contentHash = fnv1a32(stableStringify(usj.content));
  const state: TraversalState = { bookCode: '', currentVerse: undefined, verses: [] };

  traverse(usj.content, state);

  if (state.currentVerse !== undefined) state.verses.push(state.currentVerse);

  if (!state.bookCode) throw new Error('Invalid USJ: no book marker with a code attribute found');

  return {
    bookCode: state.bookCode,
    writingSystem,
    contentHash,
    verses: state.verses,
  };
}
