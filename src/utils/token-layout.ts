import type { PhraseAnalysisLink, Token } from 'interlinearizer';
import type {
  FocusContext,
  LinkSlot,
  RenderUnit,
  SlotFocusInfo,
  TokenGroup,
} from '../types/token-layout';
import { isWordToken } from '../types/type-guards';

export type { FocusContext, LinkSlot, RenderUnit, SlotFocusInfo, TokenGroup };

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

/**
 * Computes the slot's focus-derived inputs to `TokenLinkIcon`. Pure function over the slot's
 * segment ids and the supplied focus context; bundles the slot-specific flags together with the
 * focused phrase/token so the icon receives a single `slotFocus` object.
 *
 * @param prevSegmentId - Segment id of the group before the slot, or `undefined` for the leading
 *   slot.
 * @param nextSegmentId - Segment id of the group after the slot, or `undefined` for the trailing
 *   slot.
 * @param focus - Resolved focus context for the whole strip.
 * @param focusedSideIsPrev - The layout-specific bool indicating whether focus is start-ward of
 *   this slot.
 * @returns Slot focus info ready to pass as `slotFocus` to `MemoizedTokenLinkIcon`.
 */
export function resolveSlotFocus(
  prevSegmentId: string | undefined,
  nextSegmentId: string | undefined,
  focus: FocusContext,
  focusedSideIsPrev: boolean | undefined,
): SlotFocusInfo {
  const isSameSegmentAsFocus =
    focus.focusedSegmentId !== undefined &&
    prevSegmentId === focus.focusedSegmentId &&
    nextSegmentId === focus.focusedSegmentId;
  return {
    focusedSideIsPrev,
    isSameSegmentAsFocus,
    focusedPhraseLink: focus.focusedPhraseLink,
    focusedFreeToken: focus.focusedFreeToken,
  };
}

/**
 * The "no focus" slot-focus bundle: nothing focused, so the link button is inert. Used by
 * `PhraseBox` for the in-phrase unlink icons, which never participate in focus-driven linking.
 */
export const NO_SLOT_FOCUS: SlotFocusInfo = {
  focusedSideIsPrev: undefined,
  isSameSegmentAsFocus: false,
  focusedPhraseLink: undefined,
  focusedFreeToken: undefined,
};

/**
 * Groups adjacent word tokens that share the same approved `PhraseAnalysisLink` into single
 * `TokenGroup` entries. Non-word tokens are skipped. Discontiguous phrase members produce separate
 * groups that share the same `phraseLink`. `punctuationBetween` is initialized to empty arrays
 * here; {@link buildRenderUnits} fills it in with any punctuation tokens that appear between the
 * word tokens in document order.
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
      last.punctuationBetween.push([]);
    } else {
      groups.push({ tokens: [token], phraseLink: link, firstIndex: index, punctuationBetween: [] });
    }
    return groups;
  }, []);
}

/**
 * Walks `tokens` in document order and emits an alternating sequence of phrase groups and link
 * slots. A leading slot is always emitted before the first group and a trailing slot after the
 * last, so punctuation at segment boundaries still renders. Slots between groups always carry both
 * `prevGroup` and `nextGroup`. Unlink icons between tokens within a multi-token phrase are rendered
 * inside `PhraseBox`, not as separate slots here.
 *
 * Punctuation that appears between two word tokens of the same group is stored in the group's
 * `punctuationBetween` array (at the index corresponding to the gap between those tokens) so
 * `PhraseBox` can render it inline between the token chips, rather than pushing it into the
 * following inter-group slot.
 *
 * @param tokens - Flat token list from the segment or strip.
 * @param tokenGroups - Pre-built phrase groups produced by {@link groupTokens}.
 * @returns An ordered list of render units interleaving groups and slots.
 */
export function buildRenderUnits(tokens: Token[], tokenGroups: TokenGroup[]): RenderUnit[] {
  const units: RenderUnit[] = [];
  const groupByFirstRef = new Map(tokenGroups.map((g) => [g.tokens[0].ref, g]));

  // Map from each non-first token ref to its group and its position within that group, so
  // punctuation encountered between two tokens of the same group can be routed into
  // punctuationBetween rather than pendingPunctuation.
  const nonFirstWordRefToGroup = new Map<string, { group: TokenGroup; tokenIndex: number }>(
    tokenGroups.flatMap((g) =>
      g.tokens.slice(1).map((t, j) => [t.ref, { group: g, tokenIndex: j + 1 }] as const),
    ),
  );

  let pendingPunctuation: Token[] = [];
  // When non-null, punctuation belongs to the gap inside a multi-token group.
  let pendingIntraGroup: { group: TokenGroup; gapIndex: number } | undefined;
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
      if (pendingIntraGroup) {
        // Punctuation between two tokens of the same group: route into the group.
        pendingIntraGroup.group.punctuationBetween[pendingIntraGroup.gapIndex].push(token);
      } else {
        pendingPunctuation.push(token);
      }
      return;
    }

    const intraEntry = nonFirstWordRefToGroup.get(token.ref);
    if (intraEntry) {
      // This is a subsequent token of an already-open group. The gap index is tokenIndex - 1
      // (the gap between tokens[tokenIndex-1] and tokens[tokenIndex]).
      const gapIndex = intraEntry.tokenIndex - 1;
      // Reset the gap array to a fresh one so repeated calls to buildRenderUnits (e.g. on focus
      // change) do not accumulate into the memoized TokenGroup's shared arrays. If
      // pendingIntraGroup is already tracking this exact gap, punctuation tokens were routed
      // directly into it; preserve them by prepending rather than replacing.
      if (
        pendingIntraGroup?.group === intraEntry.group &&
        pendingIntraGroup.gapIndex === gapIndex
      ) {
        intraEntry.group.punctuationBetween[gapIndex] = [
          ...pendingPunctuation,
          ...intraEntry.group.punctuationBetween[gapIndex],
        ];
      } else {
        intraEntry.group.punctuationBetween[gapIndex] = [...pendingPunctuation];
      }
      pendingPunctuation = [];
      const nextGapIndex = intraEntry.tokenIndex;
      pendingIntraGroup =
        nextGapIndex < intraEntry.group.punctuationBetween.length
          ? { group: intraEntry.group, gapIndex: nextGapIndex }
          : undefined;
      return;
    }

    // First token of a new group: close the intra-group tracker and emit the inter-group slot.
    pendingIntraGroup = undefined;
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
