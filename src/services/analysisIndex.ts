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
import type { AnalysisLinks, ChangeSet, IndexDifference } from '../types/analysis-repository';
import { bookOfRef } from '../utils/analysis-book';
import { normalizeSurfaceForm } from '../utils/analysis-identity';
import { preferredLink } from '../utils/pick-rules';
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

  /** The analysis each token approves, for tokens approving one. */
  private readonly approvedByTokenRef = new Map<string, string>();

  /** The tokens approving each analysis, for analyses some token approves. */
  private readonly approvingTokens = new Map<string, Set<string>>();

  constructor(analysis: TextAnalysis) {
    this.tokenAnalyses = new RecordTable('tokenAnalyses', formKeyers, analysis.tokenAnalyses);
    this.phraseAnalyses = new RecordTable('phraseAnalyses', formKeyers, analysis.phraseAnalyses);
    this.segmentAnalyses = new RecordTable('segmentAnalyses', {}, analysis.segmentAnalyses);
    this.tokenLinks = new RecordTable(
      'tokenAnalysisLinks',
      {
        ...linkKeyers((link: TokenAnalysisLink) => bookOfRef(link.token.tokenRef)),
        tokenRef: (link) => [link.token.tokenRef],
      },
      analysis.tokenAnalysisLinks,
    );
    this.phraseLinks = new RecordTable(
      'phraseAnalysisLinks',
      {
        // Every token of a phrase shares a book, so the first one places the whole run.
        ...linkKeyers((link: PhraseAnalysisLink) => bookOfRef(link.tokens[0].tokenRef)),
        tokenRef: (link) => link.tokens.map(({ tokenRef }) => tokenRef),
      },
      analysis.phraseAnalysisLinks,
    );
    this.segmentLinks = new RecordTable(
      'segmentAnalysisLinks',
      {
        ...linkKeyers((link: SegmentAnalysisLink) => bookOfRef(link.segmentId)),
        segmentId: (link) => [link.segmentId],
      },
      analysis.segmentAnalysisLinks,
    );
    new Set(analysis.tokenAnalysisLinks.map(({ token }) => token.tokenRef)).forEach((tokenRef) =>
      this.settleApproval(tokenRef),
    );
  }

  /**
   * Applies `changes`, which must name each id at most once per record kind. The index holds the
   * put records themselves, not copies.
   */
  apply(changes: ChangeSet): void {
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
    const approved = new Set([...this.approvingTokens.keys(), ...rebuilt.approvingTokens.keys()]);
    const approvalDifferences = [...approved].flatMap((analysisId): IndexDifference[] => {
      const kept = this.approvingTokens.get(analysisId) ?? new Set<string>();
      const fresh = rebuilt.approvingTokens.get(analysisId) ?? new Set<string>();
      const missing = [...fresh].filter((tokenRef) => !kept.has(tokenRef));
      const extra = [...kept].filter((tokenRef) => !fresh.has(tokenRef));
      if (missing.length === 0 && extra.length === 0) return [];
      return [{ index: 'tokenAnalyses by approving token', key: analysisId, missing, extra }];
    });
    return [
      ...this.tokenAnalyses.differencesFrom(rebuilt.tokenAnalyses),
      ...this.phraseAnalyses.differencesFrom(rebuilt.phraseAnalyses),
      ...this.segmentAnalyses.differencesFrom(rebuilt.segmentAnalyses),
      ...this.tokenLinks.differencesFrom(rebuilt.tokenLinks),
      ...this.phraseLinks.differencesFrom(rebuilt.phraseLinks),
      ...this.segmentLinks.differencesFrom(rebuilt.segmentLinks),
      ...approvalDifferences,
    ];
  }

  /**
   * The tokens whose approval `changes` may settle differently. They are the tokens of the token
   * links that the changes put or delete. They also include the tokens of each stored token link
   * naming a token payload that the changes put or delete.
   */
  private tokensReachedBy({ tokenAnalyses, tokenAnalysisLinks }: ChangeSet): Set<string> {
    const linkIds = [
      ...(tokenAnalysisLinks?.puts ?? []).map(({ id }) => id),
      ...(tokenAnalysisLinks?.deletes ?? []),
    ];
    const payloadIds = [
      ...(tokenAnalyses?.puts ?? []).map(({ id }) => id),
      ...(tokenAnalyses?.deletes ?? []),
    ];
    return new Set(
      [...this.tokenLinks.get(linkIds), ...this.tokenLinks.find('analysisId', payloadIds)].map(
        ({ token }) => token.tokenRef,
      ),
    );
  }

  /** Files `tokenRef` under the analysis that the approval tie-break picks among its approved links. */
  private settleApproval(tokenRef: string): void {
    const settled = preferredLink(
      this.tokenLinks
        .find('tokenRef', [tokenRef])
        .filter(
          ({ status, analysisId }) => status === 'approved' && this.tokenAnalyses.has(analysisId),
        ),
    )?.analysisId;
    const held = this.approvedByTokenRef.get(tokenRef);
    if (held === settled) return;
    const unsettled = held === undefined ? undefined : this.approvingTokens.get(held);
    if (held !== undefined && unsettled) {
      unsettled.delete(tokenRef);
      if (unsettled.size === 0) this.approvingTokens.delete(held);
    }
    if (settled === undefined) {
      this.approvedByTokenRef.delete(tokenRef);
      return;
    }
    this.approvedByTokenRef.set(tokenRef, settled);
    const tokens = this.approvingTokens.get(settled) ?? new Set<string>();
    tokens.add(tokenRef);
    this.approvingTokens.set(settled, tokens);
  }
}
