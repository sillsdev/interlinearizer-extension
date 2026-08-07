/// <reference types="jest" />

import type { Token } from 'interlinearizer';
import { emptyFocusContext } from '../../types/empty-factories';
import type { FocusContext } from '../../types/token-layout';
import {
  resolveFocusContext,
  resolveSlotFocus,
  groupTokens,
  buildRenderUnits,
  NO_SLOT_FOCUS,
} from '../../utils/token-layout';
import { makePhraseLink, makePunctToken, makeWordToken } from '../test-helpers';

describe('resolveFocusContext', () => {
  it('returns all-undefined context when focusedTokenRef is undefined', () => {
    const ctx = resolveFocusContext(undefined, new Map(), new Map(), new Map());
    expect(ctx.focusedToken).toBeUndefined();
    expect(ctx.focusedPhraseLink).toBeUndefined();
    expect(ctx.focusedFreeToken).toBeUndefined();
    expect(ctx.focusedSegmentId).toBeUndefined();
    expect(ctx.focusedPhraseId).toBeUndefined();
  });

  it('resolves a focused free word token (not in any phrase)', () => {
    const tok = makeWordToken('tok-a');
    const tokensByRef = new Map<string, Token>([['tok-a', tok]]);
    const ctx = resolveFocusContext('tok-a', tokensByRef, new Map(), new Map([['tok-a', 'seg-1']]));
    expect(ctx.focusedToken).toBe(tok);
    expect(ctx.focusedFreeToken).toBe(tok);
    expect(ctx.focusedPhraseLink).toBeUndefined();
    expect(ctx.focusedPhraseId).toBeUndefined();
    expect(ctx.focusedSegmentId).toBe('seg-1');
  });

  it('resolves a focused token that is inside a phrase', () => {
    const tok = makeWordToken('tok-a');
    const phraseLink = makePhraseLink('p1', ['tok-a', 'tok-b']);
    const tokensByRef = new Map<string, Token>([['tok-a', tok]]);
    const phraseLinkByRef = new Map([['tok-a', phraseLink]]);
    const ctx = resolveFocusContext('tok-a', tokensByRef, phraseLinkByRef, new Map());
    expect(ctx.focusedPhraseLink).toBe(phraseLink);
    expect(ctx.focusedPhraseId).toBe('p1');
    expect(ctx.focusedFreeToken).toBeUndefined();
  });

  it('resolves focusedToken as undefined when the token is not a word token', () => {
    const punct = makePunctToken('tok-p');
    const tokensByRef = new Map<string, Token>([['tok-p', punct]]);
    const ctx = resolveFocusContext('tok-p', tokensByRef, new Map(), new Map());
    expect(ctx.focusedToken).toBeUndefined();
    expect(ctx.focusedFreeToken).toBeUndefined();
  });

  it('resolves focusedToken as undefined when the token ref is not in the map', () => {
    const ctx = resolveFocusContext('unknown', new Map(), new Map(), new Map());
    expect(ctx.focusedToken).toBeUndefined();
  });
});

describe('resolveSlotFocus', () => {
  /**
   * Builds a focus context with the given segment id and optional phrase/free token; all other
   * fields default to undefined.
   */
  function focusWithSegment(
    focusedSegmentId: string | undefined,
    overrides: Partial<FocusContext> = {},
  ): FocusContext {
    return { ...emptyFocusContext(), focusedSegmentId, ...overrides };
  }

  it('marks isSameSegmentAsFocus true when all three segment ids agree', () => {
    const result = resolveSlotFocus('seg-1', 'seg-1', focusWithSegment('seg-1'), true);
    expect(result.isSameSegmentAsFocus).toBe(true);
  });

  it('marks isSameSegmentAsFocus false when focusedSegmentId is undefined', () => {
    const result = resolveSlotFocus('seg-1', 'seg-1', focusWithSegment(undefined), undefined);
    expect(result.isSameSegmentAsFocus).toBe(false);
  });

  it('marks isSameSegmentAsFocus false when prev and next are in different segments', () => {
    const result = resolveSlotFocus('seg-1', 'seg-2', focusWithSegment('seg-1'), true);
    expect(result.isSameSegmentAsFocus).toBe(false);
  });

  it('passes focusedSideIsPrev through when false', () => {
    expect(
      resolveSlotFocus('seg-1', 'seg-1', focusWithSegment('seg-1'), false).focusedSideIsPrev,
    ).toBe(false);
  });

  it('passes focusedSideIsPrev through when undefined', () => {
    expect(
      resolveSlotFocus('seg-1', 'seg-1', focusWithSegment('seg-1'), undefined).focusedSideIsPrev,
    ).toBeUndefined();
  });

  it('forwards focusedPhraseLink and focusedFreeToken from the focus context', () => {
    const link = makePhraseLink('p1', ['tok-a']);
    const freeToken = makeWordToken('tok-b');
    const result = resolveSlotFocus(
      'seg-1',
      'seg-1',
      focusWithSegment('seg-1', { focusedPhraseLink: link, focusedFreeToken: freeToken }),
      true,
    );
    expect(result.focusedPhraseLink).toBe(link);
    expect(result.focusedFreeToken).toBe(freeToken);
  });
});

describe('NO_SLOT_FOCUS', () => {
  it('represents an inert, unfocused slot', () => {
    expect(NO_SLOT_FOCUS).toEqual({
      focusedSideIsPrev: undefined,
      isSameSegmentAsFocus: false,
      focusedPhraseLink: undefined,
      focusedFreeToken: undefined,
    });
  });
});

describe('groupTokens', () => {
  it('returns an empty array for an empty token list', () => {
    expect(groupTokens([], new Map())).toHaveLength(0);
  });

  it('skips non-word tokens', () => {
    const groups = groupTokens([makePunctToken('p1')], new Map());
    expect(groups).toHaveLength(0);
  });

  it('creates one group per free word token', () => {
    const groups = groupTokens([makeWordToken('tok-a'), makeWordToken('tok-b')], new Map());
    expect(groups).toHaveLength(2);
    expect(groups[0].phraseLink).toBeUndefined();
    expect(groups[1].phraseLink).toBeUndefined();
  });

  it('groups adjacent tokens in the same phrase into one group', () => {
    const link = makePhraseLink('p1', ['tok-a', 'tok-b']);
    const phraseLinkByRef = new Map([
      ['tok-a', link],
      ['tok-b', link],
    ]);
    const groups = groupTokens([makeWordToken('tok-a'), makeWordToken('tok-b')], phraseLinkByRef);
    expect(groups).toHaveLength(1);
    expect(groups[0].tokens).toHaveLength(2);
    expect(groups[0].phraseLink?.analysisId).toBe('p1');
  });

  it('produces three groups (two phrase fragments plus the intervening free token) for a discontiguous phrase', () => {
    const link = makePhraseLink('p1', ['tok-a', 'tok-c']);
    const phraseLinkByRef = new Map([
      ['tok-a', link],
      ['tok-c', link],
    ]);
    const groups = groupTokens(
      [makeWordToken('tok-a'), makeWordToken('tok-b'), makeWordToken('tok-c')],
      phraseLinkByRef,
    );
    expect(groups).toHaveLength(3);
    expect(groups[0].phraseLink?.analysisId).toBe('p1');
    expect(groups[1].phraseLink).toBeUndefined();
    expect(groups[2].phraseLink?.analysisId).toBe('p1');
  });

  it('records the correct firstIndex for each group', () => {
    const groups = groupTokens(
      [makePunctToken('p0'), makeWordToken('tok-a'), makeWordToken('tok-b')],
      new Map(),
    );
    expect(groups[0].firstIndex).toBe(1);
    expect(groups[1].firstIndex).toBe(2);
  });
});

describe('buildRenderUnits', () => {
  it('produces a leading and trailing slot when there is one group', () => {
    const tok = makeWordToken('tok-a');
    const group = { tokens: [tok], phraseLink: undefined, firstIndex: 0, punctuationBetween: [] };
    const units = buildRenderUnits([tok], [group]);
    expect(units).toHaveLength(3);
    expect(units[0].kind).toBe('slot');
    expect(units[1].kind).toBe('group');
    expect(units[2].kind).toBe('slot');
  });

  it('puts punctuation in the slot between two groups', () => {
    const a = makeWordToken('tok-a');
    const punct = makePunctToken('p1', ',');
    const b = makeWordToken('tok-b');
    const groups = [
      { tokens: [a], phraseLink: undefined, firstIndex: 0, punctuationBetween: [] },
      { tokens: [b], phraseLink: undefined, firstIndex: 2, punctuationBetween: [] },
    ];
    const units = buildRenderUnits([a, punct, b], groups);
    const slotUnit = units.find(
      (u) => u.kind === 'slot' && u.slot.prevGroup !== undefined && u.slot.nextGroup !== undefined,
    );
    expect(slotUnit?.kind).toBe('slot');
    if (slotUnit?.kind === 'slot') {
      expect(slotUnit.slot.punctuation).toHaveLength(1);
      expect(slotUnit.slot.punctuation[0].ref).toBe('p1');
    }
  });

  it('routes punctuation between tokens of the same group into punctuationBetween', () => {
    const a = makeWordToken('tok-a');
    const punct = makePunctToken('p1', ',');
    const b = makeWordToken('tok-b');
    const link = makePhraseLink('ph1', ['tok-a', 'tok-b']);
    const groups = groupTokens(
      [a, punct, b],
      new Map([
        ['tok-a', link],
        ['tok-b', link],
      ]),
    );
    buildRenderUnits([a, punct, b], groups);
    expect(groups[0].punctuationBetween).toHaveLength(1);
    expect(groups[0].punctuationBetween[0]).toHaveLength(1);
    expect(groups[0].punctuationBetween[0][0].ref).toBe('p1');
  });

  it('routes punctuation following an open intra-group gap into that same group', () => {
    // A three-token group with two punctuation tokens between its second and third tokens: the
    // second punctuation token must join the intra-group gap opened by the first, not be buffered.
    const a = makeWordToken('tok-a');
    const b = makeWordToken('tok-b');
    const p1 = makePunctToken('p1', ',');
    const p2 = makePunctToken('p2', ';');
    const c = makeWordToken('tok-c');
    const link = makePhraseLink('ph1', ['tok-a', 'tok-b', 'tok-c']);
    const groups = groupTokens(
      [a, b, p1, p2, c],
      new Map([
        ['tok-a', link],
        ['tok-b', link],
        ['tok-c', link],
      ]),
    );
    buildRenderUnits([a, b, p1, p2, c], groups);
    // Both punctuation tokens land in the open intra-group gap after tokens[1] (b).
    const routed = groups[0].punctuationBetween.flat().map((t) => t.ref);
    expect(routed).toEqual(['p1', 'p2']);
  });

  it('does not put intra-group punctuation into any slot', () => {
    const a = makeWordToken('tok-a');
    const punct = makePunctToken('p1', ',');
    const b = makeWordToken('tok-b');
    const link = makePhraseLink('ph1', ['tok-a', 'tok-b']);
    const groups = groupTokens(
      [a, punct, b],
      new Map([
        ['tok-a', link],
        ['tok-b', link],
      ]),
    );
    const units = buildRenderUnits([a, punct, b], groups);
    const allSlots = units.filter((u) => u.kind === 'slot');
    const allPunctuation = allSlots.flatMap((u) => (u.kind === 'slot' ? u.slot.punctuation : []));
    expect(allPunctuation).toHaveLength(0);
  });

  it('routes punctuation after the last token of a group into the following inter-group slot, not punctuationBetween', () => {
    // [A, B] (phrase group 1), punct, [C] (phrase group 2): after B (group 1's last token) the
    // intra-group gap must be closed so the punctuation goes to the inter-group slot, not an
    // out-of-bounds punctuationBetween index.
    const a = makeWordToken('tok-a');
    const b = makeWordToken('tok-b');
    const punct = makePunctToken('p1', ',');
    const c = makeWordToken('tok-c');
    const link1 = makePhraseLink('ph1', ['tok-a', 'tok-b']);
    const link2 = makePhraseLink('ph2', ['tok-c']);
    const groups = groupTokens(
      [a, b, punct, c],
      new Map([
        ['tok-a', link1],
        ['tok-b', link1],
        ['tok-c', link2],
      ]),
    );
    const units = buildRenderUnits([a, b, punct, c], groups);

    // The punctuation must appear in the inter-group slot between group 1 and group 2.
    const interGroupSlot = units.find(
      (u) => u.kind === 'slot' && u.slot.prevGroup === groups[0] && u.slot.nextGroup === groups[1],
    );
    expect(interGroupSlot?.kind).toBe('slot');
    if (interGroupSlot?.kind === 'slot') {
      expect(interGroupSlot.slot.punctuation.map((t) => t.ref)).toEqual(['p1']);
    }

    // The punctuation must NOT appear in group 1's punctuationBetween.
    expect(groups[0].punctuationBetween.flat()).toHaveLength(0);
  });
});
