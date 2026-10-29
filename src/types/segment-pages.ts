import type {
  PhraseAnalysis,
  PhraseAnalysisLink,
  ScriptureRef,
  Segment,
  SegmentAnalysis,
  SegmentAnalysisLink,
  SegmentHeading,
  TokenAnalysis,
  TokenAnalysisLink,
  VerseStart,
} from 'interlinearizer';

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
}>;

/** Every segment of a book in document order, segmented by the boundaries the request named. */
export type BookOutline = Readonly<{
  bookRef: string;
  /** The `textVersion` of the book the outline was built from. */
  textVersion: string;
  segments: readonly OutlineSegment[];
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
