import { Canon } from '@sillsdev/scripture';
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
  AnalysisPayloads,
  ApprovalsByForm,
  ChangeSet,
  IndexDifference,
  RecordChanges,
  TokenAnalysisSummary,
} from '../types/analysis-repository';
import { SUMMARY_PLACE_COUNT } from '../types/analysis-repository';
import { bookOfRef, BOOKLESS_PARTITION } from '../utils/analysis-book';
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- named only for its doc links
import type { splitAnalysisByBook } from '../utils/analysis-book';
import { normalizeSurfaceForm } from '../utils/analysis-identity';
import { compareDocumentOrder, parseUsage, type CatalogUsage } from '../utils/analysis-query';
import { preferredLink, preferredLinkByKey } from '../utils/pick-rules';
import { fileId, idsLacking, type IdsByKey, RecordTable, unfileId } from '../utils/record-table';

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
  'get' | 'find' | 'has' | 'count'
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
  const putLinkTargets = new Set(putLinks.map(({ analysisId }) => analysisId));
  const changedLinksTo = new Map<string, number>();
  priorLinks.forEach(({ analysisId }) =>
    changedLinksTo.set(analysisId, (changedLinksTo.get(analysisId) ?? 0) + 1),
  );
  return [...new Set(reachedIds)].some((id) => {
    const linksTo = links.count('analysisId', id);
    if (storedIds.has(id) && linksTo === 0) return true;
    const storedAfter = putPayloadIds.has(id) || (storedIds.has(id) && !deletedPayloadIds.has(id));
    if (!storedAfter) return false;
    // The changes replace or delete every link they name, so only the rest keep their payload.
    const linkedAfter = putLinkTargets.has(id) || linksTo > (changedLinksTo.get(id) ?? 0);
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

/** Whether any payload has no link referencing it. */
function hasUnlinkedPayload<Payload extends { id: string }>(
  payloads: PayloadTable<Payload>,
  links: LinkTable<{ id: string; analysisId: string }>,
): boolean {
  return payloads.all().some(({ id }) => !links.has('analysisId', id));
}

const formKeyers = {
  form: (payload: { surfaceText: string }) => [normalizeSurfaceForm(payload.surfaceText)],
};

/** How many of `tokenRefs` sit in each book, leaving out books with none. */
function countByBook(tokenRefs: Iterable<string>): Record<string, number> {
  const counts: Record<string, number> = {};
  [...tokenRefs].forEach((tokenRef) => {
    const book = bookOfRef(tokenRef);
    counts[book] = (counts[book] ?? 0) + 1;
  });
  return counts;
}

/** Orders two usages by verse alone, taking books in canonical order. */
function compareVerses(a: CatalogUsage, b: CatalogUsage): number {
  return (
    Canon.bookIdToNumber(a.book) - Canon.bookIdToNumber(b.book) ||
    a.chapter - b.chapter ||
    a.verse - b.verse
  );
}

/**
 * The refs among `tokenRefs` in their first verses, in document order: whole verses, as few as hold
 * {@link SUMMARY_PLACE_COUNT} refs, or all of them when fewer do.
 */
function firstVerseRefs(tokenRefs: Iterable<string>): string[] {
  const usages = [...tokenRefs].map((tokenRef) => parseUsage(tokenRef, undefined));
  usages.sort(compareDocumentOrder);
  let end = Math.min(SUMMARY_PLACE_COUNT, usages.length);
  while (end < usages.length && compareVerses(usages[end - 1], usages[end]) === 0) end += 1;
  return usages.slice(0, end).map(({ tokenRef }) => tokenRef);
}

/** Totals the token links to `analysis` from `links`, which must hold every such link. */
function summarize(
  analysis: TokenAnalysis,
  links: readonly TokenAnalysisLink[],
): TokenAnalysisSummary {
  const approved = new Set<string>();
  const stale = new Set<string>();
  links.forEach(({ status, token }) => {
    if (status === 'approved') approved.add(token.tokenRef);
    else if (status === 'stale') stale.add(token.tokenRef);
  });
  return {
    analysis,
    approvalsByBook: countByBook(approved),
    staleByBook: countByBook(stale),
    firstApprovals: firstVerseRefs(approved),
    firstStale: firstVerseRefs(stale),
  };
}

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

  /**
   * The analysis each token approves, for tokens approving one, with the normalized surface form
   * the approval is filed under.
   */
  private readonly approvalByTokenRef = new Map<
    string,
    Readonly<{ analysisId: string; form: string }>
  >();

  /** The tokens that approve each analysis. An analysis that no token approves has no entry. */
  private readonly approvingTokens: IdsByKey = new Map();

  /** The approving tokens filed under each normalized surface form. */
  private readonly approvingTokensByForm: IdsByKey = new Map();

  /**
   * Each token analysis's summary by id, or `undefined` until summaries are first asked for. An
   * apply leaves the summaries that it may change in place, naming them in `unsummarized`.
   */
  private summaries: Map<string, TokenAnalysisSummary> | undefined;

  /** The token analyses whose kept summary an apply may have changed. */
  private readonly unsummarized = new Set<string>();

  /** The kept summaries as last listed, or `undefined` when an apply may have changed one since. */
  private summaryList: TokenAnalysisSummary[] | undefined;

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
    this.settleAllApprovals();
  }

  /**
   * Applies `changes`, which must name each id at most once per record kind. The index holds the
   * put records themselves, not copies.
   */
  apply(changes: ChangeSet): void {
    if (this.summaries) this.analysesReachedBy(changes).forEach((id) => this.unsummarized.add(id));
    const unsettled = this.tokensReachedBy(changes);
    this.tokenAnalyses.apply(changes.tokenAnalyses);
    this.phraseAnalyses.apply(changes.phraseAnalyses);
    this.segmentAnalyses.apply(changes.segmentAnalyses);
    this.tokenLinks.apply(changes.tokenAnalysisLinks);
    this.phraseLinks.apply(changes.phraseAnalysisLinks);
    this.segmentLinks.apply(changes.segmentAnalysisLinks);
    this.tokensReachedBy(changes).forEach((tokenRef) => unsettled.add(tokenRef));
    unsettled.forEach((tokenRef) => this.settleApproval(tokenRef));
  }

  /**
   * How many tokens approve each of `analysisIds`, leaving out those that no token approves. A
   * token approves the analysis that its approved link names. Where a token has several approved
   * links naming stored payloads, the approval tie-break picks one.
   */
  countApprovals(analysisIds: readonly string[]): Record<string, number> {
    return Object.fromEntries(
      [...new Set(analysisIds)].flatMap((id) => {
        const size = this.approvingTokens.get(id)?.size;
        return size ? [[id, size]] : [];
      }),
    );
  }

  /**
   * Every token analysis with totals of the token links to it. The summaries hold the records this
   * index holds, and are shared between calls, as is the list while no apply changes one.
   */
  summarizeTokenAnalyses(): readonly TokenAnalysisSummary[] {
    if (this.summaryList && this.unsummarized.size === 0) return this.summaryList;
    if (!this.summaries) {
      const linksByAnalysis = Map.groupBy(this.tokenLinks.all(), ({ analysisId }) => analysisId);
      this.summaries = new Map(
        this.tokenAnalyses
          .all()
          .map((ta) => [ta.id, summarize(ta, linksByAnalysis.get(ta.id) ?? [])]),
      );
    }
    const { summaries } = this;
    this.unsummarized.forEach((id) => {
      const [ta] = this.tokenAnalyses.get([id]);
      if (ta) summaries.set(id, summarize(ta, this.tokenLinks.find('analysisId', [id])));
      else summaries.delete(id);
    });
    this.unsummarized.clear();
    this.summaryList = [...summaries.values()];
    return this.summaryList;
  }

  /**
   * The approvals filed under each of `normalizedForms`, leaving out a form with none. A token's
   * approval is filed under its approved link's token surface text, normalized.
   */
  findApprovalsByForm(normalizedForms: readonly string[]): ApprovalsByForm {
    return Object.fromEntries(
      [...new Set(normalizedForms)].flatMap((form) => {
        const tokenRefs = this.approvingTokensByForm.get(form);
        if (!tokenRefs) return [];
        const approvals = [...tokenRefs].map((tokenRef) => {
          const approval = this.approvalByTokenRef.get(tokenRef);
          /* v8 ignore next -- a token is filed under a form only while it holds an approval */
          if (!approval) throw new Error(`Token ${tokenRef} is filed with no approval`);
          return [tokenRef, approval.analysisId];
        });
        return [[form, Object.fromEntries(approvals)]];
      }),
    );
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

  /** The codes of the books that links of every kind point into, each once. */
  linkedBooks(): string[] {
    return [
      ...new Set([
        ...this.tokenLinks.keys('book'),
        ...this.segmentLinks.keys('book'),
        ...this.phraseLinks.keys('book'),
      ]),
    ];
  }

  /** The payloads of every kind that no link names. */
  unlinkedPayloads(): AnalysisPayloads {
    return {
      tokenAnalyses: unlinkedPayloads(this.tokenAnalyses, this.tokenLinks),
      phraseAnalyses: unlinkedPayloads(this.phraseAnalyses, this.phraseLinks),
      segmentAnalyses: unlinkedPayloads(this.segmentAnalyses, this.segmentLinks),
    };
  }

  /** The keys of the partitions {@link splitAnalysisByBook} would split the records into. */
  partitionKeys(): string[] {
    const keys = new Set(this.linkedBooks());
    if (
      hasUnlinkedPayload(this.tokenAnalyses, this.tokenLinks) ||
      hasUnlinkedPayload(this.phraseAnalyses, this.phraseLinks) ||
      hasUnlinkedPayload(this.segmentAnalyses, this.segmentLinks)
    )
      keys.add(BOOKLESS_PARTITION);
    return [...keys];
  }

  /**
   * The partition {@link splitAnalysisByBook} would file under `key`, or `undefined` when it would
   * file none there. Records come in the order it would give, unless a put moved a link from
   * another book; that link comes last here.
   */
  partition(key: string): TextAnalysis | undefined {
    if (key === BOOKLESS_PARTITION) {
      const { segmentAnalyses, tokenAnalyses, phraseAnalyses } = this.unlinkedPayloads();
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
    const differencesOf = (index: string, kept: IdsByKey, fresh: IdsByKey) =>
      [...new Set([...kept.keys(), ...fresh.keys()])].flatMap((key): IndexDifference[] => {
        const missing = idsLacking(fresh.get(key), kept.get(key));
        const extra = idsLacking(kept.get(key), fresh.get(key));
        if (missing.length === 0 && extra.length === 0) return [];
        return [{ index, key, missing, extra }];
      });
    return [
      ...this.tokenAnalyses.differencesFrom(rebuilt.tokenAnalyses),
      ...this.phraseAnalyses.differencesFrom(rebuilt.phraseAnalyses),
      ...this.segmentAnalyses.differencesFrom(rebuilt.segmentAnalyses),
      ...this.tokenLinks.differencesFrom(rebuilt.tokenLinks),
      ...this.phraseLinks.differencesFrom(rebuilt.phraseLinks),
      ...this.segmentLinks.differencesFrom(rebuilt.segmentLinks),
      ...differencesOf(
        'tokenAnalyses by approving token',
        this.approvingTokens,
        rebuilt.approvingTokens,
      ),
      ...this.summaryDifferencesFrom(rebuilt),
      ...differencesOf(
        'tokenAnalyses by approved form',
        this.approvingTokensByForm,
        rebuilt.approvingTokensByForm,
      ),
    ];
  }

  /**
   * Where the kept summaries differ from `rebuilt`'s, a summary that differs being both missing and
   * extra; none while no summaries are kept.
   */
  private summaryDifferencesFrom(rebuilt: AnalysisIndex): IndexDifference[] {
    if (!this.summaries) return [];
    // Books are compared in sorted order, because a link retargeted by a merge is listed under its
    // new analysis after that analysis's other links, whereas a rebuild lists it in stored order.
    const sortedBooks = (counts: Readonly<Record<string, number>>) =>
      Object.entries(counts).sort(([a], [b]) => a.localeCompare(b));
    const byId = (summaries: readonly TokenAnalysisSummary[]) =>
      new Map(
        summaries.map((summary) => [
          summary.analysis.id,
          JSON.stringify({
            ...summary,
            approvalsByBook: sortedBooks(summary.approvalsByBook),
            staleByBook: sortedBooks(summary.staleByBook),
          }),
        ]),
      );
    const kept = byId(this.summarizeTokenAnalyses());
    const fresh = byId(rebuilt.summarizeTokenAnalyses());
    return [...new Set([...kept.keys(), ...fresh.keys()])].flatMap((id): IndexDifference[] =>
      kept.get(id) === fresh.get(id)
        ? []
        : [
            {
              index: 'tokenAnalyses by summary',
              key: id,
              missing: fresh.has(id) ? [id] : [],
              extra: kept.has(id) ? [id] : [],
            },
          ],
    );
  }

  /**
   * The token analyses whose summary `changes` may alter: those they put or delete, and those named
   * by a token link they put, or by the stored link that a put or delete replaces.
   */
  private analysesReachedBy({ tokenAnalyses, tokenAnalysisLinks }: ChangeSet): string[] {
    return [
      ...idsNamedBy(tokenAnalyses),
      ...this.tokenLinks.get(idsNamedBy(tokenAnalysisLinks)).map(({ analysisId }) => analysisId),
      ...(tokenAnalysisLinks?.puts ?? []).map(({ analysisId }) => analysisId),
    ];
  }

  /**
   * The tokens whose approval `changes` may settle differently. They are the tokens of the token
   * links that the changes put or delete. They also include the tokens of each stored token link
   * naming a token payload that the changes put or delete.
   */
  private tokensReachedBy({ tokenAnalyses, tokenAnalysisLinks }: ChangeSet): Set<string> {
    return new Set(
      [
        ...this.tokenLinks.get(idsNamedBy(tokenAnalysisLinks)),
        ...this.tokenLinks.find('analysisId', idsNamedBy(tokenAnalyses)),
      ].map(({ token }) => token.tokenRef),
    );
  }

  /**
   * Whether `link` counts toward its token's approval: approved, naming an analysis the index
   * holds.
   */
  private countsAsApproval({ status, analysisId }: TokenAnalysisLink): boolean {
    return status === 'approved' && this.tokenAnalyses.hasRecord(analysisId);
  }

  /**
   * Files every token under the analysis that the approval tie-break picks among its approved
   * links, and under that link's normalized surface form.
   */
  private settleAllApprovals(): void {
    preferredLinkByKey(this.tokenLinks.all(), (link) =>
      this.countsAsApproval(link) ? link.token.tokenRef : undefined,
    ).forEach((link, tokenRef) => this.fileApproval(tokenRef, link));
  }

  /**
   * Files `tokenRef` under the analysis that the approval tie-break picks among its approved links,
   * and under that link's normalized surface form.
   */
  private settleApproval(tokenRef: string): void {
    const link = preferredLink(
      this.tokenLinks.find('tokenRef', [tokenRef]).filter((each) => this.countsAsApproval(each)),
    );
    const held = this.approvalByTokenRef.get(tokenRef);
    if (held) {
      unfileId(this.approvingTokens, held.analysisId, tokenRef);
      unfileId(this.approvingTokensByForm, held.form, tokenRef);
    }
    if (!link) {
      this.approvalByTokenRef.delete(tokenRef);
      return;
    }
    this.fileApproval(tokenRef, link);
  }

  private fileApproval(tokenRef: string, { analysisId, token }: TokenAnalysisLink): void {
    const form = normalizeSurfaceForm(token.surfaceText);
    this.approvalByTokenRef.set(tokenRef, { analysisId, form });
    fileId(this.approvingTokens, analysisId, tokenRef);
    fileId(this.approvingTokensByForm, form, tokenRef);
  }
}
