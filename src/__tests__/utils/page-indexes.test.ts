/// <reference types="jest" />

import type { Book, PhraseAnalysisLink } from 'interlinearizer';
import { resegmentBook } from 'parsers/papi/resegmentBook';
import type { PageAnalysis, SegmentPage } from '../../types/segment-pages';
import { buildBookIndexes } from '../../utils/book-indexes';
import { buildBookOutline } from '../../utils/book-outline';
import { buildPageIndexes, outlineRangeOf } from '../../utils/page-indexes';
import { emptyAnalysis } from '../../types/empty-factories';
import { makePhraseLink, makeVerseBook, tokenRefOf } from '../test-helpers';

const BOOK = makeVerseBook([
  { sid: 'GEN 1:1', text: 'In the beginning, God created.' },
  { sid: 'GEN 1:2', text: 'And the earth was void.' },
  { sid: 'GEN 1:3', text: 'And God said, light!' },
  { sid: 'GEN 1:4', text: 'And there was light.' },
]);
const ref = (surfaceText: string, book: Book = BOOK) => tokenRefOf(book, surfaceText);

/** The page of `book` holding the segments at `[start, end)`, with the spans of `links`. */
function pageOf(
  book: Book,
  start: number,
  end: number,
  links: readonly PhraseAnalysisLink[] = [],
): SegmentPage {
  const indexes = buildBookIndexes(book.segments);
  const analysis: PageAnalysis = {
    ...emptyAnalysis(),
    phraseAnalysisLinks: links,
    poolBuckets: {},
    staleFreeTranslations: { bySegment: {}, orphanedAfter: {}, orphanedAhead: [] },
    phraseSpans: Object.fromEntries(
      links.map((link) => [
        link.id,
        link.tokens.flatMap(({ tokenRef }) => {
          const token = indexes.wordTokenByRef.get(tokenRef);
          const segmentId = indexes.tokenSegmentMap.get(tokenRef);
          const docOrder = indexes.tokenDocOrder.get(tokenRef);
          if (!token || segmentId === undefined || docOrder === undefined) return [];
          const gapText = indexes.gapTextByWordRef.get(tokenRef);
          return [{ token, segmentId, docOrder, ...(gapText !== undefined && { gapText }) }];
        }),
      ]),
    ),
  };
  return {
    textVersion: book.textVersion,
    start,
    segments: book.segments.slice(start, end),
    analysis,
  };
}

/** The entries of `map` for those of `keys` that it holds. */
function restricted<V>(map: ReadonlyMap<string, V>, keys: Iterable<string>): Map<string, V> {
  const entries: [string, V][] = [];
  [...keys].forEach((key) => {
    const value = map.get(key);
    if (value !== undefined) entries.push([key, value]);
  });
  return new Map(entries);
}

describe('buildPageIndexes', () => {
  const outline = buildBookOutline(BOOK, BOOK.segments).segments;
  const whole = buildBookIndexes(BOOK.segments);

  it('places the tokens of the pages held as the whole book places them', () => {
    const pages = [pageOf(BOOK, 0, 1), pageOf(BOOK, 2, 3)];
    const refs = [BOOK.segments[0], BOOK.segments[2]].flatMap((s) => s.tokens.map((t) => t.ref));

    const indexes = buildPageIndexes(outline, pages);

    expect(indexes.tokenDocOrder).toStrictEqual(restricted(whole.tokenDocOrder, refs));
    expect(indexes.fullTokenOrder).toStrictEqual(restricted(whole.fullTokenOrder, refs));
    expect(indexes.tokenSegmentMap).toStrictEqual(restricted(whole.tokenSegmentMap, refs));
    expect(indexes.wordTokenByRef).toStrictEqual(restricted(whole.wordTokenByRef, refs));
    expect(indexes.gapTextByWordRef).toStrictEqual(restricted(whole.gapTextByWordRef, refs));
  });

  it('places the tokens of a phrase in a segment not held as the whole book places them', () => {
    const link = makePhraseLink('pl', [ref('earth'), ref('God')]);
    const spanned = [ref('earth'), ref('God')];

    const indexes = buildPageIndexes(outline, [pageOf(BOOK, 0, 1, [link])]);

    expect(restricted(indexes.tokenDocOrder, spanned)).toStrictEqual(
      restricted(whole.tokenDocOrder, spanned),
    );
    expect(restricted(indexes.tokenSegmentMap, spanned)).toStrictEqual(
      restricted(whole.tokenSegmentMap, spanned),
    );
    expect(restricted(indexes.wordTokenByRef, spanned)).toStrictEqual(
      restricted(whole.wordTokenByRef, spanned),
    );
    expect(restricted(indexes.gapTextByWordRef, spanned)).toStrictEqual(
      restricted(whole.gapTextByWordRef, spanned),
    );
  });

  it('guards by the members the book still holds of a phrase naming one it lacks', () => {
    const link = makePhraseLink('pl', ['GEN 1:9:0', ref('In'), ref('the')]);

    const indexes = buildPageIndexes(outline, [pageOf(BOOK, 0, 1, [link])]);

    expect(indexes.straddledBoundaryRefs).toStrictEqual(new Set([ref('the')]));
  });

  it('builds over pages carrying no analysis, spanning nothing', () => {
    const { textVersion, start, segments } = pageOf(BOOK, 0, 1);

    const indexes = buildPageIndexes(outline, [{ textVersion, start, segments }]);

    expect(indexes.wordTokenByRef.size).toBe(5);
    expect(indexes.straddledBoundaryRefs.size).toBe(0);
  });

  it('lists every segment of the outline, and the segments of the pages held', () => {
    const indexes = buildPageIndexes(outline, [pageOf(BOOK, 1, 2)]);

    expect(indexes.segmentOrder).toStrictEqual(whole.segmentOrder);
    expect([...indexes.outlineSegmentById.values()]).toStrictEqual(outline);
    expect(indexes.segmentById).toStrictEqual(new Map([['GEN 1:2', BOOK.segments[1]]]));
  });

  it('guards the boundaries held that would cut a phrase, as the whole book does', () => {
    const across = makePhraseLink('pl-across', [ref('beginning'), ref('earth')]);
    const within = makePhraseLink('pl-within', [ref('said'), ref('light')]);
    const pages = [pageOf(BOOK, 0, 1, [across]), pageOf(BOOK, 2, 3, [within])];
    const held = [BOOK.segments[0], BOOK.segments[2]].flatMap((s) => s.tokens.map((t) => t.ref));
    const blocked = new Set<string>();
    [across, within].forEach(({ tokens }) => {
      const orders = tokens.map(({ tokenRef }) => whole.tokenDocOrder.get(tokenRef) ?? 0);
      for (let i = Math.min(...orders) + 1; i <= Math.max(...orders); i += 1)
        blocked.add(whole.wordRefByOrder[i]);
    });

    const indexes = buildPageIndexes(outline, pages);

    expect(indexes.straddledBoundaryRefs).toStrictEqual(
      new Set(held.filter((tokenRef) => blocked.has(tokenRef))),
    );
  });
});

describe('outlineRangeOf', () => {
  const headed = makeVerseBook([
    { sid: 'GEN 1:1', text: 'In the ' },
    { heading: 's1', verseId: 'GEN 1:1', text: 'The Creation', charIndex: 7 },
    { sid: 'GEN 1:1', text: 'beginning God', charOffset: 7 },
    { sid: 'GEN 1:2', text: 'And the earth was void.' },
    { sid: 'GEN 1:3', text: 'And God said' },
    { sid: 'GEN 1:4', text: 'And there was light.' },
  ]);
  const book = resegmentBook(headed, {
    removedVerseStarts: ['GEN 1:4:0'],
    addedStarts: [{ tokenRef: ref('was', headed), surfaceText: 'was' }],
  });
  const outline = buildBookOutline(book, book.segments).segments;
  const { tokenSegmentMap, segmentOrder } = buildBookIndexes(book.segments);

  it('finds the segment that holds each token of the book', () => {
    book.segments
      .flatMap((segment) => segment.tokens)
      .forEach(({ ref: tokenRef }) => {
        const index = segmentOrder.get(tokenSegmentMap.get(tokenRef) ?? '');

        expect(outlineRangeOf(outline, tokenRef)).toStrictEqual({
          start: index,
          end: (index ?? 0) + 1,
        });
      });
  });

  it('finds a segment by its id', () => {
    expect(outlineRangeOf(outline, 'GEN 1:3')).toStrictEqual({
      start: segmentOrder.get('GEN 1:3'),
      end: (segmentOrder.get('GEN 1:3') ?? 0) + 1,
    });
  });

  it('finds the segment begun mid-verse that a later verse begins in, by the verse', () => {
    const verses = makeVerseBook([
      { sid: 'GEN 1:1', text: 'In the beginning' },
      { sid: 'GEN 1:2', text: 'And the earth' },
    ]);
    const split = resegmentBook(verses, {
      removedVerseStarts: ['GEN 1:2:0'],
      addedStarts: [{ tokenRef: ref('beginning', verses), surfaceText: 'beginning' }],
    });
    const splitOutline = buildBookOutline(split, split.segments).segments;

    expect(outlineRangeOf(splitOutline, 'GEN 1:2')).toStrictEqual({ start: 1, end: 2 });
  });

  it('finds nothing for a token of a verse the book lacks', () => {
    expect(outlineRangeOf(outline, 'GEN 1:9:0')).toBeUndefined();
  });

  it('finds nothing for a heading the book lacks', () => {
    expect(outlineRangeOf(outline, 'GEN 1:2/s1:0')).toBeUndefined();
  });
});
