import type {
  AssignmentStatus,
  DraftProject,
  PhraseAnalysis,
  PhraseAnalysisLink,
  SegmentAnalysis,
  SegmentAnalysisLink,
  TokenAnalysis,
} from 'interlinearizer';
import type {
  AnalysisLinks,
  AnalysisRepository,
  IndexDifference,
  ScopeRecord,
} from '../types/analysis-repository';
import { scopeRecordOf } from '../utils/change-set';
import { jsonCopy } from '../utils/json-copy';
import type { AnalysisIndex } from './analysisIndex';

/** An index, with the draft whose records it is kept over. */
export type IndexedDraft = {
  draft: DraftProject;
  index: AnalysisIndex;
};

/** The reads of a repository that keeps an {@link AnalysisIndex} over its records. */
export abstract class IndexedRepository implements Pick<
  AnalysisRepository,
  | 'getScope'
  | 'getTokenAnalyses'
  | 'getPhraseAnalyses'
  | 'getSegmentAnalyses'
  | 'getPhraseAnalysisLinks'
  | 'findLinksByToken'
  | 'findLinksBySegment'
  | 'findLinksToAnalyses'
  | 'findLinksInBooks'
  | 'findTokenAnalysesByForm'
  | 'findPhraseAnalysesByForm'
  | 'checkIndexes'
> {
  async getScope(): Promise<ScopeRecord> {
    return jsonCopy(scopeRecordOf((await this.indexed()).draft));
  }

  getTokenAnalyses(ids: string[]): Promise<TokenAnalysis[]> {
    return this.query((index) => index.getTokenAnalyses(ids));
  }

  getPhraseAnalyses(ids: string[]): Promise<PhraseAnalysis[]> {
    return this.query((index) => index.getPhraseAnalyses(ids));
  }

  getSegmentAnalyses(ids: string[]): Promise<SegmentAnalysis[]> {
    return this.query((index) => index.getSegmentAnalyses(ids));
  }

  getPhraseAnalysisLinks(ids: string[]): Promise<PhraseAnalysisLink[]> {
    return this.query((index) => index.getPhraseAnalysisLinks(ids));
  }

  findLinksByToken(
    tokenRefs: string[],
  ): Promise<Pick<AnalysisLinks, 'tokenAnalysisLinks' | 'phraseAnalysisLinks'>> {
    return this.query((index) => index.findLinksByToken(tokenRefs));
  }

  findLinksBySegment(segmentIds: string[]): Promise<SegmentAnalysisLink[]> {
    return this.query((index) => index.findLinksBySegment(segmentIds));
  }

  findLinksToAnalyses(analysisIds: string[]): Promise<AnalysisLinks> {
    return this.query((index) => index.findLinksToAnalyses(analysisIds));
  }

  findLinksInBooks(bookCodes: string[], statuses?: AssignmentStatus[]): Promise<AnalysisLinks> {
    return this.query((index) => index.findLinksInBooks(bookCodes, statuses));
  }

  findTokenAnalysesByForm(normalizedForms: string[]): Promise<TokenAnalysis[]> {
    return this.query((index) => index.findTokenAnalysesByForm(normalizedForms));
  }

  findPhraseAnalysesByForm(normalizedForms: string[]): Promise<PhraseAnalysis[]> {
    return this.query((index) => index.findPhraseAnalysesByForm(normalizedForms));
  }

  /**
   * Reports where the kept index differs from one built afresh from the records, for debugging;
   * nothing while none is built.
   */
  async checkIndexes(): Promise<IndexDifference[]> {
    const kept = this.keptIndex();
    return kept ? kept.index.differencesFrom(kept.draft.analysis) : [];
  }

  /** Runs `read` against the index and returns a copy of its result, so callers may change it. */
  private async query<T>(read: (index: AnalysisIndex) => T): Promise<T> {
    return jsonCopy(read((await this.indexed()).index));
  }

  /**
   * The kept index and its draft, loaded from storage first when none is kept.
   *
   * @throws Whatever loading the stored records throws.
   */
  protected abstract indexed(): Promise<IndexedDraft>;

  /** The kept index and the draft it is kept over, or `undefined` when none is kept. */
  protected abstract keptIndex(): IndexedDraft | undefined;
}
