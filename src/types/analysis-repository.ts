import type {
  DraftProject,
  PhraseAnalysis,
  SegmentAnalysis,
  TextAnalysis,
  TokenAnalysis,
} from 'interlinearizer';

/**
 * Text records by key: the platform's per-extension user data in the extension host, or files in
 * the same layout in Node.
 */
export interface KeyValueStorage {
  /** @returns `undefined` when nothing is stored at `key`. */
  read(key: string): Promise<string | undefined>;
  write(key: string, data: string): Promise<void>;
  /** Succeeds as well when nothing is stored at `key`. */
  delete(key: string): Promise<void>;
}

/** Where a repository reports records it could not use as stored. */
export interface RepositoryLogger {
  warn(message: string, ...details: unknown[]): void;
}

/** A source project's draft apart from its analysis: what the records it holds belong to. */
export type DraftScope = Omit<DraftProject, 'analysis'>;

/**
 * Reads and writes one draft's analysis records. Every call is async and takes and returns only
 * JSON-plain values, so an implementation may sit behind a network boundary or another language.
 */
export interface AnalysisRepository {
  getScope(): Promise<DraftScope>;

  /** @returns One payload per requested id that is stored; ids with none are left out. */
  getTokenAnalyses(ids: readonly string[]): Promise<TokenAnalysis[]>;

  /** @returns One payload per requested id that is stored; ids with none are left out. */
  getPhraseAnalyses(ids: readonly string[]): Promise<PhraseAnalysis[]>;

  /** @returns One payload per requested id that is stored; ids with none are left out. */
  getSegmentAnalyses(ids: readonly string[]): Promise<SegmentAnalysis[]>;

  /** Every record, for callers that still exchange the whole draft. */
  exportAll(): Promise<TextAnalysis>;

  /**
   * Replaces the scope and every record, for callers that still exchange the whole draft.
   *
   * @throws {Error} If the stored draft was written by a newer build; nothing is written.
   * @throws If storage rejects a read or a write.
   */
  replaceAll(scope: DraftScope, analysis: TextAnalysis): Promise<void>;
}
