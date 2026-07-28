import type { PhraseAnalysisLink, Token } from 'interlinearizer';

/**
 * Resolved focus state shared by the segment and continuous views so both derive their highlight
 * and link-icon rules from one source. Built once per render.
 */
export type FocusContext = {
  /** The focused word token itself, or `undefined` when nothing is focused. */
  focusedToken: (Token & { type: 'word' }) | undefined;
  /** The phrase containing the focused token, or `undefined` when the focused token is free. */
  focusedPhraseLink: PhraseAnalysisLink | undefined;
  /** The focused token when it is not part of any phrase ("free"); `undefined` otherwise. */
  focusedFreeToken: (Token & { type: 'word' }) | undefined;
  /** Segment id containing the focused token, or `undefined` when nothing is focused. */
  focusedSegmentId: string | undefined;
  /** PhraseId to highlight as "focused" for arc / phrase-box styling. */
  focusedPhraseId: string | undefined;
};

/**
 * The focus-derived inputs a single between-group link slot needs: its own direction and segment
 * flags plus the two {@link FocusContext} fields the link icon reads, bundled so the icon takes one
 * focus object.
 */
export type SlotFocusInfo = {
  /**
   * `true` when the focused group is start-ward of this slot, `false` when end-ward, `undefined`
   * when nothing is focused. Callers compute this from their own ordering of groups.
   */
  focusedSideIsPrev: boolean | undefined;
  /**
   * `true` when both slot neighbors are in the same segment as the focused token. The link button
   * is active only when linking joins tokens within one segment.
   */
  isSameSegmentAsFocus: boolean;
  /** The phrase containing the focused token, or `undefined` when the focused token is free. */
  focusedPhraseLink: PhraseAnalysisLink | undefined;
  /** The focused token when it is not part of any phrase ("free"); `undefined` otherwise. */
  focusedFreeToken: (Token & { type: 'word' }) | undefined;
};

/** A grouped render unit: one or more adjacent tokens that share the same phrase (or no phrase). */
export type TokenGroup = {
  /** The tokens to render together as a single phrase box. */
  tokens: (Token & { type: 'word' })[];
  /** The phrase link shared by all tokens in this group, or `undefined` for ungrouped solo tokens. */
  phraseLink: PhraseAnalysisLink | undefined;
  /**
   * The index of the first token in this group within the flat token array it was built from, so
   * callers can slice that array back to the group's range.
   */
  firstIndex: number;
  /**
   * Punctuation tokens that appear between adjacent word tokens within this group, in document
   * order. `punctuationBetween[i]` contains punctuation that falls between `tokens[i]` and
   * `tokens[i+1]`. Always has length `tokens.length - 1`; entries are empty arrays when no
   * punctuation sits between that pair.
   */
  punctuationBetween: Token[][];
};

/** A slot between two adjacent token groups, carrying the link icon and any punctuation in the gap. */
export type LinkSlot = {
  /** The last token group before this slot, or `undefined` for the leading slot. */
  prevGroup: TokenGroup | undefined;
  /** The first token group after this slot, or `undefined` for the trailing slot. */
  nextGroup: TokenGroup | undefined;
  /** Punctuation tokens that sit between the two word groups, in document order. */
  punctuation: Token[];
};

/** A unit in the rendered token row — either a phrase group or a between-group slot. */
export type RenderUnit = { kind: 'group'; group: TokenGroup } | { kind: 'slot'; slot: LinkSlot };
