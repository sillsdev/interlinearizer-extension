/// <reference types="jest" />

import type {
  PhraseAnalysisLink,
  SegmentAnalysis,
  SegmentAnalysisLink,
  TextAnalysis,
  TokenAnalysis,
  TokenAnalysisLink,
  TokenSnapshot,
} from 'interlinearizer';
import { createAnalysisStore } from '../../store';
import {
  approveAnalysisForToken,
  createPhrase,
  deleteAnalysis,
  deleteMorphemes,
  deletePhrase,
  mergeAnalysisInto,
  mergePhrases,
  selectAnalysisDeletionOutcome,
  selectAnalysisMergePeers,
  selectApprovedGloss,
  selectApprovedMorphemes,
  selectCatalogRows,
  selectMorphemeResetLosesGlosses,
  selectPhraseLinkByTokenRef,
  selectPhraseGloss,
  selectPhraseLinks,
  selectPoolIndex,
  selectResolvedTokenAnalysis,
  selectSuggestionAfterClearing,
  selectSegmentFreeTranslation,
  updatePhrase,
  writeAnalysisGloss,
  writeAnalysisMorphemeGloss,
  writeAnalysisMorphemes,
  writeGloss,
  writeMorphemeGloss,
  writeMorphemes,
  writePhraseGloss,
  writeSegmentFreeTranslation,
  type AnalysisState,
} from '../../store/analysisSlice';
import { emptyAnalysis } from '../../types/empty-factories';
import { makePhraseLink, FIXTURE_STAMPS } from '../test-helpers';

/**
 * Builds an approved {@link TokenAnalysisLink} for `tok-1` pointing at the given
 * {@link TokenAnalysis}.
 */
function makeApprovedLink(ta: TokenAnalysis): TokenAnalysisLink {
  return {
    ...FIXTURE_STAMPS,
    analysisId: ta.id,
    status: 'approved',
    token: { tokenRef: 'tok-1', surfaceText: ta.surfaceText },
  };
}

/** Builds a minimal {@link TextAnalysis} with a single approved link for `tok-1`/`ta-1`. */
function makeAnalysis(ta: TokenAnalysis): TextAnalysis {
  return {
    ...emptyAnalysis(),
    tokenAnalyses: [ta],
    tokenAnalysisLinks: [makeApprovedLink(ta)],
  };
}

/**
 * Counts approved links on the same payload as `tokenRef`'s own approved link, used to assert
 * sharing without reaching into the link arrays at each call site.
 *
 * @returns The number of approved links on that token's payload, or 0 when it has no approved link.
 */
function approvedLinkCountForPayload(state: AnalysisState, tokenRef: string): number {
  const { tokenAnalysisLinks } = state.analysis;
  const own = tokenAnalysisLinks.find(
    (l) => l.status === 'approved' && l.token.tokenRef === tokenRef,
  );
  if (!own) return 0;
  return tokenAnalysisLinks.filter(
    (l) => l.status === 'approved' && l.analysisId === own.analysisId,
  ).length;
}

describe('writeGloss', () => {
  it('removes an orphaned approved link and creates a fresh one', () => {
    // Orphaned state: an approved link whose analysisId has no matching TokenAnalysis.
    const orphanLink: TokenAnalysisLink = {
      ...FIXTURE_STAMPS,
      analysisId: 'old-uuid',
      status: 'approved',
      token: { tokenRef: 'tok-1', surfaceText: 'word' },
    };
    const store = createAnalysisStore({
      analysis: {
        analysis: { ...emptyAnalysis(), tokenAnalysisLinks: [orphanLink] },
        analysisLanguage: 'und',
      },
    });

    store.dispatch(writeGloss('tok-1', 'word', 'hello'));

    const { tokenAnalysisLinks } = store.getState().analysis.analysis;
    expect(tokenAnalysisLinks).toHaveLength(1);
    expect(tokenAnalysisLinks[0].analysisId).not.toBe('old-uuid');
  });

  it('produces exactly one approved link after writing a gloss over an orphaned link', () => {
    const orphanLink: TokenAnalysisLink = {
      ...FIXTURE_STAMPS,
      analysisId: 'old-uuid',
      status: 'approved',
      token: { tokenRef: 'tok-1', surfaceText: 'word' },
    };
    const store = createAnalysisStore({
      analysis: {
        analysis: { ...emptyAnalysis(), tokenAnalysisLinks: [orphanLink] },
        analysisLanguage: 'und',
      },
    });

    store.dispatch(writeGloss('tok-1', 'word', 'hello'));

    const approved = store
      .getState()
      .analysis.analysis.tokenAnalysisLinks.filter(
        (l) => l.status === 'approved' && l.token.tokenRef === 'tok-1',
      );
    expect(approved).toHaveLength(1);
  });

  it('initializes gloss when the existing approved analysis has none', () => {
    // Seed an approved TokenAnalysis with no gloss field, then update it via writeGloss.
    const store = createAnalysisStore({
      analysis: {
        analysis: makeAnalysis({ ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'word' }),
        analysisLanguage: 'und',
      },
    });

    store.dispatch(writeGloss('tok-1', 'word', 'hello'));

    const { tokenAnalyses } = store.getState().analysis.analysis;
    expect(tokenAnalyses[0].gloss).toStrictEqual({ und: 'hello' });
  });

  it('refreshes the surface text on the analysis and the link snapshot when the token text changed', () => {
    const store = createAnalysisStore({
      analysis: {
        analysis: makeAnalysis({
          ...FIXTURE_STAMPS,
          id: 'ta-1',
          surfaceText: 'word',
          gloss: { und: 'hi' },
        }),
        analysisLanguage: 'und',
      },
    });

    store.dispatch(writeGloss('tok-1', 'words', 'hello'));

    const { tokenAnalyses, tokenAnalysisLinks } = store.getState().analysis.analysis;
    expect(tokenAnalyses[0].surfaceText).toBe('words');
    expect(tokenAnalysisLinks[0].token.surfaceText).toBe('words');
  });

  it('removes the record and link when a blank gloss empties a gloss-only analysis', () => {
    const store = createAnalysisStore({
      analysis: {
        analysis: makeAnalysis({
          ...FIXTURE_STAMPS,
          id: 'ta-1',
          surfaceText: 'word',
          gloss: { und: 'hi' },
        }),
        analysisLanguage: 'und',
      },
    });

    store.dispatch(writeGloss('tok-1', 'word', '   '));

    const { tokenAnalyses, tokenAnalysisLinks } = store.getState().analysis.analysis;
    expect(tokenAnalyses).toHaveLength(0);
    expect(tokenAnalysisLinks).toHaveLength(0);
  });

  it('clears the active-language gloss but keeps the record when other content remains', () => {
    const store = createAnalysisStore({
      analysis: {
        analysis: makeAnalysis({
          ...FIXTURE_STAMPS,
          id: 'ta-1',
          surfaceText: 'word',
          gloss: { und: 'hi' },
          morphemes: [{ id: 'm-1', form: 'word', writingSystem: 'und' }],
        }),
        analysisLanguage: 'und',
      },
    });

    store.dispatch(writeGloss('tok-1', 'word', ''));

    const { tokenAnalyses } = store.getState().analysis.analysis;
    expect(tokenAnalyses).toHaveLength(1);
    expect(tokenAnalyses[0].gloss).toBeUndefined();
    expect(tokenAnalyses[0].morphemes).toHaveLength(1);
  });

  it('clears only the active-language gloss when another language gloss remains', () => {
    const store = createAnalysisStore({
      analysis: {
        analysis: makeAnalysis({
          ...FIXTURE_STAMPS,
          id: 'ta-1',
          surfaceText: 'word',
          gloss: { und: 'hi', fr: 'bonjour' },
        }),
        analysisLanguage: 'und',
      },
    });

    store.dispatch(writeGloss('tok-1', 'word', ''));

    const { tokenAnalyses } = store.getState().analysis.analysis;
    expect(tokenAnalyses).toHaveLength(1);
    expect(tokenAnalyses[0].gloss).toStrictEqual({ fr: 'bonjour' });
  });

  it('is a no-op when a blank gloss is written to a token with no approved analysis', () => {
    const store = createAnalysisStore({
      analysis: { analysis: emptyAnalysis(), analysisLanguage: 'und' },
    });

    store.dispatch(writeGloss('tok-1', 'word', '  '));

    const { tokenAnalyses, tokenAnalysisLinks } = store.getState().analysis.analysis;
    expect(tokenAnalyses).toHaveLength(0);
    expect(tokenAnalysisLinks).toHaveLength(0);
  });

  it('edits one token of a shared payload without rewriting its co-linked sibling', () => {
    // tok-1 and tok-2 gloss 'the' identically, so they converge onto one shared payload. Editing
    // tok-1 to distinct content must fork it onto a private clone, leaving tok-2's gloss untouched.
    const store = createAnalysisStore();
    store.dispatch(writeGloss('tok-1', 'the', 'def'));
    store.dispatch(writeGloss('tok-2', 'the', 'def'));

    store.dispatch(writeGloss('tok-1', 'the', 'changed'));

    const state = store.getState().analysis;
    expect(selectApprovedGloss(state, 'tok-1')).toBe('changed');
    expect(selectApprovedGloss(state, 'tok-2')).toBe('def');
    // The shared payload forked, so there are now two distinct payloads.
    expect(state.analysis.tokenAnalyses).toHaveLength(2);
  });
});

describe('find-or-create on write (dedupe)', () => {
  it('converges two identical glosses onto one shared payload with two approved links', () => {
    const store = createAnalysisStore();

    store.dispatch(writeGloss('tok-1', 'the', 'def'));
    store.dispatch(writeGloss('tok-2', 'the', 'def'));

    const { tokenAnalyses, tokenAnalysisLinks } = store.getState().analysis.analysis;
    expect(tokenAnalyses).toHaveLength(1);
    expect(tokenAnalysisLinks).toHaveLength(2);
    expect(tokenAnalysisLinks.every((l) => l.analysisId === tokenAnalyses[0].id)).toBe(true);
  });

  it('keeps competing glosses for one surface form as distinct payloads (homograph)', () => {
    const store = createAnalysisStore();

    store.dispatch(writeGloss('tok-1', 'bank', 'riverside'));
    store.dispatch(writeGloss('tok-2', 'bank', 'finance'));

    const { tokenAnalyses, tokenAnalysisLinks } = store.getState().analysis.analysis;
    expect(tokenAnalyses).toHaveLength(2);
    expect(tokenAnalysisLinks).toHaveLength(2);
  });

  it('converges across surface case so a sentence-initial form reuses the payload', () => {
    const store = createAnalysisStore();

    store.dispatch(writeGloss('tok-1', 'the', 'def'));
    store.dispatch(writeGloss('tok-2', 'The', 'def'));

    expect(store.getState().analysis.analysis.tokenAnalyses).toHaveLength(1);
  });

  it('records the linking token surface on the shared snapshot, not the payload surface', () => {
    const store = createAnalysisStore();

    store.dispatch(writeGloss('tok-1', 'the', 'def'));
    store.dispatch(writeGloss('tok-2', 'The', 'def'));

    const link = store
      .getState()
      .analysis.analysis.tokenAnalysisLinks.find((l) => l.token.tokenRef === 'tok-2');
    expect(link?.token.surfaceText).toBe('The');
  });

  it('converges identical morpheme breakdowns onto one shared payload', () => {
    const store = createAnalysisStore();

    store.dispatch(writeMorphemes('tok-1', 'cats', ['cat', '-s'], 'en'));
    store.dispatch(writeMorphemes('tok-2', 'cats', ['cat', '-s'], 'en'));

    const { tokenAnalyses, tokenAnalysisLinks } = store.getState().analysis.analysis;
    expect(tokenAnalyses).toHaveLength(1);
    expect(tokenAnalysisLinks).toHaveLength(2);
  });

  it('re-converges an in-place edit that makes a homograph identical to its sibling', () => {
    const store = createAnalysisStore();
    store.dispatch(writeGloss('tok-1', 'bank', 'riverside'));
    store.dispatch(writeGloss('tok-2', 'bank', 'finance')); // distinct payload (homograph)

    // Edit tok-2's gloss to exactly match tok-1's existing payload.
    store.dispatch(writeGloss('tok-2', 'bank', 'riverside'));

    const { tokenAnalyses, tokenAnalysisLinks } = store.getState().analysis.analysis;
    // The two payloads re-converge onto one, so frequency re-merges rather than splitting.
    expect(tokenAnalyses).toHaveLength(1);
    expect(tokenAnalysisLinks).toHaveLength(2);
    expect(tokenAnalysisLinks.every((l) => l.analysisId === tokenAnalyses[0].id)).toBe(true);
    expect(approvedLinkCountForPayload(store.getState().analysis, 'tok-1')).toBe(2);
  });
});

describe('link-based cleanup', () => {
  it('clearing a gloss on a shared payload drops only the editing link, never orphaning others', () => {
    const store = createAnalysisStore();
    store.dispatch(writeGloss('tok-1', 'the', 'def'));
    store.dispatch(writeGloss('tok-2', 'the', 'def'));

    store.dispatch(writeGloss('tok-1', 'the', ''));

    const state = store.getState().analysis;
    const { tokenAnalyses, tokenAnalysisLinks } = state.analysis;
    // The editing token is unlinked; the co-linked token's link still resolves to a live payload.
    expect(tokenAnalysisLinks.some((l) => l.token.tokenRef === 'tok-1')).toBe(false);
    const tok2Link = tokenAnalysisLinks.find((l) => l.token.tokenRef === 'tok-2');
    expect(tok2Link).toBeDefined();
    expect(tokenAnalyses.some((ta) => ta.id === tok2Link?.analysisId)).toBe(true);
    // ...and that payload still carries the co-linked token's gloss — clearing one instance forks
    // it off rather than emptying the shared payload out from under the other token.
    expect(selectApprovedGloss(state, 'tok-2')).toBe('def');
    expect(selectApprovedGloss(state, 'tok-1')).toBe('');
  });

  it('removes the payload once its last link is cleared', () => {
    const store = createAnalysisStore();
    store.dispatch(writeGloss('tok-1', 'the', 'def'));
    store.dispatch(writeGloss('tok-2', 'the', 'def'));

    store.dispatch(writeGloss('tok-1', 'the', ''));
    store.dispatch(writeGloss('tok-2', 'the', ''));

    const { tokenAnalyses, tokenAnalysisLinks } = store.getState().analysis.analysis;
    expect(tokenAnalyses).toHaveLength(0);
    expect(tokenAnalysisLinks).toHaveLength(0);
  });

  it('deleting morphemes on a shared morpheme payload keeps it for co-linked tokens', () => {
    const store = createAnalysisStore();
    store.dispatch(writeMorphemes('tok-1', 'cats', ['cat', '-s'], 'en'));
    store.dispatch(writeMorphemes('tok-2', 'cats', ['cat', '-s'], 'en'));

    store.dispatch(deleteMorphemes({ tokenRef: 'tok-1' }));

    const state = store.getState().analysis;
    const { tokenAnalyses, tokenAnalysisLinks } = state.analysis;
    expect(tokenAnalysisLinks.some((l) => l.token.tokenRef === 'tok-1')).toBe(false);
    const tok2Link = tokenAnalysisLinks.find((l) => l.token.tokenRef === 'tok-2');
    expect(tokenAnalyses.some((ta) => ta.id === tok2Link?.analysisId)).toBe(true);
    // The co-linked token keeps its morphemes — deleting one instance's breakdown forks it off
    // rather than stripping the shared payload the other token still relies on.
    expect(selectApprovedMorphemes(state, 'tok-2')).toHaveLength(2);
    expect(selectApprovedMorphemes(state, 'tok-1')).toHaveLength(0);
  });
});

describe('selectApprovedGloss', () => {
  it('returns empty string when the approved analysis has no gloss for the language', () => {
    // Approved analysis exists but has no gloss entry for the requested language.
    const store = createAnalysisStore({
      analysis: {
        analysis: makeAnalysis({
          ...FIXTURE_STAMPS,
          id: 'ta-1',
          surfaceText: 'word',
          gloss: { fr: 'bonjour' },
        }),
        analysisLanguage: 'en',
      },
    });

    expect(selectApprovedGloss(store.getState().analysis, 'tok-1')).toBe('');
  });
});

/** Builds a {@link TextAnalysis} seeded with the given approved phrase link. */
function makeAnalysisWithPhrase(link: PhraseAnalysisLink): TextAnalysis {
  return {
    ...emptyAnalysis(),
    phraseAnalyses: [{ ...FIXTURE_STAMPS, id: link.analysisId, surfaceText: 'phrase' }],
    phraseAnalysisLinks: [link],
  };
}

describe('createPhrase', () => {
  it('appends a PhraseAnalysis and approved PhraseAnalysisLink', () => {
    const store = createAnalysisStore();
    const tokens: TokenSnapshot[] = [
      { tokenRef: 'tok-a', surfaceText: 'Hello' },
      { tokenRef: 'tok-b', surfaceText: 'World' },
    ];

    store.dispatch(createPhrase(tokens));

    const { phraseAnalyses, phraseAnalysisLinks } = store.getState().analysis.analysis;
    expect(phraseAnalyses).toHaveLength(1);
    expect(phraseAnalysisLinks).toHaveLength(1);
    expect(phraseAnalysisLinks[0].status).toBe('approved');
    expect(phraseAnalysisLinks[0].tokens).toStrictEqual(tokens);
    expect(phraseAnalyses[0].id).toBe(phraseAnalysisLinks[0].analysisId);
  });

  it('sets surfaceText to tokens joined by spaces', () => {
    const store = createAnalysisStore();
    const tokens: TokenSnapshot[] = [
      { tokenRef: 'tok-a', surfaceText: 'foo' },
      { tokenRef: 'tok-b', surfaceText: 'bar' },
    ];

    store.dispatch(createPhrase(tokens));

    expect(store.getState().analysis.analysis.phraseAnalyses[0].surfaceText).toBe('foo bar');
  });
});

describe('updatePhrase', () => {
  it('replaces the token list of the matching phrase link', () => {
    const existing = makePhraseLink('phrase-1', ['tok-a']);
    const store = createAnalysisStore({
      analysis: { analysis: makeAnalysisWithPhrase(existing), analysisLanguage: 'und' },
    });
    const newTokens: TokenSnapshot[] = [
      { tokenRef: 'tok-a', surfaceText: 'foo' },
      { tokenRef: 'tok-b', surfaceText: 'bar' },
    ];

    store.dispatch(updatePhrase({ phraseId: 'phrase-1', tokens: newTokens }));

    expect(store.getState().analysis.analysis.phraseAnalysisLinks[0].tokens).toStrictEqual(
      newTokens,
    );
  });

  it('re-derives surfaceText from the new tokens', () => {
    const existing = makePhraseLink('phrase-1', ['tok-a']);
    const store = createAnalysisStore({
      analysis: { analysis: makeAnalysisWithPhrase(existing), analysisLanguage: 'und' },
    });
    const newTokens: TokenSnapshot[] = [
      { tokenRef: 'tok-a', surfaceText: 'foo' },
      { tokenRef: 'tok-b', surfaceText: 'bar' },
    ];

    store.dispatch(updatePhrase({ phraseId: 'phrase-1', tokens: newTokens }));

    expect(store.getState().analysis.analysis.phraseAnalyses[0].surfaceText).toBe('foo bar');
  });

  it('preserves the phrase analysis id when tokens is non-empty', () => {
    const existing = makePhraseLink('phrase-1', ['tok-a', 'tok-b']);
    const store = createAnalysisStore({
      analysis: { analysis: makeAnalysisWithPhrase(existing), analysisLanguage: 'und' },
    });

    store.dispatch(
      updatePhrase({ phraseId: 'phrase-1', tokens: [{ tokenRef: 'tok-a', surfaceText: 'Hello' }] }),
    );

    expect(store.getState().analysis.analysis.phraseAnalysisLinks[0].analysisId).toBe('phrase-1');
  });

  it('removes the phrase entirely when tokens becomes empty', () => {
    const existing = makePhraseLink('phrase-1', ['tok-a']);
    const store = createAnalysisStore({
      analysis: { analysis: makeAnalysisWithPhrase(existing), analysisLanguage: 'und' },
    });

    store.dispatch(updatePhrase({ phraseId: 'phrase-1', tokens: [] }));

    const { phraseAnalyses, phraseAnalysisLinks } = store.getState().analysis.analysis;
    expect(phraseAnalyses).toHaveLength(0);
    expect(phraseAnalysisLinks).toHaveLength(0);
  });

  it('does nothing when the phraseId does not match any link', () => {
    const existing = makePhraseLink('phrase-1', ['tok-a']);
    const store = createAnalysisStore({
      analysis: { analysis: makeAnalysisWithPhrase(existing), analysisLanguage: 'und' },
    });
    const before = store.getState().analysis.analysis.phraseAnalysisLinks[0].tokens;

    store.dispatch(updatePhrase({ phraseId: 'nonexistent', tokens: [] }));

    expect(store.getState().analysis.analysis.phraseAnalysisLinks[0].tokens).toStrictEqual(before);
  });
});

describe('deletePhrase', () => {
  it('removes both the PhraseAnalysis and its PhraseAnalysisLink', () => {
    const existing = makePhraseLink('phrase-1', ['tok-a']);
    const store = createAnalysisStore({
      analysis: { analysis: makeAnalysisWithPhrase(existing), analysisLanguage: 'und' },
    });

    store.dispatch(deletePhrase({ phraseId: 'phrase-1' }));

    const { phraseAnalyses, phraseAnalysisLinks } = store.getState().analysis.analysis;
    expect(phraseAnalyses).toHaveLength(0);
    expect(phraseAnalysisLinks).toHaveLength(0);
  });

  it('leaves other phrases intact when deleting one', () => {
    const link1 = makePhraseLink('phrase-1', ['tok-a']);
    const link2 = makePhraseLink('phrase-2', ['tok-b']);
    const store = createAnalysisStore({
      analysis: {
        analysis: {
          ...emptyAnalysis(),
          phraseAnalyses: [
            { ...FIXTURE_STAMPS, id: 'phrase-1', surfaceText: 'A' },
            { ...FIXTURE_STAMPS, id: 'phrase-2', surfaceText: 'B' },
          ],
          phraseAnalysisLinks: [link1, link2],
        },
        analysisLanguage: 'und',
      },
    });

    store.dispatch(deletePhrase({ phraseId: 'phrase-1' }));

    const { phraseAnalyses, phraseAnalysisLinks } = store.getState().analysis.analysis;
    expect(phraseAnalyses).toHaveLength(1);
    expect(phraseAnalyses[0].id).toBe('phrase-2');
    expect(phraseAnalysisLinks).toHaveLength(1);
    expect(phraseAnalysisLinks[0].analysisId).toBe('phrase-2');
  });
});

describe('mergePhrases', () => {
  it('replaces the target tokens, re-derives surfaceText, and deletes the absorbed phrase', () => {
    const target = makePhraseLink('phrase-1', ['tok-a']);
    const absorbed = makePhraseLink('phrase-2', ['tok-b']);
    const store = createAnalysisStore({
      analysis: {
        analysis: {
          ...emptyAnalysis(),
          phraseAnalyses: [
            { ...FIXTURE_STAMPS, id: 'phrase-1', surfaceText: 'A' },
            { ...FIXTURE_STAMPS, id: 'phrase-2', surfaceText: 'B' },
          ],
          phraseAnalysisLinks: [target, absorbed],
        },
        analysisLanguage: 'und',
      },
    });

    const mergedTokens: TokenSnapshot[] = [
      { tokenRef: 'tok-a', surfaceText: 'A' },
      { tokenRef: 'tok-b', surfaceText: 'B' },
    ];
    store.dispatch(
      mergePhrases({
        targetPhraseId: 'phrase-1',
        tokens: mergedTokens,
        absorbedPhraseId: 'phrase-2',
      }),
    );

    const { phraseAnalyses, phraseAnalysisLinks } = store.getState().analysis.analysis;
    expect(phraseAnalyses).toHaveLength(1);
    expect(phraseAnalyses[0].id).toBe('phrase-1');
    expect(phraseAnalyses[0].surfaceText).toBe('A B');
    expect(phraseAnalysisLinks).toHaveLength(1);
    expect(phraseAnalysisLinks[0].analysisId).toBe('phrase-1');
    expect(phraseAnalysisLinks[0].tokens).toStrictEqual(mergedTokens);
  });

  it('grows the target without deleting anything when absorbedPhraseId is undefined', () => {
    const target = makePhraseLink('phrase-1', ['tok-a']);
    const store = createAnalysisStore({
      analysis: { analysis: makeAnalysisWithPhrase(target), analysisLanguage: 'und' },
    });

    const mergedTokens: TokenSnapshot[] = [
      { tokenRef: 'tok-a', surfaceText: 'A' },
      { tokenRef: 'tok-b', surfaceText: 'B' },
    ];
    store.dispatch(
      mergePhrases({
        targetPhraseId: 'phrase-1',
        tokens: mergedTokens,
        absorbedPhraseId: undefined,
      }),
    );

    const { phraseAnalyses, phraseAnalysisLinks } = store.getState().analysis.analysis;
    expect(phraseAnalyses).toHaveLength(1);
    expect(phraseAnalyses[0].surfaceText).toBe('A B');
    expect(phraseAnalysisLinks[0].tokens).toStrictEqual(mergedTokens);
  });

  it('no-ops entirely when absorbedPhraseId equals targetPhraseId', () => {
    const phrase = makePhraseLink('phrase-1', ['tok-a']);
    const store = createAnalysisStore({
      analysis: {
        analysis: {
          ...emptyAnalysis(),
          phraseAnalyses: [{ ...FIXTURE_STAMPS, id: 'phrase-1', surfaceText: 'A' }],
          phraseAnalysisLinks: [phrase],
        },
        analysisLanguage: 'und',
      },
    });

    store.dispatch(
      mergePhrases({
        targetPhraseId: 'phrase-1',
        tokens: [
          { tokenRef: 'tok-a', surfaceText: 'A' },
          { tokenRef: 'tok-b', surfaceText: 'B' },
        ],
        absorbedPhraseId: 'phrase-1',
      }),
    );

    const { phraseAnalyses, phraseAnalysisLinks } = store.getState().analysis.analysis;
    expect(phraseAnalyses).toHaveLength(1);
    expect(phraseAnalyses[0].surfaceText).toBe('A');
    expect(phraseAnalysisLinks).toHaveLength(1);
    expect(phraseAnalysisLinks[0].tokens).toHaveLength(1);
  });

  it('no-ops on the target updates when the target phrase id is not found', () => {
    const absorbed = makePhraseLink('phrase-2', ['tok-b']);
    const store = createAnalysisStore({
      analysis: { analysis: makeAnalysisWithPhrase(absorbed), analysisLanguage: 'und' },
    });

    store.dispatch(
      mergePhrases({
        targetPhraseId: 'missing',
        tokens: [{ tokenRef: 'tok-b', surfaceText: 'B' }],
        absorbedPhraseId: 'phrase-2',
      }),
    );

    // The absorbed phrase is still removed; the missing target simply has no link/analysis to grow.
    const { phraseAnalyses, phraseAnalysisLinks } = store.getState().analysis.analysis;
    expect(phraseAnalyses).toHaveLength(0);
    expect(phraseAnalysisLinks).toHaveLength(0);
  });
});

describe('selectPhraseLinks', () => {
  it('returns only approved phrase links', () => {
    const approved = makePhraseLink('phrase-1', ['tok-a']);
    const suggested: PhraseAnalysisLink = {
      ...makePhraseLink('phrase-2', ['tok-b']),
      status: 'suggested',
    };
    const analysis: TextAnalysis = {
      ...emptyAnalysis(),
      phraseAnalyses: [
        { ...FIXTURE_STAMPS, id: 'phrase-1', surfaceText: 'A' },
        { ...FIXTURE_STAMPS, id: 'phrase-2', surfaceText: 'B' },
      ],
      phraseAnalysisLinks: [approved, suggested],
    };
    const store = createAnalysisStore({ analysis: { analysis, analysisLanguage: 'und' } });

    const result = selectPhraseLinks(store.getState().analysis);

    expect(result).toHaveLength(1);
    expect(result[0].analysisId).toBe('phrase-1');
  });
});

describe('selectPhraseLinkByTokenRef', () => {
  it('maps each tokenRef to its approved phrase link', () => {
    const link = makePhraseLink('phrase-1', ['tok-a', 'tok-b']);
    const store = createAnalysisStore({
      analysis: { analysis: makeAnalysisWithPhrase(link), analysisLanguage: 'und' },
    });

    const map = selectPhraseLinkByTokenRef(store.getState().analysis);

    expect(map.get('tok-a')?.analysisId).toBe('phrase-1');
    expect(map.get('tok-b')?.analysisId).toBe('phrase-1');
  });

  it('returns an empty map when no approved phrase links exist', () => {
    const store = createAnalysisStore();

    const map = selectPhraseLinkByTokenRef(store.getState().analysis);

    expect(map.size).toBe(0);
  });
});

describe('writePhraseGloss', () => {
  it('writes the gloss for the active language on a phrase', () => {
    const link = makePhraseLink('phrase-1', ['tok-a']);
    const store = createAnalysisStore({
      analysis: { analysis: makeAnalysisWithPhrase(link), analysisLanguage: 'und' },
    });

    store.dispatch(writePhraseGloss({ phraseId: 'phrase-1', value: 'beginning' }));

    const pa = store.getState().analysis.analysis.phraseAnalyses[0];
    expect(pa.gloss).toStrictEqual({ und: 'beginning' });
  });

  it('no-ops when the phrase id is not found', () => {
    const store = createAnalysisStore();

    store.dispatch(writePhraseGloss({ phraseId: 'nonexistent', value: 'hi' }));

    expect(store.getState().analysis.analysis.phraseAnalyses).toHaveLength(0);
  });
});

describe('selectPhraseGloss', () => {
  it('returns the gloss string for a phrase in the active language', () => {
    const link = makePhraseLink('phrase-1', ['tok-a']);
    const store = createAnalysisStore({
      analysis: { analysis: makeAnalysisWithPhrase(link), analysisLanguage: 'und' },
    });
    store.dispatch(writePhraseGloss({ phraseId: 'phrase-1', value: 'beginning' }));

    const gloss = selectPhraseGloss(store.getState().analysis, 'phrase-1');

    expect(gloss).toBe('beginning');
  });

  it('returns empty string when the phrase has no gloss in the active language', () => {
    const link = makePhraseLink('phrase-1', ['tok-a']);
    const store = createAnalysisStore({
      analysis: { analysis: makeAnalysisWithPhrase(link), analysisLanguage: 'und' },
    });

    expect(selectPhraseGloss(store.getState().analysis, 'phrase-1')).toBe('');
  });

  it('returns empty string when the phrase id is not found', () => {
    const store = createAnalysisStore();
    expect(selectPhraseGloss(store.getState().analysis, 'nonexistent')).toBe('');
  });
});

/**
 * Builds a {@link TextAnalysis} seeded with a single segment analysis for `seg-1`.
 *
 * @param analysis - The lone entry in `segmentAnalyses`.
 * @param link - Joining link to use instead of the default, which approves `analysis` for `seg-1`.
 */
function makeAnalysisWithSegment(
  analysis: SegmentAnalysis,
  link?: SegmentAnalysisLink,
): TextAnalysis {
  return {
    ...emptyAnalysis(),
    segmentAnalyses: [analysis],
    segmentAnalysisLinks: [
      link ?? {
        ...FIXTURE_STAMPS,
        analysisId: analysis.id,
        status: 'approved',
        segmentId: 'seg-1',
      },
    ],
  };
}

describe('writeSegmentFreeTranslation', () => {
  it('creates a new approved segment analysis and link when none exists', () => {
    const store = createAnalysisStore();

    store.dispatch(writeSegmentFreeTranslation('seg-1', 'In the beginning', 'au commencement'));

    const { segmentAnalyses, segmentAnalysisLinks } = store.getState().analysis.analysis;
    expect(segmentAnalyses).toHaveLength(1);
    expect(segmentAnalyses[0]).toMatchObject({
      surfaceText: 'In the beginning',
      freeTranslation: { und: 'au commencement' },
    });
    expect(segmentAnalysisLinks).toEqual([
      {
        analysisId: segmentAnalyses[0].id,
        createdAt: segmentAnalyses[0].createdAt,
        updatedAt: segmentAnalyses[0].updatedAt,
        status: 'approved',
        segmentId: 'seg-1',
      },
    ]);
  });

  it('no-ops on a blank write when the segment has no approved analysis', () => {
    const store = createAnalysisStore();

    store.dispatch(writeSegmentFreeTranslation('seg-1', 'In the beginning', '   '));

    expect(store.getState().analysis.analysis.segmentAnalyses).toHaveLength(0);
    expect(store.getState().analysis.analysis.segmentAnalysisLinks).toHaveLength(0);
  });

  it('updates an existing analysis in place and refreshes the surface text', () => {
    const seeded = makeAnalysisWithSegment({
      ...FIXTURE_STAMPS,
      id: 'sa-1',
      surfaceText: 'old surface',
      freeTranslation: { und: 'old' },
    });
    const store = createAnalysisStore({ analysis: { analysis: seeded, analysisLanguage: 'und' } });

    store.dispatch(writeSegmentFreeTranslation('seg-1', 'new surface', 'new'));

    const { segmentAnalyses } = store.getState().analysis.analysis;
    expect(segmentAnalyses).toHaveLength(1);
    expect(segmentAnalyses[0]).toMatchObject({
      id: 'sa-1',
      surfaceText: 'new surface',
      freeTranslation: { und: 'new' },
    });
  });

  it('initializes the free translation on an existing analysis that has none', () => {
    const seeded = makeAnalysisWithSegment({
      ...FIXTURE_STAMPS,
      id: 'sa-1',
      surfaceText: 'surface',
      literalTranslation: { und: 'word for word' },
    });
    const store = createAnalysisStore({ analysis: { analysis: seeded, analysisLanguage: 'und' } });

    store.dispatch(writeSegmentFreeTranslation('seg-1', 'surface', 'idiomatic'));

    const sa = store.getState().analysis.analysis.segmentAnalyses[0];
    expect(sa.freeTranslation).toStrictEqual({ und: 'idiomatic' });
    expect(sa.literalTranslation).toStrictEqual({ und: 'word for word' });
  });

  it('removes the record and its link when a blank write empties the analysis', () => {
    const seeded = makeAnalysisWithSegment({
      ...FIXTURE_STAMPS,
      id: 'sa-1',
      surfaceText: 'surface',
      freeTranslation: { und: 'value' },
    });
    const store = createAnalysisStore({ analysis: { analysis: seeded, analysisLanguage: 'und' } });

    store.dispatch(writeSegmentFreeTranslation('seg-1', 'surface', ''));

    expect(store.getState().analysis.analysis.segmentAnalyses).toHaveLength(0);
    expect(store.getState().analysis.analysis.segmentAnalysisLinks).toHaveLength(0);
  });

  it('keeps the record when another language still has a free translation', () => {
    const seeded = makeAnalysisWithSegment({
      ...FIXTURE_STAMPS,
      id: 'sa-1',
      surfaceText: 'surface',
      freeTranslation: { und: 'value', fr: 'valeur' },
    });
    const store = createAnalysisStore({ analysis: { analysis: seeded, analysisLanguage: 'und' } });

    store.dispatch(writeSegmentFreeTranslation('seg-1', 'surface', ''));

    expect(store.getState().analysis.analysis.segmentAnalyses[0].freeTranslation).toStrictEqual({
      fr: 'valeur',
    });
  });

  it('keeps the record when a literal translation remains after clearing the free translation', () => {
    const seeded = makeAnalysisWithSegment({
      ...FIXTURE_STAMPS,
      id: 'sa-1',
      surfaceText: 'surface',
      freeTranslation: { und: 'value' },
      literalTranslation: { und: 'word for word' },
    });
    const store = createAnalysisStore({ analysis: { analysis: seeded, analysisLanguage: 'und' } });

    store.dispatch(writeSegmentFreeTranslation('seg-1', 'surface', ''));

    const { segmentAnalyses } = store.getState().analysis.analysis;
    expect(segmentAnalyses).toHaveLength(1);
    expect(segmentAnalyses[0].freeTranslation).toBeUndefined();
    expect(segmentAnalyses[0].literalTranslation).toStrictEqual({ und: 'word for word' });
  });

  it('treats whitespace-only entries in other languages as empty and removes the record', () => {
    const seeded = makeAnalysisWithSegment({
      ...FIXTURE_STAMPS,
      id: 'sa-1',
      surfaceText: 'surface',
      freeTranslation: { und: '   ', fr: 'valeur' },
    });
    const store = createAnalysisStore({ analysis: { analysis: seeded, analysisLanguage: 'fr' } });

    store.dispatch(writeSegmentFreeTranslation('seg-1', 'surface', ''));

    expect(store.getState().analysis.analysis.segmentAnalyses).toHaveLength(0);
    expect(store.getState().analysis.analysis.segmentAnalysisLinks).toHaveLength(0);
  });

  it('repairs an orphaned approved link and creates a fresh analysis', () => {
    const orphanLink: SegmentAnalysisLink = {
      ...FIXTURE_STAMPS,
      analysisId: 'old-uuid',
      status: 'approved',
      segmentId: 'seg-1',
    };
    const store = createAnalysisStore({
      analysis: {
        analysis: { ...emptyAnalysis(), segmentAnalysisLinks: [orphanLink] },
        analysisLanguage: 'und',
      },
    });

    store.dispatch(writeSegmentFreeTranslation('seg-1', 'surface', 'fresh'));

    const { segmentAnalyses, segmentAnalysisLinks } = store.getState().analysis.analysis;
    expect(segmentAnalyses).toHaveLength(1);
    expect(segmentAnalysisLinks).toHaveLength(1);
    expect(segmentAnalysisLinks[0].analysisId).not.toBe('old-uuid');
    expect(segmentAnalysisLinks[0].analysisId).toBe(segmentAnalyses[0].id);
  });
});

describe('selectSegmentFreeTranslation', () => {
  it('returns the free translation for the active language', () => {
    const seeded = makeAnalysisWithSegment({
      ...FIXTURE_STAMPS,
      id: 'sa-1',
      surfaceText: 'surface',
      freeTranslation: { und: 'value' },
    });
    const store = createAnalysisStore({ analysis: { analysis: seeded, analysisLanguage: 'und' } });

    expect(selectSegmentFreeTranslation(store.getState().analysis, 'seg-1')).toBe('value');
  });

  it('returns empty string when the segment has no approved link', () => {
    const store = createAnalysisStore();
    expect(selectSegmentFreeTranslation(store.getState().analysis, 'seg-1')).toBe('');
  });

  it('returns empty string when the approved link references a missing analysis', () => {
    const store = createAnalysisStore({
      analysis: {
        analysis: {
          ...emptyAnalysis(),
          segmentAnalysisLinks: [
            { ...FIXTURE_STAMPS, analysisId: 'gone', status: 'approved', segmentId: 'seg-1' },
          ],
        },
        analysisLanguage: 'und',
      },
    });

    expect(selectSegmentFreeTranslation(store.getState().analysis, 'seg-1')).toBe('');
  });

  it('returns empty string when the analysis has no free translation for the active language', () => {
    const seeded = makeAnalysisWithSegment({
      ...FIXTURE_STAMPS,
      id: 'sa-1',
      surfaceText: 'surface',
    });
    const store = createAnalysisStore({ analysis: { analysis: seeded, analysisLanguage: 'und' } });

    expect(selectSegmentFreeTranslation(store.getState().analysis, 'seg-1')).toBe('');
  });
});

describe('writeMorphemes', () => {
  it('creates a new approved analysis with morphemes when none exists', () => {
    const store = createAnalysisStore();
    store.dispatch(writeMorphemes('tok-1', 'unbelievable', ['un-', 'believe', '-able'], 'und'));

    const { tokenAnalyses, tokenAnalysisLinks } = store.getState().analysis.analysis;
    expect(tokenAnalysisLinks).toHaveLength(1);
    expect(tokenAnalysisLinks[0].status).toBe('approved');
    expect(tokenAnalysisLinks[0].token.tokenRef).toBe('tok-1');

    const ta = tokenAnalyses.find((a) => a.id === tokenAnalysisLinks[0].analysisId);
    expect(ta).toBeDefined();
    expect(ta?.morphemes).toHaveLength(3);
    expect(ta?.morphemes?.[0].form).toBe('un-');
    expect(ta?.morphemes?.[1].form).toBe('believe');
    expect(ta?.morphemes?.[2].form).toBe('-able');
  });

  it('updates morphemes on an existing approved analysis, preserving glosses by form', () => {
    const ta: TokenAnalysis = {
      ...FIXTURE_STAMPS,
      id: 'ta-1',
      surfaceText: 'unbelievable',
      morphemes: [
        { id: 'm-1', form: 'un-', writingSystem: 'und', gloss: { und: 'not' } },
        { id: 'm-2', form: 'believe', writingSystem: 'und', gloss: { und: 'trust' } },
        { id: 'm-3', form: '-able', writingSystem: 'und' },
      ],
    };
    const store = createAnalysisStore({
      analysis: { analysis: makeAnalysis(ta), analysisLanguage: 'und' },
    });

    store.dispatch(writeMorphemes('tok-1', 'unbelievable', ['un-', 'believ', '-able'], 'und'));

    const updated = store
      .getState()
      .analysis.analysis.tokenAnalyses.find(
        (a) =>
          a.id ===
          store
            .getState()
            .analysis.analysis.tokenAnalysisLinks.find(
              (l) => l.status === 'approved' && l.token.tokenRef === 'tok-1',
            )?.analysisId,
      );
    expect(updated?.morphemes).toHaveLength(3);
    expect(updated?.morphemes?.[0].gloss).toStrictEqual({ und: 'not' });
    expect(updated?.morphemes?.[1].gloss).toBeUndefined();
    expect(updated?.morphemes?.[2].form).toBe('-able');
  });

  it('preserves distinct glosses on duplicate morpheme forms in order (reduplication)', () => {
    const ta: TokenAnalysis = {
      ...FIXTURE_STAMPS,
      id: 'ta-1',
      surfaceText: 'baba',
      morphemes: [
        { id: 'm-1', form: 'ba', writingSystem: 'und', gloss: { und: 'first' } },
        { id: 'm-2', form: 'ba', writingSystem: 'und', gloss: { und: 'second' } },
      ],
    };
    const store = createAnalysisStore({
      analysis: { analysis: makeAnalysis(ta), analysisLanguage: 'und' },
    });

    store.dispatch(writeMorphemes('tok-1', 'baba', ['ba', 'ba'], 'und'));

    const updated = store.getState().analysis.analysis.tokenAnalyses.find((a) => a.id === 'ta-1');
    expect(updated?.morphemes?.[0].gloss).toStrictEqual({ und: 'first' });
    expect(updated?.morphemes?.[1].gloss).toStrictEqual({ und: 'second' });
  });

  it('re-converges an in-place breakdown edit that makes a payload identical to a sibling', () => {
    // Two 'run' tokens with different breakdowns → two distinct payloads. Re-segment tok-2 to match
    // tok-1's single-morpheme breakdown; the payloads should collapse back onto one.
    const single: TokenAnalysis = {
      ...FIXTURE_STAMPS,
      id: 'ta-1',
      surfaceText: 'run',
      morphemes: [{ id: 'm-1', form: 'run', writingSystem: 'und' }],
    };
    const split: TokenAnalysis = {
      ...FIXTURE_STAMPS,
      id: 'ta-2',
      surfaceText: 'run',
      morphemes: [
        { id: 'm-2', form: 'ru', writingSystem: 'und' },
        { id: 'm-3', form: 'n', writingSystem: 'und' },
      ],
    };
    const store = createAnalysisStore({
      analysis: {
        analysis: {
          ...emptyAnalysis(),
          tokenAnalyses: [single, split],
          tokenAnalysisLinks: [
            {
              ...FIXTURE_STAMPS,
              analysisId: 'ta-1',
              status: 'approved',
              token: { tokenRef: 'tok-1', surfaceText: 'run' },
            },
            {
              ...FIXTURE_STAMPS,
              analysisId: 'ta-2',
              status: 'approved',
              token: { tokenRef: 'tok-2', surfaceText: 'run' },
            },
          ],
        },
        analysisLanguage: 'und',
      },
    });

    store.dispatch(writeMorphemes('tok-2', 'run', ['run'], 'und'));

    const { tokenAnalyses, tokenAnalysisLinks } = store.getState().analysis.analysis;
    expect(tokenAnalyses).toHaveLength(1);
    expect(tokenAnalysisLinks.every((l) => l.analysisId === tokenAnalyses[0].id)).toBe(true);
  });

  it('removes an orphaned approved link and creates a fresh analysis', () => {
    const orphanLink: TokenAnalysisLink = {
      ...FIXTURE_STAMPS,
      analysisId: 'old-uuid',
      status: 'approved',
      token: { tokenRef: 'tok-1', surfaceText: 'word' },
    };
    const store = createAnalysisStore({
      analysis: {
        analysis: { ...emptyAnalysis(), tokenAnalysisLinks: [orphanLink] },
        analysisLanguage: 'und',
      },
    });

    store.dispatch(writeMorphemes('tok-1', 'word', ['wor', '-d'], 'und'));

    const { tokenAnalyses, tokenAnalysisLinks } = store.getState().analysis.analysis;
    expect(tokenAnalysisLinks).toHaveLength(1);
    expect(tokenAnalysisLinks[0].analysisId).not.toBe('old-uuid');

    const ta = tokenAnalyses.find((a) => a.id === tokenAnalysisLinks[0].analysisId);
    expect(ta?.morphemes).toHaveLength(2);
  });

  it('refreshes the surface text on the analysis and the link snapshot when the token text changed', () => {
    const ta: TokenAnalysis = {
      ...FIXTURE_STAMPS,
      id: 'ta-1',
      surfaceText: 'word',
      morphemes: [{ id: 'm-1', form: 'word', writingSystem: 'und' }],
    };
    const store = createAnalysisStore({
      analysis: { analysis: makeAnalysis(ta), analysisLanguage: 'und' },
    });

    store.dispatch(writeMorphemes('tok-1', 'words', ['word', '-s'], 'und'));

    const { tokenAnalyses, tokenAnalysisLinks } = store.getState().analysis.analysis;
    expect(tokenAnalyses.find((a) => a.id === 'ta-1')?.surfaceText).toBe('words');
    expect(tokenAnalysisLinks[0].token.surfaceText).toBe('words');
  });

  it('adds morphemes to an existing approved analysis that has no morphemes', () => {
    const ta: TokenAnalysis = { ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'hello' };
    const store = createAnalysisStore({
      analysis: { analysis: makeAnalysis(ta), analysisLanguage: 'und' },
    });

    store.dispatch(writeMorphemes('tok-1', 'hello', ['hel', '-lo'], 'und'));

    const updated = store.getState().analysis.analysis.tokenAnalyses.find((a) => a.id === 'ta-1');
    expect(updated?.morphemes).toHaveLength(2);
    expect(updated?.morphemes?.[0].form).toBe('hel');
  });

  it('preserves morpheme ids when forms are unchanged', () => {
    const ta: TokenAnalysis = {
      ...FIXTURE_STAMPS,
      id: 'ta-1',
      surfaceText: 'unbelievable',
      morphemes: [
        { id: 'm-1', form: 'un-', writingSystem: 'und' },
        { id: 'm-2', form: 'believe', writingSystem: 'und' },
      ],
    };
    const store = createAnalysisStore({
      analysis: { analysis: makeAnalysis(ta), analysisLanguage: 'und' },
    });

    store.dispatch(writeMorphemes('tok-1', 'unbelievable', ['un-', 'believe', '-able'], 'und'));

    // MorphemeLink.morphemeId cross-references these ids, so editing the breakdown must not
    // regenerate the ids of morphemes whose form did not change.
    const updated = store.getState().analysis.analysis.tokenAnalyses.find((a) => a.id === 'ta-1');
    expect(updated?.morphemes?.[0].id).toBe('m-1');
    expect(updated?.morphemes?.[1].id).toBe('m-2');
  });

  it('assigns a fresh id to a newly added morpheme alongside preserved ones', () => {
    const ta: TokenAnalysis = {
      ...FIXTURE_STAMPS,
      id: 'ta-1',
      surfaceText: 'unbelievable',
      morphemes: [
        { id: 'm-1', form: 'un-', writingSystem: 'und' },
        { id: 'm-2', form: 'believe', writingSystem: 'und' },
      ],
    };
    const store = createAnalysisStore({
      analysis: { analysis: makeAnalysis(ta), analysisLanguage: 'und' },
    });

    store.dispatch(writeMorphemes('tok-1', 'unbelievable', ['un-', 'believe', '-able'], 'und'));

    const updated = store.getState().analysis.analysis.tokenAnalyses.find((a) => a.id === 'ta-1');
    const newId = updated?.morphemes?.[2].id;
    expect(newId).toBeDefined();
    expect(newId).not.toBe('m-1');
    expect(newId).not.toBe('m-2');
  });

  it('assigns unique ids to each morpheme via prepare', () => {
    const store = createAnalysisStore();
    store.dispatch(writeMorphemes('tok-1', 'abc', ['a', 'b', 'c'], 'und'));

    const ta = store.getState().analysis.analysis.tokenAnalyses[0];
    const ids = ta.morphemes?.map((m) => m.id);
    expect(new Set(ids).size).toBe(3);
  });

  it('stores the passed writing system on new morphemes, not the analysis language', () => {
    const store = createAnalysisStore({
      analysis: { analysis: emptyAnalysis(), analysisLanguage: 'en' },
    });
    store.dispatch(writeMorphemes('tok-1', 'λόγος', ['λόγ', '-ος'], 'grc'));

    const ta = store.getState().analysis.analysis.tokenAnalyses[0];
    expect(ta.morphemes?.map((m) => m.writingSystem)).toStrictEqual(['grc', 'grc']);
  });

  it('refreshes the writing system on preserved morphemes whose form is unchanged', () => {
    const ta: TokenAnalysis = {
      ...FIXTURE_STAMPS,
      id: 'ta-1',
      surfaceText: 'λόγος',
      morphemes: [{ id: 'm-1', form: 'λόγ', writingSystem: 'en', gloss: { en: 'word' } }],
    };
    const store = createAnalysisStore({
      analysis: { analysis: makeAnalysis(ta), analysisLanguage: 'en' },
    });

    store.dispatch(writeMorphemes('tok-1', 'λόγος', ['λόγ', '-ος'], 'grc'));

    const updated = store.getState().analysis.analysis.tokenAnalyses.find((a) => a.id === 'ta-1');
    expect(updated?.morphemes?.[0].gloss).toStrictEqual({ en: 'word' });
    expect(updated?.morphemes?.[0].writingSystem).toBe('grc');
  });

  it('re-segments one token of a shared payload without rewriting its co-linked sibling', () => {
    // tok-1 and tok-2 break 'cats' down identically, so they converge onto one shared payload.
    // Re-segmenting tok-1 to a distinct breakdown must fork it, leaving tok-2's breakdown intact.
    const store = createAnalysisStore();
    store.dispatch(writeMorphemes('tok-1', 'cats', ['cat', '-s'], 'en'));
    store.dispatch(writeMorphemes('tok-2', 'cats', ['cat', '-s'], 'en'));

    store.dispatch(writeMorphemes('tok-1', 'cats', ['ca', 'ts'], 'en'));

    const state = store.getState().analysis;
    expect(selectApprovedMorphemes(state, 'tok-1').map((m) => m.form)).toStrictEqual(['ca', 'ts']);
    expect(selectApprovedMorphemes(state, 'tok-2').map((m) => m.form)).toStrictEqual(['cat', '-s']);
    // The shared payload forked, so there are now two distinct payloads.
    expect(state.analysis.tokenAnalyses).toHaveLength(2);
  });
});

describe('deleteMorphemes', () => {
  it('removes the morphemes but keeps the analysis when it has a gloss', () => {
    const ta: TokenAnalysis = {
      ...FIXTURE_STAMPS,
      id: 'ta-1',
      surfaceText: 'unbelievable',
      gloss: { und: 'incredible' },
      morphemes: [{ id: 'm-1', form: 'un-', writingSystem: 'und' }],
    };
    const store = createAnalysisStore({
      analysis: { analysis: makeAnalysis(ta), analysisLanguage: 'und' },
    });

    store.dispatch(deleteMorphemes({ tokenRef: 'tok-1' }));

    const { tokenAnalyses, tokenAnalysisLinks } = store.getState().analysis.analysis;
    expect(tokenAnalyses).toHaveLength(1);
    expect(tokenAnalyses[0].morphemes).toBeUndefined();
    expect(tokenAnalyses[0].gloss).toStrictEqual({ und: 'incredible' });
    expect(tokenAnalysisLinks).toHaveLength(1);
  });

  it('removes the analysis and its link when it has no gloss', () => {
    const ta: TokenAnalysis = {
      ...FIXTURE_STAMPS,
      id: 'ta-1',
      surfaceText: 'word',
      morphemes: [{ id: 'm-1', form: 'word', writingSystem: 'und' }],
    };
    const store = createAnalysisStore({
      analysis: { analysis: makeAnalysis(ta), analysisLanguage: 'und' },
    });

    store.dispatch(deleteMorphemes({ tokenRef: 'tok-1' }));

    const { tokenAnalyses, tokenAnalysisLinks } = store.getState().analysis.analysis;
    expect(tokenAnalyses).toHaveLength(0);
    expect(tokenAnalysisLinks).toHaveLength(0);
  });

  it('removes the analysis and its link when its gloss object is empty', () => {
    const ta: TokenAnalysis = {
      ...FIXTURE_STAMPS,
      id: 'ta-1',
      surfaceText: 'word',
      gloss: {},
      morphemes: [{ id: 'm-1', form: 'word', writingSystem: 'und' }],
    };
    const store = createAnalysisStore({
      analysis: { analysis: makeAnalysis(ta), analysisLanguage: 'und' },
    });

    store.dispatch(deleteMorphemes({ tokenRef: 'tok-1' }));

    const { tokenAnalyses, tokenAnalysisLinks } = store.getState().analysis.analysis;
    expect(tokenAnalyses).toHaveLength(0);
    expect(tokenAnalysisLinks).toHaveLength(0);
  });

  it('re-converges onto an identical sibling after the breakdown is removed', () => {
    // tok-1: 'run' with gloss + breakdown; tok-2: 'run' with the same gloss but no breakdown.
    // Removing tok-1's breakdown leaves its payload identical to tok-2's, so the two collapse.
    const withBreakdown: TokenAnalysis = {
      ...FIXTURE_STAMPS,
      id: 'ta-1',
      surfaceText: 'run',
      gloss: { und: 'jog' },
      morphemes: [{ id: 'm-1', form: 'run', writingSystem: 'und' }],
    };
    const glossOnly: TokenAnalysis = {
      ...FIXTURE_STAMPS,
      id: 'ta-2',
      surfaceText: 'run',
      gloss: { und: 'jog' },
    };
    const store = createAnalysisStore({
      analysis: {
        analysis: {
          ...emptyAnalysis(),
          tokenAnalyses: [withBreakdown, glossOnly],
          tokenAnalysisLinks: [
            {
              ...FIXTURE_STAMPS,
              analysisId: 'ta-1',
              status: 'approved',
              token: { tokenRef: 'tok-1', surfaceText: 'run' },
            },
            {
              ...FIXTURE_STAMPS,
              analysisId: 'ta-2',
              status: 'approved',
              token: { tokenRef: 'tok-2', surfaceText: 'run' },
            },
          ],
        },
        analysisLanguage: 'und',
      },
    });

    store.dispatch(deleteMorphemes({ tokenRef: 'tok-1' }));

    const { tokenAnalyses, tokenAnalysisLinks } = store.getState().analysis.analysis;
    expect(tokenAnalyses).toHaveLength(1);
    expect(tokenAnalyses[0].gloss).toStrictEqual({ und: 'jog' });
    expect(tokenAnalyses[0].morphemes).toBeUndefined();
    expect(tokenAnalysisLinks.every((l) => l.analysisId === tokenAnalyses[0].id)).toBe(true);
  });

  it('no-ops when the token has no approved link', () => {
    const ta: TokenAnalysis = {
      ...FIXTURE_STAMPS,
      id: 'ta-1',
      surfaceText: 'word',
      morphemes: [{ id: 'm-1', form: 'word', writingSystem: 'und' }],
    };
    const store = createAnalysisStore({
      analysis: { analysis: makeAnalysis(ta), analysisLanguage: 'und' },
    });

    store.dispatch(deleteMorphemes({ tokenRef: 'tok-other' }));

    expect(store.getState().analysis.analysis.tokenAnalyses[0].morphemes).toHaveLength(1);
  });

  it('no-ops when the approved analysis has no morphemes', () => {
    const ta: TokenAnalysis = {
      ...FIXTURE_STAMPS,
      id: 'ta-1',
      surfaceText: 'word',
      gloss: { und: 'hi' },
    };
    const store = createAnalysisStore({
      analysis: { analysis: makeAnalysis(ta), analysisLanguage: 'und' },
    });

    store.dispatch(deleteMorphemes({ tokenRef: 'tok-1' }));

    const { tokenAnalyses, tokenAnalysisLinks } = store.getState().analysis.analysis;
    expect(tokenAnalyses).toHaveLength(1);
    expect(tokenAnalyses[0].gloss).toStrictEqual({ und: 'hi' });
    expect(tokenAnalysisLinks).toHaveLength(1);
  });

  it('keeps the analysis and link when it carries a part of speech but no gloss', () => {
    const ta: TokenAnalysis = {
      ...FIXTURE_STAMPS,
      id: 'ta-1',
      surfaceText: 'word',
      pos: 'N',
      morphemes: [{ id: 'm-1', form: 'word', writingSystem: 'und' }],
    };
    const store = createAnalysisStore({
      analysis: { analysis: makeAnalysis(ta), analysisLanguage: 'und' },
    });

    store.dispatch(deleteMorphemes({ tokenRef: 'tok-1' }));

    const { tokenAnalyses, tokenAnalysisLinks } = store.getState().analysis.analysis;
    expect(tokenAnalyses).toHaveLength(1);
    expect(tokenAnalyses[0].morphemes).toBeUndefined();
    expect(tokenAnalyses[0].pos).toBe('N');
    expect(tokenAnalysisLinks).toHaveLength(1);
  });

  it('keeps the analysis and link when it carries features but no gloss', () => {
    const ta: TokenAnalysis = {
      ...FIXTURE_STAMPS,
      id: 'ta-1',
      surfaceText: 'word',
      features: { Case: 'Nom' },
      morphemes: [{ id: 'm-1', form: 'word', writingSystem: 'und' }],
    };
    const store = createAnalysisStore({
      analysis: { analysis: makeAnalysis(ta), analysisLanguage: 'und' },
    });

    store.dispatch(deleteMorphemes({ tokenRef: 'tok-1' }));

    const { tokenAnalyses, tokenAnalysisLinks } = store.getState().analysis.analysis;
    expect(tokenAnalyses).toHaveLength(1);
    expect(tokenAnalyses[0].morphemes).toBeUndefined();
    expect(tokenAnalyses[0].features).toStrictEqual({ Case: 'Nom' });
    expect(tokenAnalysisLinks).toHaveLength(1);
  });

  it('keeps the analysis and link when it carries a lexicon sense reference but no gloss', () => {
    const ta: TokenAnalysis = {
      ...FIXTURE_STAMPS,
      id: 'ta-1',
      surfaceText: 'word',
      glossSenseRef: { authority: 'x-test', senseId: 'sense-1' },
      morphemes: [{ id: 'm-1', form: 'word', writingSystem: 'und' }],
    };
    const store = createAnalysisStore({
      analysis: { analysis: makeAnalysis(ta), analysisLanguage: 'und' },
    });

    store.dispatch(deleteMorphemes({ tokenRef: 'tok-1' }));

    const { tokenAnalyses, tokenAnalysisLinks } = store.getState().analysis.analysis;
    expect(tokenAnalyses).toHaveLength(1);
    expect(tokenAnalyses[0].morphemes).toBeUndefined();
    expect(tokenAnalyses[0].glossSenseRef).toStrictEqual({
      authority: 'x-test',
      senseId: 'sense-1',
    });
    expect(tokenAnalysisLinks).toHaveLength(1);
  });

  it('repairs an orphaned approved link by removing it', () => {
    const orphanLink: TokenAnalysisLink = {
      ...FIXTURE_STAMPS,
      analysisId: 'missing-uuid',
      status: 'approved',
      token: { tokenRef: 'tok-1', surfaceText: 'word' },
    };
    const store = createAnalysisStore({
      analysis: {
        analysis: { ...emptyAnalysis(), tokenAnalysisLinks: [orphanLink] },
        analysisLanguage: 'und',
      },
    });

    store.dispatch(deleteMorphemes({ tokenRef: 'tok-1' }));

    // Every token-analysis reducer repairs orphaned approved links the same way; an orphan found
    // during deletion is removed rather than left to dangle.
    expect(store.getState().analysis.analysis.tokenAnalysisLinks).toHaveLength(0);
  });
});

describe('writeMorphemeGloss', () => {
  it('writes a gloss onto the specified morpheme', () => {
    const ta: TokenAnalysis = {
      ...FIXTURE_STAMPS,
      id: 'ta-1',
      surfaceText: 'unbelievable',
      morphemes: [
        { id: 'm-1', form: 'un-', writingSystem: 'und' },
        { id: 'm-2', form: 'believe', writingSystem: 'und' },
      ],
    };
    const store = createAnalysisStore({
      analysis: { analysis: makeAnalysis(ta), analysisLanguage: 'und' },
    });

    store.dispatch(writeMorphemeGloss({ tokenRef: 'tok-1', morphemeId: 'm-1', value: 'not' }));

    const updated = store.getState().analysis.analysis.tokenAnalyses.find((a) => a.id === 'ta-1');
    expect(updated?.morphemes?.[0].gloss).toStrictEqual({ und: 'not' });
    expect(updated?.morphemes?.[1].gloss).toBeUndefined();
  });

  it('drops the gloss object when a blank value clears its only entry', () => {
    const ta: TokenAnalysis = {
      ...FIXTURE_STAMPS,
      id: 'ta-1',
      surfaceText: 'unbelievable',
      morphemes: [{ id: 'm-1', form: 'un-', writingSystem: 'und', gloss: { und: 'not' } }],
    };
    const store = createAnalysisStore({
      analysis: { analysis: makeAnalysis(ta), analysisLanguage: 'und' },
    });

    store.dispatch(writeMorphemeGloss({ tokenRef: 'tok-1', morphemeId: 'm-1', value: '  ' }));

    const updated = store.getState().analysis.analysis.tokenAnalyses.find((a) => a.id === 'ta-1');
    expect(updated?.morphemes?.[0].gloss).toBeUndefined();
  });

  it('removes only the active language entry from a multi-language gloss when cleared', () => {
    const ta: TokenAnalysis = {
      ...FIXTURE_STAMPS,
      id: 'ta-1',
      surfaceText: 'unbelievable',
      morphemes: [
        { id: 'm-1', form: 'un-', writingSystem: 'und', gloss: { und: 'not', fr: 'non' } },
      ],
    };
    const store = createAnalysisStore({
      analysis: { analysis: makeAnalysis(ta), analysisLanguage: 'und' },
    });

    store.dispatch(writeMorphemeGloss({ tokenRef: 'tok-1', morphemeId: 'm-1', value: '' }));

    const updated = store.getState().analysis.analysis.tokenAnalyses.find((a) => a.id === 'ta-1');
    expect(updated?.morphemes?.[0].gloss).toStrictEqual({ fr: 'non' });
  });

  it('no-ops when a blank value clears a morpheme that has no gloss', () => {
    const ta: TokenAnalysis = {
      ...FIXTURE_STAMPS,
      id: 'ta-1',
      surfaceText: 'unbelievable',
      morphemes: [{ id: 'm-1', form: 'un-', writingSystem: 'und' }],
    };
    const store = createAnalysisStore({
      analysis: { analysis: makeAnalysis(ta), analysisLanguage: 'und' },
    });

    store.dispatch(writeMorphemeGloss({ tokenRef: 'tok-1', morphemeId: 'm-1', value: '' }));

    const updated = store.getState().analysis.analysis.tokenAnalyses.find((a) => a.id === 'ta-1');
    expect(updated?.morphemes?.[0].gloss).toBeUndefined();
  });

  it('no-ops when the token has no approved link', () => {
    const store = createAnalysisStore();
    store.dispatch(writeMorphemeGloss({ tokenRef: 'tok-1', morphemeId: 'm-1', value: 'not' }));
    expect(store.getState().analysis.analysis.tokenAnalyses).toHaveLength(0);
  });

  it('repairs an orphaned approved link by removing it', () => {
    const orphanLink: TokenAnalysisLink = {
      ...FIXTURE_STAMPS,
      analysisId: 'missing-uuid',
      status: 'approved',
      token: { tokenRef: 'tok-1', surfaceText: 'word' },
    };
    const store = createAnalysisStore({
      analysis: {
        analysis: { ...emptyAnalysis(), tokenAnalysisLinks: [orphanLink] },
        analysisLanguage: 'und',
      },
    });

    store.dispatch(writeMorphemeGloss({ tokenRef: 'tok-1', morphemeId: 'm-1', value: 'not' }));

    expect(store.getState().analysis.analysis.tokenAnalysisLinks).toHaveLength(0);
  });

  it('no-ops when the morpheme id is not found', () => {
    const ta: TokenAnalysis = {
      ...FIXTURE_STAMPS,
      id: 'ta-1',
      surfaceText: 'word',
      morphemes: [{ id: 'm-1', form: 'word', writingSystem: 'und' }],
    };
    const store = createAnalysisStore({
      analysis: { analysis: makeAnalysis(ta), analysisLanguage: 'und' },
    });

    store.dispatch(
      writeMorphemeGloss({ tokenRef: 'tok-1', morphemeId: 'nonexistent', value: 'x' }),
    );

    expect(
      store.getState().analysis.analysis.tokenAnalyses[0].morphemes?.[0].gloss,
    ).toBeUndefined();
  });

  it('re-converges onto an identical sibling after a morpheme gloss edit', () => {
    // Two payloads for "cats" differ only in morpheme-0's gloss; glossing tok-1's morpheme to match
    // tok-2's makes them content-identical, so the two payloads should collapse back onto one.
    const ta1: TokenAnalysis = {
      ...FIXTURE_STAMPS,
      id: 'ta-1',
      surfaceText: 'cats',
      morphemes: [
        { id: 'm-1', form: 'cat', writingSystem: 'und' },
        { id: 'm-2', form: '-s', writingSystem: 'und', gloss: { und: 'PL' } },
      ],
    };
    const ta2: TokenAnalysis = {
      ...FIXTURE_STAMPS,
      id: 'ta-2',
      surfaceText: 'cats',
      morphemes: [
        { id: 'm-3', form: 'cat', writingSystem: 'und', gloss: { und: 'feline' } },
        { id: 'm-4', form: '-s', writingSystem: 'und', gloss: { und: 'PL' } },
      ],
    };
    const store = createAnalysisStore({
      analysis: {
        analysis: {
          ...emptyAnalysis(),
          tokenAnalyses: [ta1, ta2],
          tokenAnalysisLinks: [
            {
              ...FIXTURE_STAMPS,
              analysisId: 'ta-1',
              status: 'approved',
              token: { tokenRef: 'tok-1', surfaceText: 'cats' },
            },
            {
              ...FIXTURE_STAMPS,
              analysisId: 'ta-2',
              status: 'approved',
              token: { tokenRef: 'tok-2', surfaceText: 'cats' },
            },
          ],
        },
        analysisLanguage: 'und',
      },
    });

    store.dispatch(writeMorphemeGloss({ tokenRef: 'tok-1', morphemeId: 'm-1', value: 'feline' }));

    const { tokenAnalyses, tokenAnalysisLinks } = store.getState().analysis.analysis;
    expect(tokenAnalyses).toHaveLength(1);
    expect(tokenAnalysisLinks).toHaveLength(2);
    expect(tokenAnalysisLinks.every((l) => l.analysisId === tokenAnalyses[0].id)).toBe(true);
  });

  it('re-converges onto an identical sibling after clearing a morpheme gloss', () => {
    // Two payloads for "cats" differ only in that tok-1's morpheme-0 carries a stray gloss; clearing
    // it makes the two payloads content-identical, so they should collapse back onto one — the clear
    // path must re-converge symmetrically with the write path, not leave a duplicate behind.
    const ta1: TokenAnalysis = {
      ...FIXTURE_STAMPS,
      id: 'ta-1',
      surfaceText: 'cats',
      morphemes: [
        { id: 'm-1', form: 'cat', writingSystem: 'und', gloss: { und: 'feline' } },
        { id: 'm-2', form: '-s', writingSystem: 'und', gloss: { und: 'PL' } },
      ],
    };
    const ta2: TokenAnalysis = {
      ...FIXTURE_STAMPS,
      id: 'ta-2',
      surfaceText: 'cats',
      morphemes: [
        { id: 'm-3', form: 'cat', writingSystem: 'und' },
        { id: 'm-4', form: '-s', writingSystem: 'und', gloss: { und: 'PL' } },
      ],
    };
    const store = createAnalysisStore({
      analysis: {
        analysis: {
          ...emptyAnalysis(),
          tokenAnalyses: [ta1, ta2],
          tokenAnalysisLinks: [
            {
              ...FIXTURE_STAMPS,
              analysisId: 'ta-1',
              status: 'approved',
              token: { tokenRef: 'tok-1', surfaceText: 'cats' },
            },
            {
              ...FIXTURE_STAMPS,
              analysisId: 'ta-2',
              status: 'approved',
              token: { tokenRef: 'tok-2', surfaceText: 'cats' },
            },
          ],
        },
        analysisLanguage: 'und',
      },
    });

    store.dispatch(writeMorphemeGloss({ tokenRef: 'tok-1', morphemeId: 'm-1', value: '' }));

    const { tokenAnalyses, tokenAnalysisLinks } = store.getState().analysis.analysis;
    expect(tokenAnalyses).toHaveLength(1);
    expect(tokenAnalysisLinks).toHaveLength(2);
    expect(tokenAnalysisLinks.every((l) => l.analysisId === tokenAnalyses[0].id)).toBe(true);
  });

  it('glosses one token of a shared payload without rewriting its co-linked sibling', () => {
    // tok-1 and tok-2 break 'cats' down identically, so they converge onto one shared payload.
    // Glossing tok-1's 'cat' morpheme to distinct content must fork it, leaving tok-2's bare.
    const store = createAnalysisStore();
    store.dispatch(writeMorphemes('tok-1', 'cats', ['cat', '-s'], 'en'));
    store.dispatch(writeMorphemes('tok-2', 'cats', ['cat', '-s'], 'en'));

    // Read the shared 'cat' morpheme's id back from state — the prepare assigns fresh UUIDs.
    const catId = selectApprovedMorphemes(store.getState().analysis, 'tok-1').find(
      (m) => m.form === 'cat',
    )?.id;
    expect(catId).toBeDefined();
    store.dispatch(
      writeMorphemeGloss({ tokenRef: 'tok-1', morphemeId: catId ?? '', value: 'feline' }),
    );

    const state = store.getState().analysis;
    const tok1Cat = selectApprovedMorphemes(state, 'tok-1').find((m) => m.form === 'cat');
    const tok2Cat = selectApprovedMorphemes(state, 'tok-2').find((m) => m.form === 'cat');
    expect(tok1Cat?.gloss).toStrictEqual({ und: 'feline' });
    expect(tok2Cat?.gloss).toBeUndefined();
    // The shared payload forked, so there are now two distinct payloads.
    expect(state.analysis.tokenAnalyses).toHaveLength(2);
  });
});

describe('selectApprovedMorphemes', () => {
  it('returns morphemes from the approved analysis', () => {
    const ta: TokenAnalysis = {
      ...FIXTURE_STAMPS,
      id: 'ta-1',
      surfaceText: 'word',
      morphemes: [
        { id: 'm-1', form: 'wor', writingSystem: 'und' },
        { id: 'm-2', form: '-d', writingSystem: 'und' },
      ],
    };
    const store = createAnalysisStore({
      analysis: { analysis: makeAnalysis(ta), analysisLanguage: 'und' },
    });

    const morphemes = selectApprovedMorphemes(store.getState().analysis, 'tok-1');
    expect(morphemes).toHaveLength(2);
    expect(morphemes[0].form).toBe('wor');
  });

  it('returns an empty array when no approved link exists', () => {
    const store = createAnalysisStore();
    const morphemes = selectApprovedMorphemes(store.getState().analysis, 'tok-1');
    expect(morphemes).toHaveLength(0);
  });

  it('returns an empty array when approved analysis has no morphemes', () => {
    const ta: TokenAnalysis = { ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'word' };
    const store = createAnalysisStore({
      analysis: { analysis: makeAnalysis(ta), analysisLanguage: 'und' },
    });

    const morphemes = selectApprovedMorphemes(store.getState().analysis, 'tok-1');
    expect(morphemes).toHaveLength(0);
  });

  it('returns the same reference for repeated calls (stable empty array)', () => {
    const store = createAnalysisStore();
    const a = selectApprovedMorphemes(store.getState().analysis, 'tok-1');
    const b = selectApprovedMorphemes(store.getState().analysis, 'tok-1');
    expect(a).toBe(b);
  });
});

describe('selectPoolIndex', () => {
  it('indexes approved analyses by normalized surface form with their approval frequency', () => {
    const ta: TokenAnalysis = {
      ...FIXTURE_STAMPS,
      id: 'ta-1',
      surfaceText: 'logos',
      gloss: { en: 'word' },
    };
    // Two tokens approved to one shared payload — a sentence-initial "Logos" and a mid-sentence
    // "logos" — so the pool frequency is the count of distinct approving tokens.
    const tokenAnalysisLinks: TokenAnalysisLink[] = [
      {
        ...FIXTURE_STAMPS,
        analysisId: 'ta-1',
        status: 'approved',
        token: { tokenRef: 'tok-1', surfaceText: 'logos' },
      },
      {
        ...FIXTURE_STAMPS,
        analysisId: 'ta-1',
        status: 'approved',
        token: { tokenRef: 'tok-2', surfaceText: 'Logos' },
      },
    ];
    const store = createAnalysisStore({
      analysis: {
        analysis: { ...emptyAnalysis(), tokenAnalyses: [ta], tokenAnalysisLinks },
        analysisLanguage: 'en',
      },
    });

    expect(selectPoolIndex(store.getState().analysis).get('logos')).toEqual([
      { analysis: ta, frequency: 2 },
    ]);
  });

  it('excludes non-approved links so only confirmed analyses enter the pool', () => {
    const ta: TokenAnalysis = {
      ...FIXTURE_STAMPS,
      id: 'ta-1',
      surfaceText: 'logos',
      gloss: { en: 'word' },
    };
    const tokenAnalysisLinks: TokenAnalysisLink[] = [
      {
        ...FIXTURE_STAMPS,
        analysisId: 'ta-1',
        status: 'suggested',
        token: { tokenRef: 'tok-1', surfaceText: 'logos' },
      },
    ];
    const store = createAnalysisStore({
      analysis: {
        analysis: { ...emptyAnalysis(), tokenAnalyses: [ta], tokenAnalysisLinks },
        analysisLanguage: 'en',
      },
    });

    expect(selectPoolIndex(store.getState().analysis).size).toBe(0);
  });

  it('returns the same reference for repeated calls on unchanged state (memoized)', () => {
    const store = createAnalysisStore();
    const a = selectPoolIndex(store.getState().analysis);
    const b = selectPoolIndex(store.getState().analysis);
    expect(a).toBe(b);
  });
});

describe('selectCatalogRows', () => {
  it('returns the same reference for repeated calls on unchanged state (memoized)', () => {
    const store = createAnalysisStore();

    const a = selectCatalogRows(store.getState().analysis, 'GEN');
    const b = selectCatalogRows(store.getState().analysis, 'GEN');

    expect(a).toBe(b);
  });

  it('keeps a book cached across a call for another one', () => {
    const store = createAnalysisStore();

    const first = selectCatalogRows(store.getState().analysis, 'GEN');
    selectCatalogRows(store.getState().analysis, 'MAT');

    expect(selectCatalogRows(store.getState().analysis, 'GEN')).toBe(first);
  });

  it('rebuilds the rows after a gloss write', () => {
    const store = createAnalysisStore();
    const before = selectCatalogRows(store.getState().analysis, 'GEN');

    store.dispatch(writeGloss('GEN 1:1:0', 'λόγος', 'word'));

    const after = selectCatalogRows(store.getState().analysis, 'GEN');
    expect(after).not.toBe(before);
    expect(after.map((row) => row.gloss)).toEqual(['word']);
  });
});

describe('selectResolvedTokenAnalysis', () => {
  it('returns the approved analysis when the token has one', () => {
    const ta: TokenAnalysis = {
      ...FIXTURE_STAMPS,
      id: 'ta-1',
      surfaceText: 'word',
      gloss: { en: 'hi' },
    };
    const store = createAnalysisStore({
      analysis: { analysis: makeAnalysis(ta), analysisLanguage: 'en' },
    });

    // The approved decision is canonical; the pool match for the same surface form rides along as
    // `poolSuggestion` so the dropdown can still offer re-promotion to a pool alternative.
    expect(selectResolvedTokenAnalysis(store.getState().analysis, 'tok-1', 'word')).toEqual({
      status: 'approved',
      analysis: ta,
      poolSuggestion: { suggested: ta, candidates: [] },
    });
  });

  it('falls back to a derived suggestion for an unapproved token matching the pool', () => {
    // makeAnalysis approves tok-1 → ta-1 ('logos'); tok-2 (also 'logos') has no approved analysis,
    // so it resolves to the pooled payload as a suggestion.
    const ta: TokenAnalysis = {
      ...FIXTURE_STAMPS,
      id: 'ta-1',
      surfaceText: 'logos',
      gloss: { en: 'word' },
    };
    const store = createAnalysisStore({
      analysis: { analysis: makeAnalysis(ta), analysisLanguage: 'en' },
    });

    expect(selectResolvedTokenAnalysis(store.getState().analysis, 'tok-2', 'logos')).toEqual({
      status: 'suggested',
      suggested: ta,
      candidates: [],
    });
  });

  it('returns undefined when the token is neither approved nor matches the pool', () => {
    const store = createAnalysisStore();

    expect(
      selectResolvedTokenAnalysis(store.getState().analysis, 'tok-1', 'unseen'),
    ).toBeUndefined();
  });
});

describe('selectSuggestionAfterClearing', () => {
  /**
   * Builds a homograph 'bank' pool where `riverbank` is approved three times (`r1`/`r2`/`r3`, the
   * majority) and `finance` once (`f1`), so an approved majority token's deletion can be previewed
   * against a still-majority pick rather than a tie.
   */
  function bankPool(): TextAnalysis {
    const river: TokenAnalysis = {
      ...FIXTURE_STAMPS,
      id: 'ta-river',
      surfaceText: 'bank',
      gloss: { en: 'riverbank' },
    };
    const fin: TokenAnalysis = {
      ...FIXTURE_STAMPS,
      id: 'ta-fin',
      surfaceText: 'bank',
      gloss: { en: 'finance' },
    };
    const tokenAnalysisLinks: TokenAnalysisLink[] = [
      {
        ...FIXTURE_STAMPS,
        analysisId: 'ta-river',
        status: 'approved',
        token: { tokenRef: 'r1', surfaceText: 'bank' },
      },
      {
        ...FIXTURE_STAMPS,
        analysisId: 'ta-river',
        status: 'approved',
        token: { tokenRef: 'r2', surfaceText: 'bank' },
      },
      {
        ...FIXTURE_STAMPS,
        analysisId: 'ta-river',
        status: 'approved',
        token: { tokenRef: 'r3', surfaceText: 'bank' },
      },
      {
        ...FIXTURE_STAMPS,
        analysisId: 'ta-fin',
        status: 'approved',
        token: { tokenRef: 'f1', surfaceText: 'bank' },
      },
    ];
    return { ...emptyAnalysis(), tokenAnalyses: [river, fin], tokenAnalysisLinks };
  }

  it('returns undefined for a token with no approved analysis', () => {
    // The caller only consults this for an approved token; an unapproved one has nothing to discount.
    const store = createAnalysisStore({
      analysis: { analysis: bankPool(), analysisLanguage: 'en' },
    });

    expect(
      selectSuggestionAfterClearing(store.getState().analysis, 'tok-x', 'bank'),
    ).toBeUndefined();
  });

  it('previews the majority pick once an approved token discounts its own approval', () => {
    // r1 is approved to the majority `riverbank`. Clearing it discounts that approval (3 → 2) but it
    // still outranks `finance`, so the preview leads with the majority pick — not the lone
    // alternative the approved-token dropdown would otherwise show.
    const store = createAnalysisStore({
      analysis: { analysis: bankPool(), analysisLanguage: 'en' },
    });

    const river = store.getState().analysis.analysis.tokenAnalyses[0];
    const fin = store.getState().analysis.analysis.tokenAnalyses[1];
    expect(selectSuggestionAfterClearing(store.getState().analysis, 'r1', 'bank')).toEqual({
      status: 'suggested',
      suggested: river,
      candidates: [fin],
    });
  });

  it('returns undefined when discounting the approval empties the pool match', () => {
    // tok-1's payload is the only approval of 'word'; clearing it removes the pool entry entirely, so
    // there is nothing left to suggest — matching the empty pool the committed deletion produces.
    const ta: TokenAnalysis = {
      ...FIXTURE_STAMPS,
      id: 'ta-1',
      surfaceText: 'word',
      gloss: { en: 'hi' },
    };
    const store = createAnalysisStore({
      analysis: { analysis: makeAnalysis(ta), analysisLanguage: 'en' },
    });

    expect(
      selectSuggestionAfterClearing(store.getState().analysis, 'tok-1', 'word'),
    ).toBeUndefined();
  });
});

describe('approveAnalysisForToken', () => {
  it('approves an existing payload for an unapproved token, raising its frequency', () => {
    // tok-1 approves ta-1 ('logos'); tok-2 (also 'logos') only has it as a suggestion until accepted.
    const ta: TokenAnalysis = {
      ...FIXTURE_STAMPS,
      id: 'ta-1',
      surfaceText: 'logos',
      gloss: { en: 'word' },
    };
    const store = createAnalysisStore({
      analysis: { analysis: makeAnalysis(ta), analysisLanguage: 'en' },
    });

    store.dispatch(
      approveAnalysisForToken({ tokenRef: 'tok-2', surfaceText: 'logos', analysisId: 'ta-1' }),
    );

    // No new payload — the accepting token links to the existing shared one.
    expect(store.getState().analysis.analysis.tokenAnalyses).toHaveLength(1);
    expect(approvedLinkCountForPayload(store.getState().analysis, 'tok-2')).toBe(2);
    // The token now resolves to its own approved decision rather than a `suggested` status; the pool
    // match still rides along as `poolSuggestion` for re-promotion from the dropdown.
    expect(selectResolvedTokenAnalysis(store.getState().analysis, 'tok-2', 'logos')).toEqual({
      status: 'approved',
      analysis: ta,
      poolSuggestion: { suggested: ta, candidates: [] },
    });
  });

  it('promotes a chosen candidate id and snapshots the accepting token surface text', () => {
    // Homograph 'bank': ta-river is approved twice (the suggested pick), ta-fin once (a candidate).
    const river: TokenAnalysis = {
      ...FIXTURE_STAMPS,
      id: 'ta-river',
      surfaceText: 'bank',
      gloss: { en: 'riverside' },
    };
    const fin: TokenAnalysis = {
      ...FIXTURE_STAMPS,
      id: 'ta-fin',
      surfaceText: 'bank',
      gloss: { en: 'finance' },
    };
    const tokenAnalysisLinks: TokenAnalysisLink[] = [
      {
        ...FIXTURE_STAMPS,
        analysisId: 'ta-river',
        status: 'approved',
        token: { tokenRef: 'r1', surfaceText: 'bank' },
      },
      {
        ...FIXTURE_STAMPS,
        analysisId: 'ta-river',
        status: 'approved',
        token: { tokenRef: 'r2', surfaceText: 'bank' },
      },
      {
        ...FIXTURE_STAMPS,
        analysisId: 'ta-fin',
        status: 'approved',
        token: { tokenRef: 'f1', surfaceText: 'bank' },
      },
    ];
    const store = createAnalysisStore({
      analysis: {
        analysis: { ...emptyAnalysis(), tokenAnalyses: [river, fin], tokenAnalysisLinks },
        analysisLanguage: 'en',
      },
    });

    // Promote the candidate (ta-fin) for a sentence-initial 'Bank', not the suggested ta-river.
    store.dispatch(
      approveAnalysisForToken({ tokenRef: 'b1', surfaceText: 'Bank', analysisId: 'ta-fin' }),
    );

    const link = store
      .getState()
      .analysis.analysis.tokenAnalysisLinks.find((l) => l.token.tokenRef === 'b1');
    expect(link?.analysisId).toBe('ta-fin');
    expect(link?.token.surfaceText).toBe('Bank');
  });

  it('is a no-op when the analysis id matches no stored payload (no orphan link)', () => {
    // Guards against an unknown id being appended as an approved link that points at nothing.
    const ta: TokenAnalysis = {
      ...FIXTURE_STAMPS,
      id: 'ta-1',
      surfaceText: 'logos',
      gloss: { en: 'word' },
    };
    const store = createAnalysisStore({
      analysis: { analysis: makeAnalysis(ta), analysisLanguage: 'en' },
    });

    store.dispatch(
      approveAnalysisForToken({
        tokenRef: 'tok-2',
        surfaceText: 'logos',
        analysisId: 'ta-missing',
      }),
    );

    // No approved link to the nonexistent payload was appended; only the seeded tok-1 link remains.
    const links = store.getState().analysis.analysis.tokenAnalysisLinks;
    expect(links).toHaveLength(1);
    expect(links.some((l) => l.token.tokenRef === 'tok-2')).toBe(false);
  });

  it('repoints the existing approved link when promoting an already-approved token (no second link)', () => {
    // Promoting an already-approved homograph to a different pool analysis must swap the one approved
    // link in place rather than appending a second (preserving the single-approved invariant) or
    // no-opping (which would silently fail the re-promotion the UI offers). A co-linked sibling keeps
    // ta-1 alive, so the old payload survives.
    const approved: TokenAnalysis = {
      ...FIXTURE_STAMPS,
      id: 'ta-1',
      surfaceText: 'logos',
      gloss: { en: 'word' },
    };
    const other: TokenAnalysis = {
      ...FIXTURE_STAMPS,
      id: 'ta-2',
      surfaceText: 'logos',
      gloss: { en: 'other' },
    };
    const store = createAnalysisStore({
      analysis: {
        analysis: {
          ...emptyAnalysis(),
          tokenAnalyses: [approved, other],
          tokenAnalysisLinks: [
            {
              ...FIXTURE_STAMPS,
              analysisId: 'ta-1',
              status: 'approved',
              token: { tokenRef: 'tok-1', surfaceText: 'logos' },
            },
            {
              ...FIXTURE_STAMPS,
              analysisId: 'ta-1',
              status: 'approved',
              token: { tokenRef: 'tok-sibling', surfaceText: 'logos' },
            },
          ],
        },
        analysisLanguage: 'en',
      },
    });

    store.dispatch(
      approveAnalysisForToken({ tokenRef: 'tok-1', surfaceText: 'logos', analysisId: 'ta-2' }),
    );

    // The one approved link for tok-1 is repointed to ta-2 — not duplicated.
    const links = store
      .getState()
      .analysis.analysis.tokenAnalysisLinks.filter((l) => l.token.tokenRef === 'tok-1');
    expect(links).toHaveLength(1);
    expect(links[0].analysisId).toBe('ta-2');
    // The sibling still approves ta-1, so the old payload survives.
    expect(store.getState().analysis.analysis.tokenAnalyses.map((ta) => ta.id)).toEqual([
      'ta-1',
      'ta-2',
    ]);
  });

  it('reclaims the old payload when promoting an already-approved token off its last reference', () => {
    // When the promoted-away payload has no other approved link, repointing leaves it orphaned, so
    // it is dropped — a promotion never strands an empty payload.
    const approved: TokenAnalysis = {
      ...FIXTURE_STAMPS,
      id: 'ta-1',
      surfaceText: 'logos',
      gloss: { en: 'word' },
    };
    const other: TokenAnalysis = {
      ...FIXTURE_STAMPS,
      id: 'ta-2',
      surfaceText: 'logos',
      gloss: { en: 'other' },
    };
    const store = createAnalysisStore({
      analysis: {
        analysis: {
          ...emptyAnalysis(),
          tokenAnalyses: [approved, other],
          tokenAnalysisLinks: [
            {
              ...FIXTURE_STAMPS,
              analysisId: 'ta-1',
              status: 'approved',
              token: { tokenRef: 'tok-1', surfaceText: 'logos' },
            },
          ],
        },
        analysisLanguage: 'en',
      },
    });

    store.dispatch(
      approveAnalysisForToken({ tokenRef: 'tok-1', surfaceText: 'logos', analysisId: 'ta-2' }),
    );

    const links = store
      .getState()
      .analysis.analysis.tokenAnalysisLinks.filter((l) => l.token.tokenRef === 'tok-1');
    expect(links).toHaveLength(1);
    expect(links[0].analysisId).toBe('ta-2');
    // ta-1 had no other approved reference, so it was reclaimed.
    expect(store.getState().analysis.analysis.tokenAnalyses.map((ta) => ta.id)).toEqual(['ta-2']);
  });

  it('is a no-op when promoting an already-approved token to the analysis it already approves', () => {
    // Re-approving the same payload changes nothing — the link already points there.
    const approved: TokenAnalysis = {
      ...FIXTURE_STAMPS,
      id: 'ta-1',
      surfaceText: 'logos',
      gloss: { en: 'word' },
    };
    const store = createAnalysisStore({
      analysis: {
        analysis: {
          ...emptyAnalysis(),
          tokenAnalyses: [approved],
          tokenAnalysisLinks: [
            {
              ...FIXTURE_STAMPS,
              analysisId: 'ta-1',
              status: 'approved',
              token: { tokenRef: 'tok-1', surfaceText: 'logos' },
            },
          ],
        },
        analysisLanguage: 'en',
      },
    });

    store.dispatch(
      approveAnalysisForToken({ tokenRef: 'tok-1', surfaceText: 'logos', analysisId: 'ta-1' }),
    );

    const links = store
      .getState()
      .analysis.analysis.tokenAnalysisLinks.filter((l) => l.token.tokenRef === 'tok-1');
    expect(links).toHaveLength(1);
    expect(links[0].analysisId).toBe('ta-1');
    expect(store.getState().analysis.analysis.tokenAnalyses).toHaveLength(1);
  });
});

describe('selectMorphemeResetLosesGlosses', () => {
  /**
   * Writes a two-morpheme breakdown for `tokenRef` and returns the id of its first morpheme, so
   * tests can gloss a morpheme whose id the reducer generated.
   */
  function breakDown(store: ReturnType<typeof createAnalysisStore>, tokenRef: string): string {
    store.dispatch(writeMorphemes(tokenRef, 'cats', ['cat', '-s'], 'en'));
    return selectApprovedMorphemes(store.getState().analysis, tokenRef)[0].id;
  }

  it('reports no loss when the token has no approved analysis', () => {
    const store = createAnalysisStore();
    expect(selectMorphemeResetLosesGlosses(store.getState().analysis, 'tok-1')).toBe(false);
  });

  it('reports no loss when the breakdown carries no morpheme glosses', () => {
    // Bare segmentation is cheap to retype, so removing it needs no confirmation.
    const store = createAnalysisStore();
    breakDown(store, 'tok-1');
    expect(selectMorphemeResetLosesGlosses(store.getState().analysis, 'tok-1')).toBe(false);
  });

  it('reports a loss when a glossed breakdown is linked only by this token', () => {
    const store = createAnalysisStore();
    const morphemeId = breakDown(store, 'tok-1');
    store.dispatch(writeMorphemeGloss({ tokenRef: 'tok-1', morphemeId, value: 'feline' }));
    expect(selectMorphemeResetLosesGlosses(store.getState().analysis, 'tok-1')).toBe(true);
  });

  it('reports no loss when a glossed breakdown is shared with another token', () => {
    // deleteMorphemes forks a shared payload rather than emptying it, so the co-linked token keeps
    // the glosses and nothing is lost project-wide.
    const store = createAnalysisStore();
    const morphemeId = breakDown(store, 'tok-1');
    store.dispatch(writeMorphemeGloss({ tokenRef: 'tok-1', morphemeId, value: 'feline' }));
    const state = store.getState().analysis;
    const [{ analysisId }] = state.analysis.tokenAnalysisLinks.filter(
      (l) => l.token.tokenRef === 'tok-1',
    );
    store.dispatch(approveAnalysisForToken({ tokenRef: 'tok-2', surfaceText: 'cats', analysisId }));
    expect(selectMorphemeResetLosesGlosses(store.getState().analysis, 'tok-2')).toBe(false);
  });
});

describe('analysis timestamps', () => {
  const FIRST_WRITE = '2026-04-01T09:00:00.000Z';
  const SECOND_WRITE = '2026-04-02T10:30:00.000Z';

  /** Advances the frozen clock so a following dispatch stamps a time distinct from the last. */
  function setClock(time: string): void {
    jest.setSystemTime(new Date(time));
  }

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date(FIRST_WRITE));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /** Returns the approved payload and link for a token, so the two can be asserted on together. */
  function approvedPair(state: AnalysisState, tokenRef: string) {
    const link = state.analysis.tokenAnalysisLinks.find(
      (l) => l.status === 'approved' && l.token.tokenRef === tokenRef,
    );
    const analysis = state.analysis.tokenAnalyses.find((ta) => ta.id === link?.analysisId);
    return { link, analysis };
  }

  it('stamps a new token analysis and its link with the write time', () => {
    const store = createAnalysisStore();

    store.dispatch(writeGloss('tok-1', 'cat', 'feline'));

    const { link, analysis } = approvedPair(store.getState().analysis, 'tok-1');
    expect(analysis).toMatchObject({ createdAt: FIRST_WRITE, updatedAt: FIRST_WRITE });
    expect(link).toMatchObject({ createdAt: FIRST_WRITE, updatedAt: FIRST_WRITE });
  });

  it('advances only updatedAt when an existing analysis is edited', () => {
    const store = createAnalysisStore();
    store.dispatch(writeGloss('tok-1', 'cat', 'feline'));

    setClock(SECOND_WRITE);
    store.dispatch(writeGloss('tok-1', 'cat', 'kitty'));

    const { link, analysis } = approvedPair(store.getState().analysis, 'tok-1');
    expect(analysis).toMatchObject({ createdAt: FIRST_WRITE, updatedAt: SECOND_WRITE });
    expect(link).toMatchObject({ createdAt: FIRST_WRITE, updatedAt: SECOND_WRITE });
  });

  it('keeps the shared payload dated by its content when a second token adopts it', () => {
    // The payload records when this gloss entered the project; only the new link records when this
    // token took it on.
    const store = createAnalysisStore();
    store.dispatch(writeGloss('tok-1', 'cat', 'feline'));

    setClock(SECOND_WRITE);
    store.dispatch(writeGloss('tok-2', 'cat', 'feline'));

    const { link, analysis } = approvedPair(store.getState().analysis, 'tok-2');
    expect(analysis).toMatchObject({ createdAt: FIRST_WRITE, updatedAt: FIRST_WRITE });
    expect(link).toMatchObject({ createdAt: SECOND_WRITE, updatedAt: SECOND_WRITE });
  });

  it('dates a fork from the edit that produced it, leaving the co-linked token untouched', () => {
    const store = createAnalysisStore();
    store.dispatch(writeGloss('tok-1', 'cat', 'feline'));
    store.dispatch(writeGloss('tok-2', 'cat', 'feline'));

    setClock(SECOND_WRITE);
    store.dispatch(writeGloss('tok-1', 'cat', 'tomcat'));

    const edited = approvedPair(store.getState().analysis, 'tok-1');
    expect(edited.analysis).toMatchObject({ createdAt: SECOND_WRITE, updatedAt: SECOND_WRITE });
    const sibling = approvedPair(store.getState().analysis, 'tok-2');
    expect(sibling.analysis).toMatchObject({ createdAt: FIRST_WRITE, updatedAt: FIRST_WRITE });
    expect(sibling.link).toMatchObject({ createdAt: FIRST_WRITE, updatedAt: FIRST_WRITE });
  });

  it('keeps the surviving payload dated by its content when an edit re-converges onto it', () => {
    const store = createAnalysisStore();
    store.dispatch(writeGloss('tok-1', 'cat', 'feline'));
    store.dispatch(writeGloss('tok-2', 'cat', 'tomcat'));

    setClock(SECOND_WRITE);
    store.dispatch(writeGloss('tok-2', 'cat', 'feline'));

    const { link, analysis } = approvedPair(store.getState().analysis, 'tok-2');
    expect(store.getState().analysis.analysis.tokenAnalyses).toHaveLength(1);
    expect(analysis).toMatchObject({ createdAt: FIRST_WRITE, updatedAt: FIRST_WRITE });
    expect(link).toMatchObject({ updatedAt: SECOND_WRITE });
  });

  it('stamps only the link when a token approves an existing pool analysis', () => {
    const store = createAnalysisStore();
    store.dispatch(writeGloss('tok-1', 'cat', 'feline'));
    const { analysis } = approvedPair(store.getState().analysis, 'tok-1');
    const analysisId = analysis?.id ?? '';

    setClock(SECOND_WRITE);
    store.dispatch(approveAnalysisForToken({ tokenRef: 'tok-2', surfaceText: 'cat', analysisId }));

    const approved = approvedPair(store.getState().analysis, 'tok-2');
    expect(approved.analysis).toMatchObject({ createdAt: FIRST_WRITE, updatedAt: FIRST_WRITE });
    expect(approved.link).toMatchObject({ createdAt: SECOND_WRITE, updatedAt: SECOND_WRITE });
  });

  it('stamps a morpheme gloss edit on the payload and the link', () => {
    const store = createAnalysisStore();
    store.dispatch(writeMorphemes('tok-1', 'cats', ['cat', 's'], 'en'));
    const [morpheme] = selectApprovedMorphemes(store.getState().analysis, 'tok-1');

    setClock(SECOND_WRITE);
    store.dispatch(
      writeMorphemeGloss({ tokenRef: 'tok-1', morphemeId: morpheme.id, value: 'cat' }),
    );

    const { link, analysis } = approvedPair(store.getState().analysis, 'tok-1');
    expect(analysis).toMatchObject({ createdAt: FIRST_WRITE, updatedAt: SECOND_WRITE });
    expect(link).toMatchObject({ updatedAt: SECOND_WRITE });
  });

  it('stamps a new phrase and its link, then advances both when the phrase is glossed', () => {
    const store = createAnalysisStore();
    const tokens: TokenSnapshot[] = [
      { tokenRef: 'tok-1', surfaceText: 'in' },
      { tokenRef: 'tok-2', surfaceText: 'the' },
    ];
    const { payload } = store.dispatch(createPhrase(tokens));
    const phraseId = payload.id;

    expect(store.getState().analysis.analysis.phraseAnalyses[0]).toMatchObject({
      createdAt: FIRST_WRITE,
      updatedAt: FIRST_WRITE,
    });

    setClock(SECOND_WRITE);
    store.dispatch(writePhraseGloss({ phraseId, value: 'within' }));

    const state = store.getState().analysis.analysis;
    expect(state.phraseAnalyses[0]).toMatchObject({
      createdAt: FIRST_WRITE,
      updatedAt: SECOND_WRITE,
    });
    expect(state.phraseAnalysisLinks[0]).toMatchObject({
      createdAt: FIRST_WRITE,
      updatedAt: SECOND_WRITE,
    });
  });

  it('stamps a phrase link when its token membership changes', () => {
    const store = createAnalysisStore();
    const { payload } = store.dispatch(
      createPhrase([
        { tokenRef: 'tok-1', surfaceText: 'in' },
        { tokenRef: 'tok-2', surfaceText: 'the' },
      ]),
    );

    setClock(SECOND_WRITE);
    store.dispatch(
      updatePhrase({
        phraseId: payload.id,
        tokens: [
          { tokenRef: 'tok-1', surfaceText: 'in' },
          { tokenRef: 'tok-2', surfaceText: 'the' },
          { tokenRef: 'tok-3', surfaceText: 'beginning' },
        ],
      }),
    );

    const state = store.getState().analysis.analysis;
    expect(state.phraseAnalysisLinks[0]).toMatchObject({
      createdAt: FIRST_WRITE,
      updatedAt: SECOND_WRITE,
    });
    expect(state.phraseAnalyses[0]).toMatchObject({ updatedAt: SECOND_WRITE });
  });

  it('stamps a segment free translation on creation and again on edit', () => {
    const store = createAnalysisStore();
    store.dispatch(writeSegmentFreeTranslation('seg-1', 'In the beginning', 'au commencement'));

    setClock(SECOND_WRITE);
    store.dispatch(writeSegmentFreeTranslation('seg-1', 'In the beginning', 'au debut'));

    const state = store.getState().analysis.analysis;
    expect(state.segmentAnalyses[0]).toMatchObject({
      createdAt: FIRST_WRITE,
      updatedAt: SECOND_WRITE,
    });
    expect(state.segmentAnalysisLinks[0]).toMatchObject({
      createdAt: FIRST_WRITE,
      updatedAt: SECOND_WRITE,
    });
  });
});

describe('analysis-keyed reducers', () => {
  /**
   * Builds a store where one payload is shared by two approved tokens, the shape the catalog's
   * whole reason for existing rests on: one row, many usages.
   */
  function makeSharedStore(overrides?: Partial<TokenAnalysis>) {
    const shared: TokenAnalysis = {
      ...FIXTURE_STAMPS,
      id: 'ta-shared',
      surfaceText: 'word',
      gloss: { und: 'first' },
      ...overrides,
    };
    const links: TokenAnalysisLink[] = ['tok-1', 'tok-2'].map((tokenRef) => ({
      ...FIXTURE_STAMPS,
      analysisId: shared.id,
      status: 'approved',
      token: { tokenRef, surfaceText: 'word' },
    }));
    return createAnalysisStore({
      analysis: {
        analysis: { ...emptyAnalysis(), tokenAnalyses: [shared], tokenAnalysisLinks: links },
        analysisLanguage: 'und',
      },
    });
  }

  /**
   * Two payloads for one surface form where the second is linked only as a candidate, the shape a
   * Paratext 9 import lands: a homograph the catalog lists but the suggestion pool never admits.
   * Withholding approval from the shared payload as well leaves neither of them in the pool.
   */
  function makeUnapprovedHomographStore({ approveShared = true } = {}) {
    const shared: TokenAnalysis = {
      ...FIXTURE_STAMPS,
      id: 'ta-shared',
      surfaceText: 'word',
      gloss: { und: 'first' },
    };
    const candidate: TokenAnalysis = {
      ...FIXTURE_STAMPS,
      id: 'ta-candidate',
      surfaceText: 'word',
      gloss: { und: 'candidate' },
    };
    const links: TokenAnalysisLink[] = [
      {
        ...FIXTURE_STAMPS,
        analysisId: shared.id,
        status: approveShared ? 'approved' : 'candidate',
        token: { tokenRef: 'tok-1', surfaceText: 'word' },
      },
      {
        ...FIXTURE_STAMPS,
        analysisId: candidate.id,
        status: 'candidate',
        token: { tokenRef: 'tok-2', surfaceText: 'word' },
      },
    ];
    return createAnalysisStore({
      analysis: {
        analysis: {
          ...emptyAnalysis(),
          tokenAnalyses: [shared, candidate],
          tokenAnalysisLinks: links,
        },
        analysisLanguage: 'und',
      },
    });
  }

  describe('writeAnalysisGloss', () => {
    it('rewrites the gloss for every token linked to the payload', () => {
      const store = makeSharedStore();

      store.dispatch(writeAnalysisGloss({ analysisId: 'ta-shared', value: 'second' }));

      const state = store.getState().analysis;
      expect(selectApprovedGloss(state, 'tok-1')).toBe('second');
      expect(selectApprovedGloss(state, 'tok-2')).toBe('second');
    });

    it('does not fork the shared payload', () => {
      const store = makeSharedStore();

      store.dispatch(writeAnalysisGloss({ analysisId: 'ta-shared', value: 'second' }));

      expect(store.getState().analysis.analysis.tokenAnalyses).toHaveLength(1);
    });

    it('removes the record entirely when the edit empties it', () => {
      const store = makeSharedStore();

      store.dispatch(writeAnalysisGloss({ analysisId: 'ta-shared', value: '  ' }));

      const { tokenAnalyses, tokenAnalysisLinks } = store.getState().analysis.analysis;
      expect(tokenAnalyses).toHaveLength(0);
      expect(tokenAnalysisLinks).toHaveLength(0);
    });

    it('keeps the record when clearing the gloss leaves other content behind', () => {
      const store = makeSharedStore({
        morphemes: [{ id: 'm-1', form: 'word', writingSystem: 'en' }],
      });

      store.dispatch(writeAnalysisGloss({ analysisId: 'ta-shared', value: '' }));

      const { tokenAnalyses } = store.getState().analysis.analysis;
      expect(tokenAnalyses).toHaveLength(1);
      expect(tokenAnalyses[0].gloss).toBeUndefined();
    });

    it('glosses a record that carried none, a breakdown having been entered first', () => {
      const store = makeSharedStore({
        gloss: undefined,
        morphemes: [{ id: 'm-1', form: 'word', writingSystem: 'en' }],
      });

      store.dispatch(writeAnalysisGloss({ analysisId: 'ta-shared', value: 'first' }));

      expect(store.getState().analysis.analysis.tokenAnalyses[0].gloss).toEqual({ und: 'first' });
    });

    it('leaves a record that never carried a gloss alone when the gloss is cleared', () => {
      // Analyzed by its breakdown alone, which is the state a breakdown entered before its glosses
      // sits in — so clearing the gloss it does not have must not disturb the record.
      const store = makeSharedStore({
        gloss: undefined,
        morphemes: [{ id: 'm-1', form: 'word', writingSystem: 'en' }],
      });

      store.dispatch(writeAnalysisGloss({ analysisId: 'ta-shared', value: '' }));

      const { tokenAnalyses } = store.getState().analysis.analysis;
      expect(tokenAnalyses).toHaveLength(1);
      expect(tokenAnalyses[0].gloss).toBeUndefined();
      expect(tokenAnalyses[0].morphemes).toHaveLength(1);
    });

    it('collapses onto a content-identical sibling, leaving the sibling as the survivor', () => {
      const store = makeSharedStore();
      // A second payload for the same word, glossed differently — a homograph the edit will match.
      store.dispatch(writeGloss('tok-3', 'word', 'second'));
      const sibling = store
        .getState()
        .analysis.analysis.tokenAnalyses.find((ta) => ta.id !== 'ta-shared');

      store.dispatch(writeAnalysisGloss({ analysisId: 'ta-shared', value: 'second' }));

      const { tokenAnalyses } = store.getState().analysis.analysis;
      expect(tokenAnalyses).toHaveLength(1);
      expect(tokenAnalyses[0].id).toBe(sibling?.id);
    });

    it('moves the collapsed payload’s links onto the surviving sibling', () => {
      const store = makeSharedStore();
      store.dispatch(writeGloss('tok-3', 'word', 'second'));

      store.dispatch(writeAnalysisGloss({ analysisId: 'ta-shared', value: 'second' }));

      const state = store.getState().analysis;
      expect(selectApprovedGloss(state, 'tok-1')).toBe('second');
      expect(selectApprovedGloss(state, 'tok-2')).toBe('second');
      expect(selectApprovedGloss(state, 'tok-3')).toBe('second');
    });

    it('ignores an analysisId that resolves to no payload', () => {
      const store = makeSharedStore();

      store.dispatch(writeAnalysisGloss({ analysisId: 'nope', value: 'second' }));

      expect(selectApprovedGloss(store.getState().analysis, 'tok-1')).toBe('first');
    });
  });

  describe('writeAnalysisMorphemes', () => {
    it('rewrites the breakdown for every token linked to the payload', () => {
      const store = makeSharedStore();

      store.dispatch(
        writeAnalysisMorphemes({
          analysisId: 'ta-shared',
          forms: ['wor', 'd'],
          writingSystem: 'en',
        }),
      );

      const state = store.getState().analysis;
      expect(selectApprovedMorphemes(state, 'tok-1').map((m) => m.form)).toEqual(['wor', 'd']);
      expect(selectApprovedMorphemes(state, 'tok-2').map((m) => m.form)).toEqual(['wor', 'd']);
    });

    it('does not fork the shared payload', () => {
      const store = makeSharedStore();

      store.dispatch(
        writeAnalysisMorphemes({
          analysisId: 'ta-shared',
          forms: ['wor', 'd'],
          writingSystem: 'en',
        }),
      );

      expect(store.getState().analysis.analysis.tokenAnalyses).toHaveLength(1);
    });

    it('removes the breakdown when given no forms', () => {
      const store = makeSharedStore({
        morphemes: [{ id: 'm-1', form: 'word', writingSystem: 'en' }],
      });

      store.dispatch(
        writeAnalysisMorphemes({ analysisId: 'ta-shared', forms: [], writingSystem: 'en' }),
      );

      expect(store.getState().analysis.analysis.tokenAnalyses[0].morphemes).toBeUndefined();
    });

    it('removes a record whose only content was the breakdown it just lost', () => {
      const store = makeSharedStore({
        gloss: undefined,
        morphemes: [{ id: 'm-1', form: 'word', writingSystem: 'en' }],
      });

      store.dispatch(
        writeAnalysisMorphemes({ analysisId: 'ta-shared', forms: [], writingSystem: 'en' }),
      );

      expect(store.getState().analysis.analysis.tokenAnalyses).toHaveLength(0);
    });

    it('ignores an analysisId that resolves to no payload', () => {
      const store = makeSharedStore();

      store.dispatch(
        writeAnalysisMorphemes({ analysisId: 'nope', forms: ['x'], writingSystem: 'en' }),
      );

      expect(store.getState().analysis.analysis.tokenAnalyses[0].morphemes).toBeUndefined();
    });

    /** A shared payload broken down into a prefix and a stem, each carrying what it was analyzed as. */
    function makeAnnotatedStore() {
      return makeSharedStore({
        surfaceText: 'unhappy',
        morphemes: [
          {
            id: 'm-un',
            form: 'un',
            writingSystem: 'en',
            gloss: { und: 'NEG' },
            entryRef: { authority: 'lexicon', entryId: 'e-un' },
          },
          { id: 'm-happy', form: 'happy', writingSystem: 'en', gloss: { und: 'glad' } },
        ],
      });
    }

    it('keeps an unchanged morpheme whole when a neighbor is re-split', () => {
      const store = makeAnnotatedStore();

      store.dispatch(
        writeAnalysisMorphemes({
          analysisId: 'ta-shared',
          forms: ['un', 'happi'],
          writingSystem: 'en',
        }),
      );

      const [kept] = store.getState().analysis.analysis.tokenAnalyses[0].morphemes ?? [];
      expect(kept).toEqual({
        id: 'm-un',
        form: 'un',
        writingSystem: 'en',
        gloss: { und: 'NEG' },
        entryRef: { authority: 'lexicon', entryId: 'e-un' },
      });
    });

    it('mints a morpheme for a form the old breakdown cannot account for', () => {
      const store = makeAnnotatedStore();

      store.dispatch(
        writeAnalysisMorphemes({
          analysisId: 'ta-shared',
          forms: ['un', 'happi'],
          writingSystem: 'en',
        }),
      );

      const morphemes = store.getState().analysis.analysis.tokenAnalyses[0].morphemes ?? [];
      expect(morphemes[1]).toEqual({
        id: expect.any(String),
        form: 'happi',
        writingSystem: 'en',
      });
      expect(morphemes[1].id).not.toBe('m-happy');
    });

    it('matches a repeated form against a distinct morpheme each time', () => {
      const store = makeSharedStore({
        surfaceText: 'ba ba',
        morphemes: [
          { id: 'm-1', form: 'ba', writingSystem: 'en', gloss: { und: 'first' } },
          { id: 'm-2', form: 'ba', writingSystem: 'en', gloss: { und: 'second' } },
        ],
      });

      store.dispatch(
        writeAnalysisMorphemes({
          analysisId: 'ta-shared',
          forms: ['ba', 'ba'],
          writingSystem: 'en',
        }),
      );

      const morphemes = store.getState().analysis.analysis.tokenAnalyses[0].morphemes ?? [];
      expect(morphemes.map((m) => m.id)).toEqual(['m-1', 'm-2']);
    });

    it('refreshes the writing system on a morpheme it keeps', () => {
      const store = makeAnnotatedStore();

      store.dispatch(
        writeAnalysisMorphemes({
          analysisId: 'ta-shared',
          forms: ['un', 'happy'],
          writingSystem: 'fr',
        }),
      );

      const morphemes = store.getState().analysis.analysis.tokenAnalyses[0].morphemes ?? [];
      expect(morphemes.map((m) => m.writingSystem)).toEqual(['fr', 'fr']);
    });

    it('drops what a form carried when the re-split leaves no morpheme holding it', () => {
      const store = makeAnnotatedStore();

      store.dispatch(
        writeAnalysisMorphemes({
          analysisId: 'ta-shared',
          forms: ['unhappy'],
          writingSystem: 'en',
        }),
      );

      const morphemes = store.getState().analysis.analysis.tokenAnalyses[0].morphemes ?? [];
      expect(morphemes).toEqual([{ id: expect.any(String), form: 'unhappy', writingSystem: 'en' }]);
    });
  });

  describe('writeAnalysisMorphemeGloss', () => {
    /** A shared payload carrying a two-morpheme breakdown, the unit this reducer edits. */
    function makeMorphemeStore() {
      return makeSharedStore({
        morphemes: [
          { id: 'm-1', form: 'wor', writingSystem: 'en' },
          { id: 'm-2', form: 'd', writingSystem: 'en' },
        ],
      });
    }

    it('writes a morpheme gloss for every token linked to the payload', () => {
      const store = makeMorphemeStore();

      store.dispatch(
        writeAnalysisMorphemeGloss({ analysisId: 'ta-shared', morphemeId: 'm-1', value: 'WORD' }),
      );

      const state = store.getState().analysis;
      expect(selectApprovedMorphemes(state, 'tok-1')[0].gloss?.und).toBe('WORD');
      expect(selectApprovedMorphemes(state, 'tok-2')[0].gloss?.und).toBe('WORD');
    });

    it('keeps the morpheme when its gloss is cleared', () => {
      const store = makeMorphemeStore();
      store.dispatch(
        writeAnalysisMorphemeGloss({ analysisId: 'ta-shared', morphemeId: 'm-1', value: 'WORD' }),
      );

      store.dispatch(
        writeAnalysisMorphemeGloss({ analysisId: 'ta-shared', morphemeId: 'm-1', value: '' }),
      );

      const morphemes = selectApprovedMorphemes(store.getState().analysis, 'tok-1');
      expect(morphemes).toHaveLength(2);
      expect(morphemes[0].gloss).toBeUndefined();
    });

    it('ignores a morphemeId the payload does not carry', () => {
      const store = makeMorphemeStore();

      store.dispatch(
        writeAnalysisMorphemeGloss({ analysisId: 'ta-shared', morphemeId: 'nope', value: 'WORD' }),
      );

      expect(selectApprovedMorphemes(store.getState().analysis, 'tok-1')[0].gloss).toBeUndefined();
    });
  });

  describe('deleteAnalysis', () => {
    it('removes the payload and every link to it', () => {
      const store = makeSharedStore();

      store.dispatch(deleteAnalysis({ analysisId: 'ta-shared' }));

      const { tokenAnalyses, tokenAnalysisLinks } = store.getState().analysis.analysis;
      expect(tokenAnalyses).toHaveLength(0);
      expect(tokenAnalysisLinks).toHaveLength(0);
    });

    it('leaves the affected tokens reading as blank', () => {
      const store = makeSharedStore();

      store.dispatch(deleteAnalysis({ analysisId: 'ta-shared' }));

      const state = store.getState().analysis;
      expect(selectApprovedGloss(state, 'tok-1')).toBe('');
      expect(selectApprovedGloss(state, 'tok-2')).toBe('');
    });

    it('leaves a surviving homograph untouched', () => {
      const store = makeSharedStore();
      store.dispatch(writeGloss('tok-3', 'word', 'second'));

      store.dispatch(deleteAnalysis({ analysisId: 'ta-shared' }));

      expect(selectApprovedGloss(store.getState().analysis, 'tok-3')).toBe('second');
    });
  });

  describe('mergeAnalysisInto', () => {
    it('moves every link to the target and drops the source', () => {
      const store = makeSharedStore();
      store.dispatch(writeGloss('tok-3', 'word', 'second'));
      const target = store
        .getState()
        .analysis.analysis.tokenAnalyses.find((ta) => ta.id !== 'ta-shared');

      store.dispatch(
        mergeAnalysisInto({
          sourceAnalysisId: 'ta-shared',
          targetAnalysisId: target?.id ?? '',
        }),
      );

      const { tokenAnalyses } = store.getState().analysis.analysis;
      expect(tokenAnalyses).toHaveLength(1);
      expect(tokenAnalyses[0].id).toBe(target?.id);
    });

    it('sums the usage count onto the target', () => {
      const store = makeSharedStore();
      store.dispatch(writeGloss('tok-3', 'word', 'second'));
      const target = store
        .getState()
        .analysis.analysis.tokenAnalyses.find((ta) => ta.id !== 'ta-shared');

      store.dispatch(
        mergeAnalysisInto({ sourceAnalysisId: 'ta-shared', targetAnalysisId: target?.id ?? '' }),
      );

      const state = store.getState().analysis;
      expect(selectApprovedGloss(state, 'tok-1')).toBe('second');
      expect(selectApprovedGloss(state, 'tok-2')).toBe('second');
      expect(selectApprovedGloss(state, 'tok-3')).toBe('second');
    });

    it('ignores a merge of a record into itself', () => {
      const store = makeSharedStore();

      store.dispatch(
        mergeAnalysisInto({ sourceAnalysisId: 'ta-shared', targetAnalysisId: 'ta-shared' }),
      );

      expect(store.getState().analysis.analysis.tokenAnalyses).toHaveLength(1);
    });

    it('ignores a target that resolves to no payload', () => {
      const store = makeSharedStore();

      store.dispatch(
        mergeAnalysisInto({ sourceAnalysisId: 'ta-shared', targetAnalysisId: 'nope' }),
      );

      expect(selectApprovedGloss(store.getState().analysis, 'tok-1')).toBe('first');
    });

    it('ignores a source that resolves to no payload', () => {
      const store = makeSharedStore();

      store.dispatch(
        mergeAnalysisInto({ sourceAnalysisId: 'nope', targetAnalysisId: 'ta-shared' }),
      );

      expect(store.getState().analysis.analysis.tokenAnalyses).toHaveLength(1);
    });
  });

  describe('selectAnalysisDeletionOutcome', () => {
    it('reports a blank outcome when no homograph survives the deletion', () => {
      const store = makeSharedStore();

      const outcome = selectAnalysisDeletionOutcome(store.getState().analysis, 'ta-shared');

      expect(outcome).toEqual({ kind: 'blank', usageCount: 2 });
    });

    it('reports a fallback outcome naming the gloss the tokens will read', () => {
      const store = makeSharedStore();
      store.dispatch(writeGloss('tok-3', 'word', 'second'));

      const outcome = selectAnalysisDeletionOutcome(store.getState().analysis, 'ta-shared');

      expect(outcome).toEqual({ kind: 'fallback', usageCount: 2, fallbackGloss: 'second' });
    });

    it('omits the fallback gloss when the surviving peer has none in the analysis language', () => {
      const store = makeSharedStore();
      store.dispatch(writeMorphemes('tok-3', 'word', ['wor', 'd'], 'en'));

      const outcome = selectAnalysisDeletionOutcome(store.getState().analysis, 'ta-shared');

      expect(outcome).toMatchObject({ kind: 'fallback', usageCount: 2 });
      expect(outcome?.fallbackGloss).toBeUndefined();
    });

    it('returns undefined for an analysisId that resolves to no payload', () => {
      const store = makeSharedStore();

      expect(selectAnalysisDeletionOutcome(store.getState().analysis, 'nope')).toBeUndefined();
    });

    // The catalog offers a zero-usages filter for exactly this row, so the confirmation it opens
    // has to have a number for one: an analysis nothing approves affects no token at all.
    it('reports no usages for an analysis no token approves', () => {
      const unapproved: TokenAnalysis = {
        ...FIXTURE_STAMPS,
        id: 'ta-unused',
        surfaceText: 'word',
        gloss: { und: 'first' },
      };
      const store = createAnalysisStore({
        analysis: {
          analysis: {
            ...emptyAnalysis(),
            tokenAnalyses: [unapproved],
            tokenAnalysisLinks: [
              {
                ...FIXTURE_STAMPS,
                analysisId: unapproved.id,
                status: 'candidate',
                token: { tokenRef: 'tok-1', surfaceText: 'word' },
              },
            ],
          },
          analysisLanguage: 'und',
        },
      });

      const outcome = selectAnalysisDeletionOutcome(store.getState().analysis, 'ta-unused');

      expect(outcome).toEqual({ kind: 'blank', usageCount: 0 });
    });

    // The confirmation opens from a catalog row, which counts a token once however many approved
    // links carry it to the same analysis. No write path builds a duplicate, so this is the shape
    // imported or hand-edited data arrives in; the two numbers must still agree.
    it('counts a token carrying the same approval twice as one usage', () => {
      const shared: TokenAnalysis = {
        ...FIXTURE_STAMPS,
        id: 'ta-shared',
        surfaceText: 'word',
        gloss: { und: 'first' },
      };
      const duplicated: TokenAnalysisLink[] = ['tok-1', 'tok-1', 'tok-2'].map((tokenRef) => ({
        ...FIXTURE_STAMPS,
        analysisId: shared.id,
        status: 'approved',
        token: { tokenRef, surfaceText: 'word' },
      }));
      const store = createAnalysisStore({
        analysis: {
          analysis: {
            ...emptyAnalysis(),
            tokenAnalyses: [shared],
            tokenAnalysisLinks: duplicated,
          },
          analysisLanguage: 'und',
        },
      });

      const outcome = selectAnalysisDeletionOutcome(store.getState().analysis, 'ta-shared');

      expect(outcome).toEqual({ kind: 'blank', usageCount: 2 });
    });
  });

  describe('selectAnalysisMergePeers', () => {
    it('offers the homographs sharing the row’s surface form', () => {
      const store = makeSharedStore();
      store.dispatch(writeGloss('tok-3', 'word', 'second'));

      const peers = selectAnalysisMergePeers(store.getState().analysis, 'ta-shared');

      expect(peers.map((p) => p.gloss?.und)).toEqual(['second']);
    });

    it('offers nothing when the row has no homograph', () => {
      const store = makeSharedStore();

      expect(selectAnalysisMergePeers(store.getState().analysis, 'ta-shared')).toHaveLength(0);
    });

    it('offers nothing for an analysisId that resolves to no payload', () => {
      const store = makeSharedStore();

      expect(selectAnalysisMergePeers(store.getState().analysis, 'nope')).toHaveLength(0);
    });

    it('offers a homograph no token has approved', () => {
      const store = makeUnapprovedHomographStore();

      const peers = selectAnalysisMergePeers(store.getState().analysis, 'ta-shared');

      expect(peers.map((p) => p.gloss?.und)).toEqual(['candidate']);
    });

    it('offers peers to a row no token has approved', () => {
      const store = makeUnapprovedHomographStore();

      const peers = selectAnalysisMergePeers(store.getState().analysis, 'ta-candidate');

      expect(peers.map((p) => p.gloss?.und)).toEqual(['first']);
    });

    it('pairs two homographs that both went unapproved', () => {
      const store = makeUnapprovedHomographStore({ approveShared: false });

      const peers = selectAnalysisMergePeers(store.getState().analysis, 'ta-candidate');

      expect(peers.map((p) => p.gloss?.und)).toEqual(['first']);
    });

    it('ranks a peer by approvals, leaving an unapproved one last', () => {
      const store = makeUnapprovedHomographStore();
      // A second approval puts 'first' ahead of the newly-approved payload on frequency, so the
      // ordering under test is the frequency rank rather than the id tiebreak behind it.
      store.dispatch(
        approveAnalysisForToken({
          tokenRef: 'tok-4',
          surfaceText: 'word',
          analysisId: 'ta-shared',
        }),
      );
      store.dispatch(writeGloss('tok-3', 'word', 'third'));

      const peers = selectAnalysisMergePeers(store.getState().analysis, 'ta-candidate');

      expect(peers.map((p) => p.gloss?.und)).toEqual(['first', 'third']);
    });
  });
});
