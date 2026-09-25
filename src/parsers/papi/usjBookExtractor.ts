/** Plain text of a single verse extracted from a USJ document, ready to be tokenized. */
export interface RawVerse {
  kind: 'verse';
  /** SID from the USJ verse marker, e.g. `"GEN 1:1"`. Parsed into `Segment.startRef` / `endRef`. */
  sid: string;
  /**
   * Verbatim verse-label string from the USJ verse marker's `number` attribute (e.g. `"1"`, or a
   * range like `"3-4"`), rendered as the inline verse superscript. When the marker carries no
   * `number` it falls back to the verse portion of the `sid`; synthetic verse-0 scopes use `"0"`.
   */
  number: string;
  /**
   * Accumulated plain-text content of the verse. Note and footnote content is excluded. Becomes
   * `Segment.baselineText`; token `charStart` / `charEnd` are expressed relative to this string.
   */
  text: string;
  /**
   * Offset of `text` within the whole verse's text, present only on a piece that resumes the verse
   * after a mid-verse heading.
   */
  charOffset?: number;
}

/** Plain text of a single heading paragraph extracted from a USJ document, ready to be tokenized. */
export interface RawHeading {
  kind: 'heading';
  /** Becomes `Segment.id`; unique within the book and never equal to a verse SID. */
  id: string;
  /** SID of the verse scope the heading falls within, e.g. `"GEN 1:1"` or `"GEN 2:0"`. */
  verseId: string;
  /** Verbatim label of that verse scope's marker, e.g. `"3-4"`, or `"0"` ahead of verse 1. */
  verseNumber: string;
  /** USFM marker of the heading paragraph, e.g. `"s1"`. */
  marker: string;
  /** Offset in the owning verse's text at which the heading sits, in UTF-16 code units. */
  charIndex: number;
  /** Trimmed plain-text content of the heading. Note and footnote content is excluded. */
  text: string;
}

/** One unit of the text layer, in document order. */
export type RawSegment = RawVerse | RawHeading;

/** Plain text of one paragraph ahead of a book's first chapter. */
export interface RawFrontMatterParagraph {
  /** USFM marker of the paragraph, e.g. `"mt1"`, or `"id"` for the identification line. */
  marker: string;
  /** Trimmed plain-text content, note content included. */
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
  /**
   * Verses, one per USJ `verse` marker or per piece of one split by a heading within it, and
   * headings, one per text-bearing heading paragraph within a chapter, in document order.
   */
  segments: RawSegment[];
  /**
   * SIDs of verse markers dropped because an earlier marker already claimed that SID, in encounter
   * order and repeated once per dropped marker. Empty for a well-formed book.
   */
  duplicateVerseIds: string[];
  /**
   * The identification line and every paragraph ahead of the first chapter, in document order,
   * empty ones included.
   */
  frontMatter: RawFrontMatterParagraph[];
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

/**
 * Para markers whose text becomes a heading segment of its own rather than verse baseline text.
 *
 * The descriptive-title marker `d` (a Psalm superscription, e.g. "A Psalm of David") is
 * deliberately absent: its text is genuine scripture that the source omits a verse marker for, so
 * it is accumulated as the chapter's verse-0 content.
 */
const HEADING_PARA_MARKERS = new Set([
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
  'ms',
  'ms1',
  'ms2',
  'ms3',
  'mr',
  's',
  's1',
  's2',
  's3',
  's4',
  'sr',
  'r',
  'sp',
  'qa',
]);

/** Para markers for blank lines, which never enter the text layer. */
const EXCLUDED_PARA_MARKERS = new Set(['b', 'ib']);

/** Mutable state threaded through the recursive USJ traversal. */
interface TraversalState {
  /** 3-letter book code captured from the `book` marker (e.g. `"GEN"`). */
  bookCode: string;
  /** Verse SIDs seen so far; used to detect duplicates. */
  seenVerseIds: Set<string>;
  /** SIDs of verse markers skipped as duplicates, in encounter order. */
  duplicateVerseIds: string[];
  /** The verse currently being accumulated; `undefined` when outside a verse scope. */
  currentVerse: RawVerse | undefined;
  /**
   * `true` when `currentVerse` is the synthetic verse-0 scope opened at a chapter boundary. A
   * synthetic verse-0 is emitted only when it accumulates text, so chapters with no superscription
   * don't produce an empty verse-0; real verse markers are always emitted even when empty.
   */
  currentVerseIsSynthetic: boolean;
  /**
   * Headings met after the open verse's text began, held until that verse closes and its text is
   * split around them.
   */
  pendingHeadings: RawHeading[];
  /**
   * How many headings the book holds under each pairing of verse SID and marker, for minting unique
   * ids.
   */
  headingCountsByBaseId: Map<string, number>;
  /** Completed verses and headings in document order. */
  segments: RawSegment[];
  /** Whether a chapter has begun; everything ahead of the first is front matter. */
  chapterSeen: boolean;
  frontMatter: RawFrontMatterParagraph[];
}

/**
 * Closes the verse currently being accumulated (if any): trims trailing whitespace and pushes it to
 * the completed segments, then clears the open-verse state. A heading that came after the verse's
 * text began splits that text, so each heading is pushed between the text before and after it, and
 * the text resuming after it becomes a piece of its own. A synthetic verse-0 scope is dropped
 * rather than pushed when it accumulated no text, so chapters without a superscription emit no
 * spurious empty verse-0 segment. Real verse markers are pushed even when empty.
 *
 * Every emitted verse's SID is recorded in `seenVerseIds`. A real marker's SID is already recorded
 * when that marker opens; recording synthetic verse-0 scopes here lets a later explicit marker with
 * the same SID be rejected as a duplicate.
 */
function closeCurrentVerse(state: TraversalState): void {
  const verse = state.currentVerse;
  if (verse === undefined) return;
  const text = verse.text.trimEnd();
  const pieceEnds = [...state.pendingHeadings.map((heading) => heading.charIndex), text.length];
  if (!(state.currentVerseIsSynthetic && text.length === 0)) {
    state.segments.push({ ...verse, text: text.slice(0, pieceEnds[0]) });
    state.seenVerseIds.add(verse.sid);
  }
  state.pendingHeadings.forEach((heading, i) => {
    state.segments.push(heading);
    const piece = text.slice(heading.charIndex, pieceEnds[i + 1]);
    const resumed = piece.trimStart();
    if (resumed.length > 0)
      state.segments.push({
        ...verse,
        text: resumed,
        charOffset: heading.charIndex + piece.length - resumed.length,
      });
  });
  state.currentVerse = undefined;
  state.currentVerseIsSynthetic = false;
  state.pendingHeadings = [];
}

/** Keeps the first `book` node's code and identification text, ignoring a repeated `\id`. */
function handleBookNode(node: UsjNode, state: TraversalState): void {
  if (node.code && !state.bookCode) {
    state.bookCode = node.code;
    state.frontMatter.push({ marker: 'id', text: fullText(node.content ?? []).trim() });
  }
  if (node.content) traverse(node.content, state);
}

/**
 * Closes the current open verse (if any) when a `chapter` node is encountered, then opens a
 * synthetic verse-0 scope for the new chapter before recursing into its content.
 *
 * The verse-0 scope captures content that precedes the chapter's first `verse` marker — chiefly the
 * `d` descriptive title (a Psalm superscription). Headings met while it is open are filed under it,
 * so a chapter whose only content before verse 1 is a section heading emits that heading but no
 * verse-0 segment. The scope's SID is `"<book> <chapter>:0"`, parsed downstream into a verse-0
 * `Segment`. When the chapter node carries no `number` the scope cannot be named, so it is not
 * opened.
 */
function handleChapterNode(node: UsjNode, state: TraversalState): void {
  closeCurrentVerse(state);
  state.chapterSeen = true;
  if (node.number) {
    state.currentVerse = {
      kind: 'verse',
      sid: `${state.bookCode} ${node.number}:0`,
      number: '0',
      text: '',
    };
    state.currentVerseIsSynthetic = true;
  }
  if (node.content) traverse(node.content, state);
}

/**
 * Derives the verse-label fallback from a verse SID: the text after the last colon (e.g. `"7"` from
 * `"GEN 1:7"`, `"1a"` from `"GEN 1:1a"`). Used as the rendered verse number when a `verse` marker
 * omits its `number` attribute.
 *
 * @returns The verse portion after the final colon; the whole `sid` when it contains no colon.
 */
function verseNumberFromSid(sid: string): string {
  return sid.slice(sid.lastIndexOf(':') + 1);
}

/**
 * Closes the previous open verse (if any) and opens a new one for a `verse` node. The rendered
 * verse number is the marker's verbatim `number` attribute, or the sid-derived verse portion when
 * the marker omits it.
 *
 * A marker whose SID an earlier marker already claimed opens no verse scope, so its text is
 * discarded rather than folded into the preceding verse.
 *
 * @throws {SyntaxError} If the `verse` node is missing its required `sid` attribute.
 */
function handleVerseNode(node: UsjNode, state: TraversalState): void {
  closeCurrentVerse(state);
  if (!node.sid) throw new SyntaxError('Invalid USJ: verse marker missing required sid attribute');
  if (state.seenVerseIds.has(node.sid)) {
    state.duplicateVerseIds.push(node.sid);
    return;
  }
  state.seenVerseIds.add(node.sid);
  state.currentVerse = {
    kind: 'verse',
    sid: node.sid,
    number: node.number ?? verseNumberFromSid(node.sid),
    text: '',
  };
  if (node.content) traverse(node.content, state);
}

/** Concatenates the text of a heading paragraph's content, skipping notes. */
function headingText(nodes: MarkerContent[]): string {
  return nodes
    .map((node) => {
      if (typeof node === 'string') return node;
      if (node.type === 'note' || !node.content) return '';
      return headingText(node.content);
    })
    .join('');
}

/** Concatenates the text of a node's content, notes included. */
function fullText(nodes: MarkerContent[]): string {
  return nodes
    .map((node) => (typeof node === 'string' ? node : fullText(node.content ?? [])))
    .join('');
}

/**
 * Files a heading paragraph under the open verse scope, ahead of that verse's segment when it
 * precedes all of the verse's text and at its place within that text otherwise. A heading outside
 * any verse scope belongs to the introduction, which is not part of the text layer, and one with no
 * text has nothing to tokenize; both are dropped.
 *
 * The heading's id is its verse's SID plus its marker, suffixed with an ordinal when an earlier
 * heading in the book already took that id.
 */
function handleHeadingPara(node: UsjNode, marker: string, state: TraversalState): void {
  const verse = state.currentVerse;
  if (verse === undefined) return;
  const text = headingText(node.content ?? []).trim();
  if (text.length === 0) return;
  const baseId = `${verse.sid}/${marker}`;
  const ordinal = (state.headingCountsByBaseId.get(baseId) ?? 0) + 1;
  state.headingCountsByBaseId.set(baseId, ordinal);
  const charIndex = verse.text.trimEnd().length;
  const heading: RawHeading = {
    kind: 'heading',
    id: ordinal === 1 ? baseId : `${baseId}#${ordinal}`,
    verseId: verse.sid,
    verseNumber: verse.number,
    marker,
    charIndex,
    text,
  };
  if (charIndex === 0) state.segments.push(heading);
  else state.pendingHeadings.push(heading);
}

/**
 * Recurses into a `para` node's content, appending a space between adjacent para nodes when needed.
 * A paragraph ahead of the first chapter is also recorded as front matter. Heading paragraphs (see
 * {@link HEADING_PARA_MARKERS}) become headings rather than verse text, and excluded paragraphs (see
 * {@link EXCLUDED_PARA_MARKERS}) are dropped.
 */
function handleParaNode(node: UsjNode, state: TraversalState): void {
  if (!state.chapterSeen && node.marker)
    state.frontMatter.push({ marker: node.marker, text: fullText(node.content ?? []).trim() });
  if (node.marker && HEADING_PARA_MARKERS.has(node.marker)) {
    handleHeadingPara(node, node.marker, state);
    return;
  }
  if (node.marker && EXCLUDED_PARA_MARKERS.has(node.marker)) return;
  if (
    state.currentVerse !== undefined &&
    state.currentVerse.text.length > 0 &&
    !state.currentVerse.text.endsWith(' ')
  )
    state.currentVerse.text += ' ';
  if (node.content) traverse(node.content, state);
}

/**
 * Dispatch table mapping USJ node `type` strings to their traversal handler functions. Node types
 * absent from this table (e.g. `char`) are handled generically by recursing into their `content`.
 */
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
 * @throws {SyntaxError} If any verse node encountered during traversal is missing its `sid`
 *   attribute.
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
 * Intended for plain JSON-shaped structures only; does not special-case Date, Map, Set, or RegExp.
 */
function stableStringify(value: unknown): string {
  /* v8 ignore next -- defensive guard; production callers never pass undefined directly */
  if (value === undefined) return 'null';
  if (!(value instanceof Object)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const sorted = Object.entries(value)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => +(a > b) - +(a < b))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${sorted.join(',')}}`;
}

/** FNV-1a 32-bit hash — sufficient for one-way internal content versioning. */
function fnv1a32(s: string): string {
  let h = 2166136261;
  // eslint-disable-next-line no-restricted-syntax -- iterating over string, not array
  for (const char of s) {
    /* v8 ignore next 2 -- codePointAt(0) on a spread char is always defined */
    // eslint-disable-next-line no-bitwise
    h = Math.imul(h ^ (char.codePointAt(0) ?? 0), 16777619);
  }
  // eslint-disable-next-line no-bitwise
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Extracts a {@link RawBook} from a papi USJ book response.
 *
 * Each `verse` marker in the USJ document becomes one {@link RawVerse}, or one per piece when
 * headings fall within its text, and each text-bearing heading paragraph within a chapter one
 * {@link RawHeading}. Text strings within the verse scope are accumulated into `RawVerse.text`;
 * `note` nodes are skipped entirely. Verse markers with no following text produce an empty
 * `RawVerse` (`text: ""`). `RawVerse.number` is the marker's verbatim `number` attribute (falling
 * back to the sid's verse portion when absent); synthetic verse-0 scopes carry `"0"`.
 *
 * Content preceding a chapter's first `verse` marker — chiefly a `d` descriptive title (Psalm
 * superscription) — is captured as a synthetic verse-0 `RawVerse` with SID `"<book> <chapter>:0"`,
 * but only when it has text.
 *
 * The identification line and the paragraphs ahead of the first chapter are also captured, whole,
 * as front matter.
 *
 * A `verse` marker repeating a SID an earlier marker already claimed is skipped rather than fatal,
 * so a book with duplicate verses still extracts.
 *
 * @throws {SyntaxError} If no `book` marker with a `code` attribute is found in the document.
 * @throws {SyntaxError} If a `verse` marker is missing its required `sid` attribute.
 */
export function extractBookFromUsj(usj: UsjDocument, writingSystem: string): RawBook {
  const contentHash = fnv1a32(stableStringify(usj.content));
  const state: TraversalState = {
    bookCode: '',
    seenVerseIds: new Set<string>(),
    duplicateVerseIds: [],
    currentVerse: undefined,
    currentVerseIsSynthetic: false,
    pendingHeadings: [],
    headingCountsByBaseId: new Map<string, number>(),
    segments: [],
    chapterSeen: false,
    frontMatter: [],
  };

  traverse(usj.content, state);

  closeCurrentVerse(state);

  if (!state.bookCode)
    throw new SyntaxError('Invalid USJ: no book marker with a code attribute found');

  return {
    bookCode: state.bookCode,
    writingSystem,
    contentHash,
    segments: state.segments,
    duplicateVerseIds: state.duplicateVerseIds,
    frontMatter: state.frontMatter,
  };
}
