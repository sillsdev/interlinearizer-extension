/// <reference types="jest" />

import type {
  AssignmentStatus,
  Book,
  DraftProject,
  SegmentationDelta,
  TextAnalysis,
} from 'interlinearizer';
import type { DraftContent } from '../../hooks/useDraftProject';
import type { ChangeSet } from '../../types/analysis-repository';
import { emptyAnalysis, emptyDraft } from '../../types/empty-factories';
import { splitAnalysisByBook } from '../../utils/analysis-book';
import { applyChangeSet } from '../../utils/change-set';
import {
  REANCHOR_INTENT,
  reanchorChangesForBook,
  reanchorChangesForMissingBook,
} from '../../utils/reanchor-changes';
import { reanchorDraftToBook, reanchorDraftToMissingBook } from '../../utils/reanchor-draft';
import type { BookPass } from '../../utils/undo-history';
import { FIXTURE_STAMPS, makePhraseLink, makeTokenLink, makeVerseBook } from '../test-helpers';

beforeAll(() => {
  // Both passes stamp what they rewrite with the time, so they must run at one instant to compare.
  jest.useFakeTimers({ now: new Date('2026-02-01T00:00:00.000Z') });
});

afterAll(() => {
  jest.useRealTimers();
});

/** A book of Genesis 1, one verse per text. */
function genesis(...verses: string[]): Book {
  return makeVerseBook(verses.map((text, index) => ({ sid: `GEN 1:${index + 1}`, text })));
}

/** The ref of the `occurrence`th token of `book` reading `surfaceText`. */
function refOf(book: Book, surfaceText: string, occurrence = 0): string {
  const token = book.segments
    .flatMap((segment) => segment.tokens)
    .filter((t) => t.surfaceText === surfaceText)[occurrence];
  if (!token) throw new Error(`fixture missing token ${surfaceText}`);
  return token.ref;
}

/** An analysis glossing each of `words` where `book` has it, each link of `status`. */
function glossing(
  book: Book,
  words: string[],
  status: AssignmentStatus = 'approved',
): TextAnalysis {
  return {
    ...emptyAnalysis(),
    tokenAnalyses: words.map((word) => ({
      ...FIXTURE_STAMPS,
      id: `ta-${word}`,
      surfaceText: word,
      gloss: { und: `${word} gloss` },
    })),
    tokenAnalysisLinks: words.map((word) =>
      makeTokenLink(`ta-${word}`, refOf(book, word), { surfaceText: word, status }),
    ),
  };
}

/** An analysis grouping `words`, in order, into one phrase where `book` has them. */
function phrasing(book: Book, words: string[]): TextAnalysis {
  return {
    ...emptyAnalysis(),
    phraseAnalyses: [{ ...FIXTURE_STAMPS, id: 'ph-1', surfaceText: words.join(' ') }],
    phraseAnalysisLinks: [
      makePhraseLink(
        'ph-1',
        words.map((word) => refOf(book, word)),
        words,
      ),
    ],
  };
}

/** An analysis translating the segment `segmentId`, written against `surfaceText`. */
function translating(
  segmentId: string,
  surfaceText: string,
  status: AssignmentStatus = 'approved',
): TextAnalysis {
  return {
    ...emptyAnalysis(),
    segmentAnalyses: [
      { ...FIXTURE_STAMPS, id: 'sa-1', surfaceText, freeTranslation: { en: 'a translation' } },
    ],
    segmentAnalysisLinks: [
      { ...FIXTURE_STAMPS, id: 'sl-1', analysisId: 'sa-1', status, segmentId },
    ],
  };
}

/** Every record of each analysis, in order. */
function combined(...analyses: TextAnalysis[]): TextAnalysis {
  const all = emptyAnalysis();
  analyses.forEach((analysis) => {
    all.tokenAnalyses.push(...analysis.tokenAnalyses);
    all.tokenAnalysisLinks.push(...analysis.tokenAnalysisLinks);
    all.phraseAnalyses.push(...analysis.phraseAnalyses);
    all.phraseAnalysisLinks.push(...analysis.phraseAnalysisLinks);
    all.segmentAnalyses.push(...analysis.segmentAnalyses);
    all.segmentAnalysisLinks.push(...analysis.segmentAnalysisLinks);
  });
  return all;
}

function draftOf(analysis: TextAnalysis, segmentation?: SegmentationDelta): DraftProject {
  return { ...emptyDraft('src'), analysis, ...(segmentation && { segmentation }) };
}

/** `draft` holding only its analysis in `bookCode`, as a lookup of the book's links reads it. */
function bookOnly(draft: DraftProject, bookCode: string): DraftProject {
  return {
    ...draft,
    analysis: splitAnalysisByBook(draft.analysis).get(bookCode) ?? emptyAnalysis(),
  };
}

/** Checks that `changes` bring `draft` to what the WebView's `pass` makes of it. */
function expectParity(
  draft: DraftProject,
  changes: ChangeSet | undefined,
  pass: BookPass<DraftContent>,
): DraftProject {
  const expected = pass({ analysis: draft.analysis, segmentation: draft.segmentation });
  const applied = changes ? applyChangeSet(draft, changes).draft : draft;
  expect(applied.analysis).toEqual(expected.analysis);
  expect(applied.segmentation).toEqual(expected.segmentation);
  return applied;
}

/** The draft-level counterparts of the drift cases in `reanchor-analysis.test.ts`. */
const DRIFT_CASES: [string, () => { draft: DraftProject; book: Book }][] = [
  [
    'a word is inserted before a gloss',
    () => ({
      draft: draftOf(glossing(genesis('it was unbelievable'), ['unbelievable'])),
      book: genesis('it was and unbelievable'),
    }),
  ],
  [
    'a glossed word is deleted',
    () => ({
      draft: draftOf(glossing(genesis('alpha beta gamma'), ['beta'])),
      book: genesis('alpha gamma'),
    }),
  ],
  [
    'a repeated word loses an occurrence',
    () => {
      const before = genesis('beta alpha beta');
      const analysis = glossing(before, ['alpha']);
      analysis.tokenAnalysisLinks.push(
        makeTokenLink('ta-alpha', refOf(before, 'beta', 1), { surfaceText: 'beta', id: 'tl-b' }),
      );
      return { draft: draftOf(analysis), book: genesis('beta alpha') };
    },
  ],
  [
    "a stale gloss's word comes back at a shifted ref",
    () => ({
      draft: draftOf(glossing(genesis('alpha beta'), ['beta'], 'stale')),
      book: genesis('new alpha beta'),
    }),
  ],
  [
    'a rejected gloss shifts with its word',
    () => ({
      draft: draftOf(glossing(genesis('alpha beta'), ['beta'], 'rejected')),
      book: genesis('new alpha beta'),
    }),
  ],
  [
    'a phrase shifts with a word inserted before it',
    () => ({
      draft: draftOf(phrasing(genesis('alpha beta gamma'), ['beta', 'gamma'])),
      book: genesis('new alpha beta gamma'),
    }),
  ],
  [
    'a phrase loses a word',
    () => ({
      draft: draftOf(phrasing(genesis('alpha beta gamma'), ['beta', 'gamma'])),
      book: genesis('alpha gamma'),
    }),
  ],
  [
    "a free translation's segment gains a word",
    () => ({
      draft: draftOf(translating('GEN 1:1', 'alpha beta')),
      book: genesis('alpha beta gamma'),
    }),
  ],
  [
    "a stale free translation's segment reads as it did again",
    () => ({
      draft: draftOf(translating('GEN 1:1', 'alpha beta', 'stale')),
      book: genesis('alpha beta'),
    }),
  ],
  [
    'a split and its piece translation shift with a word inserted before them',
    () => {
      const before = genesis('alpha beta');
      const split = refOf(before, 'beta');
      return {
        draft: draftOf(translating(split, 'beta'), {
          removedVerseStarts: [],
          addedStarts: [{ tokenRef: split, surfaceText: 'beta' }],
        }),
        book: genesis('alpha and beta'),
      };
    },
  ],
  [
    'a verse holding a gloss is removed',
    () => ({
      draft: draftOf(glossing(genesis('alpha', 'beta'), ['beta'])),
      book: genesis('alpha'),
    }),
  ],
  [
    'a gloss shifts beside glosses in another book',
    () => {
      const exodus = makeVerseBook([{ sid: 'EXO 1:1', text: 'delta epsilon' }]);
      return {
        draft: draftOf(
          combined(
            glossing(exodus, ['epsilon']),
            glossing(genesis('alpha beta'), ['beta']),
            translating('EXO 1:1', 'delta epsilon'),
          ),
        ),
        book: genesis('new alpha beta'),
      };
    },
  ],
];

describe('reanchorChangesForBook', () => {
  it.each(DRIFT_CASES)('matches the WebView pass when %s', (_, make) => {
    const { draft, book } = make();

    const changes = reanchorChangesForBook(draft, book);

    expect(changes).toBeDefined();
    expectParity(draft, changes, reanchorDraftToBook(book));
  });

  it.each(DRIFT_CASES)('makes the same changes from the book alone when %s', (_, make) => {
    const { draft, book } = make();

    expect(reanchorChangesForBook(bookOnly(draft, book.bookRef), book)).toEqual(
      reanchorChangesForBook(draft, book),
    );
  });

  it.each(DRIFT_CASES)('changes nothing more once applied when %s', (_, make) => {
    const { draft, book } = make();
    const changes = reanchorChangesForBook(draft, book);
    if (!changes) throw new Error('expected changes');

    expect(reanchorChangesForBook(applyChangeSet(draft, changes).draft, book)).toBeUndefined();
  });

  it('names the re-anchor as its intent', () => {
    const [[, make]] = DRIFT_CASES;
    const { draft, book } = make();

    expect(reanchorChangesForBook(draft, book)?.intent).toBe(REANCHOR_INTENT);
  });

  it('puts only the links the pass rewrote', () => {
    const before = genesis('alpha beta', 'gamma');
    const draft = draftOf(glossing(before, ['beta', 'gamma']));

    const changes = reanchorChangesForBook(draft, genesis('new alpha beta', 'gamma'));

    expect(changes?.tokenAnalysisLinks?.puts.map(({ analysisId }) => analysisId)).toEqual([
      'ta-beta',
    ]);
    expect(changes?.tokenAnalysisLinks?.deletes).toEqual([]);
    expect(changes?.tokenAnalyses).toBeUndefined();
    expect(changes?.scope).toBeUndefined();
  });

  it("carries the draft's record with the split it moved", () => {
    const splitCase = DRIFT_CASES.find(([name]) => name.startsWith('a split'));
    if (!splitCase) throw new Error('expected a split case');
    const { draft, book } = splitCase[1]();
    const named = { ...draft, analysisLanguages: ['fr'], suggestedName: 'Named' };

    const scope = reanchorChangesForBook(named, book)?.scope;

    expect(scope).toEqual(
      expect.objectContaining({ analysisLanguages: ['fr'], suggestedName: 'Named' }),
    );
    expect(scope).not.toHaveProperty('analysis');
    expect(scope).not.toHaveProperty('dirty');
  });

  it('changes nothing when the book reads as the draft was written against', () => {
    const book = genesis('alpha beta');
    const draft = draftOf(combined(glossing(book, ['beta']), translating('GEN 1:1', 'alpha')), {
      removedVerseStarts: [],
      addedStarts: [{ tokenRef: refOf(book, 'beta'), surfaceText: 'beta' }],
    });

    expect(reanchorChangesForBook(draft, book)).toBeUndefined();
  });
});

/** The draft-level counterparts of the missing-book cases in `reanchor-draft.test.ts`. */
const MISSING_BOOK_CASES: [string, () => DraftProject][] = [
  ['an approval is in the book', () => draftOf(glossing(genesis('alpha beta'), ['beta']))],
  ['a free translation is in the book', () => draftOf(translating('GEN 1:1', 'alpha beta'))],
  [
    'a phrase is in the book beside an approval in another',
    () =>
      draftOf(
        combined(
          phrasing(genesis('alpha beta'), ['alpha', 'beta']),
          glossing(makeVerseBook([{ sid: 'EXO 1:1', text: 'delta' }]), ['delta']),
        ),
      ),
  ],
];

describe('reanchorChangesForMissingBook', () => {
  it.each(MISSING_BOOK_CASES)('matches the WebView pass when %s', (_, make) => {
    const draft = make();

    const changes = reanchorChangesForMissingBook(draft, 'GEN');

    expect(changes).toBeDefined();
    const applied = expectParity(draft, changes, reanchorDraftToMissingBook('GEN'));
    expect(
      [
        ...applied.analysis.tokenAnalysisLinks,
        ...applied.analysis.phraseAnalysisLinks,
        ...applied.analysis.segmentAnalysisLinks,
      ]
        .filter((link) => link.status === 'stale')
        .map(({ id }) => id),
    ).not.toEqual([]);
  });

  it.each(MISSING_BOOK_CASES)('makes the same changes from the book alone when %s', (_, make) => {
    const draft = make();

    expect(reanchorChangesForMissingBook(bookOnly(draft, 'GEN'), 'GEN')).toEqual(
      reanchorChangesForMissingBook(draft, 'GEN'),
    );
  });

  it("leaves another book's approvals alone", () => {
    const draft = draftOf(glossing(genesis('alpha beta'), ['beta']));

    expect(reanchorChangesForMissingBook(draft, 'EXO')).toBeUndefined();
  });
});
