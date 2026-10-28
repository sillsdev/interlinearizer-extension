/* eslint-disable no-console -- a command-line tool reports to its terminal */
import type {
  AnalysisChange,
  AnalysisLink,
  AnalysisQuery,
  Book,
  ChangedBook,
  DraftProject,
  PhraseAnalysisLink,
  SegmentAnalysisLink,
  SegmentationDelta,
  TextAnalysis,
  TokenAnalysisLink,
} from 'interlinearizer';
import { performance } from 'perf_hooks';
import { resegmentBook } from '../../src/parsers/papi/resegmentBook';
import { PageClient } from '../../src/cache/pageClient';
import {
  AnalysisSessions,
  type ReportedChange,
  type Session,
  type SessionHost,
} from '../../src/services/analysisSessions';
import { ApprovalRuleError } from '../../src/services/commands/approvalRule';
import * as boundaryCommands from '../../src/services/commands/boundaryCommands';
import type { ChangeBuffer } from '../../src/services/commands/changeBuffer';
import * as catalogCommands from '../../src/services/commands/catalogCommands';
import * as freeTranslationCommands from '../../src/services/commands/freeTranslationCommands';
import * as phraseCommands from '../../src/services/commands/phraseCommands';
import * as staleCommands from '../../src/services/commands/staleCommands';
import * as tokenCommands from '../../src/services/commands/tokenCommands';
import { DraftRepository } from '../../src/services/draftRepository';
import { readBookOutline, readSegmentPage } from '../../src/services/sessionPages';
import { selectPoolIndex, selectStaleFreeTranslations } from '../../src/store/analysisSlice';
import type {
  ChangeSet,
  KeyValueStorage,
  RecordChanges,
  WarningLogger,
} from '../../src/types/analysis-repository';
import type { OutlineSegment, SegmentPage } from '../../src/types/segment-pages';
import { isWordToken } from '../../src/types/type-guards';
import { bookOfRef } from '../../src/utils/analysis-book';
import { normalizeSurfaceForm } from '../../src/utils/analysis-identity';
import { bookIndexesOf, buildBookIndexes } from '../../src/utils/book-indexes';
import { buildPageIndexes, outlineRangeOf } from '../../src/utils/page-indexes';
import { computeSplitFreeRefs, sortByDocOrder } from '../../src/utils/phrase-arc';
import { phraseSurfaceForm } from '../../src/utils/phrase-text';
import { reanchorSegmentation, segmentationForBook } from '../../src/utils/segmentation';
import { placeStaleFreeTranslations } from '../../src/utils/stale-free-translations';
import { loadBooks } from '../books';
import { createRng, type Rng } from '../dataset/rng';
import { readDraftJson, readManifest } from '../dataset/store';
import { TIERS, type TierSpec } from '../dataset/tiers';
import { readCaptureMeta } from '../usj-cache';

/** How many segments one page holds, as the WebView asks for them. */
const PAGE_SIZE = 32;

const STAMP = '2026-01-01T00:00:00.000Z';

/** Random edits break invariants that a load reports, so its warnings say nothing here. */
const SILENT: WarningLogger = { warn: () => {} };

/** A session host that reads no text, serving drafts from `storage` and books from `heldBook`. */
function sessionHost(
  storage: KeyValueStorage,
  heldBook: (bookId: string, segmentation: SegmentationDelta | undefined) => Book | undefined,
  reportChange: (change: ReportedChange) => void,
): SessionHost {
  return {
    findProject: async () => undefined,
    openDraftRepository: (sourceProjectId) => new DraftRepository(storage, sourceProjectId, SILENT),
    releaseDraftRepository: async () => {},
    openPt9ImportRepository: () => {
      throw new Error('no imports here');
    },
    getInterfaceLanguages: async () => ['en'],
    startTextRead: async () => {},
    stopTextRead: async () => {},
    heldBook: (_source, bookId, segmentation) => heldBook(bookId, segmentation),
    reportChange,
  };
}

function memoryStorage(): KeyValueStorage {
  const records = new Map<string, string>();
  return {
    async read(key) {
      return records.get(key);
    },
    async write(key, data) {
      records.set(key, data);
    },
    async delete(key) {
      records.delete(key);
    },
  };
}

function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)];
}

/** Records in id order, serialized, so two answers compare without regard to order. */
function canonical(records: readonly { id: string }[]): string {
  return JSON.stringify([...records].sort((a, b) => a.id.localeCompare(b.id)));
}

/** An object's entries in key order, serialized. */
function canonicalMap(map: Readonly<Record<string, unknown>>): string {
  return JSON.stringify(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * Adds stale free translations of verses each book no longer holds: one after its last verse and
 * one ahead of its first, so pages and outlines have orphans to place.
 */
function seedOrphans(draft: DraftProject, books: readonly Book[]): void {
  books.forEach(({ bookRef, segments }) => {
    const last = segments.findLast((segment) => !segment.heading && segment.verseStarts.length > 0);
    if (!last) return;
    const { chapter } = last.startRef;
    [`${bookRef} ${chapter}:999`, `${bookRef} 1:-1`].forEach((segmentId, i) => {
      const id = `orphan-${bookRef}-${i}`;
      draft.analysis.segmentAnalyses.push({
        id,
        createdAt: STAMP,
        updatedAt: STAMP,
        surfaceText: 'lost',
        freeTranslation: { en: 'lost' },
      });
      draft.analysis.segmentAnalysisLinks.push({
        id: `link-${id}`,
        analysisId: id,
        segmentId,
        status: 'stale',
        createdAt: STAMP,
        updatedAt: STAMP,
      });
    });
  });
}

/** What the WebView's store holds for each range of a book, read from the whole analysis. */
function expectedPages(analysis: TextAnalysis, book: Book) {
  const state = { analysis, analysisLanguage: 'en' };
  const pool = selectPoolIndex(state);
  const placed = placeStaleFreeTranslations(selectStaleFreeTranslations(state), book);
  const tokenAnalysisById = new Map(analysis.tokenAnalyses.map((a) => [a.id, a]));
  const phraseAnalysisById = new Map(analysis.phraseAnalyses.map((a) => [a.id, a]));
  const segmentAnalysisById = new Map(analysis.segmentAnalyses.map((a) => [a.id, a]));
  const linksByRef = new Map<string, TokenAnalysisLink[]>();
  analysis.tokenAnalysisLinks.forEach((link) => {
    const list = linksByRef.get(link.token.tokenRef) ?? [];
    list.push(link);
    linksByRef.set(link.token.tokenRef, list);
  });
  const phrasesByRef = new Map<string, PhraseAnalysisLink[]>();
  analysis.phraseAnalysisLinks.forEach((link) =>
    link.tokens.forEach(({ tokenRef }) => {
      const list = phrasesByRef.get(tokenRef) ?? [];
      list.push(link);
      phrasesByRef.set(tokenRef, list);
    }),
  );
  const segmentLinksById = new Map<string, SegmentAnalysisLink[]>();
  analysis.segmentAnalysisLinks.forEach((link) => {
    const list = segmentLinksById.get(link.segmentId) ?? [];
    list.push(link);
    segmentLinksById.set(link.segmentId, list);
  });
  const staleLinkByAnalysisId = new Map(
    analysis.segmentAnalysisLinks.filter((l) => l.status === 'stale').map((l) => [l.analysisId, l]),
  );

  return (start: number, end: number) => {
    const segments = book.segments.slice(start, end);
    const tokens = segments.flatMap((segment) => segment.tokens);
    const tokenLinks = tokens.flatMap(({ ref }) => linksByRef.get(ref) ?? []);
    const phraseLinks = [
      ...new Map(
        tokens.flatMap(({ ref }) => phrasesByRef.get(ref) ?? []).map((l) => [l.id, l]),
      ).values(),
    ];
    const ids = (list: readonly { analysisId: string }[] | undefined) =>
      list?.map(({ analysisId }) => analysisId);
    const bySegment: Record<string, readonly string[]> = {};
    const orphanedAfter: Record<string, readonly string[]> = {};
    segments.forEach(({ id }) => {
      const reviewed = ids(placed.bySegment.get(id));
      if (reviewed) bySegment[id] = reviewed;
      const orphaned = ids(placed.orphanedAfter.get(id));
      if (orphaned) orphanedAfter[id] = orphaned;
    });
    const orphanedAhead = start === 0 ? placed.orphanedAhead.map((t) => t.analysisId) : [];
    const placedLinks = [
      ...Object.values(bySegment),
      ...Object.values(orphanedAfter),
      orphanedAhead,
    ]
      .flat()
      .flatMap((analysisId) => staleLinkByAnalysisId.get(analysisId) ?? []);
    const segmentLinks = [
      ...new Map(
        [...segments.flatMap(({ id }) => segmentLinksById.get(id) ?? []), ...placedLinks].map(
          (l) => [l.id, l],
        ),
      ).values(),
    ];
    const poolBuckets: Record<string, { analysisId: string; frequency: number }[]> = {};
    tokens.filter(isWordToken).forEach((token) => {
      const form = normalizeSurfaceForm(token.surfaceText);
      poolBuckets[form] = (pool.get(form) ?? []).map((entry) => ({
        analysisId: entry.analysis.id,
        frequency: entry.frequency,
      }));
    });
    const tokenPayloadIds = new Set([
      ...tokenLinks.map((l) => l.analysisId),
      ...Object.values(poolBuckets)
        .flat()
        .map((e) => e.analysisId),
    ]);
    return {
      tokenAnalysisLinks: tokenLinks,
      phraseAnalysisLinks: phraseLinks,
      segmentAnalysisLinks: segmentLinks,
      tokenAnalyses: [...tokenPayloadIds].flatMap((id) => tokenAnalysisById.get(id) ?? []),
      phraseAnalyses: [...new Set(phraseLinks.map((l) => l.analysisId))].flatMap(
        (id) => phraseAnalysisById.get(id) ?? [],
      ),
      segmentAnalyses: [...new Set(segmentLinks.map((l) => l.analysisId))].flatMap(
        (id) => segmentAnalysisById.get(id) ?? [],
      ),
      poolBuckets,
      staleFreeTranslations: { bySegment, orphanedAfter, orphanedAhead },
      orphanedCardCount: (index: number) =>
        (index === 0 ? placed.orphanedAhead.length : 0) +
        (placed.orphanedAfter.get(book.segments[index].id)?.length ?? 0),
    };
  };
}

/**
 * Compares each page and the outline of every book with what the WebView's store holds for them.
 *
 * @returns The pages that differ, by book and start, with what differed.
 */
async function checkPages(
  repository: DraftRepository,
  analysis: TextAnalysis,
  books: readonly Book[],
  viewBook: string,
): Promise<{ pages: number; mismatches: string[]; phrasesCrossing: number; jumps: number }> {
  const mismatches: string[] = [];
  let pages = 0;
  let phrasesCrossing = 0;
  let jumps = 0;
  // eslint-disable-next-line no-restricted-syntax -- books are read one at a time to bound memory
  for (const book of books) {
    const expectedFor = expectedPages(analysis, book);
    // eslint-disable-next-line no-await-in-loop -- one book's reads at a time
    const outline = await readBookOutline(repository, book);
    const counts = outline.segments.map((s) => s.orphanedCardCount);
    if (
      JSON.stringify(counts) !==
      JSON.stringify(counts.map((_c, i) => expectedFor(0, 0).orphanedCardCount(i)))
    )
      mismatches.push(`${book.bookRef} outline orphaned cards`);
    for (let start = 0; start < book.segments.length; start += PAGE_SIZE) {
      // eslint-disable-next-line no-await-in-loop -- calls for one draft must not overlap
      const page: SegmentPage = await readSegmentPage(repository, book, start, start + PAGE_SIZE);
      const expected = expectedFor(start, start + PAGE_SIZE);
      const got = page.analysis;
      pages += 1;
      const differing = [
        [
          'token links',
          canonical(got?.tokenAnalysisLinks ?? []),
          canonical(expected.tokenAnalysisLinks),
        ],
        [
          'phrase links',
          canonical(got?.phraseAnalysisLinks ?? []),
          canonical(expected.phraseAnalysisLinks),
        ],
        [
          'segment links',
          canonical(got?.segmentAnalysisLinks ?? []),
          canonical(expected.segmentAnalysisLinks),
        ],
        ['token payloads', canonical(got?.tokenAnalyses ?? []), canonical(expected.tokenAnalyses)],
        [
          'phrase payloads',
          canonical(got?.phraseAnalyses ?? []),
          canonical(expected.phraseAnalyses),
        ],
        [
          'segment payloads',
          canonical(got?.segmentAnalyses ?? []),
          canonical(expected.segmentAnalyses),
        ],
        ['pool buckets', canonicalMap(got?.poolBuckets ?? {}), canonicalMap(expected.poolBuckets)],
        [
          'stale free translations',
          JSON.stringify([
            canonicalMap(got?.staleFreeTranslations.bySegment ?? {}),
            canonicalMap(got?.staleFreeTranslations.orphanedAfter ?? {}),
            got?.staleFreeTranslations.orphanedAhead,
          ]),
          JSON.stringify([
            canonicalMap(expected.staleFreeTranslations.bySegment),
            canonicalMap(expected.staleFreeTranslations.orphanedAfter),
            expected.staleFreeTranslations.orphanedAhead,
          ]),
        ],
      ].filter(([, a, b]) => a !== b);
      if (differing.length > 0)
        mismatches.push(`${book.bookRef} ${start}: ${differing.map(([name]) => name).join(', ')}`);
    }
    if (book.bookRef === viewBook) {
      const held: SegmentPage[] = [];
      for (let index = 0; index < book.segments.length; index += 2) {
        // eslint-disable-next-line no-await-in-loop -- calls for one draft must not overlap
        held.push(await readSegmentPage(repository, book, index, index + 1));
      }
      const bookPhrases = analysis.phraseAnalysisLinks.filter(
        ({ tokens }) => bookOfRef(tokens[0].tokenRef) === book.bookRef,
      );
      phrasesCrossing += checkPageIndexes(book, outline.segments, held, bookPhrases, mismatches);
      // A jump to a token whose page is not held loads the page that the outline places it on.
      for (let index = 1; index < book.segments.length; index += 20) {
        const [target] = book.segments[index].tokens.filter(isWordToken);
        const range = target && outlineRangeOf(outline.segments, target.ref);
        if (range) {
          // eslint-disable-next-line no-await-in-loop -- calls for one draft must not overlap
          const page = await readSegmentPage(repository, book, range.start, range.end);
          const landed = buildPageIndexes(outline.segments, [...held, page]);
          if (landed.tokenSegmentMap.get(target.ref) !== book.segments[index].id)
            mismatches.push(`${book.bookRef} jump to ${target.ref}`);
          jumps += 1;
        }
      }
    }
  }
  return { pages, mismatches, phrasesCrossing, jumps };
}

/**
 * Checks that lookups built from the pages `held` read as the whole book's lookups do. The check
 * covers each phrase's text, arc order, split previews and segments. It also covers the boundary
 * guard on the held tokens and where each token's segment lies in the outline.
 *
 * @returns How many phrases that the held pages name reach a segment that no held page holds.
 */
function checkPageIndexes(
  book: Book,
  outline: readonly OutlineSegment[],
  held: readonly SegmentPage[],
  bookPhrases: readonly PhraseAnalysisLink[],
  mismatches: string[],
): number {
  const whole = buildBookIndexes(book.segments);
  const paged = buildPageIndexes(outline, held);
  const links = [
    ...new Map(
      held.flatMap((page) => page.analysis?.phraseAnalysisLinks ?? []).map((l) => [l.id, l]),
    ).values(),
  ];
  let crossing = 0;
  links.forEach((link) => {
    const refs = link.tokens.map(({ tokenRef }) => tokenRef);
    if (refs.some((tokenRef) => !paged.segmentById.has(whole.tokenSegmentMap.get(tokenRef) ?? '')))
      crossing += 1;
    const differs = (name: string, a: unknown, b: unknown) => {
      if (JSON.stringify(a) !== JSON.stringify(b))
        mismatches.push(`${book.bookRef} phrase ${link.id}: ${name}`);
    };
    differs('text', phraseSurfaceForm(link.tokens, paged), phraseSurfaceForm(link.tokens, whole));
    differs(
      'arc order',
      sortByDocOrder(link.tokens, paged.tokenDocOrder),
      sortByDocOrder(link.tokens, whole.tokenDocOrder),
    );
    differs(
      'split previews',
      refs.map((tokenRef) => computeSplitFreeRefs(link, tokenRef, paged.tokenDocOrder)),
      refs.map((tokenRef) => computeSplitFreeRefs(link, tokenRef, whole.tokenDocOrder)),
    );
    differs(
      'segments',
      refs.map((tokenRef) => paged.tokenSegmentMap.get(tokenRef)),
      refs.map((tokenRef) => whole.tokenSegmentMap.get(tokenRef)),
    );
  });
  const guarded = new Set<string>();
  bookPhrases.forEach(({ tokens }) => {
    const orders = tokens.flatMap(({ tokenRef }) => whole.tokenDocOrder.get(tokenRef) ?? []);
    for (let i = Math.min(...orders) + 1; i <= Math.max(...orders); i += 1)
      guarded.add(whole.wordRefByOrder[i]);
  });
  const heldRefs = held.flatMap((page) =>
    page.segments.flatMap((segment) => segment.tokens.map((token) => token.ref)),
  );
  if (
    JSON.stringify(heldRefs.filter((tokenRef) => guarded.has(tokenRef))) !==
    JSON.stringify(heldRefs.filter((tokenRef) => paged.straddledBoundaryRefs.has(tokenRef)))
  )
    mismatches.push(`${book.bookRef} boundary guard`);
  const misplaced = book.segments.flatMap((segment, index) =>
    segment.tokens.flatMap(({ ref }) => {
      const range = outlineRangeOf(outline, ref);
      return range?.start === index && range.end === index + 1 ? [] : [ref];
    }),
  );
  if (misplaced.length > 0)
    mismatches.push(
      `${book.bookRef} outline places ${misplaced.length} tokens elsewhere, ${misplaced[0]} first`,
    );
  return crossing;
}

/** The book segmented by `delta`, its segments kept per delta so indexes over them are built once. */
function segmenter(books: ReadonlyMap<string, Book>) {
  const cache = new Map<string, Book>();
  return (bookId: string, delta: SegmentationDelta | undefined): Book | undefined => {
    const book = books.get(bookId);
    if (!book) return undefined;
    const key = `${bookId}:${JSON.stringify(delta)}`;
    let segmented = cache.get(key);
    if (!segmented) {
      segmented = {
        ...book,
        segments: resegmentBook(book, reanchorSegmentation(book, delta)).segments,
      };
      cache.set(key, segmented);
    }
    return segmented;
  };
}

/** The records `changes` put or deleted, as they stood before and as they stand after. */
function versions<T extends { id: string }>(
  changes: RecordChanges<T> | undefined,
  before: readonly T[],
  after: readonly T[],
): T[] {
  const named = new Set([
    ...(changes?.puts ?? []).map(({ id }) => id),
    ...(changes?.deletes ?? []),
  ]);
  const was = new Map(before.map((r) => [r.id, r]));
  const is = new Map(after.map((r) => [r.id, r]));
  return [...named].flatMap((id) => [was.get(id), is.get(id)].filter((r) => r !== undefined));
}

/**
 * What a change's event should name, read from the drafts before and after it: the records its puts
 * and deletes reached, each where the view shows it before and after.
 */
function expectedChange(
  changes: ChangeSet,
  before: DraftProject,
  after: DraftProject,
  segmented: (bookId: string, delta: SegmentationDelta | undefined) => Book | undefined,
): AnalysisChange {
  const was = before.analysis;
  const is = after.analysis;
  const tokenPayloads = versions(changes.tokenAnalyses, was.tokenAnalyses, is.tokenAnalyses);
  const segmentPayloads = versions(
    changes.segmentAnalyses,
    was.segmentAnalyses,
    is.segmentAnalyses,
  );
  const phrasePayloads = versions(changes.phraseAnalyses, was.phraseAnalyses, is.phraseAnalyses);
  const tokenLinks = versions(
    changes.tokenAnalysisLinks,
    was.tokenAnalysisLinks,
    is.tokenAnalysisLinks,
  );
  const phraseLinks = versions(
    changes.phraseAnalysisLinks,
    was.phraseAnalysisLinks,
    is.phraseAnalysisLinks,
  );
  const segmentLinks = versions(
    changes.segmentAnalysisLinks,
    was.segmentAnalysisLinks,
    is.segmentAnalysisLinks,
  );
  const links: AnalysisLink[] = [...tokenLinks, ...phraseLinks, ...segmentLinks];
  const payloadIds = [...tokenPayloads, ...segmentPayloads, ...phrasePayloads].map(({ id }) => id);
  const whole = new Set<string>();
  const books = new Set(
    [
      ...(before.segmentation?.removedVerseStarts ?? []),
      ...(after.segmentation?.removedVerseStarts ?? []),
      ...(before.segmentation?.addedStarts ?? []).map((s) => s.tokenRef),
      ...(after.segmentation?.addedStarts ?? []).map((s) => s.tokenRef),
    ].map(bookOfRef),
  );
  books.forEach((bookId) => {
    if (
      JSON.stringify(segmentationForBook(before.segmentation, bookId)) !==
      JSON.stringify(segmentationForBook(after.segmentation, bookId))
    )
      whole.add(bookId);
  });
  const indexes = new Map<string, Set<number>>();
  const mark = (bookId: string, index: number | undefined) => {
    if (whole.has(bookId)) return;
    const book = segmented(bookId, segmentationForBook(after.segmentation, bookId));
    if (!book) {
      whole.add(bookId);
      return;
    }
    if (index === undefined) return;
    indexes.set(bookId, (indexes.get(bookId) ?? new Set()).add(index));
  };
  const at = (bookId: string) => segmented(bookId, segmentationForBook(after.segmentation, bookId));
  segmentLinks.forEach(({ segmentId }) => {
    const bookId = bookOfRef(segmentId);
    const book = at(bookId);
    if (!book) return mark(bookId, undefined);
    const order = bookIndexesOf(book.segments).segmentOrder;
    const own = order.get(segmentId);
    if (own !== undefined) return mark(bookId, own);
    const placed = placeStaleFreeTranslations([{ analysisId: '', segmentId, text: '' }], book);
    if (placed.orphanedAhead.length > 0) return mark(bookId, 0);
    const [placedAt] = [...placed.bySegment.keys(), ...placed.orphanedAfter.keys()];
    return mark(bookId, placedAt === undefined ? undefined : order.get(placedAt));
  });
  const markToken = (ref: string) => {
    const bookId = bookOfRef(ref);
    const book = at(bookId);
    if (!book) return mark(bookId, undefined);
    const { tokenSegmentMap, segmentOrder } = bookIndexesOf(book.segments);
    const segmentId = tokenSegmentMap.get(ref);
    return mark(bookId, segmentId === undefined ? undefined : segmentOrder.get(segmentId));
  };
  tokenLinks.forEach(({ token }) => markToken(token.tokenRef));
  phraseLinks.forEach(({ tokens }) => tokens.forEach(({ tokenRef }) => markToken(tokenRef)));
  const ranges = (set: ReadonlySet<number>) => {
    const out: { start: number; end: number }[] = [];
    [...set]
      .sort((a, b) => a - b)
      .forEach((i) => {
        const last = out.at(-1);
        if (last?.end === i) last.end = i + 1;
        else out.push({ start: i, end: i + 1 });
      });
    return out;
  };
  const changedBooks: ChangedBook[] = [...new Set([...whole, ...indexes.keys()])]
    .sort()
    .map((bookId) => {
      const set = indexes.get(bookId);
      return whole.has(bookId) || !set ? { bookId } : { bookId, ranges: ranges(set) };
    });
  const staleIds = new Set(
    [
      ...after.analysis.tokenAnalysisLinks,
      ...after.analysis.phraseAnalysisLinks,
      ...after.analysis.segmentAnalysisLinks,
    ]
      .filter((l) => l.status === 'stale')
      .map((l) => l.analysisId),
  );
  const queries: AnalysisQuery[] = [];
  if (tokenPayloads.length + tokenLinks.length > 0)
    queries.push('getCatalogRows', 'getConcordance');
  const stalePayload = [...tokenPayloads, ...segmentPayloads].some(({ id }) => staleIds.has(id));
  if (links.some(({ status }) => status === 'stale') || stalePayload)
    queries.push('getStaleSummary');
  return {
    books: changedBooks,
    analysisIds: [...new Set([...payloadIds, ...links.map(({ analysisId }) => analysisId)])].sort(),
    queries,
  };
}

/** Sorts books by id, so an expected change compares with one named in canonical order. */
function comparable(change: AnalysisChange | undefined): string {
  if (!change) return 'nothing';
  const { books, analysisIds, queries } = change;
  return JSON.stringify({
    books: [...books].sort((a, b) => a.bookId.localeCompare(b.bookId)),
    analysisIds,
    queries,
  });
}

/**
 * Runs random commands, undos and redos in a session over the tier. Compares each change's event
 * with what the drafts before and after it say it touched. Checks that a page client following the
 * changes holds what the session serves, including when a refetch is sent before a change.
 *
 * @returns How many changes ran, those whose event or cached pages differed, and how many refetches
 *   raced a change.
 */
async function checkEvents(
  draft: DraftProject,
  books: readonly Book[],
  viewBook: Book,
  steps: number,
): Promise<{ changes: number; mismatches: string[]; races: number }> {
  const storage = memoryStorage();
  await new DraftRepository(storage, draft.sourceProjectId, SILENT).replaceAll(draft);
  const segmented = segmenter(new Map(books.map((b) => [b.bookRef, b])));
  const reported = new Map<string, ReportedChange>();
  const sessions = new AnalysisSessions(
    sessionHost(storage, segmented, (change) => reported.set(change.changeId, change)),
  );
  const { sessionId } = await sessions.open(draft.sourceProjectId);
  const read = async () =>
    (await new DraftRepository(storage, draft.sourceProjectId, SILENT).exportAll()).draft;
  const rng = createRng('pages', draft.sourceProjectId);
  const words = viewBook.segments.flatMap((s) => s.tokens.filter(isWordToken));
  const pairs = viewBook.segments.flatMap((s) => {
    const w = s.tokens.filter(isWordToken);
    return w.slice(1).map((t, i) => [w[i], t]);
  });
  const now = () => new Date().toISOString();
  const ids = () => ({
    analysisId: crypto.randomUUID(),
    linkId: crypto.randomUUID(),
    forkId: crypto.randomUUID(),
  });
  const snapshot = (t: { ref: string; surfaceText: string }) => ({
    tokenRef: t.ref,
    surfaceText: t.surfaceText,
  });

  const commands: [
    string,
    (buffer: ChangeBuffer, current: DraftProject) => Promise<void | Book[]>,
  ][] = [
    [
      'writeGloss',
      async (buffer) => {
        const t = pick(rng, words);
        await tokenCommands.writeGloss(buffer, {
          ...ids(),
          now: now(),
          tokenRef: t.ref,
          surfaceText: t.surfaceText,
          value: `g${Math.floor(rng() * 5)}`,
          analysisLanguage: 'en',
        });
      },
    ],
    [
      'approveAnalysisForToken',
      async (buffer, current) => {
        const t = pick(rng, words);
        const form = normalizeSurfaceForm(t.surfaceText);
        const payloads = current.analysis.tokenAnalyses.filter(
          (a) => normalizeSurfaceForm(a.surfaceText) === form,
        );
        if (payloads.length === 0) return;
        await tokenCommands.approveAnalysisForToken(buffer, {
          ...ids(),
          now: now(),
          tokenRef: t.ref,
          surfaceText: t.surfaceText,
          analysisId: pick(rng, payloads).id,
        });
      },
    ],
    [
      'writeSegmentFreeTranslation',
      async (buffer) => {
        const s = pick(rng, viewBook.segments);
        await freeTranslationCommands.writeSegmentFreeTranslation(buffer, {
          ...ids(),
          now: now(),
          segmentId: s.id,
          surfaceText: s.baselineText,
          value: `ft${Math.floor(rng() * 3)}`,
          analysisLanguage: 'en',
        });
      },
    ],
    [
      'createPhrase',
      async (buffer) => {
        if (pairs.length === 0) return;
        const pair = pick(rng, pairs);
        await phraseCommands.createPhrase(buffer, {
          ...ids(),
          now: now(),
          tokens: pair.map(snapshot),
        });
      },
    ],
    [
      'discardStaleFreeTranslation',
      async (buffer, current) => {
        const stale = current.analysis.segmentAnalysisLinks.filter(
          (l) => l.status === 'stale' && bookOfRef(l.segmentId) === viewBook.bookRef,
        );
        if (stale.length === 0) return;
        await staleCommands.discardStaleFreeTranslation(buffer, {
          analysisId: pick(rng, stale).analysisId,
        });
      },
    ],
    [
      'keepStaleFreeTranslation',
      async (buffer, current) => {
        const stale = current.analysis.segmentAnalysisLinks.filter(
          (l) => l.status === 'stale' && bookOfRef(l.segmentId) === viewBook.bookRef,
        );
        if (stale.length === 0) return;
        const s = pick(rng, viewBook.segments);
        await staleCommands.keepStaleFreeTranslation(buffer, {
          analysisId: pick(rng, stale).analysisId,
          segmentId: s.id,
          surfaceText: s.baselineText,
          now: now(),
        });
      },
    ],
    [
      'writeAnalysisGloss',
      async (buffer, current) => {
        if (current.analysis.tokenAnalyses.length === 0) return;
        await catalogCommands.writeAnalysisGloss(buffer, {
          analysisId: pick(rng, current.analysis.tokenAnalyses).id,
          value: `c${Math.floor(rng() * 3)}`,
          analysisLanguage: 'en',
          now: now(),
        });
      },
    ],
    [
      'deleteAnalyses',
      async (buffer, current) => {
        if (current.analysis.tokenAnalyses.length === 0) return;
        await catalogCommands.deleteAnalyses(buffer, {
          analysisIds: [pick(rng, current.analysis.tokenAnalyses).id],
        });
      },
    ],
    [
      'splitSegment',
      async (buffer) => {
        const s = pick(
          rng,
          viewBook.segments.filter((seg) => seg.tokens.filter(isWordToken).length > 1),
        );
        const t = s.tokens.filter(isWordToken)[1];
        await boundaryCommands.splitSegment(buffer, {
          verseBook: viewBook,
          tokenRef: t.ref,
          now: now(),
          newId: () => crypto.randomUUID(),
        });
        return [viewBook];
      },
    ],
  ];

  const sessionBook = async (session: Session) => {
    const { segmentation } = await session.repository.getScope();
    return (
      segmented(viewBook.bookRef, segmentationForBook(segmentation, viewBook.bookRef)) ?? viewBook
    );
  };
  const fetchPage = (start: number, end: number) =>
    sessions.run(sessionId, async (session) =>
      readSegmentPage(session.repository, await sessionBook(session), start, end),
    );
  const fetchOutline = () =>
    sessions.run(sessionId, async (session) =>
      readBookOutline(session.repository, await sessionBook(session)),
    );
  const client = new PageClient({ getOutline: fetchOutline, getSegments: fetchPage });
  await client.open();
  client.load(0, Number.MAX_SAFE_INTEGER, 'list');
  await client.settled();

  const mismatches: string[] = [];
  let changes = 0;
  let races = 0;
  for (let step = 0; step < steps; step += 1) {
    // eslint-disable-next-line no-await-in-loop -- each change builds on the one before
    const before = await read();
    const { cache } = client;
    if (!cache) throw new Error('The client holds no outline');
    const racing =
      rng() < 0.3
        ? Math.floor((rng() * viewBook.segments.length) / PAGE_SIZE) * PAGE_SIZE
        : undefined;
    const sentAt = cache.revision;
    const stalePage =
      racing === undefined
        ? undefined
        : // eslint-disable-next-line no-await-in-loop -- a refetch sent ahead of the change
          await fetchPage(racing, racing + PAGE_SIZE);
    const changeId = `step-${step}`;
    const roll = rng();
    let applied: ChangeSet | undefined;
    let name: string;
    if (roll < 0.1) {
      name = 'undo';
      // eslint-disable-next-line no-await-in-loop -- each change builds on the one before
      const reply = await sessions.undo(sessionId, changeId);
      if (reply) client.apply(reply);
      applied = reply?.changes;
    } else if (roll < 0.15) {
      name = 'redo';
      // eslint-disable-next-line no-await-in-loop -- each change builds on the one before
      const reply = await sessions.redo(sessionId, changeId);
      if (reply) client.apply(reply);
      applied = reply?.changes;
    } else {
      const [intent, command] = pick(rng, commands);
      name = intent;
      // eslint-disable-next-line no-await-in-loop -- each change builds on the one before
      const reply = await sessions
        .edit(sessionId, intent, (buffer) => command(buffer, before), { changeId })
        // A random edit that the approval rule refuses applies nothing, as the host intends.
        .catch((e) => {
          if (e instanceof ApprovalRuleError) return undefined;
          throw e;
        });
      if (reply) client.apply(reply);
      applied = reply?.changes;
    }
    if (stalePage && !applied?.scope) {
      cache.absorb(stalePage, sentAt);
      races += 1;
    }
    // eslint-disable-next-line no-await-in-loop -- the client settles before it is compared
    await client.settled();
    // eslint-disable-next-line no-await-in-loop -- compared against what the session serves now
    const outline = await fetchOutline();
    if (JSON.stringify(client.cache?.outline) !== JSON.stringify(outline))
      mismatches.push(`${name} (${changeId}): cached outline differs`);
    for (let start = 0; start < outline.segments.length; start += PAGE_SIZE) {
      // eslint-disable-next-line no-await-in-loop -- calls for one draft must not overlap
      const fresh = await fetchPage(start, start + PAGE_SIZE);
      if (canonicalPage(client.cache?.pageAt(start, start + PAGE_SIZE)) !== canonicalPage(fresh))
        mismatches.push(`${name} (${changeId}): cached page ${start} differs`);
    }
    // eslint-disable-next-line no-await-in-loop -- each change builds on the one before
    const after = await read();
    const expected =
      applied && Object.keys(applied).length > 1
        ? expectedChange(applied, before, after, segmented)
        : undefined;
    const isEmpty = (c: AnalysisChange | undefined) =>
      !c || (c.books.length === 0 && c.analysisIds.length === 0 && c.queries.length === 0);
    const want = isEmpty(expected) ? 'nothing' : comparable(expected);
    const got = comparable(reported.get(changeId));
    if (applied && Object.keys(applied).length > 1) changes += 1;
    if (want !== got) mismatches.push(`${name} (${changeId}): expected ${want}, reported ${got}`);
  }
  await sessions.closeAll();
  return { changes, mismatches, races };
}

/** A page with every list in id order and every map in key order, serialized. */
function canonicalPage(page: SegmentPage | undefined): string {
  if (!page?.analysis) return JSON.stringify(page);
  const { analysis, ...rest } = page;
  return JSON.stringify({
    ...rest,
    tokenAnalysisLinks: canonical(analysis.tokenAnalysisLinks),
    phraseAnalysisLinks: canonical(analysis.phraseAnalysisLinks),
    segmentAnalysisLinks: canonical(analysis.segmentAnalysisLinks),
    tokenAnalyses: canonical(analysis.tokenAnalyses),
    phraseAnalyses: canonical(analysis.phraseAnalyses),
    segmentAnalyses: canonical(analysis.segmentAnalyses),
    poolBuckets: canonicalMap(analysis.poolBuckets),
    staleFreeTranslations: [
      canonicalMap(analysis.staleFreeTranslations.bySegment),
      canonicalMap(analysis.staleFreeTranslations.orphanedAfter),
      analysis.staleFreeTranslations.orphanedAhead,
    ],
    phraseSpans: canonicalMap(analysis.phraseSpans),
  });
}

/**
 * Times opening a session on `draft`, the session's first page request, and the request after it.
 * The first request waits for whatever remains of the index build that opening starts.
 */
async function timeFirstRequest(
  draft: DraftProject,
  viewBook: Book,
): Promise<{ open: number; first: number; next: number }> {
  const storage = memoryStorage();
  await new DraftRepository(storage, draft.sourceProjectId, SILENT).replaceAll(draft);
  const sessions = new AnalysisSessions(
    sessionHost(
      storage,
      () => undefined,
      () => {},
    ),
  );
  let started = performance.now();
  const { sessionId } = await sessions.open(draft.sourceProjectId);
  const open = performance.now() - started;
  const page = (start: number) =>
    sessions.run(sessionId, ({ repository }) =>
      readSegmentPage(repository, viewBook, start, start + PAGE_SIZE),
    );
  started = performance.now();
  await page(0);
  const first = performance.now() - started;
  started = performance.now();
  await page(PAGE_SIZE);
  const next = performance.now() - started;
  await sessions.closeAll();
  return { open, first, next };
}

async function checkTier(tier: TierSpec): Promise<boolean> {
  const meta = readCaptureMeta();
  const manifest = readManifest(tier.name);
  const books = loadBooks(meta, manifest.books);
  const draft: DraftProject = JSON.parse(readDraftJson(tier.name));
  seedOrphans(draft, books);
  const viewBook = books.find((b) => b.bookRef === tier.viewBook);
  if (!viewBook) throw new Error(`Tier ${tier.name} has no view book ${tier.viewBook}`);

  const timing = await timeFirstRequest(draft, viewBook);

  const storage = memoryStorage();
  await new DraftRepository(storage, draft.sourceProjectId, SILENT).replaceAll(draft);
  const repository = new DraftRepository(storage, draft.sourceProjectId, SILENT);
  const pages = await checkPages(repository, draft.analysis, books, tier.viewBook);

  const links = draft.analysis.tokenAnalysisLinks.length;
  // Each change rereads the whole draft twice, so larger tiers get fewer.
  const steps = Math.min(200, Math.max(10, Math.round(2e6 / links)));
  const events = await checkEvents(draft, books, viewBook, steps);

  console.log(
    `${tier.name.padEnd(15)} ${pages.pages} pages, ${pages.mismatches.length} differ (${pages.phrasesCrossing} phrases reach unheld segments, ${pages.jumps} jumps)  ${events.changes} changes (${events.races} refetch races), ${events.mismatches.length} differ  open ${timing.open.toFixed(0)} ms, first page ${timing.first.toFixed(0)} ms, next ${timing.next.toFixed(1)} ms`,
  );
  [...pages.mismatches, ...events.mismatches].slice(0, 20).forEach((m) => console.log(`  ${m}`));
  return pages.mismatches.length === 0 && events.mismatches.length === 0;
}

async function main(): Promise<void> {
  const requested = process.argv.slice(2);
  const unknown = requested.filter((name) => !TIERS.some((t) => t.name === name));
  if (unknown.length > 0) {
    console.error(
      `Unknown tiers: ${unknown.join(', ')}. Expected any of ${TIERS.map((t) => t.name).join(', ')}.`,
    );
    process.exitCode = 1;
    return;
  }
  const tiers = TIERS.filter((t) => requested.length === 0 || requested.includes(t.name));
  let agreed = true;
  // eslint-disable-next-line no-restricted-syntax -- tiers run one at a time to bound memory
  for (const tier of tiers) {
    // eslint-disable-next-line no-await-in-loop -- tiers run one at a time to bound memory
    if (!(await checkTier(tier))) agreed = false;
  }
  if (!agreed) process.exitCode = 1;
}

main();
