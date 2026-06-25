/** @file Unit tests for store/analysisSlice.ts. */
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
import { makePhraseLink } from '../test-helpers';
import { emptyAnalysis } from '../../types/empty-factories';
import {
  createPhrase,
  deleteMorphemes,
  deletePhrase,
  forkAnalysisForToken,
  mergePhrases,
  selectApprovedGloss,
  selectApprovedLinkCountForPayload,
  selectApprovedMorphemes,
  selectPhraseLinkByTokenRef,
  selectPhraseGloss,
  selectPhraseLinks,
  selectSegmentFreeTranslation,
  updatePhrase,
  writeGloss,
  writeMorphemeGloss,
  writeMorphemes,
  writePhraseGloss,
  writeSegmentFreeTranslation,
} from '../../store/analysisSlice';

/**
 * Builds an approved `TokenAnalysisLink` for `tok-1` pointing at the given `TokenAnalysis`.
 *
 * @param ta - The `TokenAnalysis` the link should reference.
 * @returns A `TokenAnalysisLink` with `status: 'approved'` and `tokenRef: 'tok-1'`.
 */
function makeApprovedLink(ta: TokenAnalysis): TokenAnalysisLink {
  return {
    analysisId: ta.id,
    status: 'approved',
    token: { tokenRef: 'tok-1', surfaceText: ta.surfaceText },
  };
}

/**
 * Builds a minimal `TextAnalysis` with a single approved link for `tok-1`/`ta-1`.
 *
 * @param ta - The `TokenAnalysis` payload to include.
 * @returns A `TextAnalysis` seeded with one approved token analysis link.
 */
function makeAnalysis(ta: TokenAnalysis): TextAnalysis {
  return {
    ...emptyAnalysis(),
    tokenAnalyses: [ta],
    tokenAnalysisLinks: [makeApprovedLink(ta)],
  };
}

describe('writeGloss', () => {
  it('removes an orphaned approved link and creates a fresh one', () => {
    // Orphaned state: an approved link whose analysisId has no matching TokenAnalysis.
    const orphanLink: TokenAnalysisLink = {
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
        analysis: makeAnalysis({ id: 'ta-1', surfaceText: 'word' }),
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
        analysis: makeAnalysis({ id: 'ta-1', surfaceText: 'word', gloss: { und: 'hi' } }),
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
        analysis: makeAnalysis({ id: 'ta-1', surfaceText: 'word', gloss: { und: 'hi' } }),
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
});

describe('forkAnalysisForToken', () => {
  it('clones a shared payload and repoints only the forking token to the clone', () => {
    const store = createAnalysisStore();
    store.dispatch(writeGloss('tok-1', 'the', 'def'));
    store.dispatch(writeGloss('tok-2', 'the', 'def'));

    store.dispatch(forkAnalysisForToken('tok-1'));

    const { tokenAnalyses, tokenAnalysisLinks } = store.getState().analysis.analysis;
    expect(tokenAnalyses).toHaveLength(2);
    const tok1 = tokenAnalysisLinks.find((l) => l.token.tokenRef === 'tok-1');
    const tok2 = tokenAnalysisLinks.find((l) => l.token.tokenRef === 'tok-2');
    expect(tok1?.analysisId).toBeDefined();
    expect(tok1?.analysisId).not.toBe(tok2?.analysisId);
  });

  it('lets a forked token be edited without affecting the original payload', () => {
    const store = createAnalysisStore();
    store.dispatch(writeGloss('tok-1', 'the', 'def'));
    store.dispatch(writeGloss('tok-2', 'the', 'def'));

    store.dispatch(forkAnalysisForToken('tok-1'));
    store.dispatch(writeGloss('tok-1', 'the', 'changed'));

    expect(selectApprovedGloss(store.getState().analysis, 'tok-1')).toBe('changed');
    expect(selectApprovedGloss(store.getState().analysis, 'tok-2')).toBe('def');
  });

  it('no-ops when the token has no approved analysis', () => {
    const store = createAnalysisStore();

    store.dispatch(forkAnalysisForToken('tok-x'));

    expect(store.getState().analysis.analysis.tokenAnalyses).toHaveLength(0);
  });

  it('no-ops when the payload is not shared (sole link)', () => {
    const store = createAnalysisStore();
    store.dispatch(writeGloss('tok-1', 'the', 'def'));

    store.dispatch(forkAnalysisForToken('tok-1'));

    expect(store.getState().analysis.analysis.tokenAnalyses).toHaveLength(1);
  });
});

describe('selectApprovedLinkCountForPayload', () => {
  it('returns 0 when the token has no approved analysis', () => {
    const store = createAnalysisStore();
    expect(selectApprovedLinkCountForPayload(store.getState().analysis, 'tok-x')).toBe(0);
  });

  it('returns 1 for a payload occupied by a single token', () => {
    const store = createAnalysisStore();
    store.dispatch(writeGloss('tok-1', 'the', 'def'));
    expect(selectApprovedLinkCountForPayload(store.getState().analysis, 'tok-1')).toBe(1);
  });

  it('returns the shared count for every token on a shared payload', () => {
    const store = createAnalysisStore();
    store.dispatch(writeGloss('tok-1', 'the', 'def'));
    store.dispatch(writeGloss('tok-2', 'the', 'def'));

    expect(selectApprovedLinkCountForPayload(store.getState().analysis, 'tok-1')).toBe(2);
    expect(selectApprovedLinkCountForPayload(store.getState().analysis, 'tok-2')).toBe(2);
  });

  it('drops back to 1 for each token after one forks off a shared payload', () => {
    const store = createAnalysisStore();
    store.dispatch(writeGloss('tok-1', 'the', 'def'));
    store.dispatch(writeGloss('tok-2', 'the', 'def'));

    store.dispatch(forkAnalysisForToken('tok-1'));

    expect(selectApprovedLinkCountForPayload(store.getState().analysis, 'tok-1')).toBe(1);
    expect(selectApprovedLinkCountForPayload(store.getState().analysis, 'tok-2')).toBe(1);
  });
});

describe('link-based cleanup', () => {
  it('clearing a gloss on a shared payload drops only the editing link, never orphaning others', () => {
    const store = createAnalysisStore();
    store.dispatch(writeGloss('tok-1', 'the', 'def'));
    store.dispatch(writeGloss('tok-2', 'the', 'def'));

    store.dispatch(writeGloss('tok-1', 'the', ''));

    const { tokenAnalyses, tokenAnalysisLinks } = store.getState().analysis.analysis;
    // The editing token is unlinked; the co-linked token's link still resolves to a live payload.
    expect(tokenAnalysisLinks.some((l) => l.token.tokenRef === 'tok-1')).toBe(false);
    const tok2Link = tokenAnalysisLinks.find((l) => l.token.tokenRef === 'tok-2');
    expect(tok2Link).toBeDefined();
    expect(tokenAnalyses.some((ta) => ta.id === tok2Link?.analysisId)).toBe(true);
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

    const { tokenAnalyses, tokenAnalysisLinks } = store.getState().analysis.analysis;
    expect(tokenAnalysisLinks.some((l) => l.token.tokenRef === 'tok-1')).toBe(false);
    const tok2Link = tokenAnalysisLinks.find((l) => l.token.tokenRef === 'tok-2');
    expect(tokenAnalyses.some((ta) => ta.id === tok2Link?.analysisId)).toBe(true);
  });
});

describe('selectApprovedGloss', () => {
  it('returns empty string when the approved analysis has no gloss for the language', () => {
    // Approved analysis exists but has no gloss entry for the requested language.
    const store = createAnalysisStore({
      analysis: {
        analysis: makeAnalysis({ id: 'ta-1', surfaceText: 'word', gloss: { fr: 'bonjour' } }),
        analysisLanguage: 'en',
      },
    });

    expect(selectApprovedGloss(store.getState().analysis, 'tok-1')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Phrase reducers
// ---------------------------------------------------------------------------

/**
 * Builds a `TextAnalysis` seeded with the given approved phrase link.
 *
 * @param link - The `PhraseAnalysisLink` to include.
 * @returns A `TextAnalysis` with the link and its corresponding `PhraseAnalysis`.
 */
function makeAnalysisWithPhrase(link: PhraseAnalysisLink): TextAnalysis {
  return {
    ...emptyAnalysis(),
    phraseAnalyses: [{ id: link.analysisId, surfaceText: 'phrase' }],
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
            { id: 'phrase-1', surfaceText: 'A' },
            { id: 'phrase-2', surfaceText: 'B' },
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
            { id: 'phrase-1', surfaceText: 'A' },
            { id: 'phrase-2', surfaceText: 'B' },
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
          phraseAnalyses: [{ id: 'phrase-1', surfaceText: 'A' }],
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

// ---------------------------------------------------------------------------
// Phrase selectors
// ---------------------------------------------------------------------------

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
        { id: 'phrase-1', surfaceText: 'A' },
        { id: 'phrase-2', surfaceText: 'B' },
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
 * Builds a `TextAnalysis` seeded with a single approved `SegmentAnalysis` for `seg-1`.
 *
 * @param analysis - The `SegmentAnalysis` payload to include.
 * @param link - Optional override for the link; defaults to an approved link for `seg-1`.
 * @returns A `TextAnalysis` with the segment analysis and its link.
 */
function makeAnalysisWithSegment(
  analysis: SegmentAnalysis,
  link?: SegmentAnalysisLink,
): TextAnalysis {
  return {
    ...emptyAnalysis(),
    segmentAnalyses: [analysis],
    segmentAnalysisLinks: [
      link ?? { analysisId: analysis.id, status: 'approved', segmentId: 'seg-1' },
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
      { analysisId: segmentAnalyses[0].id, status: 'approved', segmentId: 'seg-1' },
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
          segmentAnalysisLinks: [{ analysisId: 'gone', status: 'approved', segmentId: 'seg-1' }],
        },
        analysisLanguage: 'und',
      },
    });

    expect(selectSegmentFreeTranslation(store.getState().analysis, 'seg-1')).toBe('');
  });

  it('returns empty string when the analysis has no free translation for the active language', () => {
    const seeded = makeAnalysisWithSegment({ id: 'sa-1', surfaceText: 'surface' });
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

  it('removes an orphaned approved link and creates a fresh analysis', () => {
    const orphanLink: TokenAnalysisLink = {
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
    const ta: TokenAnalysis = { id: 'ta-1', surfaceText: 'hello' };
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
});

describe('deleteMorphemes', () => {
  it('removes the morphemes but keeps the analysis when it has a gloss', () => {
    const ta: TokenAnalysis = {
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

  it('no-ops when the token has no approved link', () => {
    const ta: TokenAnalysis = {
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
    const ta: TokenAnalysis = { id: 'ta-1', surfaceText: 'word', gloss: { und: 'hi' } };
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
      id: 'ta-1',
      surfaceText: 'word',
      glossSenseRef: { senseId: 'sense-1' },
      morphemes: [{ id: 'm-1', form: 'word', writingSystem: 'und' }],
    };
    const store = createAnalysisStore({
      analysis: { analysis: makeAnalysis(ta), analysisLanguage: 'und' },
    });

    store.dispatch(deleteMorphemes({ tokenRef: 'tok-1' }));

    const { tokenAnalyses, tokenAnalysisLinks } = store.getState().analysis.analysis;
    expect(tokenAnalyses).toHaveLength(1);
    expect(tokenAnalyses[0].morphemes).toBeUndefined();
    expect(tokenAnalyses[0].glossSenseRef).toStrictEqual({ senseId: 'sense-1' });
    expect(tokenAnalysisLinks).toHaveLength(1);
  });

  it('repairs an orphaned approved link by removing it', () => {
    const orphanLink: TokenAnalysisLink = {
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
});

describe('selectApprovedMorphemes', () => {
  it('returns morphemes from the approved analysis', () => {
    const ta: TokenAnalysis = {
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
    const ta: TokenAnalysis = { id: 'ta-1', surfaceText: 'word' };
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
