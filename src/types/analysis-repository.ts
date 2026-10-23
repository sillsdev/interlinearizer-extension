import type { DraftProject, TextAnalysis } from 'interlinearizer';

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

/** What an {@link AnalysisRepository} lets its caller do. */
export interface RepositoryCapabilities {
  /** Whether every write is refused, as it is for a Paratext 9 import. */
  readOnly: boolean;
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

/** A draft's own record: everything in it but its analysis. */
export type ScopeRecord = Omit<DraftProject, 'analysis'>;

/** Whole-record puts and deletes of one record kind. */
export type RecordChanges<T> = {
  /** Records to store whole, each replacing any stored under its id. */
  puts: T[];
  /** Ids of records to remove; an id with nothing stored under it is skipped. */
  deletes: string[];
};

/**
 * One command's changes, applied all-or-nothing. A record kind it leaves alone is absent, and an id
 * appears at most once in a kind's puts and deletes together.
 */
export type ChangeSet = {
  /** Names the command that made the changes. */
  intent: string;
  /** The scope's record, whole, which carries boundary changes; absent when it is left alone. */
  scope?: ScopeRecord;
} & {
  [Kind in keyof TextAnalysis]?: RecordChanges<TextAnalysis[Kind][number]>;
};

/** What applying a {@link ChangeSet} tells its caller. */
export type ApplyResult = {
  /** Restores what the applied changes replaced; applying it undoes them. */
  inverse: ChangeSet;
};

/**
 * Reads and writes one source project's draft, or, when read-only, reads analysis in a draft's
 * shape. Every call is async and takes and returns only JSON-plain values, so an implementation may
 * sit behind a network boundary or another language. Once a call settles, the caller may change a
 * draft it passed in or got back without changing what is stored. Lists of records come back in no
 * promised order.
 *
 * Calls for one draft must not overlap, whether on one repository or several. After one repository
 * saves a draft, any other that had already loaded or saved it must load it again before its next
 * save.
 */
export interface AnalysisRepository {
  /** Fixed for the repository's lifetime. */
  readonly capabilities: RepositoryCapabilities;

  /**
   * Loads the whole stored draft, or, from a writable repository, an empty one for the source
   * project when none is stored. Stored content that cannot be read loads as empty, so one damaged
   * record never hides the rest.
   *
   * @throws {Error} If the repository is read-only and nothing is stored for it to read.
   * @throws {SyntaxError} If the draft's stored value contains invalid JSON.
   * @throws {Error} If the stored draft was written by a newer build.
   * @throws If storage rejects a read.
   */
  exportAll(): Promise<DraftExport>;

  /**
   * Loads the whole stored draft for copying into a project, or, from a writable repository, an
   * empty one for the source project when none is stored.
   *
   * @throws {Error} If the repository is read-only and nothing is stored for it to read.
   * @throws {SyntaxError} If the draft's stored value contains invalid JSON.
   * @throws {Error} If the stored draft was written by a newer build.
   * @throws {Error} If the draft itself is unreadable, so no book in it can be vouched for.
   * @throws If storage rejects a read.
   */
  exportForCopy(): Promise<DraftExport>;

  /**
   * Saves the whole draft, replacing the stored one, stamped with this build's model version. Once
   * the save's cleanup succeeds, nothing the saved draft no longer needs stays stored, apart from
   * the stored analysis a save keeps for unreadable books. Content that lands counts as saved even
   * when that cleanup fails; a later save, from any repository, finishes the cleanup. A book whose
   * stored analysis could not be read is kept as stored unless `options` discards it: a draft that
   * loaded it empty never wipes it, and analysis the draft carries for it never stands in for what
   * could not be read.
   *
   * @returns The books whose analysis in the draft was left out for that reason; empty when the
   *   draft was saved whole.
   * @throws {ReadOnlyAnalysisError} If the repository is read-only; nothing is written.
   * @throws {Error} If the stored draft was written by a newer build; nothing is written.
   * @throws If storage rejects a read or a write.
   */
  replaceAll(draft: DraftProject, options?: ReplaceAllOptions): Promise<string[]>;

  /**
   * Records the stored draft as saved to its project, leaving its content as it stands. A draft
   * never saved, or already clean, is left alone.
   *
   * @throws {ReadOnlyAnalysisError} If the repository is read-only; nothing is written.
   * @throws {Error} If the stored draft was written by a newer build, or is unreadable; nothing is
   *   written.
   * @throws If storage rejects a read or a write.
   */
  markClean(): Promise<void>;

  /**
   * Applies `changes` to the stored draft whole or not at all, stamped with this build's model
   * version. A draft never saved counts as an empty one.
   *
   * @throws {ReadOnlyAnalysisError} If the repository is read-only; nothing is applied.
   * @throws {Error} If an id appears more than once in one record kind's changes, or the scope's
   *   record names another source project; nothing is applied.
   * @throws {Error} If the changes reach a book whose stored analysis could not be read; nothing is
   *   applied.
   * @throws {SyntaxError} If the draft's stored value contains invalid JSON.
   * @throws {Error} If the stored draft was written by a newer build; nothing is applied.
   * @throws If storage rejects a read or a write. The draft as this repository holds it is
   *   unchanged, though storage may hold some of the changes until a later save.
   */
  apply(changes: ChangeSet): Promise<ApplyResult>;
}
