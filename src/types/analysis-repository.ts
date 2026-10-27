import type {
  AssignmentStatus,
  DraftProject,
  PhraseAnalysis,
  PhraseAnalysisLink,
  SegmentAnalysis,
  SegmentAnalysisLink,
  TextAnalysis,
  TokenAnalysis,
} from 'interlinearizer';
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- named only for its doc links
import type { normalizeSurfaceForm } from '../utils/analysis-identity';

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

/**
 * A draft's own record: everything in it but its analysis and its `dirty` flag, which every apply
 * sets.
 */
export type ScopeRecord = Omit<DraftProject, 'analysis' | 'dirty'>;

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

/** How an apply treats the draft's unsaved mark. */
export type ApplyOptions = {
  /**
   * Leave the draft as saved or unsaved as it was, for bookkeeping such as a re-anchor pass rather
   * than an edit. Absent, the draft is marked unsaved.
   */
  keepDirty?: boolean;
};

/** What applying a {@link ChangeSet} tells its caller. */
export type ApplyResult = {
  /** Restores what the applied changes replaced; applying it undoes them. */
  inverse: ChangeSet;
  /** Whether the draft was marked unsaved before the changes applied. */
  wasDirty: boolean;
};

/** Links of every kind, one list per kind. */
export type AnalysisLinks = Pick<
  TextAnalysis,
  'tokenAnalysisLinks' | 'phraseAnalysisLinks' | 'segmentAnalysisLinks'
>;

/** A difference between a repository's kept indexes and ones built afresh from its records. */
export type IndexDifference = {
  /** The record kind, or `<kind> by <index name>` for a derived index. */
  index: string;
  /** The record id, or the key whose entries differ in a derived index. */
  key: string;
  /**
   * Ids filed under `key` in the fresh index and not the kept one; where `index` names a record
   * kind, also the id of a record whose kept copy differs.
   */
  missing: string[];
  /**
   * Ids filed under `key` in the kept index and not the fresh one; where `index` names a record
   * kind, also the id of a record whose kept copy differs.
   */
  extra: string[];
};

/**
 * Reads and writes one source project's draft, or, when read-only, reads analysis in a draft's
 * shape. Every call is async and takes and returns only JSON-plain values, so an implementation may
 * sit behind a network boundary or another language. Once a call settles, the caller may change a
 * draft or records it passed in or got back without changing what is stored. Lists of records come
 * back in no promised order, and a lookup by several keys returns each record once.
 *
 * Calls for one draft must not overlap, whether on one repository or several. After one repository
 * saves a draft, any other that had already loaded or saved it must load it again through
 * {@link exportAll} before its next save or lookup; {@link exportForCopy} does not count.
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
   * Applies `changes` to the stored draft whole or not at all, marked unsaved unless `options`
   * keeps the mark, and stamped with this build's model version. A draft never saved counts as an
   * empty one.
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
  apply(changes: ChangeSet, options?: ApplyOptions): Promise<ApplyResult>;

  /**
   * The draft's own record, as {@link AnalysisRepository.exportAll} would load it.
   *
   * @throws Whatever {@link AnalysisRepository.exportAll} throws.
   */
  getScope(): Promise<ScopeRecord>;

  /**
   * The token analyses stored under `ids`; an id with none stored under it is skipped.
   *
   * @throws Whatever {@link AnalysisRepository.exportAll} throws.
   */
  getTokenAnalyses(ids: string[]): Promise<TokenAnalysis[]>;

  /**
   * The phrase analyses stored under `ids`; an id with none stored under it is skipped.
   *
   * @throws Whatever {@link AnalysisRepository.exportAll} throws.
   */
  getPhraseAnalyses(ids: string[]): Promise<PhraseAnalysis[]>;

  /**
   * The segment analyses stored under `ids`; an id with none stored under it is skipped.
   *
   * @throws Whatever {@link AnalysisRepository.exportAll} throws.
   */
  getSegmentAnalyses(ids: string[]): Promise<SegmentAnalysis[]>;

  /**
   * The phrase links stored under `ids`; an id with none stored under it is skipped.
   *
   * @throws Whatever {@link AnalysisRepository.exportAll} throws.
   */
  getPhraseAnalysisLinks(ids: string[]): Promise<PhraseAnalysisLink[]>;

  /**
   * The token links on any of `tokenRefs`, and the phrase links touching any of them.
   *
   * @throws Whatever {@link AnalysisRepository.exportAll} throws.
   */
  findLinksByToken(
    tokenRefs: string[],
  ): Promise<Pick<AnalysisLinks, 'tokenAnalysisLinks' | 'phraseAnalysisLinks'>>;

  /**
   * The segment links on any of `segmentIds`.
   *
   * @throws Whatever {@link AnalysisRepository.exportAll} throws.
   */
  findLinksBySegment(segmentIds: string[]): Promise<SegmentAnalysisLink[]>;

  /**
   * The links of every kind to any of `analysisIds`.
   *
   * @throws Whatever {@link AnalysisRepository.exportAll} throws.
   */
  findLinksToAnalyses(analysisIds: string[]): Promise<AnalysisLinks>;

  /**
   * The links of every kind into any of `bookCodes`, limited to `statuses` when given.
   *
   * @throws Whatever {@link AnalysisRepository.exportAll} throws.
   */
  findLinksInBooks(bookCodes: string[], statuses?: AssignmentStatus[]): Promise<AnalysisLinks>;

  /**
   * The token analyses whose surface text {@link normalizeSurfaceForm} maps to one of
   * `normalizedForms`.
   *
   * @throws Whatever {@link AnalysisRepository.exportAll} throws.
   */
  findTokenAnalysesByForm(normalizedForms: string[]): Promise<TokenAnalysis[]>;

  /**
   * The phrase analyses whose surface text {@link normalizeSurfaceForm} maps to one of
   * `normalizedForms`.
   *
   * @throws Whatever {@link AnalysisRepository.exportAll} throws.
   */
  findPhraseAnalysesByForm(normalizedForms: string[]): Promise<PhraseAnalysis[]>;

  /**
   * Reports where the derived indexes the repository keeps differ from ones built afresh from its
   * records, for debugging, leaving the kept ones as they are. A repository keeping none reports
   * nothing.
   */
  checkIndexes(): Promise<IndexDifference[]>;
}
