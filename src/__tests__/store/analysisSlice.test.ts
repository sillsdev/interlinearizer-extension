/** @file Unit tests for store/analysisSlice.ts. */
/// <reference types="jest" />

import type {
  PhraseAnalysisLink,
  TextAnalysis,
  TokenAnalysis,
  TokenAnalysisLink,
  TokenSnapshot,
} from 'interlinearizer';
import { createAnalysisStore } from '../../store';
import {
  createPhrase,
  defaultAnalysis,
  defaultState,
  deletePhrase,
  selectApprovedGloss,
  selectPhraseLinkByTokenRef,
  selectPhraseAnalysisById,
  selectPhraseLinks,
  setAnalysis,
  updatePhrase,
  writeGloss,
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
    ...defaultAnalysis,
    tokenAnalyses: [ta],
    tokenAnalysisLinks: [makeApprovedLink(ta)],
  };
}

describe('setAnalysis', () => {
  it('replaces the full analysis in state', () => {
    const store = createAnalysisStore();
    const next = makeAnalysis({ id: 'ta-1', surfaceText: 'word', gloss: { und: 'hi' } });

    store.dispatch(setAnalysis(next));

    expect(store.getState().analysis.analysis).toStrictEqual(next);
  });

  it('does not mutate analysisLanguage', () => {
    const store = createAnalysisStore({ analysis: { ...defaultState, analysisLanguage: 'fr' } });
    store.dispatch(setAnalysis(defaultAnalysis));
    expect(store.getState().analysis.analysisLanguage).toBe('fr');
  });
});

describe('writeGloss', () => {
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
 * Builds a minimal approved `PhraseAnalysisLink` fixture for testing.
 *
 * @param phraseId - The ID for the `PhraseAnalysis` and its link.
 * @param tokenRefs - Token refs to include in the phrase.
 * @returns A `PhraseAnalysisLink` with `status: 'approved'`.
 */
function makePhraseLink(phraseId: string, tokenRefs: string[]): PhraseAnalysisLink {
  const tokens: TokenSnapshot[] = tokenRefs.map((ref) => ({ tokenRef: ref, surfaceText: ref }));
  return { analysisId: phraseId, status: 'approved', tokens };
}

/**
 * Builds a `TextAnalysis` seeded with the given approved phrase link.
 *
 * @param link - The `PhraseAnalysisLink` to include.
 * @returns A `TextAnalysis` with the link and its corresponding `PhraseAnalysis`.
 */
function makeAnalysisWithPhrase(link: PhraseAnalysisLink): TextAnalysis {
  return {
    ...defaultAnalysis,
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

  it('preserves the phrase analysis id', () => {
    const existing = makePhraseLink('phrase-1', ['tok-a']);
    const store = createAnalysisStore({
      analysis: { analysis: makeAnalysisWithPhrase(existing), analysisLanguage: 'und' },
    });

    store.dispatch(updatePhrase({ phraseId: 'phrase-1', tokens: [] }));

    expect(store.getState().analysis.analysis.phraseAnalysisLinks[0].analysisId).toBe('phrase-1');
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
          ...defaultAnalysis,
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
      ...defaultAnalysis,
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

describe('selectPhraseAnalysisById', () => {
  it('returns the PhraseAnalysis for a known id', () => {
    const link = makePhraseLink('phrase-1', ['tok-a']);
    const store = createAnalysisStore({
      analysis: { analysis: makeAnalysisWithPhrase(link), analysisLanguage: 'und' },
    });

    const result = selectPhraseAnalysisById(store.getState().analysis, 'phrase-1');

    expect(result?.id).toBe('phrase-1');
  });

  it('returns undefined for an unknown id', () => {
    const store = createAnalysisStore();

    const result = selectPhraseAnalysisById(store.getState().analysis, 'nonexistent');

    expect(result).toBeUndefined();
  });
});
