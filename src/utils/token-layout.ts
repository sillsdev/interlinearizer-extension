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
 * Resolves the {@link FocusContext} implied by a single focused token ref. All views share these
 * rules; layouts differ only in how they discover which token is focused, not in what that focus
 * means.
 *
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
 * Computes one link slot's {@link SlotFocusInfo}, bundling the slot-specific flags with the focused
 * phrase and token so the link icon receives a single focus object.
 *
 * @param prevSegmentId - Segment id of the group before the slot; `undefined` for the leading slot.
 * @param nextSegmentId - Segment id of the group after the slot; `undefined` for the trailing slot.
 * @param focus - Resolved focus context for the whole strip.
 * @param focusedSideIsPrev - Layout-specific flag for whether focus is start-ward of this slot.
 */
export function resolveSlotFocus(
  prevSegmentId: string | undefined,
  nextSegmentId: string | undefined,
  focus: FocusContext,
  focusedSideIsPrev: boolean | undefined,
): SlotFocusInfo {
  const { focusedSegmentId } = focus;
  const isSameSegmentAsFocus =
    focusedSegmentId !== undefined &&
    prevSegmentId === focusedSegmentId &&
    nextSegmentId === focusedSegmentId;
  return {
    focusedSideIsPrev,
    isSameSegmentAsFocus,
    focusedPhraseLink: focus.focusedPhraseLink,
    focusedFreeToken: focus.focusedFreeToken,
  };
}

/**
 * The "no focus" bundle: nothing focused, so the link button is inert. Used for the unlink icons
 * inside a phrase, which never participate in focus-driven linking.
 */
export const NO_SLOT_FOCUS: SlotFocusInfo = {
  focusedSideIsPrev: undefined,
  isSameSegmentAsFocus: false,
  focusedPhraseLink: undefined,
  focusedFreeToken: undefined,
};

/**
 * Groups adjacent word tokens sharing the same approved phrase into single {@link TokenGroup}
 * entries, skipping non-word tokens. Discontiguous phrase members produce separate groups that
 * share one phrase link. Each group's punctuation is left empty here and filled in when the render
 * units are built.
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
 * Emits an alternating sequence of phrase groups and link slots in document order. A leading slot
 * always precedes the first group and a trailing slot follows the last, so punctuation at segment
 * boundaries still renders. Unlink icons between tokens of a multi-token phrase are rendered by the
 * phrase box itself rather than emitted as slots here.
 *
 * Punctuation falling between two word tokens of the same group is stored on that group instead of
 * being pushed into the following inter-group slot, so it renders inline between the token chips.
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
        pendingIntraGroup.group.punctuationBetween[pendingIntraGroup.gapIndex] = [
          ...pendingIntraGroup.group.punctuationBetween[pendingIntraGroup.gapIndex],
          token,
        ];
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
      if (nextGapIndex < intraEntry.group.punctuationBetween.length) {
        // Entering a new intra-group gap for this invocation; clear any stale memoized entries.
        intraEntry.group.punctuationBetween[nextGapIndex] = [];
        pendingIntraGroup = { group: intraEntry.group, gapIndex: nextGapIndex };
      } else {
        pendingIntraGroup = undefined;
      }
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
