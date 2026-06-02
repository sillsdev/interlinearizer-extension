/** @file Unit tests for utils/token-layout.ts. */
/// <reference types="jest" />

import type { Token } from 'interlinearizer';
import {
  resolveFocusContext,
  resolveSlotFocus,
  groupTokens,
  buildRenderUnits,
  NO_SLOT_FOCUS,
  type FocusContext,
} from '../../utils/token-layout';
import { makePhraseLink } from '../test-helpers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a word token fixture.
 *
 * @param ref - Token reference.
 * @param surfaceText - Surface text.
 * @returns A word token.
 */
function mkWord(ref: string, surfaceText = ref): Token & { type: 'word' } {
  return { ref, surfaceText, writingSystem: 'en', type: 'word', charStart: 0, charEnd: 1 };
}

/**
 * Creates a punctuation token fixture.
 *
 * @param ref - Token reference.
 * @param surfaceText - Surface text.
 * @returns A punctuation token.
 */
function mkPunct(ref: string, surfaceText = '.'): Token {
  return { ref, surfaceText, writingSystem: 'en', type: 'punctuation', charStart: 0, charEnd: 1 };
}

// ---------------------------------------------------------------------------
// resolveFocusContext
// ---------------------------------------------------------------------------

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
    const tok = mkWord('tok-a');
    const tokensByRef = new Map<string, Token>([['tok-a', tok]]);
    const ctx = resolveFocusContext('tok-a', tokensByRef, new Map(), new Map([['tok-a', 'seg-1']]));
    expect(ctx.focusedToken).toBe(tok);
    expect(ctx.focusedFreeToken).toBe(tok);
    expect(ctx.focusedPhraseLink).toBeUndefined();
    expect(ctx.focusedPhraseId).toBeUndefined();
    expect(ctx.focusedSegmentId).toBe('seg-1');
  });

  it('resolves a focused token that is inside a phrase', () => {
    const tok = mkWord('tok-a');
    const phraseLink = makePhraseLink('p1', ['tok-a', 'tok-b']);
    const tokensByRef = new Map<string, Token>([['tok-a', tok]]);
    const phraseLinkByRef = new Map([['tok-a', phraseLink]]);
    const ctx = resolveFocusContext('tok-a', tokensByRef, phraseLinkByRef, new Map());
    expect(ctx.focusedPhraseLink).toBe(phraseLink);
    expect(ctx.focusedPhraseId).toBe('p1');
    expect(ctx.focusedFreeToken).toBeUndefined();
  });

  it('resolves focusedToken as undefined when the token is not a word token', () => {
    const punct = mkPunct('tok-p');
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

// ---------------------------------------------------------------------------
// resolveSlotFocus
// ---------------------------------------------------------------------------

describe('resolveSlotFocus', () => {
  /**
   * Builds a focus context with the given segment id and optional phrase/free token; all other
   * fields default to undefined.
   *
   * @param focusedSegmentId - Segment id of the focused token, or `undefined`.
   * @param overrides - Optional `focusedPhraseLink` / `focusedFreeToken` overrides.
   * @returns A `FocusContext` for `resolveSlotFocus`.
   */
  function focusWithSegment(
    focusedSegmentId: string | undefined,
    overrides: Partial<FocusContext> = {},
  ): FocusContext {
    return {
      focusedToken: undefined,
      focusedPhraseLink: undefined,
      focusedFreeToken: undefined,
      focusedSegmentId,
      focusedPhraseId: undefined,
      ...overrides,
    };
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
    const freeToken = mkWord('tok-b');
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

// ---------------------------------------------------------------------------
// NO_SLOT_FOCUS
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// groupTokens
// ---------------------------------------------------------------------------

describe('groupTokens', () => {
  it('returns an empty array for an empty token list', () => {
    expect(groupTokens([], new Map())).toHaveLength(0);
  });

  it('skips non-word tokens', () => {
    const groups = groupTokens([mkPunct('p1')], new Map());
    expect(groups).toHaveLength(0);
  });

  it('creates one group per free word token', () => {
    const groups = groupTokens([mkWord('tok-a'), mkWord('tok-b')], new Map());
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
    const groups = groupTokens([mkWord('tok-a'), mkWord('tok-b')], phraseLinkByRef);
    expect(groups).toHaveLength(1);
    expect(groups[0].tokens).toHaveLength(2);
    expect(groups[0].phraseLink?.analysisId).toBe('p1');
  });

  it('produces two groups for a discontiguous phrase', () => {
    const link = makePhraseLink('p1', ['tok-a', 'tok-c']);
    const phraseLinkByRef = new Map([
      ['tok-a', link],
      ['tok-c', link],
    ]);
    // tok-b is free, breaking the phrase into two separate groups
    const groups = groupTokens(
      [mkWord('tok-a'), mkWord('tok-b'), mkWord('tok-c')],
      phraseLinkByRef,
    );
    expect(groups).toHaveLength(3);
    expect(groups[0].phraseLink?.analysisId).toBe('p1');
    expect(groups[1].phraseLink).toBeUndefined();
    expect(groups[2].phraseLink?.analysisId).toBe('p1');
  });

  it('records the correct firstIndex for each group', () => {
    const groups = groupTokens([mkPunct('p0'), mkWord('tok-a'), mkWord('tok-b')], new Map());
    // tok-a is at index 1, tok-b at index 2
    expect(groups[0].firstIndex).toBe(1);
    expect(groups[1].firstIndex).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// buildRenderUnits
// ---------------------------------------------------------------------------

describe('buildRenderUnits', () => {
  it('produces a leading and trailing slot when there is one group', () => {
    const tok = mkWord('tok-a');
    const group = { tokens: [tok], phraseLink: undefined, firstIndex: 0 };
    const units = buildRenderUnits([tok], [group]);
    // leading slot, group, trailing slot
    expect(units).toHaveLength(3);
    expect(units[0].kind).toBe('slot');
    expect(units[1].kind).toBe('group');
    expect(units[2].kind).toBe('slot');
  });

  it('puts punctuation in the slot between two groups', () => {
    const a = mkWord('tok-a');
    const punct = mkPunct('p1', ',');
    const b = mkWord('tok-b');
    const groups = [
      { tokens: [a], phraseLink: undefined, firstIndex: 0 },
      { tokens: [b], phraseLink: undefined, firstIndex: 2 },
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
});
