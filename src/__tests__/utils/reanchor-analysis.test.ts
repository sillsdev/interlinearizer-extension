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
    // Only the second "the" is glossed, and its own ref still names it, so it stays put.
    const analysis = analysisWithTokenLinks([makeTokenLink('GEN 1:1:14', 'the')]);

    const result = reanchor(analysis, book);

    expect(result.tokenAnalysisLinks[0].token.tokenRef).toBe('GEN 1:1:14');
  });

  it('leaves a lone repeated form approved when its own ref still names it', () => {
    const book = makeVerseBook([{ sid: 'GEN 1:1', text: 'the light and the dark' }]);
    const analysis = analysisWithTokenLinks([makeTokenLink('GEN 1:1:14', 'the')]);

    const result = reanchor(analysis, book);

    expect(result.tokenAnalysisLinks[0].status).toBe('approved');
  });

  it('stales a displaced lone form when a twin of it survives elsewhere in the verse', () => {
    const book = makeVerseBook([{ sid: 'GEN 1:1', text: 'dog and the bright the cat' }]);
    // Written against a verse whose "the" sat at 0. That ref now names "dog", and two "the"s
    // survive, so no evidence says which one the gloss meant.
    const analysis = analysisWithTokenLinks([makeTokenLink('GEN 1:1:0', 'the')]);

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

  it('stales a link whose verse the book still holds with none of its text left', () => {
    const book = makeVerseBook([
      { sid: 'GEN 1:1', text: 'it was unbelievable' },
      { sid: 'GEN 1:2', text: '' },
    ]);
    const analysis = analysisWithTokenLinks([makeTokenLink('GEN 1:2:0', 'emptied')]);

    const result = reanchor(analysis, book);

    expect(result.tokenAnalysisLinks[0].status).toBe('stale');
  });

  it('keeps the snapshot naming the live token when a stale one shares its ref', () => {
    const book = makeVerseBook([{ sid: 'GEN 1:1', text: 'dog sat' }]);
    // A stale link's snapshot keeps the form it was written against, so letting it speak for the
    // ref would re-stale the approval that replaced it.
    const analysis = analysisWithTokenLinks([
      { ...makeTokenLink('GEN 1:1:0', 'cat'), status: 'stale' },
      makeTokenLink('GEN 1:1:0', 'dog', 'ta-2'),
    ]);

    const result = reanchor(analysis, book);

    expect(result.tokenAnalysisLinks.map((l) => l.status)).toEqual(['stale', 'approved']);
  });

  it('returns a stale link to approved when its word comes back at a shifted ref', () => {
    const book = makeVerseBook([{ sid: 'GEN 1:1', text: 'it and was unbelievable' }]);
    const analysis = analysisWithTokenLinks([
      { ...makeTokenLink('GEN 1:1:7', 'unbelievable'), status: 'stale' },
    ]);

    const result = reanchor(analysis, book);

    const moved = book.segments[0].tokens.find((t) => t.surfaceText === 'unbelievable');
    expect(result.tokenAnalysisLinks[0].token.tokenRef).toBe(moved?.ref);
    expect(result.tokenAnalysisLinks[0].status).toBe('approved');
  });

  it('returns a stale link to approved when its word comes back at the same ref', () => {
    const book = makeVerseBook([{ sid: 'GEN 1:1', text: 'it was unbelievable' }]);
    const analysis = analysisWithTokenLinks([
      { ...makeTokenLink('GEN 1:1:7', 'unbelievable'), status: 'stale' },
    ]);

    const result = reanchor(analysis, book);

    expect(result.tokenAnalysisLinks[0].status).toBe('approved');
  });

  it('leaves a stale link stale rather than giving its token a second approved link', () => {
    const book = makeVerseBook([{ sid: 'GEN 1:1', text: 'it was unbelievable' }]);
    // A user who re-glossed the word while the old link was stale already owns the approval.
    const analysis = analysisWithTokenLinks([
      { ...makeTokenLink('GEN 1:1:7', 'unbelievable'), status: 'stale' },
      makeTokenLink('GEN 1:1:7', 'unbelievable', 'ta-2'),
    ]);

    const result = reanchor(analysis, book);

    expect(result.tokenAnalysisLinks.map((l) => l.status)).toEqual(['stale', 'approved']);
  });

  it('leaves a stale link stale when the approval sharing its token shifts along with it', () => {
    const book = makeVerseBook([{ sid: 'GEN 1:1', text: 'it was and unbelievable' }]);
    const analysis = analysisWithTokenLinks([
      { ...makeTokenLink('GEN 1:1:7', 'unbelievable'), status: 'stale' },
      makeTokenLink('GEN 1:1:7', 'unbelievable', 'ta-2'),
    ]);

    const result = reanchor(analysis, book);

    expect(result.tokenAnalysisLinks.map((l) => l.status)).toEqual(['stale', 'approved']);
  });

  it('revives a stale link when the approval that held its token is itself staled', () => {
    const book = makeVerseBook([{ sid: 'GEN 1:1', text: 'it was unbelievable' }]);
    const analysis = analysisWithTokenLinks([
      { ...makeTokenLink('GEN 1:1:7', 'unbelievable'), status: 'stale' },
      makeTokenLink('GEN 1:1:99', 'vanished', 'ta-2'),
    ]);

    const result = reanchor(analysis, book);

    expect(result.tokenAnalysisLinks.map((l) => l.status)).toEqual(['approved', 'stale']);
  });

  it('leaves a placed link that was never stale at the status it had', () => {
    const book = makeVerseBook([{ sid: 'GEN 1:1', text: 'it was unbelievable' }]);
    const analysis = analysisWithTokenLinks([
      { ...makeTokenLink('GEN 1:1:7', 'unbelievable'), status: 'suggested' },
    ]);

    const result = reanchor(analysis, book);

    expect(result.tokenAnalysisLinks[0].status).toBe('suggested');
  });

  it('anchors same-ref links by their own stored form rather than the first one seen', () => {
    const book = makeVerseBook([{ sid: 'GEN 1:1', text: 'the cat sat' }]);
    // History left a stale 'cat' and its replacement approval 'dog' on one ref. Neither matches the
    // live form there, so only each link's own stored text says which word it meant.
    const analysis = analysisWithTokenLinks([
      { ...makeTokenLink('GEN 1:1:0', 'cat'), status: 'stale' },
      makeTokenLink('GEN 1:1:0', 'dog', 'ta-2'),
    ]);

    const result = reanchor(analysis, book);

    const cat = book.segments[0].tokens.find((t) => t.surfaceText === 'cat');
    expect(result.tokenAnalysisLinks[0].token.tokenRef).toBe(cat?.ref);
    expect(result.tokenAnalysisLinks[1].status).toBe('stale');
  });

  it('stales a repeated form when the verse gained an occurrence of it', () => {
    const book = makeVerseBook([{ sid: 'GEN 1:1', text: 'the alpha the beta the' }]);
    // Written against "alpha the beta the", where the glossed pair sat at 6 and 15. A third "the"
    // appearing means a pairing was chosen rather than forced, so neither gloss may claim one.
    const analysis = analysisWithTokenLinks([
      makeTokenLink('GEN 1:1:6', 'the'),
      makeTokenLink('GEN 1:1:15', 'the', 'ta-2'),
    ]);

    const result = reanchor(analysis, book);

    expect(result.tokenAnalysisLinks.map((l) => l.status)).toEqual(['stale', 'stale']);
  });

  it('places a repeated form when the verse holds exactly the occurrences it stored', () => {
    const book = makeVerseBook([{ sid: 'GEN 1:1', text: 'and the light and the dark' }]);
    const analysis = analysisWithTokenLinks([
      makeTokenLink('GEN 1:1:0', 'the'),
      makeTokenLink('GEN 1:1:16', 'the', 'ta-2'),
    ]);

    const result = reanchor(analysis, book);

    expect(result.tokenAnalysisLinks.map((l) => l.status)).toEqual(['approved', 'approved']);
  });

  it('leaves an orphaned rejected link rejected rather than staling its verdict', () => {
    const book = makeVerseBook([{ sid: 'GEN 1:1', text: 'it was' }]);
    const analysis = analysisWithTokenLinks([
      { ...makeTokenLink('GEN 1:1:7', 'unbelievable'), status: 'rejected' },
    ]);

    const result = reanchor(analysis, book);

    expect(result.tokenAnalysisLinks[0].status).toBe('rejected');
  });

  it('leaves a rejected link rejected when the word it names comes back', () => {
    const book = makeVerseBook([{ sid: 'GEN 1:1', text: 'it was unbelievable' }]);
    const analysis = analysisWithTokenLinks([
      { ...makeTokenLink('GEN 1:1:7', 'unbelievable'), status: 'rejected' },
    ]);

    const result = reanchor(analysis, book);

    expect(result.tokenAnalysisLinks[0].status).toBe('rejected');
  });

  it('leaves an orphaned rejected phrase link rejected rather than staling its verdict', () => {
    const book = makeVerseBook([{ sid: 'GEN 1:1', text: 'and now' }]);
    const analysis: TextAnalysis = {
      ...emptyAnalysis(),
      phraseAnalysisLinks: [
        {
          ...makePhraseLink('pa-1', ['GEN 1:1:0', 'GEN 1:1:3'], ['in', 'the']),
          status: 'rejected',
        },
      ],
    };

    const result = reanchor(analysis, book);

    expect(result.phraseAnalysisLinks[0].status).toBe('rejected');
  });

  it('leaves a drifted rejected segment link rejected rather than staling its verdict', () => {
    const book = makeVerseBook([{ sid: 'GEN 1:1', text: 'it was good' }]);
    const base = analysisWithSegmentLink('GEN 1:1', 'something else entirely');
    const analysis = {
      ...base,
      segmentAnalysisLinks: [{ ...base.segmentAnalysisLinks[0], status: 'rejected' as const }],
    };

    const result = reanchor(analysis, book);

    expect(result.segmentAnalysisLinks[0].status).toBe('rejected');
  });

  it('counts a candidate link as holding its token against a stale link reviving onto it', () => {
    const book = makeVerseBook([{ sid: 'GEN 1:1', text: 'it was unbelievable' }]);
    // PT9's merger demotes a second approval to 'candidate' to keep one approval per token, so a
    // candidate still occupies the token its stale neighbor would otherwise revive onto.
    const analysis = analysisWithTokenLinks([
      { ...makeTokenLink('GEN 1:1:7', 'unbelievable'), status: 'stale' },
      { ...makeTokenLink('GEN 1:1:7', 'unbelievable', 'ta-2'), status: 'candidate' },
    ]);

    const result = reanchor(analysis, book);

    expect(result.tokenAnalysisLinks.map((l) => l.status)).toEqual(['stale', 'candidate']);
  });

  it('returns a stale phrase link to approved when all of its tokens place again', () => {
    const book = makeVerseBook([{ sid: 'GEN 1:1', text: 'and in the beginning' }]);
    const analysis: TextAnalysis = {
      ...emptyAnalysis(),
      phraseAnalysisLinks: [
        { ...makePhraseLink('pa-1', ['GEN 1:1:0', 'GEN 1:1:3'], ['in', 'the']), status: 'stale' },
      ],
    };

    const result = reanchor(analysis, book);

    expect(result.phraseAnalysisLinks[0].status).toBe('approved');
  });

  it('leaves a stale phrase stale when another approved phrase holds a token it would revive onto', () => {
    const book = makeVerseBook([{ sid: 'GEN 1:1', text: 'and in the beginning' }]);
    // A stale phrase is invisible to the phrase-creation guard, which is how two phrases come to
    // overlap on 'in'.
    const analysis: TextAnalysis = {
      ...emptyAnalysis(),
      phraseAnalysisLinks: [
        { ...makePhraseLink('pa-1', ['GEN 1:1:4', 'GEN 1:1:7'], ['in', 'the']), status: 'stale' },
        makePhraseLink('pa-2', ['GEN 1:1:4', 'GEN 1:1:11'], ['in', 'beginning']),
      ],
    };

    const result = reanchor(analysis, book);

    expect(result.phraseAnalysisLinks.map((l) => l.status)).toEqual(['stale', 'approved']);
  });

  it('leaves a stale phrase link in another book stale rather than reviving it', () => {
    const book = makeVerseBook([{ sid: 'GEN 1:1', text: 'in the beginning' }]);
    const analysis: TextAnalysis = {
      ...emptyAnalysis(),
      phraseAnalysisLinks: [
        { ...makePhraseLink('pa-1', ['EXO 1:1:0', 'EXO 1:1:3'], ['in', 'the']), status: 'stale' },
      ],
    };

    const result = reanchor(analysis, book);

    expect(result.phraseAnalysisLinks[0].status).toBe('stale');
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

  it('keeps a segment translation approved when a merge expands the segment it names', () => {
    const verseBook = makeVerseBook([
      { sid: 'GEN 1:1', text: 'alpha beta' },
      { sid: 'GEN 1:2', text: 'gamma delta' },
    ]);
    const merged = resegmentBook(verseBook, {
      removedVerseStarts: [verseBook.segments[1].tokens[0].ref],
      addedStarts: [],
    });
    const analysis = analysisWithSegmentLink('GEN 1:1', 'alpha beta');

    const result = reanchor(analysis, merged);

    expect(result.segmentAnalysisLinks[0].status).toBe('approved');
  });

  it('keeps a segment translation approved when a split truncates the segment it names', () => {
    const verseBook = makeVerseBook([{ sid: 'GEN 1:1', text: 'alpha beta' }]);
    const split = resegmentBook(verseBook, {
      removedVerseStarts: [],
      addedStarts: [verseBook.segments[0].tokens[1].ref],
    });
    const analysis = analysisWithSegmentLink('GEN 1:1', 'alpha beta');

    const result = reanchor(analysis, split);

    expect(result.segmentAnalysisLinks[0].status).toBe('approved');
  });

  it('returns a stale segment link to approved when its baseline is restored', () => {
    const book = makeVerseBook([{ sid: 'GEN 1:1', text: 'it was good' }]);
    const analysis = analysisWithSegmentLink('GEN 1:1', book.segments[0].baselineText);
    const staled = {
      ...analysis,
      segmentAnalysisLinks: [{ ...analysis.segmentAnalysisLinks[0], status: 'stale' as const }],
    };

    const result = reanchor(staled, book);

    expect(result.segmentAnalysisLinks[0].status).toBe('approved');
  });

  it('leaves a stale segment link stale rather than giving its segment a second translation', () => {
    const book = makeVerseBook([{ sid: 'GEN 1:1', text: 'it was good' }]);
    const base = analysisWithSegmentLink('GEN 1:1', book.segments[0].baselineText);
    // A user who retranslated the segment while the old link was stale already owns the approval.
    const analysis = {
      ...base,
      segmentAnalysisLinks: [
        { ...base.segmentAnalysisLinks[0], status: 'stale' as const },
        { ...base.segmentAnalysisLinks[0], analysisId: 'sa-2' },
      ],
      segmentAnalyses: [
        base.segmentAnalyses[0],
        { ...base.segmentAnalyses[0], id: 'sa-2', freeTranslation: { en: 'a retranslation' } },
      ],
    };

    const result = reanchor(analysis, book);

    expect(result.segmentAnalysisLinks.map((l) => l.status)).toEqual(['stale', 'approved']);
  });

  it('leaves a stale segment link stale when its segment is absent from the loaded book', () => {
    const book = makeVerseBook([{ sid: 'GEN 1:1', text: 'it was good' }]);
    const base = analysisWithSegmentLink('EXO 1:1', 'something else entirely');
    const analysis = {
      ...base,
      segmentAnalysisLinks: [{ ...base.segmentAnalysisLinks[0], status: 'stale' as const }],
    };

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
