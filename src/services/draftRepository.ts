import type { DraftProject, TextAnalysis } from 'interlinearizer';
import type {
  AnalysisRepository,
  KeyValueStorage,
  UnreadableContentPolicy,
  WarningLogger,
} from '../types/analysis-repository';
import { emptyAnalysis, emptyDraft } from '../types/empty-factories';
import { assertSupportedModelVersion, CURRENT_MODEL_VERSION } from '../types/model-version';
import {
  hasLinkWithoutId,
  isDraftProject,
  isStringArray,
  isTextAnalysis,
} from '../types/type-guards';
import { mergeAnalyses, splitAnalysisByBook } from '../utils/analysis-book';
import { reportAnalysisViolations } from '../utils/analysis-violations';
import { perfTime, perfTimeAsync, perfTimeAsyncExcluding } from '../utils/perf-marks';
import { draftAnalysisKey, draftJournalKey, draftKey } from './storageKeys';

/**
 * Awaits every operation, so a caller that rejects leaves none of them still in flight.
 *
 * @throws Whatever the first rejecting operation threw, in argument order.
 */
async function settleAll(operations: readonly Promise<unknown>[]): Promise<void> {
  const outcomes = await Promise.allSettled(operations);
  const failure = outcomes.find((outcome) => outcome.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
}

/**
 * Names the shards an interrupted save could strand, so a later process can still find them.
 * Storage cannot enumerate keys, so a shard the manifest does not name is otherwise unreachable.
 */
interface ShardJournal {
  /**
   * Books whose shard this save wrote before the envelope came to name them. A load reads these,
   * recovering work an interrupted save would otherwise strand.
   */
  adding: string[];
  /**
   * Books whose orphaned shard awaits deletion, already dropped from the envelope. A load must not
   * read these, or the wipe that recorded them would undo itself.
   */
  removing: string[];
}

/** A journal naming no shards, which is what a cleared or unusable one recovers as. */
function emptyShardJournal(): ShardJournal {
  return { adding: [], removing: [] };
}

/** Type guard for a JSON-parsed value that must be a {@link ShardJournal}. */
function isShardJournal(value: unknown): value is ShardJournal {
  if (!value || typeof value !== 'object') return false;
  return (
    'adding' in value &&
    isStringArray(value.adding) &&
    'removing' in value &&
    isStringArray(value.removing)
  );
}

/** A draft as stored: its `analysis` always empty, with the analysis itself held in shards. */
type StoredDraft = DraftProject & {
  /**
   * Book codes of the shards holding this draft's analysis. Storage cannot enumerate keys, so
   * nothing else can say which shards a draft owns.
   */
  analysisBooks: string[];
};

/**
 * Separates a validated draft from its shard manifest, which is absent when the analysis is stored
 * inline and dropped when it is unusable.
 */
function withoutShardManifest(draft: DraftProject): DraftProject & { analysisBooks?: string[] } {
  if (!('analysisBooks' in draft)) return draft;
  const { analysisBooks, ...rest } = draft;
  return isStringArray(analysisBooks) ? { ...rest, analysisBooks } : rest;
}

/** One book's shard as loaded. */
type LoadedShard = {
  /** Empty when the shard could not be read, standing in for content this build cannot recover. */
  analysis: TextAnalysis;
  /**
   * Whether the shard was read. If not, whether it still occupies storage, which decides whether
   * anything is left to keep reachable.
   */
  state: 'loaded' | 'unusable' | 'absent';
};

/**
 * A source project's draft, stored as an envelope plus one analysis shard per book. A save rewrites
 * only the shards whose content changed since this instance last loaded or saved them. Nothing
 * overwrites a draft written by a newer build.
 *
 * Calls on one instance must not overlap.
 */
export class DraftRepository implements AnalysisRepository {
  private readonly storage: KeyValueStorage;

  private readonly logger: WarningLogger;

  private readonly sourceProjectId: string;

  /**
   * Each book's shard as last loaded or saved, serialized. A book missing here counts as changed,
   * so a lost entry costs a write, not correctness.
   */
  private shardContents = new Map<string, string>();

  /**
   * Books whose shard the last load could not use. Such a book reaches the caller as empty. A save
   * keeps its shard and manifest entry rather than taking the book for wiped.
   */
  private unreadableShards = new Set<string>();

  constructor(storage: KeyValueStorage, sourceProjectId: string, logger: WarningLogger) {
    this.storage = storage;
    this.logger = logger;
    this.sourceProjectId = sourceProjectId;
  }

  /**
   * Loads the stored draft. A draft never saved loads as a fresh empty one. So does a draft that
   * fails validation or belongs to another source project, and it is logged.
   *
   * A draft written by a newer build is refused, not discarded, so the build that can read it still
   * finds it. {@link replaceAll} refuses to overwrite it too.
   *
   * A book whose shard is missing or unusable loads as empty. {@link replaceAll} then keeps that
   * shard and its manifest entry until a save carries analyses for the book again.
   *
   * A shard holding a link with no id is unusable. A draft holding such a link inline loads as a
   * fresh empty draft. Both are logged.
   *
   * A save interrupted before its envelope landed leaves shards the manifest does not name. A book
   * first analyzed in that save still loads with its work.
   *
   * With `unreadable` set to `'throw'`, a draft or shard that would load as empty rejects instead,
   * before this instance records anything about the load.
   *
   * @throws {SyntaxError} If the draft's stored value contains invalid JSON.
   * @throws {Error} If the stored draft's `modelVersion` is higher than this build's.
   * @throws {Error} If the draft or a shard is unreadable and `unreadable` is `'throw'`.
   * @throws If storage rejects a read.
   */
  async exportAll(unreadable: UnreadableContentPolicy = 'empty'): Promise<DraftProject> {
    return this.readDraft(unreadable === 'throw');
  }

  /**
   * Saves the draft, replacing the stored one whole apart from the {@link CURRENT_MODEL_VERSION}
   * stamp. A draft written by a newer build is left as it stands.
   *
   * No storage transaction spans the shards, so an interrupted save can leave books from two saves.
   * It never leaves a listed book without its shard. Each shard counts as saved once it lands, so
   * the save after a failed one rewrites only the books still missing.
   *
   * Recovery survives a restart. The next load finds a shard the envelope never came to name, and a
   * later save retries a failed deletion. A book dropped from the analysis leaves no shard behind,
   * whether or not this instance loaded the draft, unless that load could not use the book's
   * shard.
   *
   * A save that fails leaves no storage call of its own in flight. A wiped book's shard that could
   * not be deleted is no failure of the save: the draft has landed, and the shard stays journaled
   * for a later save to retry.
   *
   * @throws {Error} If the stored draft was written by a newer build; nothing is written.
   * @throws If storage rejects a read while checking the stored draft; nothing is written.
   * @throws If storage rejects a write.
   */
  async replaceAll(draft: DraftProject): Promise<void> {
    const { sourceProjectId, storage, shardContents: saved, unreadableShards: unreadable } = this;
    const { analysis } = draft;
    const storedBooks = await perfTimeAsync('saveDraft:read', () =>
      this.assertStoredDraftIsWritable(),
    );
    const byBook = perfTime('saveDraft:compare', () => splitAnalysisByBook(analysis));

    // Books this save no longer carries, less those held back because the load could not read them.
    // Without a load here, only the stored manifest and the journal name earlier shards. A
    // journaled addition whose shard never landed deletes as a no-op.
    const journaled = await perfTimeAsync('saveDraft:read', () => this.readShardJournal());
    const knownShards = new Set([
      ...saved.keys(),
      ...storedBooks,
      ...journaled.adding,
      ...journaled.removing,
    ]);
    const wiped = [...knownShards].filter(
      (bookCode) => !byBook.has(bookCode) && !unreadable.has(bookCode),
    );
    const held = [...unreadable].filter((bookCode) => !byBook.has(bookCode));

    // Journal every shard this save could strand before writing any. A book the stored manifest
    // already names needs no entry: the manifest alone keeps it reachable.
    const stranded = [...byBook.keys()].filter((bookCode) => !storedBooks.includes(bookCode));
    await perfTimeAsync('saveDraft:write', () =>
      this.writeShardJournal({ adding: stranded, removing: wiped }),
    );

    const shards = perfTime('saveDraft:compare', () =>
      [...byBook].map(([bookCode, partition]) => {
        const json = JSON.stringify(partition);
        return { bookCode, json, changed: saved.get(bookCode) !== json };
      }),
    );
    await perfTimeAsync('saveDraft:write', () =>
      settleAll(
        shards.map(async ({ bookCode, json, changed }) => {
          if (changed) await storage.write(draftAnalysisKey(sourceProjectId, bookCode), json);
          saved.set(bookCode, json);
          // This save restored the book, so a later wipe may delete its shard.
          unreadable.delete(bookCode);
        }),
      ),
    );

    const envelope: StoredDraft = {
      ...draft,
      modelVersion: CURRENT_MODEL_VERSION,
      analysis: emptyAnalysis(),
      analysisBooks: [...byBook.keys(), ...held],
    };
    await perfTimeAsync('saveDraft:write', () =>
      storage.write(draftKey(sourceProjectId), JSON.stringify(envelope)),
    );

    // A wiped book's shard would otherwise be orphaned. Deleting it only after the envelope stops
    // naming the book means a failure here never leaves the manifest naming a missing shard.
    const undeleted: string[] = [];
    const deletions = await perfTimeAsync('saveDraft:write', () =>
      Promise.allSettled(
        wiped.map(async (bookCode) => {
          try {
            await storage.delete(draftAnalysisKey(sourceProjectId, bookCode));
          } catch (e) {
            // Kept in the journal, so a later save retries the deletion even across a restart.
            undeleted.push(bookCode);
            throw e;
          }
          // Dropped only once the shard is gone, so a later save in this process retries a failed
          // deletion.
          saved.delete(bookCode);
        }),
      ),
    );

    // With the envelope naming every shard this save added, only a failed deletion is still owed.
    // The draft itself has landed, so the failure is logged rather than thrown: a caller that took
    // it for a failed save would send the same draft again for nothing. If recording it fails too,
    // the shard failure is the one worth logging, and the next save retries the journal either way.
    const failed = deletions.find((outcome) => outcome.status === 'rejected');
    if (failed?.status === 'rejected') {
      this.logger.warn(
        `Interlinearizer: could not delete the orphaned analysis shards ${undeleted.join(', ')} of ${sourceProjectId}; a later save retries:`,
        failed.reason,
      );
    }
    try {
      await perfTimeAsync('saveDraft:write', () =>
        this.writeShardJournal({ adding: [], removing: undeleted }),
      );
    } catch (e) {
      if (!failed) throw e;
      this.logger.warn(
        `Interlinearizer: could not update the shard journal for ${sourceProjectId}:`,
        e,
      );
    }
  }

  /**
   * Loads the stored draft as {@link exportAll} describes. Loading a sharded draft also resets the
   * shard contents and unreadable books this instance keeps, unless `strict` rejects the load.
   *
   * @throws {SyntaxError} If the draft's stored value contains invalid JSON.
   * @throws {Error} If the stored draft's `modelVersion` is higher than this build's.
   * @throws {Error} If `strict` and the draft or a shard is unreadable.
   * @throws If storage rejects a read.
   */
  private async readDraft(strict: boolean): Promise<DraftProject> {
    const { sourceProjectId, storage } = this;
    /** Rejects an unreadable record when strict; otherwise logs it, and the caller loads it empty. */
    const unreadable = (message: string) => {
      if (strict) throw new Error(message);
      this.logger.warn(message);
    };
    const raw = await perfTimeAsync('getDraft:read', () => storage.read(draftKey(sourceProjectId)));
    if (raw === undefined) return emptyDraft(sourceProjectId);
    const parsed: unknown = perfTime('getDraft:parse', () => JSON.parse(raw));
    // Refuse a newer build's draft before validating it. A later shape need not pass this build's
    // guard, and failing validation is what resets the draft to empty.
    assertSupportedModelVersion(parsed, `draft for source project ${sourceProjectId}`);
    if (
      !!parsed &&
      typeof parsed === 'object' &&
      'analysis' in parsed &&
      hasLinkWithoutId(parsed.analysis)
    ) {
      unreadable(
        `Interlinearizer: draft for source project ${sourceProjectId} has links without ids; loading it empty`,
      );
      return emptyDraft(sourceProjectId);
    }
    if (!isDraftProject(parsed) || parsed.sourceProjectId !== sourceProjectId) {
      unreadable('Interlinearizer: stored draft failed validation; resetting to empty draft');
      return emptyDraft(sourceProjectId);
    }
    const { analysisBooks, ...draft } = withoutShardManifest(parsed);
    const describeDraft = `draft for source project ${sourceProjectId} on load`;
    // A draft with no manifest carries its analysis inline, with no shards to read.
    if (!analysisBooks) {
      perfTime('getDraft:parse', () =>
        reportAnalysisViolations(this.logger, draft.analysis, describeDraft),
      );
      return draft;
    }
    const keyOf = (bookCode: string) => draftAnalysisKey(sourceProjectId, bookCode);
    // A save interrupted before its envelope landed leaves shards this manifest never came to name.
    // A journaled book whose shard never landed reads as missing and drops back out below.
    const { booksToRead, orphaned, shards } = await perfTimeAsyncExcluding(
      'getDraft:read',
      'getDraft:parse',
      async () => {
        const { adding } = await this.readShardJournal();
        const orphanedBooks = adding.filter((bookCode) => !analysisBooks.includes(bookCode));
        const books = [...analysisBooks, ...orphanedBooks];
        return {
          booksToRead: books,
          orphaned: orphanedBooks,
          shards: await Promise.all(
            books.map(async (bookCode) => {
              const shardRaw = await storage.read(keyOf(bookCode));
              return perfTime('getDraft:parse', () =>
                this.parseAnalysisShard(shardRaw, keyOf(bookCode)),
              );
            }),
          ),
        };
      },
    );
    // Record what each shard holds, so the next save can tell which books changed. An unusable
    // shard's empty stand-in is not what storage holds, so it is recorded apart. A journaled book is
    // dropped only once its shard is gone. Dropping one still in storage would strand it, with
    // neither the manifest nor the journal naming it.
    const loadedByBook = booksToRead
      .map((bookCode, i) => ({ bookCode, ...shards[i] }))
      .filter(({ bookCode, state }) => state !== 'absent' || !orphaned.includes(bookCode));
    const unusable = loadedByBook.filter(({ state }) => state !== 'loaded');
    if (strict && unusable.length > 0)
      throw new Error(
        `Interlinearizer: draft for source project ${sourceProjectId} has unreadable analysis shards for ${unusable.map(({ bookCode }) => bookCode).join(', ')}`,
      );
    perfTime('getDraft:compare', () => {
      this.shardContents = new Map(
        loadedByBook
          .filter(({ state }) => state === 'loaded')
          .map(({ bookCode, analysis }) => [bookCode, JSON.stringify(analysis)]),
      );
    });
    this.unreadableShards = new Set(unusable.map(({ bookCode }) => bookCode));
    return perfTime('getDraft:parse', () => {
      // Checked once merged: a link and its payload can sit in different shards, so a violation
      // is only real of the whole.
      const analysis = mergeAnalyses(shards.map((shard) => shard.analysis));
      reportAnalysisViolations(this.logger, analysis, describeDraft);
      return { ...draft, analysis };
    });
  }

  /**
   * Parses one book's shard as read from `key`. A missing or unusable shard is treated as empty, so
   * one lost book does not fail the whole load. A shard holding a link with no id is unusable.
   */
  private parseAnalysisShard(raw: string | undefined, key: string): LoadedShard {
    if (raw === undefined) return { analysis: emptyAnalysis(), state: 'absent' };
    try {
      const parsed: unknown = JSON.parse(raw);
      if (hasLinkWithoutId(parsed)) {
        this.logger.warn(
          `Interlinearizer: analysis shard ${key} has links without ids; treating as empty`,
        );
        return { analysis: emptyAnalysis(), state: 'unusable' };
      }
      if (!isTextAnalysis(parsed)) {
        this.logger.warn(
          `Interlinearizer: analysis shard ${key} failed validation; treating as empty`,
        );
        return { analysis: emptyAnalysis(), state: 'unusable' };
      }
      return { analysis: parsed, state: 'loaded' };
    } catch {
      this.logger.warn(
        `Interlinearizer: analysis shard ${key} is not valid JSON; treating as empty`,
      );
      return { analysis: emptyAnalysis(), state: 'unusable' };
    }
  }

  /**
   * Guards an otherwise blind save against clobbering a draft this build cannot read. The draft in
   * hand says nothing about storage. A caller whose load was refused holds an empty draft stamped
   * with this revision, and saving it would overwrite the very record the refusal protected.
   *
   * An absent or unparseable draft carries no stamp to refuse, so the save replaces it. A read that
   * fails for any other reason cannot rule that record out. A refused save costs a retry; an
   * overwritten record is gone for good.
   *
   * @returns The book codes the stored draft's manifest names, empty when there is no readable
   *   manifest to name them.
   * @throws {Error} If the stored draft's `modelVersion` is higher than this build's.
   * @throws If storage rejects the read.
   */
  private async assertStoredDraftIsWritable(): Promise<string[]> {
    const raw = await this.storage.read(draftKey(this.sourceProjectId));
    if (raw === undefined) return [];
    let stored: unknown;
    try {
      stored = JSON.parse(raw);
    } catch {
      return [];
    }
    assertSupportedModelVersion(stored, `draft for source project ${this.sourceProjectId}`);
    if (!isDraftProject(stored)) return [];
    const { analysisBooks } = withoutShardManifest(stored);
    return analysisBooks ?? [];
  }

  /**
   * Reads the shard journal. A missing, unparseable or malformed journal recovers as empty. It is a
   * recovery hint, not a record of truth: every book it names is checked against storage before
   * anything acts on it. Losing one costs an orphaned shard, never correctness.
   *
   * @throws If storage rejects the read.
   */
  private async readShardJournal(): Promise<ShardJournal> {
    const { sourceProjectId } = this;
    const raw = await this.storage.read(draftJournalKey(sourceProjectId));
    if (raw === undefined) return emptyShardJournal();
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isShardJournal(parsed)) return parsed;
      this.logger.warn(
        `Interlinearizer: shard journal for ${sourceProjectId} is malformed; treating as empty`,
      );
    } catch {
      this.logger.warn(
        `Interlinearizer: shard journal for ${sourceProjectId} is not valid JSON; treating as empty`,
      );
    }
    return emptyShardJournal();
  }

  /**
   * Writes the shard journal, or deletes it when it names nothing, so a settled draft leaves none
   * behind.
   *
   * @throws If storage rejects the write or the deletion.
   */
  private async writeShardJournal(journal: ShardJournal): Promise<void> {
    const key = draftJournalKey(this.sourceProjectId);
    if (journal.adding.length === 0 && journal.removing.length === 0) {
      await this.storage.delete(key);
      return;
    }
    await this.storage.write(key, JSON.stringify(journal));
  }
}
