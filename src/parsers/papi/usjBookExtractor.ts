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
  /** Node type string (e.g. `"book"`, `"chapter"`, `"verse"`, `"para"`, `"note"`). */
  type: string;
  /** USFM marker (e.g. `"p"`, `"s1"`, `"q"`). Present on `para` and `note` nodes. */
  marker?: string;
  /** Chapter or verse number string. Present on `chapter` nodes. */
  number?: string;
  /** 3-letter book code. Present on `book` nodes. */
  code?: string;
  /**
   * Verse or chapter SID. Present on `verse` nodes (e.g. `"GEN 1:1"`) and `chapter` nodes (e.g.
   * `"GEN 1"`).
   */
  sid?: string;
  /** Child content items (strings or nested nodes). */
  content?: MarkerContent[];
}

/** Minimal shape of a USJ document as returned by the papi `platformScripture.USJ_Book` provider. */
export interface UsjDocument {
  content: MarkerContent[];
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Para markers whose content is not part of the verse baseline text (headings, titles, spacing,
 * speaker IDs, acrostic headings, etc.). Verse-content para markers (p, m, pi, q*, etc.) are absent
 * from this set and have their text accumulated as usual.
 */
const HEADING_PARA_MARKERS = new Set([
  // Major section headings and reference ranges
  'ms',
  'ms1',
  'ms2',
  'ms3',
  'mr',
  // Section headings, reference ranges, and descriptive titles
  's',
  's1',
  's2',
  's3',
  's4',
  'sr',
  'r',
  'd',
  // Speaker, acrostic heading, blank lines
  'sp',
  'qa',
  'b',
  'ib',
  // Introduction headings
  'imt',
  'imt1',
  'imt2',
  'imt3',
  'imte',
  'imte1',
  'imte2',
  'is',
  'is1',
  'is2',
]);

/** Mutable state threaded through the recursive USJ traversal. */
interface TraversalState {
  /** 3-letter book code captured from the `book` marker (e.g. `"GEN"`). */
  bookCode: string;
  /** The verse currently being accumulated; `undefined` when outside a verse scope. */
  currentVerse: { sid: string; text: string } | undefined;
  /** Completed verses in document order. */
  verses: RawVerse[];
}

/**
 * Captures the book code from a `book` node, then recurses into its content.
 *
 * @param node - The `book` USJ node; `node.code` is the 3-letter book code.
 * @param state - Shared traversal state updated in place.
 */
function handleBookNode(node: UsjNode, state: TraversalState): void {
  if (node.code) state.bookCode = node.code;
  if (node.content) traverse(node.content, state);
}

/**
 * Closes the current open verse (if any) when a `chapter` node is encountered, then recurses into
 * the chapter's content to pick up verses inside it.
 *
 * @param node - The `chapter` USJ node.
 * @param state - Shared traversal state updated in place.
 */
function handleChapterNode(node: UsjNode, state: TraversalState): void {
  if (state.currentVerse !== undefined) {
    state.currentVerse.text = state.currentVerse.text.trimEnd();
    state.verses.push(state.currentVerse);
    state.currentVerse = undefined;
  }
  if (node.content) traverse(node.content, state);
}

/**
 * Closes the previous open verse (if any) and opens a new one for a `verse` node.
 *
 * @param node - The `verse` USJ node; must carry a `sid` attribute (e.g. `"GEN 1:1"`).
 * @param state - Shared traversal state updated in place.
 * @throws {SyntaxError} If the `verse` node is missing its required `sid` attribute.
 */
function handleVerseNode(node: UsjNode, state: TraversalState): void {
  if (state.currentVerse !== undefined) {
    state.currentVerse.text = state.currentVerse.text.trimEnd();
    state.verses.push(state.currentVerse);
  }
  if (!node.sid) throw new SyntaxError('Invalid USJ: verse marker missing required sid attribute');
  state.currentVerse = { sid: node.sid, text: '' };
  if (node.content) traverse(node.content, state);
}

/**
 * Recurses into a `para` node's content, appending a space between adjacent para nodes when needed.
 * Heading-class paragraphs (see {@link HEADING_PARA_MARKERS}) are skipped entirely so their text is
 * not included in the verse baseline.
 *
 * @param node - The `para` USJ node; `node.marker` determines whether to skip or recurse.
 * @param state - Shared traversal state updated in place.
 */
function handleParaNode(node: UsjNode, state: TraversalState): void {
  if (node.marker && HEADING_PARA_MARKERS.has(node.marker)) return;
  if (
    state.currentVerse !== undefined &&
    state.currentVerse.text.length > 0 &&
    !state.currentVerse.text.endsWith(' ')
  )
    state.currentVerse.text += ' ';
  if (node.content) traverse(node.content, state);
}

/** Dispatch table mapping USJ node `type` strings to their traversal handlers. */
const NODE_HANDLERS: Partial<Record<string, (node: UsjNode, state: TraversalState) => void>> = {
  book: handleBookNode,
  chapter: handleChapterNode,
  verse: handleVerseNode,
  note: () => {}, // skip note/footnote content — not part of the baseline text
  para: handleParaNode,
};

/**
 * Recursively walks a USJ content array, accumulating verse text into `state`.
 *
 * @param nodes - Content items to walk (`string` or {@link UsjNode}).
 * @param state - Shared mutable state updated in place during traversal.
 */
function traverse(nodes: MarkerContent[], state: TraversalState): void {
  nodes.forEach((node) => {
    if (typeof node === 'string') {
      if (state.currentVerse !== undefined) state.currentVerse.text += node;
      return;
    }
    const handler = Object.hasOwn(NODE_HANDLERS, node.type) ? NODE_HANDLERS[node.type] : undefined;
    if (handler) handler(node, state);
    else if (node.content) traverse(node.content, state);
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
  if (value === undefined) return 'null';
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
 * @param s - String to hash.
 * @returns Lowercase hex string of the unsigned 32-bit FNV-1a digest.
 */
function fnv1a32(s: string): string {
  const h = [...s].reduce<number>(
    /* v8 ignore next 2 -- codePointAt(0) on a spread char is always defined */
    // eslint-disable-next-line no-bitwise
    (acc, char) => Math.imul(acc ^ (char.codePointAt(0) ?? 0), 16777619),
    2166136261,
  );
  // eslint-disable-next-line no-bitwise
  return (h >>> 0).toString(16).padStart(8, '0');
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
 * @returns A `RawBook` with `bookCode`, `writingSystem`, `contentHash`, and `verses` populated.
 * @throws {SyntaxError} If no `book` marker with a `code` attribute is found in the document.
 */
export function extractBookFromUsj(usj: UsjDocument, writingSystem: string): RawBook {
  const contentHash = fnv1a32(stableStringify(usj.content));
  const state: TraversalState = { bookCode: '', currentVerse: undefined, verses: [] };

  traverse(usj.content, state);

  if (state.currentVerse !== undefined) {
    state.currentVerse.text = state.currentVerse.text.trimEnd();
    state.verses.push(state.currentVerse);
  }

  if (!state.bookCode)
    throw new SyntaxError('Invalid USJ: no book marker with a code attribute found');

  return {
    bookCode: state.bookCode,
    writingSystem,
    contentHash,
    verses: state.verses,
  };
}
