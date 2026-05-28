import type { PhraseAnalysisLink, Token } from 'interlinearizer';
import { isWordToken } from '../types/typeGuards';

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
 * Resolves the focus context from a single `focusedTokenRef`. All views use the same rules; the
 * only thing that differs between layouts is how they discover which token is focused, not what
 * that focus means.
 *
 * @param focusedTokenRef - Ref of the focused word token, or `undefined`.
 * @param tokensByRef - Lookup from token ref to the full token (word or other).
 * @param phraseLinkByRef - Map from token ref to the phrase link containing it.
 * @param tokenSegmentMap - Map from token ref to the id of the segment containing it.
 * @returns The resolved focus context. All fields are `undefined` when `focusedTokenRef` is unset.
 */
export function resolveFocusContext(
  focusedTokenRef: string | undefined,
  tokensByRef: ReadonlyMap<string, Token>,
  phraseLinkByRef: ReadonlyMap<string, PhraseAnalysisLink>,
  tokenSegmentMap: ReadonlyMap<string, string>,
): FocusContext {
  if (focusedTokenRef === undefined) {
    return {
      focusedToken: undefined,
      focusedPhraseLink: undefined,
      focusedFreeToken: undefined,
      focusedSegmentId: undefined,
      focusedPhraseId: undefined,
    };
  }
  const raw = tokensByRef.get(focusedTokenRef);
  const focusedToken = raw && isWordToken(raw) ? raw : undefined;
  const focusedPhraseLink = phraseLinkByRef.get(focusedTokenRef);
  const focusedFreeToken = focusedPhraseLink === undefined ? focusedToken : undefined;
  return {
    focusedToken,
    focusedPhraseLink,
    focusedFreeToken,
    focusedSegmentId: tokenSegmentMap.get(focusedTokenRef),
    focusedPhraseId: focusedPhraseLink?.analysisId,
  };
}

/** Focus-derived inputs to `TokenLinkIcon` for a single between-group slot. */
export type SlotFocusInfo = {
  /**
   * `true` when the focused group is start-ward of this slot, `false` when end-ward, `undefined`
   * when nothing is focused. Caller must compute this from its own ordering (`focusedGroupSeen`
   * cursor for SegmentView; flat index comparison for ContinuousView).
   */
  focusedSideIsPrev: boolean | undefined;
  /**
   * `true` when both slot neighbors are in the same segment as the focused token. Phrases cannot
   * span segments, so the link button is disabled when this is `false`.
   */
  isSameSegmentAsFocus: boolean;
};

/**
 * Computes the slot's focus-derived inputs to `TokenLinkIcon`. Pure function over segment ids and
 * the supplied focus context.
 *
 * @param prevSegmentId - Segment id of the group before the slot, or `undefined` for the leading
 *   slot.
 * @param nextSegmentId - Segment id of the group after the slot, or `undefined` for the trailing
 *   slot.
 * @param focusedSegmentId - Segment id of the focused token, or `undefined`.
 * @param focusedSideIsPrev - The layout-specific bool indicating whether focus is start-ward of
 *   this slot.
 * @returns Slot focus info ready to pass through to `MemoizedTokenLinkIcon`.
 */
export function resolveSlotFocus(
  prevSegmentId: string | undefined,
  nextSegmentId: string | undefined,
  focusedSegmentId: string | undefined,
  focusedSideIsPrev: boolean | undefined,
): SlotFocusInfo {
  const isSameSegmentAsFocus =
    focusedSegmentId !== undefined &&
    prevSegmentId === focusedSegmentId &&
    nextSegmentId === focusedSegmentId;
  return { focusedSideIsPrev, isSameSegmentAsFocus };
}

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
};

/**
 * Groups adjacent word tokens that share the same approved `PhraseAnalysisLink` into single
 * `TokenGroup` entries. Non-word tokens are skipped. Discontiguous phrase members produce separate
 * groups that share the same `phraseLink`.
 *
 * @param tokens - The flat token list to group.
 * @param phraseLinkByRef - Map from `tokenRef` to the `PhraseAnalysisLink` containing it.
 * @returns An ordered array of `TokenGroup`s ready for rendering.
 */
export function groupTokens(
  tokens: Token[],
  phraseLinkByRef: Map<string, PhraseAnalysisLink>,
): TokenGroup[] {
  return tokens.reduce<TokenGroup[]>((groups, token, index) => {
    if (!isWordToken(token)) return groups;
    const link = phraseLinkByRef.get(token.ref);
    const last = groups[groups.length - 1];
    if (link && last?.phraseLink?.analysisId === link.analysisId) {
      last.tokens.push(token);
    } else {
      groups.push({ tokens: [token], phraseLink: link, firstIndex: index });
    }
    return groups;
  }, []);
}

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

/**
 * Walks `tokens` in document order and emits an alternating sequence of phrase groups and link
 * slots. A leading slot is always emitted before the first group and a trailing slot after the
 * last, so punctuation at segment boundaries still renders. Slots between groups always carry both
 * `prevGroup` and `nextGroup`. Unlink icons between tokens within a multi-token phrase are rendered
 * inside `PhraseBox`, not as separate slots here.
 *
 * @param tokens - Flat token list from the segment or strip.
 * @param tokenGroups - Pre-built phrase groups produced by {@link groupTokens}.
 * @returns An ordered list of render units interleaving groups and slots.
 */
export function buildRenderUnits(tokens: Token[], tokenGroups: TokenGroup[]): RenderUnit[] {
  const units: RenderUnit[] = [];
  const groupByFirstRef = new Map(tokenGroups.map((g) => [g.tokens[0].ref, g]));
  const nonFirstWordRefs = new Set(tokenGroups.flatMap((g) => g.tokens.slice(1).map((t) => t.ref)));

  let pendingPunctuation: Token[] = [];
  let lastGroup: TokenGroup | undefined;

  const emitSlot = (nextGroup: TokenGroup | undefined) => {
    units.push({
      kind: 'slot',
      slot: { prevGroup: lastGroup, nextGroup, punctuation: pendingPunctuation },
    });
    pendingPunctuation = [];
  };

  tokens.forEach((token) => {
    if (!isWordToken(token)) {
      pendingPunctuation.push(token);
      return;
    }
    if (nonFirstWordRefs.has(token.ref)) return;
    const group = groupByFirstRef.get(token.ref);
    /* v8 ignore next -- groupByFirstRef always contains a group for every first-word ref */
    if (!group) return;
    emitSlot(group);
    units.push({ kind: 'group', group });
    lastGroup = group;
  });
  emitSlot(undefined);
  return units;
}
