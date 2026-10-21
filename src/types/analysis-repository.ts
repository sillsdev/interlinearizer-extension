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

/** A stored draft as read for copying elsewhere, with the books it could not vouch for. */
export type DraftExport = {
  /** The draft, holding no analysis for the books in `unreadableBooks`. */
  draft: DraftProject;
  /**
   * Book codes whose stored analysis could not be read and which the draft has not wiped, so the
   * draft carries none for them. A copy must not take that absence for the book having been wiped.
   */
  unreadableBooks: string[];
};

/**
 * Reads and writes one source project's draft. Every call is async and takes and returns only
 * JSON-plain values, so an implementation may sit behind a network boundary or another language.
 */
export interface AnalysisRepository {
  /**
   * Loads the whole stored draft. Stored content that cannot be read loads as empty, so one damaged
   * record never hides the rest.
   *
   * @throws {SyntaxError} If the draft's stored value contains invalid JSON.
   * @throws {Error} If the stored draft was written by a newer build.
   * @throws If storage rejects a read.
   */
  exportAll(): Promise<DraftProject>;

  /**
   * Loads the whole stored draft for copying into a project, naming the books whose analysis could
   * not be read rather than passing them off as empty.
   *
   * @throws {SyntaxError} If the draft's stored value contains invalid JSON.
   * @throws {Error} If the stored draft was written by a newer build.
   * @throws {Error} If the draft itself is unreadable, so no book in it can be vouched for.
   * @throws If storage rejects a read.
   */
  exportForCopy(): Promise<DraftExport>;

  /**
   * Saves the whole draft, replacing the stored one. Content that lands counts as saved even when
   * cleanup after it fails. A book whose stored analysis could not be read is kept while the draft
   * carries none for it, so a draft that loaded it empty never wipes it, whatever the draft's
   * `wipedBooks` says.
   *
   * @throws {Error} If the stored draft was written by a newer build; nothing is written.
   * @throws If storage rejects a read or a write.
   */
  replaceAll(draft: DraftProject): Promise<void>;

  /**
   * Records the stored draft as saved to its project, leaving its content as it stands. A draft
   * never saved, or already clean, is left alone.
   *
   * @throws {Error} If the stored draft was written by a newer build, or is unreadable; nothing is
   *   written.
   * @throws If storage rejects a read or a write.
   */
  markClean(): Promise<void>;
}
