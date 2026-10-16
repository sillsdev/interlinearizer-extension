import type { ScriptureRef, Segment, SegmentHeading, VerseStart } from 'interlinearizer';

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
}>;

/** Every segment of a book in document order, segmented by the boundaries the request named. */
export type BookOutline = Readonly<{
  bookRef: string;
  /** The `textVersion` of the book the outline was built from. */
  textVersion: string;
  segments: readonly OutlineSegment[];
}>;

/** A run of a book's segments, at the indexes its outline lists them at. */
export type SegmentPage = Readonly<{
  /** The `textVersion` of the book the segments were cut from. */
  textVersion: string;
  /** Outline index of the first segment. */
  start: number;
  segments: readonly Segment[];
}>;
