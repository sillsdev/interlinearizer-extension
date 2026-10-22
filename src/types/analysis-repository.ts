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
 * Thrown where a draft that could not be read for some books would overwrite stored analysis with
 * only what it could read.
 */
export class UnreadableBooksError extends Error {
  /** Book codes whose stored analysis could not be read. */
  readonly books: readonly string[];

  constructor(message: string, books: readonly string[]) {
    super(message);
    this.name = 'UnreadableBooksError';
    this.books = books;
  }
}

/** How a draft save treats stored analysis it could not read. */
export type ReplaceAllOptions = {
  /**
   * Discard it, as starting a draft over (New, Open) does, so the save writes the books it belongs
   * to like any other. Absent, such a book's stored analysis is kept, whatever the draft carries
   * for it.
   */
  discardUnreadable?: boolean;
};

/** A stored draft as read, with the books it could not vouch for. */
export type DraftExport = {
  /** The draft, holding no analysis for the books in `unreadableBooks`. */
  draft: DraftProject;
  /**
   * Book codes whose stored analysis could not be read, so the draft carries none for them. A copy
   * must not take that absence for the book having been wiped.
   */
  unreadableBooks: string[];
};

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
   * Stored content that cannot be read loads as empty, so one damaged record never hides the rest.
   *
   * @throws {SyntaxError} If the draft's stored value contains invalid JSON.
   * @throws {Error} If the stored draft was written by a newer build.
   * @throws If storage rejects a read.
   */
  exportAll(): Promise<DraftExport>;

  /**
   * Loads the whole stored draft for copying into a project, or an empty one for the source project
   * when none is stored.
   *
   * @throws {SyntaxError} If the draft's stored value contains invalid JSON.
   * @throws {Error} If the stored draft was written by a newer build.
   * @throws {Error} If the draft itself is unreadable, so no book in it can be vouched for.
   * @throws If storage rejects a read.
   */
  exportForCopy(): Promise<DraftExport>;

  /**
   * Saves the whole draft, replacing the stored one, stamped with this build's model version.
   * Content that lands counts as saved even when cleanup after it fails. A book whose stored
   * analysis could not be read is kept as stored unless `options` discards it: a draft that loaded
   * it empty never wipes it, and analysis the draft carries for it never stands in for what could
   * not be read.
   *
   * @returns The books whose analysis in the draft was left out for that reason; empty when the
   *   draft was saved whole.
   * @throws {Error} If the stored draft was written by a newer build; nothing is written.
   * @throws If storage rejects a read or a write.
   */
  replaceAll(draft: DraftProject, options?: ReplaceAllOptions): Promise<string[]>;

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
