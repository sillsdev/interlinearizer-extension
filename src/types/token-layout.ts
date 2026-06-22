/**
 * @file Types describing the intermediate data structures produced when laying out tokens for
 *   rendering. These are pure structural types with no runtime behaviour; the functions that build
 *   and consume them live in `utils/token-layout.ts`.
 */
import type { PhraseAnalysisLink, Token } from 'interlinearizer';

/**
 * Resolved focus state shared by SegmentView and ContinuousView so both views derive their
 * highlight / link-icon rules from the same source. Built once per render from the parent's
 * `focusedTokenRef`.
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
 * The complete bundle of focus-derived inputs `TokenLinkIcon` needs for a single between-group
 * slot. Combines the slot-specific direction/segment flags with the two focus-context fields the
 * icon reads directly (`focusedPhraseLink` / `focusedFreeToken`), so the icon takes one focus
 * object instead of four separate props.
 */
export type SlotFocusInfo = {
  /**
   * `true` when the focused group is start-ward of this slot, `false` when end-ward, `undefined`
   * when nothing is focused. Caller must compute this from its own ordering (`focusedGroupSeen`
   * cursor for SegmentView; flat index comparison for ContinuousView).
   */
  focusedSideIsPrev: boolean | undefined;
  /**
   * `true` when both slot neighbors are in the same segment as the focused token. Within one
   * segment the link button joins tokens into a phrase as usual.
   */
  isSameSegmentAsFocus: boolean;
  /**
   * `true` when this slot is the boundary between the focused token's segment and an immediately
   * adjacent segment — i.e. one neighbor is in the focused segment and the other is in the segment
   * directly before or after it in document order. The cross-segment link button is active only at
   * these edges, so pulling an adjacent segment's edge token into the focused phrase moves the
   * boundary by exactly one token and keeps both segments contiguous.
   */
  isAdjacentEdgeOfFocus: boolean;
  /** The phrase containing the focused token, or `undefined` when the focused token is free. */
  focusedPhraseLink: PhraseAnalysisLink | undefined;
  /** The focused token when it is not part of any phrase ("free"); `undefined` otherwise. */
  focusedFreeToken: (Token & { type: 'word' }) | undefined;
};

/** A grouped render unit: one or more adjacent tokens that share the same phrase (or no phrase). */
export type TokenGroup = {
  /** The tokens to render together in one `PhraseBox`. */
  tokens: (Token & { type: 'word' })[];
  /** The phrase link shared by all tokens in this group, or `undefined` for ungrouped solo tokens. */
  phraseLink: PhraseAnalysisLink | undefined;
  /**
   * The index of the first token in the flat token array from which this group was built — passed
   * as `index` to `PhraseBox`.
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
