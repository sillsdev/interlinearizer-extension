import type { DraftProject } from 'interlinearizer';

/** Text records by key. */
export interface KeyValueStorage {
  /** Resolves `undefined` when nothing is stored at `key`. */
  read(key: string): Promise<string | undefined>;
  write(key: string, data: string): Promise<void>;
  /** Succeeds as well when nothing is stored at `key`. */
  delete(key: string): Promise<void>;
}

/** Where warnings about stored records go. */
export interface WarningLogger {
  warn(message: string, ...details: unknown[]): void;
}

/**
 * Reads and writes one source project's draft. Every call is async and takes and returns only
 * JSON-plain values, so an implementation may sit behind a network boundary or another language.
 */
export interface AnalysisRepository {
  /**
   * Loads the whole stored draft.
   *
   * @throws {SyntaxError} If the stored draft contains invalid JSON.
   * @throws {Error} If the stored draft was written by a newer build.
   * @throws If storage rejects a read.
   */
  exportAll(): Promise<DraftProject>;

  /**
   * Saves the whole draft, replacing the stored one.
   *
   * @throws {Error} If the stored draft was written by a newer build; nothing is written.
   * @throws If storage rejects a read or a write.
   */
  replaceAll(draft: DraftProject): Promise<void>;
}
