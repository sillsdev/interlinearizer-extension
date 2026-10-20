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
 * Once a call settles, the caller may change a draft it passed in or got back without changing what
 * is stored. Lists of records come back in no promised order.
 *
 * Calls for one draft must not overlap, whether on one repository or several. After one repository
 * saves a draft, any other that had already loaded or saved it must load it again before its next
 * save.
 */
export interface AnalysisRepository {
  /**
   * Loads the whole stored draft, or an empty one for the source project when none is stored.
   *
   * @throws {SyntaxError} If the draft's stored value contains invalid JSON.
   * @throws {Error} If the stored draft was written by a newer build.
   * @throws If storage rejects a read.
   */
  exportAll(): Promise<DraftProject>;

  /**
   * Saves the whole draft, replacing the stored one, stamped with this build's model version.
   *
   * @throws {Error} If the stored draft was written by a newer build; nothing is written.
   * @throws If storage rejects a read or a write.
   */
  replaceAll(draft: DraftProject): Promise<void>;
}
