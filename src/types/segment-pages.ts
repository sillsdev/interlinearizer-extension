import type {
  PhraseAnalysis,
  PhraseAnalysisLink,
  ScriptureRef,
  Segment,
  SegmentAnalysis,
  SegmentAnalysisLink,
  SegmentHeading,
  Token,
  TokenAnalysis,
  TokenAnalysisLink,
  VerseStart,
} from 'interlinearizer';
import type { PageCaller } from '../cache/pageClient';

/** A segment as a book's outline lists it: where it falls and how much it holds, not its text. */
export type OutlineSegment = Readonly<{
  id: Segment['id'];
  startRef: ScriptureRef;
  verseStarts: readonly VerseStart[];
  heading?: SegmentHeading;
  /** How many tokens it holds, punctuation included. */
  tokenCount: number;
  wordTokenCount: number;
  /** Length of its baseline text, in UTF-16 code units. */
  textLength: number;
  /**
   * How many orphaned free-translation cards the view shows beside the segment. An orphaned card
   * holds a free translation of a verse that the book no longer holds. Present only when a session
   * asked for the outline.
   */
  orphanedCardCount?: number;
  /** Whether a token of the segment holds a stale analysis. Present only when a session asked. */
  hasStaleGloss?: boolean;
  /**
   * Whether the view shows a stale free translation at the segment, on an orphaned card or not.
   * Present only when a session asked.
   */
  hasStaleFreeTranslation?: boolean;
}>;

/** What a book's boundary controls need to know of the draft's boundaries in it. */
export type OutlineBoundaries = Readonly<{
  /**
   * Each merged-away verse start, by its verse's first word token. That token keys the boundary
   * slot, whereas the verse start itself may be punctuation, such as an opening quote.
   */
  formerBoundaries: Readonly<Record<string, string>>;
  /** The verse starts that no merge can remove, there being no text before them to merge into. */
  unmergeableStarts: readonly string[];
  /** The boundaries that the draft sets and the book's text no longer carries. */
  lostBoundaries: readonly string[];
}>;

/** Every segment of a book in document order, segmented by the boundaries the request named. */
export type BookOutline = Readonly<{
  bookRef: string;
  /** The `textVersion` of the book the outline was built from. */
  textVersion: string;
  segments: readonly OutlineSegment[];
  /** The verse markers that the book repeats; the text under each repeat is not shown. */
  duplicateVerseIds: readonly string[];
  /** Present only when a session asked for the outline. */
  boundaries?: OutlineBoundaries;
}>;

/** A place in a book where a token's analysis went stale. */
export type StaleGlossPlace = Readonly<{ analysisId: string; tokenRef: string }>;

/** The stale analyses that a book holds. */
export type StaleSummary = Readonly<{
  /** Each place, once, in document order; a place whose token the book no longer holds comes last. */
  glosses: readonly StaleGlossPlace[];
  /**
   * Each stale free translation, with the segment showing it or, for one whose verse is gone, the
   * segment it is shown beside, in the order the view shows them.
   */
  freeTranslations: readonly Readonly<{ analysisId: string; segmentId: string }>[];
}>;

/** One payload of a pool bucket, with how many tokens approve it. */
export type PoolEntryRef = Readonly<{
  analysisId: string;
  frequency: number;
}>;

/**
 * Pool buckets by normalized form: the approved token payloads sharing each form, ranked best-first
 * as the suggestion engine ranks them. A form that no approved payload has maps to `[]`.
 */
export type PoolBuckets = Readonly<Record<string, readonly PoolEntryRef[]>>;

/** Pool buckets, with the payloads they name. */
export type PoolRead = {
  /** The pool bucket of each form read. */
  poolBuckets: PoolBuckets;
  /** The payloads that `poolBuckets` names. */
  poolAnalyses: TokenAnalysis[];
};

/** A word token of a phrase that touches a page, with where it sits in its book. */
export type PhraseSpanToken = Readonly<{
  token: Token & { type: 'word' };
  segmentId: string;
  /** Its place among the book's word tokens, in document order. */
  docOrder: number;
  /**
   * The baseline text separating it from the previous word token of its segment, verbatim; absent
   * for a segment's first word token.
   */
  gapText?: string;
}>;

/** Stale free translations by where the view shows them, each named by its payload's id. */
export type PlacedFreeTranslations = Readonly<{
  /**
   * Those that each segment shows for review beside its own translation, by segment id, in document
   * order.
   */
  bySegment: Readonly<Record<string, readonly string[]>>;
  /**
   * Those of verses the book no longer holds, by the id of the segment ending the nearest earlier
   * verse, in verse order.
   */
  orphanedAfter: Readonly<Record<string, readonly string[]>>;
  /** Those of verses that the book no longer holds and that ran ahead of every verse it still holds. */
  orphanedAhead: readonly string[];
}>;

/** The analysis a session's draft holds for a run of segments. */
export type PageAnalysis = Readonly<{
  /** Every token link on a token of the segments. */
  tokenAnalysisLinks: readonly TokenAnalysisLink[];
  /** Every phrase link touching a token of the segments. */
  phraseAnalysisLinks: readonly PhraseAnalysisLink[];
  /** Every segment link on one of the segments, and every stale one placed among them. */
  segmentAnalysisLinks: readonly SegmentAnalysisLink[];
  /** The token payloads the links and pool buckets name, each once. */
  tokenAnalyses: readonly TokenAnalysis[];
  /** The phrase payloads the links name, each once. */
  phraseAnalyses: readonly PhraseAnalysis[];
  /** The segment payloads the links name, each once. */
  segmentAnalyses: readonly SegmentAnalysis[];
  /** The pool bucket of the normalized form of each word token in the segments. */
  poolBuckets: PoolBuckets;
  /** The stale free translations placed among the segments. */
  staleFreeTranslations: PlacedFreeTranslations;
  /**
   * The word tokens of each phrase link, by its id, in the order the link stores them, wherever
   * they sit in the book. A token the book no longer holds is left out.
   */
  phraseSpans: Readonly<Record<string, readonly PhraseSpanToken[]>>;
}>;

/** A run of a book's segments, at the indexes its outline lists them at. */
export type SegmentPage = Readonly<{
  /** The `textVersion` of the book the segments were cut from. */
  textVersion: string;
  /** Outline index of the first segment. */
  start: number;
  segments: readonly Segment[];
  /** Present only when a session asked for the page. */
  analysis?: PageAnalysis;
}>;

/**
 * The loaded book's segment list, as the host segments and serves it. One object per outline: pages
 * loading into it change none of its fields, only what {@link SegmentPages.segmentAt} answers.
 */
export interface SegmentPages {
  bookRef: string;
  /** Every segment of the book in document order. */
  outline: readonly OutlineSegment[];
  /** The boundary-edit count the outline was segmented at. */
  segmentationVersion: number;
  /** What the book's boundary controls need to know of the draft's boundaries. */
  boundaries: OutlineBoundaries;
  /** The verse markers that the book repeats; the text under each repeat is not shown. */
  duplicateVerseIds: readonly string[];
  /** The segment at `index` of the outline, `undefined` until its page has loaded. */
  segmentAt: (index: number) => Segment | undefined;
  /**
   * Each run of the segments loaded, as one page with its analysis. The same list until
   * {@link SegmentPages.loadedVersion} changes.
   */
  heldPages: () => readonly SegmentPage[];
  /**
   * Asks for the segments at outline indexes `[start, end)`, clamped to the outline. The latest
   * range that each `caller` asked for is reloaded whenever a new outline loads.
   */
  load: (start: number, end: number, caller: PageCaller) => void;
  /** Drops the range that `caller` last asked for, so that later outlines do not reload it. */
  release: (caller: PageCaller) => void;
  /** Calls `onChange` whenever pages load, until the returned function is called. */
  subscribe: (onChange: () => void) => () => void;
  /** A number that changes whenever pages load. */
  loadedVersion: () => number;
}

/** The pages of the open book as they load. */
export interface SegmentPagesLoad {
  /**
   * The pages of the latest outline to load; those of an earlier one while a later one loads, and
   * `undefined` before any has loaded.
   */
  pages: SegmentPages | undefined;
  /** `true` until the book's outline has loaded or failed to. */
  isLoading: boolean;
  /** Why the book's outline could not be loaded, once every retry has failed. */
  error: string | undefined;
}
