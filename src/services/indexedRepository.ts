import type {
  AssignmentStatus,
  PhraseAnalysis,
  SegmentAnalysis,
  SegmentAnalysisLink,
  TextAnalysis,
  TokenAnalysis,
} from 'interlinearizer';
import type {
  AnalysisLinks,
  AnalysisRepository,
  IndexDifference,
} from '../types/analysis-repository';
import { jsonCopy } from '../utils/json-copy';
import type { AnalysisIndex } from './analysisIndex';

/** An index, with the analysis whose records it is kept over. */
export type IndexedAnalysis = {
  analysis: TextAnalysis;
  index: AnalysisIndex;
};

/** The lookups of a repository that answers them from an {@link AnalysisIndex} over its records. */
export abstract class IndexedRepository implements Pick<
  AnalysisRepository,
  | 'getTokenAnalyses'
  | 'getPhraseAnalyses'
  | 'getSegmentAnalyses'
  | 'findLinksByToken'
  | 'findLinksBySegment'
  | 'findLinksToAnalyses'
  | 'findLinksInBooks'
  | 'findTokenAnalysesByForm'
  | 'findPhraseAnalysesByForm'
  | 'checkIndexes'
> {
  getTokenAnalyses(ids: string[]): Promise<TokenAnalysis[]> {
    return this.query((index) => index.getTokenAnalyses(ids));
  }

  getPhraseAnalyses(ids: string[]): Promise<PhraseAnalysis[]> {
    return this.query((index) => index.getPhraseAnalyses(ids));
  }

  getSegmentAnalyses(ids: string[]): Promise<SegmentAnalysis[]> {
    return this.query((index) => index.getSegmentAnalyses(ids));
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
    return kept ? kept.index.differencesFrom(kept.analysis) : [];
  }

  /** Runs `read` against the index and returns a copy of its result, so callers may change it. */
  private async query<T>(read: (index: AnalysisIndex) => T): Promise<T> {
    return jsonCopy(read(await this.indexed()));
  }

  /**
   * The kept index, built over the stored records first when none is kept.
   *
   * @throws Whatever loading the stored records throws.
   */
  protected abstract indexed(): Promise<AnalysisIndex>;

  /** The kept index and the analysis it is kept over, or `undefined` when none is kept. */
  protected abstract keptIndex(): IndexedAnalysis | undefined;
}
