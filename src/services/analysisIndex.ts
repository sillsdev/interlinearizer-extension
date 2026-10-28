import type {
  AssignmentStatus,
  PhraseAnalysis,
  PhraseAnalysisLink,
  SegmentAnalysis,
  SegmentAnalysisLink,
  TextAnalysis,
  TokenAnalysis,
  TokenAnalysisLink,
} from 'interlinearizer';
import type {
  AnalysisLinks,
  ChangeSet,
  IndexDifference,
  RecordChanges,
} from '../types/analysis-repository';
import { bookOfRef, BOOKLESS_PARTITION } from '../utils/analysis-book';
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- named only for its doc links
import type { splitAnalysisByBook } from '../utils/analysis-book';
import { normalizeSurfaceForm } from '../utils/analysis-identity';
import { RecordTable } from './recordTable';

/** The key a link is filed under for its book and status. */
function bookStatusKey(bookCode: string, status: AssignmentStatus): string {
  return `${bookCode}/${status}`;
}

/** The indexes every kind of link is filed in, given how to find a link's book. */
function linkKeyers<Link extends { analysisId: string; status: AssignmentStatus }>(
  bookOf: (link: Link) => string,
) {
  return {
    analysisId: (link: Link) => [link.analysisId],
    book: (link: Link) => [bookOf(link)],
    bookStatus: (link: Link) => [bookStatusKey(bookOf(link), link.status)],
  };
}

function tokenLinkBook(link: TokenAnalysisLink): string {
  return bookOfRef(link.token.tokenRef);
}

function phraseLinkBook(link: PhraseAnalysisLink): string {
  // Every token of a phrase shares a book, so the first one places the whole run.
  return bookOfRef(link.tokens[0].tokenRef);
}

function segmentLinkBook(link: SegmentAnalysisLink): string {
  return bookOfRef(link.segmentId);
}

/** The ids one record kind's changes put or delete. */
function idsNamedBy(changes: RecordChanges<{ id: string }> | undefined): string[] {
  return changes ? [...changes.puts.map(({ id }) => id), ...changes.deletes] : [];
}

/** One record kind's payloads. */
type PayloadTable<Payload extends { id: string }> = Pick<
  RecordTable<Payload, never>,
  'get' | 'all'
>;

/** The links to one record kind's payloads. */
type LinkTable<Link extends { id: string }> = Pick<
  RecordTable<Link, 'analysisId' | 'book'>,
  'get' | 'find' | 'has'
>;

/**
 * Adds to `books` the book of each link the changes reach, as `links` stands before they apply. A
 * link is reached when `linkChanges` puts, replaces or deletes it, or when `payloadChanges` puts or
 * deletes its payload. Leaves both tables as they stand.
 *
 * @returns Whether a payload the changes put, delete or relink is stored with no link referencing
 *   it, before they apply or after.
 */
function reachOfKind<
  Payload extends { id: string },
  Link extends { id: string; analysisId: string },
>(
  payloads: PayloadTable<Payload>,
  links: LinkTable<Link>,
  bookOf: (link: Link) => string,
  payloadChanges: RecordChanges<Payload> | undefined,
  linkChanges: RecordChanges<Link> | undefined,
  books: Set<string>,
): boolean {
  const changedPayloadIds = idsNamedBy(payloadChanges);
  const changedLinkIds = new Set(idsNamedBy(linkChanges));
  const putLinks = linkChanges?.puts ?? [];
  const priorLinks = links.get([...changedLinkIds]);
  [...priorLinks, ...putLinks, ...links.find('analysisId', changedPayloadIds)].forEach((link) =>
    books.add(bookOf(link)),
  );

  const deletedPayloadIds = new Set(payloadChanges?.deletes);
  const putPayloadIds = new Set(payloadChanges?.puts.map(({ id }) => id));
  const reachedIds = [
    ...changedPayloadIds,
    ...[...priorLinks, ...putLinks].map(({ analysisId }) => analysisId),
  ];
  const storedIds = new Set(payloads.get(reachedIds).map(({ id }) => id));
  return [...new Set(reachedIds)].some((id) => {
    const linkedBefore = links.has('analysisId', id);
    if (storedIds.has(id) && !linkedBefore) return true;
    const storedAfter = putPayloadIds.has(id) || (storedIds.has(id) && !deletedPayloadIds.has(id));
    if (!storedAfter) return false;
    const linkedAfter =
      putLinks.some(({ analysisId }) => analysisId === id) ||
      (linkedBefore && links.find('analysisId', [id]).some((link) => !changedLinkIds.has(link.id)));
    return !linkedAfter;
  });
}

/** The payloads no link references. */
function unlinkedPayloads<Payload extends { id: string }>(
  payloads: PayloadTable<Payload>,
  links: LinkTable<{ id: string; analysisId: string }>,
): Payload[] {
  return payloads.all().filter(({ id }) => !links.has('analysisId', id));
}

const formKeyers = {
  form: (payload: { surfaceText: string }) => [normalizeSurfaceForm(payload.surfaceText)],
};

/**
 * An analysis's records by id, with the derived indexes its lookups answer from. Built from the
 * records and kept current as changes are applied. It hands out the records it holds, not copies.
 */
export class AnalysisIndex {
  private readonly tokenAnalyses: RecordTable<TokenAnalysis, 'form'>;

  private readonly phraseAnalyses: RecordTable<PhraseAnalysis, 'form'>;

  private readonly segmentAnalyses: RecordTable<SegmentAnalysis, never>;

  private readonly tokenLinks: RecordTable<
    TokenAnalysisLink,
    'analysisId' | 'book' | 'bookStatus' | 'tokenRef'
  >;

  private readonly phraseLinks: RecordTable<
    PhraseAnalysisLink,
    'analysisId' | 'book' | 'bookStatus' | 'tokenRef'
  >;

  private readonly segmentLinks: RecordTable<
    SegmentAnalysisLink,
    'analysisId' | 'book' | 'bookStatus' | 'segmentId'
  >;

  constructor(analysis: TextAnalysis) {
    this.tokenAnalyses = new RecordTable('tokenAnalyses', formKeyers, analysis.tokenAnalyses);
    this.phraseAnalyses = new RecordTable('phraseAnalyses', formKeyers, analysis.phraseAnalyses);
    this.segmentAnalyses = new RecordTable('segmentAnalyses', {}, analysis.segmentAnalyses);
    this.tokenLinks = new RecordTable(
      'tokenAnalysisLinks',
      {
        ...linkKeyers(tokenLinkBook),
        tokenRef: (link) => [link.token.tokenRef],
      },
      analysis.tokenAnalysisLinks,
    );
    this.phraseLinks = new RecordTable(
      'phraseAnalysisLinks',
      {
        ...linkKeyers(phraseLinkBook),
        tokenRef: (link) => link.tokens.map(({ tokenRef }) => tokenRef),
      },
      analysis.phraseAnalysisLinks,
    );
    this.segmentLinks = new RecordTable(
      'segmentAnalysisLinks',
      {
        ...linkKeyers(segmentLinkBook),
        segmentId: (link) => [link.segmentId],
      },
      analysis.segmentAnalysisLinks,
    );
  }

  /**
   * Applies `changes`, which must name each id at most once per record kind. The index holds the
   * put records themselves, not copies.
   */
  apply(changes: ChangeSet): void {
    this.tokenAnalyses.apply(changes.tokenAnalyses);
    this.phraseAnalyses.apply(changes.phraseAnalyses);
    this.segmentAnalyses.apply(changes.segmentAnalyses);
    this.tokenLinks.apply(changes.tokenAnalysisLinks);
    this.phraseLinks.apply(changes.phraseAnalysisLinks);
    this.segmentLinks.apply(changes.segmentAnalysisLinks);
  }

  /**
   * The keys of the partitions whose records `changes` may alter once applied, keyed as
   * {@link splitAnalysisByBook} keys them. `changes` must name each id at most once per record
   * kind.
   *
   * The keys are each book holding a link the changes alter, or a link to a payload they alter.
   * {@link BOOKLESS_PARTITION} is included when a payload they reach is unlinked before they apply
   * or after.
   */
  reach(changes: ChangeSet): Set<string> {
    const books = new Set<string>();
    const reachesUnlinked = [
      reachOfKind(
        this.tokenAnalyses,
        this.tokenLinks,
        tokenLinkBook,
        changes.tokenAnalyses,
        changes.tokenAnalysisLinks,
        books,
      ),
      reachOfKind(
        this.phraseAnalyses,
        this.phraseLinks,
        phraseLinkBook,
        changes.phraseAnalyses,
        changes.phraseAnalysisLinks,
        books,
      ),
      reachOfKind(
        this.segmentAnalyses,
        this.segmentLinks,
        segmentLinkBook,
        changes.segmentAnalyses,
        changes.segmentAnalysisLinks,
        books,
      ),
    ].some(Boolean);
    if (reachesUnlinked) books.add(BOOKLESS_PARTITION);
    return books;
  }

  /** The keys of the partitions {@link splitAnalysisByBook} would split the records into. */
  partitionKeys(): string[] {
    const keys = new Set([
      ...this.tokenLinks.keys('book'),
      ...this.segmentLinks.keys('book'),
      ...this.phraseLinks.keys('book'),
    ]);
    if (this.partition(BOOKLESS_PARTITION)) keys.add(BOOKLESS_PARTITION);
    return [...keys];
  }

  /**
   * The partition {@link splitAnalysisByBook} would file under `key`, or `undefined` when it would
   * file none there. Records come in the order it would give, unless a put moved a link from
   * another book; that link comes last here.
   */
  partition(key: string): TextAnalysis | undefined {
    if (key === BOOKLESS_PARTITION) {
      const segmentAnalyses = unlinkedPayloads(this.segmentAnalyses, this.segmentLinks);
      const tokenAnalyses = unlinkedPayloads(this.tokenAnalyses, this.tokenLinks);
      const phraseAnalyses = unlinkedPayloads(this.phraseAnalyses, this.phraseLinks);
      if (segmentAnalyses.length + tokenAnalyses.length + phraseAnalyses.length === 0)
        return undefined;
      return {
        segmentAnalyses,
        segmentAnalysisLinks: [],
        tokenAnalyses,
        tokenAnalysisLinks: [],
        phraseAnalyses,
        phraseAnalysisLinks: [],
      };
    }
    const segmentAnalysisLinks = this.segmentLinks.find('book', [key]);
    const tokenAnalysisLinks = this.tokenLinks.find('book', [key]);
    const phraseAnalysisLinks = this.phraseLinks.find('book', [key]);
    if (segmentAnalysisLinks.length + tokenAnalysisLinks.length + phraseAnalysisLinks.length === 0)
      return undefined;
    const analysisIds = (links: readonly { analysisId: string }[]) =>
      links.map(({ analysisId }) => analysisId);
    return {
      segmentAnalyses: this.segmentAnalyses.get(analysisIds(segmentAnalysisLinks)),
      segmentAnalysisLinks,
      tokenAnalyses: this.tokenAnalyses.get(analysisIds(tokenAnalysisLinks)),
      tokenAnalysisLinks,
      phraseAnalyses: this.phraseAnalyses.get(analysisIds(phraseAnalysisLinks)),
      phraseAnalysisLinks,
    };
  }

  /** The token analyses stored under `ids`, each once; an id with none stored is skipped. */
  getTokenAnalyses(ids: readonly string[]): TokenAnalysis[] {
    return this.tokenAnalyses.get(ids);
  }

  /** The phrase analyses stored under `ids`, each once; an id with none stored is skipped. */
  getPhraseAnalyses(ids: readonly string[]): PhraseAnalysis[] {
    return this.phraseAnalyses.get(ids);
  }

  /** The segment analyses stored under `ids`, each once; an id with none stored is skipped. */
  getSegmentAnalyses(ids: readonly string[]): SegmentAnalysis[] {
    return this.segmentAnalyses.get(ids);
  }

  /** The phrase links stored under `ids`, each once; an id with none stored is skipped. */
  getPhraseAnalysisLinks(ids: readonly string[]): PhraseAnalysisLink[] {
    return this.phraseLinks.get(ids);
  }

  /** The token links on any of `tokenRefs`, and the phrase links touching any of them. */
  findLinksByToken(
    tokenRefs: readonly string[],
  ): Pick<AnalysisLinks, 'tokenAnalysisLinks' | 'phraseAnalysisLinks'> {
    return {
      tokenAnalysisLinks: this.tokenLinks.find('tokenRef', tokenRefs),
      phraseAnalysisLinks: this.phraseLinks.find('tokenRef', tokenRefs),
    };
  }

  /** The segment links on any of `segmentIds`. */
  findLinksBySegment(segmentIds: readonly string[]): SegmentAnalysisLink[] {
    return this.segmentLinks.find('segmentId', segmentIds);
  }

  /** The links of every kind to any of `analysisIds`. */
  findLinksToAnalyses(analysisIds: readonly string[]): AnalysisLinks {
    return {
      tokenAnalysisLinks: this.tokenLinks.find('analysisId', analysisIds),
      phraseAnalysisLinks: this.phraseLinks.find('analysisId', analysisIds),
      segmentAnalysisLinks: this.segmentLinks.find('analysisId', analysisIds),
    };
  }

  /** The links of every kind into any of `bookCodes`, limited to `statuses` when given. */
  findLinksInBooks(
    bookCodes: readonly string[],
    statuses?: readonly AssignmentStatus[],
  ): AnalysisLinks {
    if (!statuses) {
      return {
        tokenAnalysisLinks: this.tokenLinks.find('book', bookCodes),
        phraseAnalysisLinks: this.phraseLinks.find('book', bookCodes),
        segmentAnalysisLinks: this.segmentLinks.find('book', bookCodes),
      };
    }
    const keys = bookCodes.flatMap((bookCode) =>
      statuses.map((status) => bookStatusKey(bookCode, status)),
    );
    return {
      tokenAnalysisLinks: this.tokenLinks.find('bookStatus', keys),
      phraseAnalysisLinks: this.phraseLinks.find('bookStatus', keys),
      segmentAnalysisLinks: this.segmentLinks.find('bookStatus', keys),
    };
  }

  /**
   * The token analyses whose surface text {@link normalizeSurfaceForm} maps to one of
   * `normalizedForms`.
   */
  findTokenAnalysesByForm(normalizedForms: readonly string[]): TokenAnalysis[] {
    return this.tokenAnalyses.find('form', normalizedForms);
  }

  /**
   * The phrase analyses whose surface text {@link normalizeSurfaceForm} maps to one of
   * `normalizedForms`.
   */
  findPhraseAnalysesByForm(normalizedForms: readonly string[]): PhraseAnalysis[] {
    return this.phraseAnalyses.find('form', normalizedForms);
  }

  /** Where this index differs from one built afresh from `analysis`. */
  differencesFrom(analysis: TextAnalysis): IndexDifference[] {
    const rebuilt = new AnalysisIndex(analysis);
    return [
      ...this.tokenAnalyses.differencesFrom(rebuilt.tokenAnalyses),
      ...this.phraseAnalyses.differencesFrom(rebuilt.phraseAnalyses),
      ...this.segmentAnalyses.differencesFrom(rebuilt.segmentAnalyses),
      ...this.tokenLinks.differencesFrom(rebuilt.tokenLinks),
      ...this.phraseLinks.differencesFrom(rebuilt.phraseLinks),
      ...this.segmentLinks.differencesFrom(rebuilt.segmentLinks),
    ];
  }
}
