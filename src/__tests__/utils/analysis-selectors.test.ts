/// <reference types="jest" />

import type {
  AssignmentStatus,
  MorphemeAnalysis,
  PhraseAnalysis,
  PhraseAnalysisLink,
  SegmentAnalysis,
  SegmentAnalysisLink,
  TextAnalysis,
  TokenAnalysis,
  TokenAnalysisLink,
} from 'interlinearizer';
import {
  morphemeFormsLostByResplit,
  selectAnalysisDeletionOutcome,
  selectApprovedGloss,
  selectApprovedGlossSenseRef,
  selectApprovedMorphemes,
  selectMorphemePayloadIsSolelyOwned,
  selectMorphemeResetLosesAnnotation,
  selectPhraseLinkById,
  selectPhraseLinkByTokenRef,
  selectPhraseGloss,
  selectPhraseSenseRef,
  selectPhraseLinks,
  selectPoolIndex,
  selectResolvedTokenAnalysis,
  selectSuggestionAfterClearing,
  selectSegmentFreeTranslation,
  selectSegmentsWithApprovedTranslation,
  selectStaleFreeTranslations,
  selectStaleTokenLinks,
  selectFreeTranslationsBySegment,
  selectStaleMorphemesAnalysisId,
  selectUnapprovedTokenAnalysis,
  type AnalysisState,
} from '../../utils/analysis-selectors';
import { emptyAnalysis } from '../../types/empty-factories';
import { makePhraseLink, FIXTURE_STAMPS } from '../test-helpers';

/** A stand-in for a store holding `preloaded`, for selectors to read through `getState`. */
function createAnalysisStore(
  preloaded: { analysis: AnalysisState } = {
    analysis: { analysis: emptyAnalysis(), analysisLanguage: 'und' },
  },
) {
  return { getState: () => preloaded };
}

/**
 * Builds an approved {@link TokenAnalysisLink} for `tok-1` pointing at the given
 * {@link TokenAnalysis}.
 */
function makeApprovedLink(ta: TokenAnalysis): TokenAnalysisLink {
  return {
    id: `tok-1:${ta.id}`,
    ...FIXTURE_STAMPS,
    analysisId: ta.id,
    status: 'approved',
    token: { tokenRef: 'tok-1', surfaceText: ta.surfaceText },
  };
}

/** Builds a link from `tokenRef` to `ta` at the given review status. */
function makeLink(
  ta: TokenAnalysis,
  tokenRef: string,
  status: AssignmentStatus,
): TokenAnalysisLink {
  return {
    id: `${tokenRef}:${ta.id}:${status}`,
    ...FIXTURE_STAMPS,
    analysisId: ta.id,
    status,
    token: { tokenRef, surfaceText: ta.surfaceText },
  };
}

/** Builds a `logos` {@link TokenAnalysis} glossed in English. */
function logos(id: string, gloss: string): TokenAnalysis {
  return { ...FIXTURE_STAMPS, id, surfaceText: 'logos', gloss: { en: gloss } };
}

/** Builds an English-language analysis state from token analyses and their links. */
function tokenState(
  tokenAnalyses: TokenAnalysis[],
  tokenAnalysisLinks: TokenAnalysisLink[],
): { analysis: AnalysisState } {
  return {
    analysis: {
      analysis: { ...emptyAnalysis(), tokenAnalyses, tokenAnalysisLinks },
      analysisLanguage: 'en',
    },
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

describe('selectApprovedGlossSenseRef', () => {
  const SENSE = { authority: 'fw-lite', projectId: 'lex', senseId: 's-1' };

  it("returns the sense ref on the token's approved analysis", () => {
    const store = createAnalysisStore({
      analysis: {
        analysis: makeAnalysis({
          ...FIXTURE_STAMPS,
          id: 'ta-1',
          surfaceText: 'word',
          glossSenseRef: SENSE,
        }),
        analysisLanguage: 'en',
      },
    });

    expect(selectApprovedGlossSenseRef(store.getState().analysis, 'tok-1')).toEqual(SENSE);
  });

  it('returns undefined for a token with no approved analysis', () => {
    const store = createAnalysisStore();

    expect(selectApprovedGlossSenseRef(store.getState().analysis, 'tok-1')).toBeUndefined();
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

describe('selectPhraseGloss', () => {
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

describe('selectPhraseSenseRef', () => {
  it("returns the sense ref on the phrase's payload", () => {
    const sense = { authority: 'fw-lite', projectId: 'lex', senseId: 's-1' };
    const link = makePhraseLink('phrase-1', ['tok-a']);
    const analysis = makeAnalysisWithPhrase(link);
    analysis.phraseAnalyses[0].senseRef = sense;
    const store = createAnalysisStore({ analysis: { analysis, analysisLanguage: 'und' } });

    expect(selectPhraseSenseRef(store.getState().analysis, 'phrase-1')).toEqual(sense);
  });

  it('returns undefined when the phrase id is not found', () => {
    const store = createAnalysisStore();

    expect(selectPhraseSenseRef(store.getState().analysis, 'nonexistent')).toBeUndefined();
  });
});

describe('phrase payload sharing', () => {
  const NOW = '2026-05-01T12:00:00.000Z';

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date(NOW));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const NOT: PhraseAnalysis = {
    ...FIXTURE_STAMPS,
    id: 'pa-not',
    surfaceText: 'ne pas',
    gloss: { en: 'not' },
  };

  /** An approved occurrence `id` over `tokenRefs`, reading the payload `analysisId`. */
  function occurrence(id: string, analysisId: string, tokenRefs: string[]): PhraseAnalysisLink {
    return { ...makePhraseLink(id, tokenRefs), analysisId };
  }

  function phraseStore(
    phraseAnalyses: PhraseAnalysis[],
    phraseAnalysisLinks: PhraseAnalysisLink[],
  ) {
    return createAnalysisStore({
      analysis: {
        analysis: { ...emptyAnalysis(), phraseAnalyses, phraseAnalysisLinks },
        analysisLanguage: 'en',
      },
    });
  }

  describe('selectors', () => {
    it('reads the gloss through the occurrence rather than the payload id', () => {
      const store = phraseStore([NOT], [occurrence('occ-1', 'pa-not', ['tok-1'])]);

      expect(selectPhraseGloss(store.getState().analysis, 'occ-1')).toBe('not');
      expect(selectPhraseGloss(store.getState().analysis, 'pa-not')).toBe('');
    });

    it('indexes each approved occurrence of a shared payload by its link id', () => {
      const store = phraseStore(
        [NOT],
        [occurrence('occ-1', 'pa-not', ['tok-1']), occurrence('occ-2', 'pa-not', ['tok-2'])],
      );

      expect([...selectPhraseLinkById(store.getState().analysis).keys()]).toEqual([
        'occ-1',
        'occ-2',
      ]);
    });
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
        id: 'sl-1',
        ...FIXTURE_STAMPS,
        analysisId: analysis.id,
        status: 'approved',
        segmentId: 'seg-1',
      },
    ],
  };
}

/** Builds a free translation of `segmentId`, read in `und` unless given, and its link at `status`. */
function segmentTranslation(
  id: string,
  segmentId: string,
  status: AssignmentStatus,
  freeTranslation: Record<string, string> = { und: `translation ${id}` },
): { analysis: SegmentAnalysis; link: SegmentAnalysisLink } {
  return {
    analysis: { ...FIXTURE_STAMPS, id, surfaceText: 'old text', freeTranslation },
    link: { id: `${segmentId}:${id}`, ...FIXTURE_STAMPS, analysisId: id, status, segmentId },
  };
}

/** Builds a `und` analysis state holding the given free translations. */
function segmentState(
  ...translations: { analysis: SegmentAnalysis; link: SegmentAnalysisLink }[]
): { analysis: AnalysisState } {
  return {
    analysis: {
      analysis: {
        ...emptyAnalysis(),
        segmentAnalyses: translations.map((t) => t.analysis),
        segmentAnalysisLinks: translations.map((t) => t.link),
      },
      analysisLanguage: 'und',
    },
  };
}

describe('selectStaleFreeTranslations', () => {
  it('lists a stale translation with its text in the active language', () => {
    const store = createAnalysisStore(
      segmentState(segmentTranslation('sa-1', 'seg-1', 'stale', { und: 'old' })),
    );

    expect(selectStaleFreeTranslations(store.getState().analysis)).toEqual([
      { analysisId: 'sa-1', segmentId: 'seg-1', text: 'old' },
    ]);
  });

  it('lists a stale translation holding nothing in the active language with empty text', () => {
    const store = createAnalysisStore(
      segmentState(segmentTranslation('sa-1', 'seg-1', 'stale', { fr: 'ancien' })),
    );

    expect(selectStaleFreeTranslations(store.getState().analysis)[0].text).toBe('');
  });

  it('leaves an approved translation out', () => {
    const store = createAnalysisStore(
      segmentState(segmentTranslation('sa-1', 'seg-1', 'approved')),
    );

    expect(selectStaleFreeTranslations(store.getState().analysis)).toEqual([]);
  });

  it('leaves out a stale link whose record is missing', () => {
    const { link } = segmentTranslation('sa-1', 'seg-1', 'stale');
    const store = createAnalysisStore({
      analysis: {
        analysis: { ...emptyAnalysis(), segmentAnalysisLinks: [link] },
        analysisLanguage: 'und',
      },
    });

    expect(selectStaleFreeTranslations(store.getState().analysis)).toEqual([]);
  });
});

describe('selectStaleTokenLinks', () => {
  it('lists a stale link', () => {
    const ta = logos('ta-1', 'word');
    const stale = makeLink(ta, 'tok-1', 'stale');
    const store = createAnalysisStore(tokenState([ta], [stale]));

    expect(selectStaleTokenLinks(store.getState().analysis)).toEqual([stale]);
  });

  it('leaves out a link of any other status', () => {
    const ta = logos('ta-1', 'word');
    const store = createAnalysisStore(tokenState([ta], [makeLink(ta, 'tok-1', 'approved')]));

    expect(selectStaleTokenLinks(store.getState().analysis)).toEqual([]);
  });

  it('leaves out a stale link whose payload is missing', () => {
    const ta = logos('ta-1', 'word');
    const store = createAnalysisStore(tokenState([], [makeLink(ta, 'tok-1', 'stale')]));

    expect(selectStaleTokenLinks(store.getState().analysis)).toEqual([]);
  });
});

describe('selectSegmentsWithApprovedTranslation', () => {
  it('lists a segment holding an approved translation', () => {
    const store = createAnalysisStore(
      segmentState(segmentTranslation('sa-1', 'seg-1', 'approved')),
    );

    expect(selectSegmentsWithApprovedTranslation(store.getState().analysis)).toEqual(
      new Set(['seg-1']),
    );
  });

  it('leaves out a segment holding only a stale translation', () => {
    const store = createAnalysisStore(segmentState(segmentTranslation('sa-1', 'seg-1', 'stale')));

    expect(selectSegmentsWithApprovedTranslation(store.getState().analysis)).toEqual(new Set());
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
            {
              id: 'sl-4',
              ...FIXTURE_STAMPS,
              analysisId: 'gone',
              status: 'approved',
              segmentId: 'seg-1',
            },
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

describe('selectFreeTranslationsBySegment', () => {
  it('maps a segment to its free translation in the active language', () => {
    const seeded = makeAnalysisWithSegment({
      ...FIXTURE_STAMPS,
      id: 'sa-1',
      surfaceText: 'surface',
      freeTranslation: { und: 'value' },
    });
    const store = createAnalysisStore({ analysis: { analysis: seeded, analysisLanguage: 'und' } });

    expect(selectFreeTranslationsBySegment(store.getState().analysis)).toEqual(
      new Map([['seg-1', 'value']]),
    );
  });

  it('omits a segment whose free translation is empty in the active language', () => {
    const seeded = makeAnalysisWithSegment({
      ...FIXTURE_STAMPS,
      id: 'sa-1',
      surfaceText: 'surface',
      freeTranslation: { fr: 'valeur' },
    });
    const store = createAnalysisStore({ analysis: { analysis: seeded, analysisLanguage: 'und' } });

    expect(selectFreeTranslationsBySegment(store.getState().analysis).size).toBe(0);
  });

  it('omits a segment whose only link is unapproved', () => {
    const seeded = makeAnalysisWithSegment({
      ...FIXTURE_STAMPS,
      id: 'sa-1',
      surfaceText: 'surface',
      freeTranslation: { und: 'value' },
    });
    const store = createAnalysisStore({
      analysis: {
        analysis: {
          ...seeded,
          segmentAnalysisLinks: seeded.segmentAnalysisLinks.map((l) => ({
            ...l,
            status: 'rejected',
          })),
        },
        analysisLanguage: 'und',
      },
    });

    expect(selectFreeTranslationsBySegment(store.getState().analysis).size).toBe(0);
  });

  it('omits a segment whose approved link points at a missing analysis', () => {
    const store = createAnalysisStore({
      analysis: {
        analysis: {
          ...emptyAnalysis(),
          segmentAnalysisLinks: [
            {
              id: 'sl-5',
              ...FIXTURE_STAMPS,
              analysisId: 'gone',
              status: 'approved',
              segmentId: 'seg-1',
            },
          ],
        },
        analysisLanguage: 'und',
      },
    });

    expect(selectFreeTranslationsBySegment(store.getState().analysis).size).toBe(0);
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

describe('selectUnapprovedTokenAnalysis', () => {
  it("returns the token's own unapproved record", () => {
    const suggested = logos('ta-1', 'word');
    const state = createAnalysisStore(
      tokenState([suggested], [makeLink(suggested, 'tok-1', 'suggested')]),
    ).getState().analysis;

    expect(selectUnapprovedTokenAnalysis(state, 'tok-1')).toBe(state.analysis.tokenAnalyses[0]);
  });

  it('skips a record with no gloss in the active language for a later glossed one', () => {
    const french: TokenAnalysis = { ...logos('ta-1', 'word'), gloss: { fr: 'mot' } };
    const english = logos('ta-2', 'word');
    const state = createAnalysisStore(
      tokenState(
        [french, english],
        [makeLink(french, 'tok-1', 'suggested'), makeLink(english, 'tok-1', 'candidate')],
      ),
    ).getState().analysis;

    expect(selectUnapprovedTokenAnalysis(state, 'tok-1')).toBe(state.analysis.tokenAnalyses[1]);
  });

  it('falls back to the first record when none is glossed in the active language', () => {
    const french: TokenAnalysis = { ...logos('ta-1', 'word'), gloss: { fr: 'mot' } };
    const unglossed: TokenAnalysis = { ...FIXTURE_STAMPS, id: 'ta-2', surfaceText: 'logos' };
    const state = createAnalysisStore(
      tokenState(
        [french, unglossed],
        [makeLink(french, 'tok-1', 'suggested'), makeLink(unglossed, 'tok-1', 'candidate')],
      ),
    ).getState().analysis;

    expect(selectUnapprovedTokenAnalysis(state, 'tok-1')).toBe(state.analysis.tokenAnalyses[0]);
  });

  it('returns undefined for a token with an approval', () => {
    const approved = logos('ta-1', 'word');
    const suggested = logos('ta-2', 'speech');
    const state = createAnalysisStore(
      tokenState(
        [approved, suggested],
        [makeLink(approved, 'tok-1', 'approved'), makeLink(suggested, 'tok-1', 'suggested')],
      ),
    ).getState().analysis;

    expect(selectUnapprovedTokenAnalysis(state, 'tok-1')).toBeUndefined();
  });

  it('returns undefined for a token holding no record', () => {
    const suggested = logos('ta-1', 'word');
    const state = createAnalysisStore(
      tokenState([suggested], [makeLink(suggested, 'tok-2', 'suggested')]),
    ).getState().analysis;

    expect(selectUnapprovedTokenAnalysis(state, 'tok-1')).toBeUndefined();
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
        id: 'tl-16',
        ...FIXTURE_STAMPS,
        analysisId: 'ta-1',
        status: 'approved',
        token: { tokenRef: 'tok-1', surfaceText: 'logos' },
      },
      {
        id: 'tl-17',
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
        id: 'tl-18',
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
    // `alternatives` so the dropdown can still offer re-promotion.
    expect(selectResolvedTokenAnalysis(store.getState().analysis, 'tok-1', 'word')).toEqual({
      status: 'approved',
      analysis: ta,
      alternatives: { suggested: ta, candidates: [] },
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

  it("offers an unapproved token's persisted suggested analysis", () => {
    const imported = logos('ta-imported', 'word');
    const store = createAnalysisStore(
      tokenState([imported], [makeLink(imported, 'tok-1', 'suggested')]),
    );

    expect(selectResolvedTokenAnalysis(store.getState().analysis, 'tok-1', 'logos')).toEqual({
      status: 'suggested',
      suggested: imported,
      candidates: [],
    });
  });

  it("ranks a token's persisted analyses ahead of the pool's match", () => {
    const pooled = logos('ta-pooled', 'word');
    const imported = logos('ta-imported', 'speech');
    const store = createAnalysisStore(
      tokenState(
        [pooled, imported],
        [makeLink(pooled, 'tok-other', 'approved'), makeLink(imported, 'tok-1', 'suggested')],
      ),
    );

    expect(selectResolvedTokenAnalysis(store.getState().analysis, 'tok-1', 'logos')).toEqual({
      status: 'suggested',
      suggested: imported,
      candidates: [pooled],
    });
  });

  it("ranks a token's suggested links ahead of its candidate links", () => {
    const candidate = logos('ta-candidate', 'speech');
    const suggested = logos('ta-suggested', 'word');
    const store = createAnalysisStore(
      tokenState(
        [candidate, suggested],
        [makeLink(candidate, 'tok-1', 'candidate'), makeLink(suggested, 'tok-1', 'suggested')],
      ),
    );

    expect(selectResolvedTokenAnalysis(store.getState().analysis, 'tok-1', 'logos')).toEqual({
      status: 'suggested',
      suggested,
      candidates: [candidate],
    });
  });

  it('does not offer a rejected analysis', () => {
    const rejected = logos('ta-rejected', 'word');
    const store = createAnalysisStore(
      tokenState([rejected], [makeLink(rejected, 'tok-1', 'rejected')]),
    );

    expect(
      selectResolvedTokenAnalysis(store.getState().analysis, 'tok-1', 'logos'),
    ).toBeUndefined();
  });

  it('does not offer any of several analyses the token rejected', () => {
    const word = logos('ta-word', 'word');
    const speech = logos('ta-speech', 'speech');
    const store = createAnalysisStore(
      tokenState(
        [word, speech],
        [
          makeLink(word, 'tok-1', 'rejected'),
          makeLink(speech, 'tok-1', 'rejected'),
          makeLink(word, 'tok-2', 'approved'),
          makeLink(speech, 'tok-3', 'approved'),
        ],
      ),
    );

    expect(
      selectResolvedTokenAnalysis(store.getState().analysis, 'tok-1', 'logos'),
    ).toBeUndefined();
  });

  it('skips a persisted link whose payload is missing', () => {
    const imported = logos('ta-imported', 'word');
    const store = createAnalysisStore(
      tokenState(
        [imported],
        [
          makeLink(logos('ta-missing', 'speech'), 'tok-1', 'suggested'),
          makeLink(imported, 'tok-1', 'candidate'),
        ],
      ),
    );

    expect(selectResolvedTokenAnalysis(store.getState().analysis, 'tok-1', 'logos')).toEqual({
      status: 'suggested',
      suggested: imported,
      candidates: [],
    });
  });

  it('offers a payload the token links twice only once', () => {
    const imported = logos('ta-imported', 'word');
    const store = createAnalysisStore(
      tokenState(
        [imported],
        [makeLink(imported, 'tok-1', 'suggested'), makeLink(imported, 'tok-1', 'candidate')],
      ),
    );

    expect(selectResolvedTokenAnalysis(store.getState().analysis, 'tok-1', 'logos')).toEqual({
      status: 'suggested',
      suggested: imported,
      candidates: [],
    });
  });

  it("offers an approved token's persisted analyses as alternatives", () => {
    const approved = logos('ta-approved', 'word');
    const imported = logos('ta-imported', 'speech');
    const store = createAnalysisStore(
      tokenState(
        [approved, imported],
        [makeLink(approved, 'tok-1', 'approved'), makeLink(imported, 'tok-1', 'candidate')],
      ),
    );

    expect(selectResolvedTokenAnalysis(store.getState().analysis, 'tok-1', 'logos')).toEqual({
      status: 'approved',
      analysis: approved,
      alternatives: { suggested: imported, candidates: [approved] },
    });
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
        id: 'tl-19',
        ...FIXTURE_STAMPS,
        analysisId: 'ta-river',
        status: 'approved',
        token: { tokenRef: 'r1', surfaceText: 'bank' },
      },
      {
        id: 'tl-20',
        ...FIXTURE_STAMPS,
        analysisId: 'ta-river',
        status: 'approved',
        token: { tokenRef: 'r2', surfaceText: 'bank' },
      },
      {
        id: 'tl-21',
        ...FIXTURE_STAMPS,
        analysisId: 'ta-river',
        status: 'approved',
        token: { tokenRef: 'r3', surfaceText: 'bank' },
      },
      {
        id: 'tl-22',
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

  it('leaves out an analysis the token rejected', () => {
    const pool = bankPool();
    const store = createAnalysisStore({
      analysis: {
        analysis: {
          ...pool,
          tokenAnalysisLinks: [
            ...pool.tokenAnalysisLinks,
            {
              id: 'tl-23',
              ...FIXTURE_STAMPS,
              analysisId: 'ta-fin',
              status: 'rejected',
              token: { tokenRef: 'r1', surfaceText: 'bank' },
            },
          ],
        },
        analysisLanguage: 'en',
      },
    });

    const river = store.getState().analysis.analysis.tokenAnalyses[0];
    expect(selectSuggestionAfterClearing(store.getState().analysis, 'r1', 'bank')).toEqual({
      status: 'suggested',
      suggested: river,
      candidates: [],
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

  it("previews the token's persisted analyses ahead of the pool", () => {
    const pool = bankPool();
    const imported: TokenAnalysis = {
      ...FIXTURE_STAMPS,
      id: 'ta-imported',
      surfaceText: 'bank',
      gloss: { en: 'embankment' },
    };
    const store = createAnalysisStore({
      analysis: {
        analysis: {
          ...pool,
          tokenAnalyses: [...pool.tokenAnalyses, imported],
          tokenAnalysisLinks: [...pool.tokenAnalysisLinks, makeLink(imported, 'r1', 'candidate')],
        },
        analysisLanguage: 'en',
      },
    });

    const [river, fin] = store.getState().analysis.analysis.tokenAnalyses;
    expect(selectSuggestionAfterClearing(store.getState().analysis, 'r1', 'bank')).toEqual({
      status: 'suggested',
      suggested: imported,
      candidates: [river, fin],
    });
  });
});

/** Builds a `received` analysis broken down as the spelling `recieved` was, kept by the reader. */
function keptBreakdown(id: string, gloss: string): TokenAnalysis {
  return {
    ...FIXTURE_STAMPS,
    id,
    surfaceText: 'received',
    gloss: { en: gloss },
    morphemes: [
      { id: 'm-1', form: 'reciev', writingSystem: 'en', gloss: { en: 'get' } },
      { id: 'm-2', form: 'ed', writingSystem: 'en', gloss: { en: 'PST' } },
    ],
  };
}

/** {@link keptBreakdown} still marked stale, awaiting the reader. */
function staleBreakdown(id: string, gloss: string): TokenAnalysis {
  return { ...keptBreakdown(id, gloss), morphemesStale: true };
}

describe('selectStaleMorphemesAnalysisId', () => {
  it("names a token's approved analysis while its breakdown is stale", () => {
    const ta = staleBreakdown('ta-1', 'got');
    const store = createAnalysisStore(tokenState([ta], [makeLink(ta, 'tok-1', 'approved')]));

    expect(selectStaleMorphemesAnalysisId(store.getState().analysis, 'tok-1')).toBe('ta-1');
  });

  it('names nothing for a breakdown that is not stale', () => {
    const ta = keptBreakdown('ta-1', 'got');
    const store = createAnalysisStore(tokenState([ta], [makeLink(ta, 'tok-1', 'approved')]));

    expect(selectStaleMorphemesAnalysisId(store.getState().analysis, 'tok-1')).toBeUndefined();
  });

  it('names nothing for a token with no approval', () => {
    const ta = staleBreakdown('ta-1', 'got');
    const store = createAnalysisStore(tokenState([ta], [makeLink(ta, 'tok-1', 'suggested')]));

    expect(selectStaleMorphemesAnalysisId(store.getState().analysis, 'tok-1')).toBeUndefined();
  });
});

describe('selectMorphemeResetLosesAnnotation', () => {
  it('reports no loss when the token has no approved analysis', () => {
    const store = createAnalysisStore();
    expect(selectMorphemeResetLosesAnnotation(store.getState().analysis, 'tok-1')).toBe(false);
  });

  it('reports a loss when an unglossed breakdown carries a lexicon reference', () => {
    // An imported morpheme can hold an entry with no gloss beside it, and the reset discards it.
    const ta: TokenAnalysis = {
      ...FIXTURE_STAMPS,
      id: 'ta-1',
      surfaceText: 'cats',
      morphemes: [
        {
          id: 'm-1',
          form: 'cat',
          writingSystem: 'en',
          senseRef: { authority: 'lexicon', senseId: 's-1' },
        },
      ],
    };
    const store = createAnalysisStore({
      analysis: { analysis: makeAnalysis(ta), analysisLanguage: 'und' },
    });
    expect(selectMorphemeResetLosesAnnotation(store.getState().analysis, 'tok-1')).toBe(true);
  });

  it('reports no loss when another token links the glossed breakdown without approving it', () => {
    const ta: TokenAnalysis = {
      ...FIXTURE_STAMPS,
      id: 'ta-1',
      surfaceText: 'cats',
      morphemes: [{ id: 'm-1', form: 'cat', writingSystem: 'en', gloss: { und: 'feline' } }],
    };
    const store = createAnalysisStore(
      tokenState([ta], [makeLink(ta, 'tok-1', 'approved'), makeLink(ta, 'tok-2', 'suggested')]),
    );

    expect(selectMorphemeResetLosesAnnotation(store.getState().analysis, 'tok-1')).toBe(false);
  });
});

describe('selectMorphemePayloadIsSolelyOwned', () => {
  it('reports not solely owned when the token has no approved analysis', () => {
    const store = createAnalysisStore();
    expect(selectMorphemePayloadIsSolelyOwned(store.getState().analysis, 'tok-1')).toBe(false);
  });

  it('reports not solely owned when another token links the payload without approving it', () => {
    const ta: TokenAnalysis = {
      ...FIXTURE_STAMPS,
      id: 'ta-1',
      surfaceText: 'cats',
      morphemes: [{ id: 'm-1', form: 'cat', writingSystem: 'en' }],
    };
    const store = createAnalysisStore(
      tokenState([ta], [makeLink(ta, 'tok-1', 'approved'), makeLink(ta, 'tok-2', 'suggested')]),
    );

    expect(selectMorphemePayloadIsSolelyOwned(store.getState().analysis, 'tok-1')).toBe(false);
  });
});

describe('morphemeFormsLostByResplit', () => {
  /** A morpheme carrying a gloss, so a re-split dropping it destroys something. */
  function glossed(id: string, form: string): MorphemeAnalysis {
    return { id, form, writingSystem: 'en', gloss: { und: form } };
  }

  it('reports nothing lost when every glossed form survives the re-split', () => {
    const old = [glossed('m-1', 'un-'), glossed('m-2', 'believ')];
    expect(morphemeFormsLostByResplit(old, ['un-', 'believ', '-able'])).toEqual([]);
  });

  it('reports a glossed form the new breakdown has no morpheme for', () => {
    const old = [glossed('m-1', 'un-'), glossed('m-2', 'believ'), glossed('m-3', '-able')];
    expect(morphemeFormsLostByResplit(old, ['un-', 'believe'])).toEqual(['believ', '-able']);
  });

  it('leaves out a stranded form that carried nothing but its segmentation', () => {
    // Losing bare segmentation costs only what the reader is retyping anyway.
    const old = [glossed('m-1', 'un-'), { id: 'm-2', form: 'believ', writingSystem: 'en' }];
    expect(morphemeFormsLostByResplit(old, ['un-', 'believe'])).toEqual([]);
  });

  it('reports an unglossed form whose morpheme carries a lexicon reference', () => {
    // A PT9 import resolves the lexeme key and the gloss column independently, so a morpheme can
    // arrive with an entry to fall back on and no gloss — a loss no retyping restores.
    const old: MorphemeAnalysis[] = [
      glossed('m-1', 'un-'),
      {
        id: 'm-2',
        form: 'believ',
        writingSystem: 'en',
        entryRef: { authority: 'lexicon', entryId: 'e-1' },
      },
    ];
    expect(morphemeFormsLostByResplit(old, ['un-', 'believe'])).toEqual(['believ']);
  });

  it('reports an unglossed form whose morpheme carries only a grammar reference', () => {
    const old: MorphemeAnalysis[] = [
      {
        id: 'm-1',
        form: 'believ',
        writingSystem: 'en',
        grammarRef: { authority: 'lexicon', msaId: 'msa-1' },
      },
    ];
    expect(morphemeFormsLostByResplit(old, ['believe'])).toEqual(['believ']);
  });

  it('counts a repeated form once per occurrence the re-split drops', () => {
    // The surviving "ba" takes the first old morpheme, as a re-split itself would, so the second is
    // what goes.
    const old = [glossed('m-1', 'ba'), glossed('m-2', 'ba')];
    expect(morphemeFormsLostByResplit(old, ['ba'])).toEqual(['ba']);
  });

  it('reports nothing lost when a repeated form keeps every occurrence', () => {
    const old = [glossed('m-1', 'ba'), glossed('m-2', 'ba')];
    expect(morphemeFormsLostByResplit(old, ['ba', 'ba'])).toEqual([]);
  });

  it('reports every glossed form lost when the breakdown is cleared', () => {
    const old = [glossed('m-1', 'un-'), glossed('m-2', 'believ')];
    expect(morphemeFormsLostByResplit(old, [])).toEqual(['un-', 'believ']);
  });

  it('reports nothing lost when there was no breakdown to begin with', () => {
    expect(morphemeFormsLostByResplit(undefined, ['un-', 'believ'])).toEqual([]);
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
      id: `link-${tokenRef}`,
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

  describe('selectAnalysisDeletionOutcome', () => {
    /** Reads every fixture token as still carrying the form its analysis was recorded under. */
    const undrifted = () => 'word';

    /** Reads `tokenRef` as belonging to a book this view has not loaded. */
    const unloaded = (tokenRef: string) => (ref: string) => (ref === tokenRef ? undefined : 'word');

    it('reports a blank outcome when no homograph survives the deletion', () => {
      const store = makeSharedStore();

      const outcome = selectAnalysisDeletionOutcome(
        store.getState().analysis,
        'ta-shared',
        undrifted,
      );

      expect(outcome).toEqual({ kind: 'blank', usageCount: 2, unappliedCount: 0 });
    });

    it('hedges rather than promising blank when a use sits in a book that is not loaded', () => {
      const store = makeSharedStore();

      expect(
        selectAnalysisDeletionOutcome(store.getState().analysis, 'ta-shared', unloaded('tok-2')),
      ).toEqual({ kind: 'fallback', usageCount: 2, unappliedCount: 0, uncertain: true });
    });

    it('does not fall back to an analysis the token rejected', () => {
      const finance = logos('ta-finance', 'finance');
      const talk = logos('ta-talk', 'talk');
      const state = tokenState(
        [finance, talk],
        [
          makeLink(finance, 'tok-1', 'approved'),
          makeLink(talk, 'tok-1', 'rejected'),
          makeLink(talk, 'tok-9', 'approved'),
        ],
      ).analysis;

      expect(selectAnalysisDeletionOutcome(state, 'ta-finance', () => 'logos')).toEqual({
        kind: 'blank',
        usageCount: 1,
        unappliedCount: 0,
      });
    });

    // Non-approved links are not places the analysis is applied, so one on drifted text says nothing
    // about what the affected tokens come to read.

    describe("with an affected token's own unapproved records", () => {
      const finance = logos('ta-finance', 'finance');
      const riverbank = logos('ta-riverbank', 'riverbank');
      const talk = logos('ta-talk', 'talk');

      /** Reads every token as still carrying the form its analysis was recorded under. */
      const standing = () => 'logos';

      it('names the record the token was offered ahead of the pool', () => {
        const state = tokenState(
          [finance, riverbank, talk],
          [
            makeLink(finance, 'tok-1', 'approved'),
            makeLink(riverbank, 'tok-1', 'candidate'),
            makeLink(talk, 'tok-9', 'approved'),
          ],
        ).analysis;

        expect(selectAnalysisDeletionOutcome(state, 'ta-finance', standing)).toEqual({
          kind: 'fallback',
          usageCount: 1,
          unappliedCount: 0,
          fallbackGloss: 'riverbank',
        });
      });

      it('names that record even where the token cannot be read', () => {
        const state = tokenState(
          [finance, riverbank],
          [makeLink(finance, 'tok-1', 'approved'), makeLink(riverbank, 'tok-1', 'candidate')],
        ).analysis;

        expect(selectAnalysisDeletionOutcome(state, 'ta-finance', () => undefined)).toEqual({
          kind: 'fallback',
          usageCount: 1,
          unappliedCount: 0,
          fallbackGloss: 'riverbank',
        });
      });

      it('names no gloss when another affected token would be left with none', () => {
        const state = tokenState(
          [finance, riverbank],
          [
            makeLink(finance, 'tok-1', 'approved'),
            makeLink(riverbank, 'tok-1', 'candidate'),
            makeLink(finance, 'tok-2', 'approved'),
          ],
        ).analysis;

        expect(selectAnalysisDeletionOutcome(state, 'ta-finance', standing)).toEqual({
          kind: 'fallback',
          usageCount: 2,
          unappliedCount: 0,
          uncertain: true,
        });
      });

      it('does not offer the token the record being deleted', () => {
        const state = tokenState(
          [finance],
          [makeLink(finance, 'tok-1', 'approved'), makeLink(finance, 'tok-1', 'candidate')],
        ).analysis;

        expect(selectAnalysisDeletionOutcome(state, 'ta-finance', standing)).toEqual({
          kind: 'blank',
          usageCount: 1,
          unappliedCount: 1,
        });
      });
    });

    it('returns undefined for an analysisId that resolves to no payload', () => {
      const store = makeSharedStore();

      expect(
        selectAnalysisDeletionOutcome(store.getState().analysis, 'nope', undrifted),
      ).toBeUndefined();
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
                id: 'tl-35',
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

      const outcome = selectAnalysisDeletionOutcome(
        store.getState().analysis,
        'ta-unused',
        undrifted,
      );

      expect(outcome).toEqual({ kind: 'blank', usageCount: 0, unappliedCount: 1 });
    });

    // A surviving homograph is exactly what makes this look like a fallback, so the unused row the
    // catalog's zero-usages filter surfaces is the one that must not promise one.
    it('reports no fallback for an unused analysis an approved homograph survives', () => {
      const unused: TokenAnalysis = {
        ...FIXTURE_STAMPS,
        id: 'ta-unused',
        surfaceText: 'word',
        gloss: { und: 'first' },
      };
      const approved: TokenAnalysis = {
        ...FIXTURE_STAMPS,
        id: 'ta-approved',
        surfaceText: 'word',
        gloss: { und: 'second' },
      };
      const store = createAnalysisStore({
        analysis: {
          analysis: {
            ...emptyAnalysis(),
            tokenAnalyses: [unused, approved],
            tokenAnalysisLinks: [
              {
                id: 'tl-36',
                ...FIXTURE_STAMPS,
                analysisId: unused.id,
                status: 'candidate',
                token: { tokenRef: 'tok-1', surfaceText: 'word' },
              },
              {
                id: 'tl-37',
                ...FIXTURE_STAMPS,
                analysisId: approved.id,
                status: 'approved',
                token: { tokenRef: 'tok-2', surfaceText: 'word' },
              },
            ],
          },
          analysisLanguage: 'und',
        },
      });

      const outcome = selectAnalysisDeletionOutcome(
        store.getState().analysis,
        'ta-unused',
        undrifted,
      );

      expect(outcome).toEqual({ kind: 'blank', usageCount: 0, unappliedCount: 1 });
    });

    // The delete is made from a catalog row, which counts a token once however many approved
    // links carry it to the same analysis. No write path builds a duplicate, so this is the shape
    // imported or hand-edited data arrives in; the two numbers must still agree.
    it('counts a token carrying the same approval twice as one usage', () => {
      const shared: TokenAnalysis = {
        ...FIXTURE_STAMPS,
        id: 'ta-shared',
        surfaceText: 'word',
        gloss: { und: 'first' },
      };
      const duplicated: TokenAnalysisLink[] = ['tok-1', 'tok-1', 'tok-2'].map(
        (tokenRef, index) => ({
          id: `link-${index}`,
          ...FIXTURE_STAMPS,
          analysisId: shared.id,
          status: 'approved',
          token: { tokenRef, surfaceText: 'word' },
        }),
      );
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

      const outcome = selectAnalysisDeletionOutcome(
        store.getState().analysis,
        'ta-shared',
        undrifted,
      );

      expect(outcome).toEqual({ kind: 'blank', usageCount: 2, unappliedCount: 0 });
    });

    // An import records rejected and stale assignments the same way it records candidates, and the
    // deletion takes all of them, so none may be left out of the number that warns about the loss.
    it('counts every non-approved status among the unapplied assignments', () => {
      const store = createAnalysisStore({
        analysis: {
          analysis: {
            ...emptyAnalysis(),
            tokenAnalyses: [
              { ...FIXTURE_STAMPS, id: 'ta-mixed', surfaceText: 'word', gloss: { und: 'first' } },
            ],
            tokenAnalysisLinks: (['candidate', 'rejected', 'stale', 'suggested'] as const).map(
              (status, i) => ({
                id: `link-${i}`,
                ...FIXTURE_STAMPS,
                analysisId: 'ta-mixed',
                status,
                token: { tokenRef: `tok-${i}`, surfaceText: 'word' },
              }),
            ),
          },
          analysisLanguage: 'und',
        },
      });

      const outcome = selectAnalysisDeletionOutcome(
        store.getState().analysis,
        'ta-mixed',
        undrifted,
      );

      expect(outcome).toEqual({ kind: 'blank', usageCount: 0, unappliedCount: 4 });
    });

    // Counted by token like the usages are, so the two numbers in one sentence are counting the
    // same kind of thing.
    it('counts a token recording the same analysis twice as one unapplied assignment', () => {
      const store = createAnalysisStore({
        analysis: {
          analysis: {
            ...emptyAnalysis(),
            tokenAnalyses: [
              { ...FIXTURE_STAMPS, id: 'ta-dup', surfaceText: 'word', gloss: { und: 'first' } },
            ],
            tokenAnalysisLinks: ['tok-1', 'tok-1'].map((tokenRef, index) => ({
              id: `link-${index}`,
              ...FIXTURE_STAMPS,
              analysisId: 'ta-dup',
              status: 'candidate' as const,
              token: { tokenRef, surfaceText: 'word' },
            })),
          },
          analysisLanguage: 'und',
        },
      });

      const outcome = selectAnalysisDeletionOutcome(store.getState().analysis, 'ta-dup', undrifted);

      expect(outcome).toEqual({ kind: 'blank', usageCount: 0, unappliedCount: 1 });
    });

    // A token approving the analysis is a use, not an unapplied assignment; a record carrying both
    // kinds must not have the approved token counted on both sides.
    it('leaves an approved token out of the unapplied count', () => {
      const store = createAnalysisStore({
        analysis: {
          analysis: {
            ...emptyAnalysis(),
            tokenAnalyses: [
              { ...FIXTURE_STAMPS, id: 'ta-both', surfaceText: 'word', gloss: { und: 'first' } },
            ],
            tokenAnalysisLinks: [
              {
                id: 'tl-38',
                ...FIXTURE_STAMPS,
                analysisId: 'ta-both',
                status: 'approved',
                token: { tokenRef: 'tok-1', surfaceText: 'word' },
              },
              {
                id: 'tl-39',
                ...FIXTURE_STAMPS,
                analysisId: 'ta-both',
                status: 'candidate',
                token: { tokenRef: 'tok-2', surfaceText: 'word' },
              },
            ],
          },
          analysisLanguage: 'und',
        },
      });

      const outcome = selectAnalysisDeletionOutcome(
        store.getState().analysis,
        'ta-both',
        undrifted,
      );

      expect(outcome).toEqual({ kind: 'blank', usageCount: 1, unappliedCount: 1 });
    });
  });
});
