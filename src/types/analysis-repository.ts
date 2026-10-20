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

/** What a load does with stored content it cannot read. */
export type UnreadableContentPolicy =
  /** Loads it as empty and logs it, so one damaged record never hides the rest. */
  | 'empty'
  /** Rejects, so nothing mistakes the empty stand-in for the stored content. */
  | 'throw';

/**
 * Reads and writes one source project's draft. Every call is async and takes and returns only
 * JSON-plain values, so an implementation may sit behind a network boundary or another language.
 */
export interface AnalysisRepository {
  /**
   * Loads the whole stored draft. Stored content that cannot be read loads as empty unless
   * `unreadable` is `'throw'`.
   *
   * @throws {SyntaxError} If the draft's stored value contains invalid JSON.
   * @throws {Error} If the stored draft was written by a newer build.
   * @throws {Error} If any stored content cannot be read and `unreadable` is `'throw'`.
   * @throws If storage rejects a read.
   */
  exportAll(unreadable?: UnreadableContentPolicy): Promise<DraftProject>;

  /**
   * Saves the whole draft, replacing the stored one. Content that lands counts as saved even when
   * cleanup after it fails.
   *
   * @throws {Error} If the stored draft was written by a newer build; nothing is written.
   * @throws If storage rejects a read or a write.
   */
  replaceAll(draft: DraftProject): Promise<void>;
}
