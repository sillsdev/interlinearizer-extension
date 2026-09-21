/// <reference types="jest" />

import type { Book, PhraseAnalysisLink, TextAnalysis, TokenAnalysisLink } from 'interlinearizer';
import { reanchorAnalysisToBook } from '../../utils/reanchor-analysis';
import { resegmentBook } from '../../parsers/papi/resegmentBook';
import { emptyAnalysis } from '../../types/empty-factories';
import { makeVerseBook, makePhraseLink, FIXTURE_STAMPS } from '../test-helpers';

/**
 * The stamp a re-anchor writes in these tests. Distinct from `FIXTURE_STAMPS` so an assertion on
 * `updatedAt` tells a refreshed link from an untouched one.
 */
const REANCHOR_STAMP = '2026-02-01T00:00:00.000Z';

function reanchor(analysis: TextAnalysis, book: Book): TextAnalysis {
  return reanchorAnalysisToBook(analysis, book, REANCHOR_STAMP);
}

/** Builds an approved token link naming `tokenRef` with the surface text it was written against. */
function makeTokenLink(
  tokenRef: string,
  surfaceText: string,
  analysisId = 'ta-1',
): TokenAnalysisLink {
  return {
    analysisId,
    ...FIXTURE_STAMPS,
    status: 'approved',
    token: { tokenRef, surfaceText },
  };
}

/** Seeds a `TextAnalysis` carrying just the given token links. */
function analysisWithTokenLinks(links: TokenAnalysisLink[]): TextAnalysis {
  return { ...emptyAnalysis(), tokenAnalysisLinks: links };
}

/**
 * Seeds a `TextAnalysis` carrying one approved segment free translation, written against
 * `surfaceText` as the segment's baseline at the time.
 */
function analysisWithSegmentLink(segmentId: string, surfaceText: string): TextAnalysis {
  return {
    ...emptyAnalysis(),
    segmentAnalyses: [
      { id: 'sa-1', ...FIXTURE_STAMPS, surfaceText, freeTranslation: { en: 'a translation' } },
    ],
    segmentAnalysisLinks: [
      { analysisId: 'sa-1', ...FIXTURE_STAMPS, status: 'approved', segmentId },
    ],
  };
}

describe('reanchorAnalysisToBook', () => {
  it('shifts a link onto the token that kept its surface text when a word is inserted before it', () => {
    const book = makeVerseBook([{ sid: 'GEN 1:1', text: 'it was and unbelievable' }]);
    const analysis = analysisWithTokenLinks([makeTokenLink('GEN 1:1:7', 'unbelievable')]);

    const result = reanchor(analysis, book);

    const moved = book.segments[0].tokens.find((t) => t.surfaceText === 'unbelievable');
    expect(result.tokenAnalysisLinks[0].token.tokenRef).toBe(moved?.ref);
    expect(result.tokenAnalysisLinks[0].status).toBe('approved');
  });

  it('leaves a link alone when its token ref still names the same surface text', () => {
    const book = makeVerseBook([{ sid: 'GEN 1:1', text: 'it was unbelievable' }]);
    const analysis = analysisWithTokenLinks([makeTokenLink('GEN 1:1:7', 'unbelievable')]);

    const result = reanchor(analysis, book);

    expect(result.tokenAnalysisLinks[0].token.tokenRef).toBe('GEN 1:1:7');
  });

  it('keeps repeated forms in order rather than collapsing them onto the first match', () => {
    const book = makeVerseBook([{ sid: 'GEN 1:1', text: 'and the light and the dark' }]);
    const theTokens = book.segments[0].tokens.filter((t) => t.surfaceText === 'the');
    // Written against the pre-edit text "the light and the dark", where the two "the"s sat at 0
    // and 16. Glossing both is what gives the alignment the context to tell them apart.
    const analysis = analysisWithTokenLinks([
      makeTokenLink('GEN 1:1:0', 'the'),
      makeTokenLink('GEN 1:1:16', 'the', 'ta-2'),
    ]);

    const result = reanchor(analysis, book);

    expect(result.tokenAnalysisLinks.map((l) => l.token.tokenRef)).toEqual(
      theTokens.map((t) => t.ref),
    );
  });

  it('stales both twins when one of a repeated pair is deleted', () => {
    const book = makeVerseBook([{ sid: 'GEN 1:1', text: 'bank' }]);
    // Written against "bank bank", where the two senses sat at 0 and 5. Which one the edit removed
    // is unknowable from the text, so neither gloss may claim the survivor.
    const analysis = analysisWithTokenLinks([
      makeTokenLink('GEN 1:1:0', 'bank'),
      makeTokenLink('GEN 1:1:5', 'bank', 'ta-2'),
    ]);

    const result = reanchor(analysis, book);

    expect(result.tokenAnalysisLinks.map((l) => l.status)).toEqual(['stale', 'stale']);
  });

  it('leaves a lone repeated form where it was written rather than picking an occurrence', () => {
    const book = makeVerseBook([{ sid: 'GEN 1:1', text: 'the light and the dark' }]);
    // Only the second "the" is glossed, so nothing in the stored sequence says which one it is.
    const analysis = analysisWithTokenLinks([makeTokenLink('GEN 1:1:14', 'the')]);

    const result = reanchor(analysis, book);

    expect(result.tokenAnalysisLinks[0].token.tokenRef).toBe('GEN 1:1:14');
  });

  it('flips a lone repeated form to stale rather than guessing between identical words', () => {
    const book = makeVerseBook([{ sid: 'GEN 1:1', text: 'the light and the dark' }]);
    const analysis = analysisWithTokenLinks([makeTokenLink('GEN 1:1:14', 'the')]);

    const result = reanchor(analysis, book);

    expect(result.tokenAnalysisLinks[0].status).toBe('stale');
  });

  it('keeps both links on a token carrying a gloss and a phrase when the book is unchanged', () => {
    const book = makeVerseBook([{ sid: 'GEN 1:1', text: 'in the beginning' }]);
    const analysis: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalysisLinks: [makeTokenLink('GEN 1:1:0', 'in')],
      phraseAnalysisLinks: [
        makePhraseLink('pa-1', ['GEN 1:1:0', 'GEN 1:1:3', 'GEN 1:1:7'], ['in', 'the', 'beginning']),
      ],
    };

    const result = reanchor(analysis, book);

    expect(result).toBe(analysis);
  });

  it('gives a token its one anchor however many links name it', () => {
    const book = makeVerseBook([{ sid: 'GEN 1:1', text: 'and in the beginning' }]);
    const analysis: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalysisLinks: [makeTokenLink('GEN 1:1:0', 'in')],
      phraseAnalysisLinks: [
        makePhraseLink('pa-1', ['GEN 1:1:0', 'GEN 1:1:3', 'GEN 1:1:7'], ['in', 'the', 'beginning']),
      ],
    };

    const result = reanchor(analysis, book);

    const inToken = book.segments[0].tokens.find((t) => t.surfaceText === 'in');
    expect(result.tokenAnalysisLinks[0].token.tokenRef).toBe(inToken?.ref);
    expect(result.phraseAnalysisLinks[0].tokens[0].tokenRef).toBe(inToken?.ref);
    expect(result.phraseAnalysisLinks[0].status).toBe('approved');
  });

  it('re-anchors a verse merged into a segment that kept the leading verse id', () => {
    const verseBook = makeVerseBook([
      { sid: 'GEN 1:1', text: 'alpha beta' },
      { sid: 'GEN 1:2', text: 'inserted gamma delta' },
    ]);
    const merged = resegmentBook(verseBook, {
      removedVerseStarts: [verseBook.segments[1].tokens[0].ref],
      addedStarts: [],
    });
    // Written against "gamma delta", before "inserted " shifted the verse's offsets.
    const analysis = analysisWithTokenLinks([makeTokenLink('GEN 1:2:0', 'gamma')]);

    const result = reanchor(analysis, merged);

    const gamma = merged.segments[0].tokens.find((t) => t.surfaceText === 'gamma');
    expect(result.tokenAnalysisLinks[0].token.tokenRef).toBe(gamma?.ref);
    expect(result.tokenAnalysisLinks[0].status).toBe('approved');
  });

  it('aligns each merged-away verse against its own tokens, not the whole segment', () => {
    const verseBook = makeVerseBook([
      { sid: 'GEN 1:1', text: 'alpha beta' },
      { sid: 'GEN 1:2', text: 'inserted alpha gamma' },
    ]);
    const merged = resegmentBook(verseBook, {
      removedVerseStarts: [verseBook.segments[1].tokens[0].ref],
      addedStarts: [],
    });
    // "alpha" occurs once per verse but twice in the merged segment, so only a per-verse alignment
    // can place either gloss.
    const analysis = analysisWithTokenLinks([
      makeTokenLink('GEN 1:1:0', 'alpha'),
      makeTokenLink('GEN 1:2:0', 'alpha', 'ta-2'),
    ]);

    const result = reanchor(analysis, merged);

    const secondAlpha = merged.segments[0].tokens.filter((t) => t.surfaceText === 'alpha')[1];
    expect(result.tokenAnalysisLinks[1].token.tokenRef).toBe(secondAlpha?.ref);
  });

  it('flips a link to stale when its token no longer exists in the segment', () => {
    const book = makeVerseBook([{ sid: 'GEN 1:1', text: 'it was fine' }]);
    const analysis = analysisWithTokenLinks([makeTokenLink('GEN 1:1:7', 'unbelievable')]);

    const result = reanchor(analysis, book);

    expect(result.tokenAnalysisLinks[0].status).toBe('stale');
  });

  it('leaves a stale link pointing at the ref it was written against', () => {
    const book = makeVerseBook([{ sid: 'GEN 1:1', text: 'it was fine' }]);
    const analysis = analysisWithTokenLinks([makeTokenLink('GEN 1:1:7', 'unbelievable')]);

    const result = reanchor(analysis, book);

    expect(result.tokenAnalysisLinks[0].token.tokenRef).toBe('GEN 1:1:7');
  });

  it('re-anchors every token of a phrase link', () => {
    const book = makeVerseBook([{ sid: 'GEN 1:1', text: 'and in the beginning' }]);
    const analysis: TextAnalysis = {
      ...emptyAnalysis(),
      phraseAnalysisLinks: [makePhraseLink('pa-1', ['GEN 1:1:0', 'GEN 1:1:3'], ['in', 'the'])],
    };

    const result = reanchor(analysis, book);

    const refs = result.phraseAnalysisLinks[0].tokens.map((t) => t.tokenRef);
    const inToken = book.segments[0].tokens.find((t) => t.surfaceText === 'in');
    const theToken = book.segments[0].tokens.find((t) => t.surfaceText === 'the');
    expect(refs).toEqual([inToken?.ref, theToken?.ref]);
  });

  it('leaves links in books other than the one being re-anchored untouched', () => {
    const book = makeVerseBook([{ sid: 'GEN 1:1', text: 'it was fine' }]);
    const analysis = analysisWithTokenLinks([makeTokenLink('EXO 1:1:7', 'unbelievable')]);

    const result = reanchor(analysis, book);

    expect(result.tokenAnalysisLinks[0]).toEqual(analysis.tokenAnalysisLinks[0]);
  });

  it('keeps a phrase on its own words when a word is inserted inside its span', () => {
    const book = makeVerseBook([{ sid: 'GEN 1:1', text: 'in the very beginning' }]);
    const analysis: TextAnalysis = {
      ...emptyAnalysis(),
      phraseAnalysisLinks: [
        makePhraseLink('pa-1', ['GEN 1:1:0', 'GEN 1:1:3', 'GEN 1:1:7'], ['in', 'the', 'beginning']),
      ],
    };

    const result = reanchor(analysis, book);

    const refs = result.phraseAnalysisLinks[0].tokens.map((t) => t.tokenRef);
    const expected = ['in', 'the', 'beginning'].map(
      (form) => book.segments[0].tokens.find((t) => t.surfaceText === form)?.ref,
    );
    expect(refs).toEqual(expected);
  });

  it('leaves the word inserted inside a phrase out of that phrase', () => {
    const book = makeVerseBook([{ sid: 'GEN 1:1', text: 'in the very beginning' }]);
    const analysis: TextAnalysis = {
      ...emptyAnalysis(),
      phraseAnalysisLinks: [
        makePhraseLink('pa-1', ['GEN 1:1:0', 'GEN 1:1:3', 'GEN 1:1:7'], ['in', 'the', 'beginning']),
      ],
    };

    const result = reanchor(analysis, book);

    const inserted = book.segments[0].tokens.find((t) => t.surfaceText === 'very');
    const refs = result.phraseAnalysisLinks[0].tokens.map((t) => t.tokenRef);
    expect(refs).not.toContain(inserted?.ref);
  });

  it('flips a phrase link to stale when one of its tokens is gone', () => {
    const book = makeVerseBook([{ sid: 'GEN 1:1', text: 'in silence' }]);
    const analysis: TextAnalysis = {
      ...emptyAnalysis(),
      phraseAnalysisLinks: [makePhraseLink('pa-1', ['GEN 1:1:0', 'GEN 1:1:3'], ['in', 'the'])],
    };

    const result = reanchor(analysis, book);

    expect(result.phraseAnalysisLinks[0].status).toBe('stale');
  });

  it('leaves an already-stale phrase link untouched rather than restamping it', () => {
    const book = makeVerseBook([{ sid: 'GEN 1:1', text: 'in silence' }]);
    const staleLink: PhraseAnalysisLink = {
      ...makePhraseLink('pa-1', ['GEN 1:1:0', 'GEN 1:1:3'], ['in', 'the']),
      status: 'stale',
    };
    const analysis: TextAnalysis = { ...emptyAnalysis(), phraseAnalysisLinks: [staleLink] };

    const result = reanchor(analysis, book);

    expect(result).toBe(analysis);
  });

  it('leaves a phrase alone when its own verse is untouched by an edit elsewhere', () => {
    const book = makeVerseBook([
      { sid: 'GEN 1:1', text: 'in the beginning' },
      { sid: 'GEN 1:2', text: 'and the earth moved' },
    ]);
    const analysis: TextAnalysis = {
      ...emptyAnalysis(),
      phraseAnalysisLinks: [makePhraseLink('pa-1', ['GEN 1:1:0', 'GEN 1:1:3'], ['in', 'the'])],
      tokenAnalysisLinks: [makeTokenLink('GEN 1:2:4', 'the')],
    };

    const result = reanchor(analysis, book);

    expect(result.phraseAnalysisLinks[0]).toBe(analysis.phraseAnalysisLinks[0]);
  });

  it('leaves a link alone when its verse is absent from the loaded book', () => {
    const book = makeVerseBook([{ sid: 'GEN 1:1', text: 'it was unbelievable' }]);
    const analysis = analysisWithTokenLinks([makeTokenLink('GEN 1:2:0', 'elsewhere')]);

    const result = reanchor(analysis, book);

    expect(result.tokenAnalysisLinks[0]).toEqual(analysis.tokenAnalysisLinks[0]);
  });

  it('returns the original analysis reference when nothing moved', () => {
    const book = makeVerseBook([{ sid: 'GEN 1:1', text: 'it was unbelievable' }]);
    const analysis = analysisWithTokenLinks([makeTokenLink('GEN 1:1:7', 'unbelievable')]);

    expect(reanchor(analysis, book)).toBe(analysis);
  });

  it('stamps a link it moves with the time of the re-anchor', () => {
    const book = makeVerseBook([{ sid: 'GEN 1:1', text: 'it was and unbelievable' }]);
    const analysis = analysisWithTokenLinks([makeTokenLink('GEN 1:1:7', 'unbelievable')]);

    const result = reanchor(analysis, book);

    expect(result.tokenAnalysisLinks[0].updatedAt).toBe(REANCHOR_STAMP);
  });

  it('stamps a link it stales with the time of the re-anchor', () => {
    const book = makeVerseBook([{ sid: 'GEN 1:1', text: 'it was fine' }]);
    const analysis = analysisWithTokenLinks([makeTokenLink('GEN 1:1:7', 'unbelievable')]);

    const result = reanchor(analysis, book);

    expect(result.tokenAnalysisLinks[0].updatedAt).toBe(REANCHOR_STAMP);
  });

  it('stamps a phrase link it moves with the time of the re-anchor', () => {
    const book = makeVerseBook([{ sid: 'GEN 1:1', text: 'and in the beginning' }]);
    const analysis: TextAnalysis = {
      ...emptyAnalysis(),
      phraseAnalysisLinks: [makePhraseLink('pa-1', ['GEN 1:1:0', 'GEN 1:1:3'], ['in', 'the'])],
    };

    const result = reanchor(analysis, book);

    expect(result.phraseAnalysisLinks[0].updatedAt).toBe(REANCHOR_STAMP);
  });

  it('stales a segment link whose stored baseline no longer matches the segment', () => {
    const book = makeVerseBook([{ sid: 'GEN 1:1', text: 'it was not good' }]);
    const analysis = analysisWithSegmentLink('GEN 1:1', 'it was good');

    const result = reanchor(analysis, book);

    expect(result.segmentAnalysisLinks[0].status).toBe('stale');
  });

  it('leaves a segment link approved when its stored baseline still matches', () => {
    const book = makeVerseBook([{ sid: 'GEN 1:1', text: 'it was good' }]);
    const analysis = analysisWithSegmentLink('GEN 1:1', book.segments[0].baselineText);

    const result = reanchor(analysis, book);

    expect(result).toBe(analysis);
  });

  it('leaves a segment link alone when its segment is absent from the loaded book', () => {
    const book = makeVerseBook([{ sid: 'GEN 1:1', text: 'it was good' }]);
    const analysis = analysisWithSegmentLink('EXO 1:1', 'something else entirely');

    const result = reanchor(analysis, book);

    expect(result).toBe(analysis);
  });
});
