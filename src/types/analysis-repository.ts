import type { DraftProject } from 'interlinearizer';

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

/**
 * Reads and writes one source project's draft. Every call is async and takes and returns only
 * JSON-plain values, so an implementation may sit behind a network boundary or another language.
 */
export interface AnalysisRepository {
  /** The whole stored draft, for callers that still exchange it whole. */
  exportAll(): Promise<DraftProject>;

  /**
   * Replaces the stored draft whole, for callers that still exchange it whole.
   *
   * @throws {Error} If the stored draft was written by a newer build; nothing is written.
   * @throws If storage rejects a read or a write.
   */
  replaceAll(draft: DraftProject): Promise<void>;
}
