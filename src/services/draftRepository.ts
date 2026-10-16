import type {
  DraftProject,
  PhraseAnalysis,
  SegmentAnalysis,
  TextAnalysis,
  TokenAnalysis,
} from 'interlinearizer';
import { emptyAnalysis, emptyDraft } from '../types/empty-factories';
import { assertSupportedModelVersion, CURRENT_MODEL_VERSION } from '../types/model-version';
import {
  hasLinkWithoutId,
  isDraftProject,
  isStringArray,
  isTextAnalysis,
  validateTextAnalysis,
} from '../types/type-guards';
import { mergeAnalyses, splitAnalysisByBook } from '../utils/analysis-book';
import { perfTime, perfTimeAsync, perfTimeAsyncExcluding } from '../utils/perf-marks';
import type {
  AnalysisRepository,
  DraftScope,
  KeyValueStorage,
  RepositoryLogger,
} from '../types/analysis-repository';
import { draftAnalysisKey, draftJournalKey, draftKey } from './storageKeys';

/**
 * Logs how an analysis falls short as it crosses the storage boundary — an unreadable shape, or an
 * invariant its collections break — tagged with `description` to name the record and the point it
 * was checked at, e.g. `project abc on save`. Logging is the whole response: the read or the write
 * proceeds either way, since a record that disagrees with itself still renders, and refusing it
 * would cost the user their work over a fault they cannot act on.
 */
export function reportAnalysisViolations(
  logger: RepositoryLogger,
  analysis: unknown,
  description: string,
): void {
  // A stored record is typed but never validated, so its analysis may be absent or misshapen. Only
  // absence is legitimate: a stored null is corruption.
  if (analysis === undefined) return;
  if (!isTextAnalysis(analysis)) {
    logger.warn(`Interlinearizer: ${description} has a structurally invalid analysis`);
    return;
  }
  validateTextAnalysis(analysis).forEach(({ kind, layer, count, sample }) => {
    logger.warn(
      `Interlinearizer: ${description} has ${count} ${layer}-layer ${kind} violation(s): ${sample.join(', ')}`,
    );
  });
}

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
 * Names the shards a save is about to strand if it is interrupted, so the next run can find them
 * without the in-memory tally. Storage cannot enumerate keys, so a shard the manifest does not name
 * is otherwise unreachable once this process is gone.
 */
interface ShardJournal {
  /**
   * Books whose shard this save wrote, pending the envelope write that names them. A load reads
   * these, recovering work an interrupted save would otherwise strand.
   */
  adding: string[];
  /**
   * Books whose shard is orphaned pending deletion, already dropped from the envelope. A load must
   * not read these, or the wipe that recorded them would undo itself; they await a retried
   * deletion.
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

/** A draft as persisted: the in-memory draft with an always-empty `analysis`, held in shards. */
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
   * Whether the shard was read, and failing that, whether it still occupies storage — which is what
   * decides whether anything is left to keep reachable.
   */
  state: 'loaded' | 'unusable' | 'absent';
};

/** Payloads by id, first stored copy winning, for reads by id. */
interface PayloadsById {
  token: Map<string, TokenAnalysis>;
  phrase: Map<string, PhraseAnalysis>;
  segment: Map<string, SegmentAnalysis>;
}

/** Indexes payloads by id, keeping the first of any that share one. */
function byId<T extends { id: string }>(payloads: readonly T[]): Map<string, T> {
  const map = new Map<string, T>();
  payloads.forEach((payload) => {
    if (!map.has(payload.id)) map.set(payload.id, payload);
  });
  return map;
}

/** The stored payload for each id that has one, in request order. */
function pick<T>(map: ReadonlyMap<string, T>, ids: readonly string[]): T[] {
  return ids.flatMap((id) => {
    const payload = map.get(id);
    return payload === undefined ? [] : [payload];
  });
}

/**
 * A source project's draft held in memory over its stored envelope and per-book analysis shards.
 * Writes rewrite only the shards whose content changed since this instance last read or wrote them,
 * and never overwrite a draft written by a newer build.
 *
 * Not safe for overlapping calls: the caller serializes {@link load} and {@link replaceAll} on one
 * instance.
 */
export class DraftRepository implements AnalysisRepository {
  private readonly storage: KeyValueStorage;

  private readonly logger: RepositoryLogger;

  private readonly sourceProjectId: string;

  private scope: DraftScope;

  private analysis: TextAnalysis;

  private payloadsById: PayloadsById | undefined;

  /**
   * The serialized shard last read or written per book code. An unknown book counts as changed, so
   * a lost entry costs a write, not correctness.
   */
  private writtenShards = new Map<string, string>();

  /**
   * Book codes whose shard the last load could not read. Such a book reaches the caller as empty,
   * so a save holds its shard and manifest entry rather than taking it for wiped.
   */
  private unreadableShards = new Set<string>();

  /** Starts as an empty draft; {@link load} reads what is stored. */
  constructor(storage: KeyValueStorage, sourceProjectId: string, logger: RepositoryLogger) {
    this.storage = storage;
    this.logger = logger;
    this.sourceProjectId = sourceProjectId;
    const { analysis, ...scope } = emptyDraft(sourceProjectId);
    this.scope = scope;
    this.analysis = analysis;
  }

  /**
   * Replaces what this instance holds with the stored draft. A draft that has never been written,
   * fails validation, or belongs to a different source project loads as a fresh empty draft, and
   * the invalid one is logged.
   *
   * A draft written by a newer build is refused rather than discarded, leaving it intact for the
   * build that can read it; {@link replaceAll} refuses to overwrite that same record.
   *
   * A book whose shard is missing or unusable loads as empty, and {@link replaceAll} then leaves
   * that shard and its manifest entry alone rather than treating the book as wiped, until a write
   * carries analyses for that book again. A shard holding a link with no id is unusable, and a
   * draft storing its analysis inline with such a link loads as a fresh empty draft; either is
   * logged.
   *
   * A write interrupted before its envelope landed leaves shards the stored manifest does not name.
   * A book first analyzed in that write still loads with its work rather than empty.
   *
   * @throws {SyntaxError} If the draft's stored value contains invalid JSON.
   * @throws {Error} If the stored draft's `modelVersion` is higher than this build's.
   * @throws If storage rejects a read.
   */
  async load(): Promise<void> {
    const { analysis, ...scope } = await this.readDraft();
    this.scope = scope;
    this.analysis = analysis;
    this.payloadsById = undefined;
  }

  async getScope(): Promise<DraftScope> {
    return { ...this.scope };
  }

  async getTokenAnalyses(ids: readonly string[]): Promise<TokenAnalysis[]> {
    return pick(this.payloads().token, ids);
  }

  async getPhraseAnalyses(ids: readonly string[]): Promise<PhraseAnalysis[]> {
    return pick(this.payloads().phrase, ids);
  }

  async getSegmentAnalyses(ids: readonly string[]): Promise<SegmentAnalysis[]> {
    return pick(this.payloads().segment, ids);
  }

  async exportAll(): Promise<TextAnalysis> {
    return { ...this.analysis };
  }

  /**
   * Writes the draft, replacing the stored one whole apart from the {@link CURRENT_MODEL_VERSION}
   * stamp. A draft written by a newer build is the exception: it is left as it stands.
   *
   * The analysis spans several records and no storage transaction spans them, so an interrupted
   * write can leave books from two writes. It never leaves a book listed whose shard is gone. What
   * did reach storage is tallied as it lands, so the write that follows a failed one rewrites only
   * the books still missing it.
   *
   * Recovery does not depend on this process staying up: a shard the envelope never came to name is
   * still found on the next load, and a deletion that fails is retried by a later write even across
   * a restart. A book dropped from the analysis leaves no shard behind whether or not this instance
   * loaded the draft.
   *
   * A write that fails leaves no storage call of its own in flight. What this instance holds takes
   * the new draft once its envelope lands.
   *
   * @throws {Error} If the stored draft was written by a newer build; nothing is written.
   * @throws If storage rejects a read while checking the stored draft; nothing is written.
   * @throws If storage rejects a write.
   * @throws If deleting a wiped book's shard rejects; the shard stays journaled for a later write
   *   to retry.
   */
  async replaceAll(scope: DraftScope, analysis: TextAnalysis): Promise<void> {
    const { sourceProjectId, storage, writtenShards: written, unreadableShards: unreadable } = this;
    const storedBooks = await perfTimeAsync('saveDraft:read', () =>
      this.assertStoredDraftIsWritable(),
    );
    const byBook = perfTime('saveDraft:compare', () => splitAnalysisByBook(analysis));

    // Books this write no longer carries, less those held back because the load could not read
    // them. A write whose draft was never loaded here has only the stored manifest or the journal
    // to name earlier shards. A journaled addition whose shard never landed deletes as a no-op.
    const journaled = await perfTimeAsync('saveDraft:read', () => this.readShardJournal());
    const knownShards = new Set([
      ...written.keys(),
      ...storedBooks,
      ...journaled.adding,
      ...journaled.removing,
    ]);
    const wiped = [...knownShards].filter(
      (bookCode) => !byBook.has(bookCode) && !unreadable.has(bookCode),
    );
    const held = [...unreadable].filter((bookCode) => !byBook.has(bookCode));

    // Name every shard this write could strand before writing any of it. A book the stored manifest
    // already names needs no entry: it survives an interruption by that manifest alone.
    const stranded = [...byBook.keys()].filter((bookCode) => !storedBooks.includes(bookCode));
    await perfTimeAsync('saveDraft:write', () =>
      this.writeShardJournal({ adding: stranded, removing: wiped }),
    );

    const shards = perfTime('saveDraft:compare', () =>
      [...byBook].map(([bookCode, partition]) => {
        const json = JSON.stringify(partition);
        return { bookCode, json, changed: written.get(bookCode) !== json };
      }),
    );
    await perfTimeAsync('saveDraft:write', () =>
      settleAll(
        shards.map(async ({ bookCode, json, changed }) => {
          if (changed) await storage.write(draftAnalysisKey(sourceProjectId, bookCode), json);
          written.set(bookCode, json);
          // This write restored the book, so a later wipe must be free to delete its shard.
          unreadable.delete(bookCode);
        }),
      ),
    );

    const envelope: StoredDraft = {
      ...scope,
      modelVersion: CURRENT_MODEL_VERSION,
      analysis: emptyAnalysis(),
      analysisBooks: [...byBook.keys(), ...held],
    };
    await perfTimeAsync('saveDraft:write', () =>
      storage.write(draftKey(sourceProjectId), JSON.stringify(envelope)),
    );
    this.scope = { ...scope, modelVersion: CURRENT_MODEL_VERSION };
    this.analysis = analysis;
    this.payloadsById = undefined;

    // A wiped book would otherwise leave its shard orphaned. Deleting only once the envelope has
    // stopped naming the book keeps a failure here from stranding the manifest on a missing shard.
    const undeleted: string[] = [];
    const deletions = await perfTimeAsync('saveDraft:write', () =>
      Promise.allSettled(
        wiped.map(async (bookCode) => {
          try {
            await storage.delete(draftAnalysisKey(sourceProjectId, bookCode));
          } catch (e) {
            // Kept in the journal so a later write retries the deletion even across a restart.
            undeleted.push(bookCode);
            throw e;
          }
          // Dropped only once the shard is gone, so a later write in this process retries a failed
          // deletion.
          written.delete(bookCode);
        }),
      ),
    );

    // With the envelope naming every shard this write added, only a failed deletion is still owed.
    // A failure to record that yields to the shard error, which is the one worth surfacing; the
    // next write retries the journal either way.
    const failed = deletions.find((outcome) => outcome.status === 'rejected');
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

    if (failed?.status === 'rejected') throw failed.reason;
  }

  private payloads(): PayloadsById {
    this.payloadsById ??= {
      token: byId(this.analysis.tokenAnalyses),
      phrase: byId(this.analysis.phraseAnalyses),
      segment: byId(this.analysis.segmentAnalyses),
    };
    return this.payloadsById;
  }

  /**
   * Reads the stored draft as {@link load} describes, resetting the shard tally when the draft holds
   * its analysis in shards.
   *
   * @throws {SyntaxError} If the draft's stored value contains invalid JSON.
   * @throws {Error} If the stored draft's `modelVersion` is higher than this build's.
   * @throws If storage rejects a read.
   */
  private async readDraft(): Promise<DraftProject> {
    const { sourceProjectId, storage } = this;
    const raw = await perfTimeAsync('getDraft:read', () => storage.read(draftKey(sourceProjectId)));
    if (raw === undefined) return emptyDraft(sourceProjectId);
    const parsed: unknown = perfTime('getDraft:parse', () => JSON.parse(raw));
    // Refuse a newer build's draft before validating it: a later shape need not satisfy this
    // build's guard, and failing validation is what resets the draft to empty.
    assertSupportedModelVersion(parsed, `draft for source project ${sourceProjectId}`);
    if (
      !!parsed &&
      typeof parsed === 'object' &&
      'analysis' in parsed &&
      hasLinkWithoutId(parsed.analysis)
    ) {
      this.logger.warn(
        `Interlinearizer: draft for source project ${sourceProjectId} has links without ids; loading it empty`,
      );
      return emptyDraft(sourceProjectId);
    }
    if (!isDraftProject(parsed) || parsed.sourceProjectId !== sourceProjectId) {
      this.logger.warn('Interlinearizer: stored draft failed validation; resetting to empty draft');
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
    // A write interrupted before its envelope landed leaves shards this manifest never came to
    // name. A journaled book whose shard never landed reads as missing and drops back out below.
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
    // Record what each shard holds so the next write can tell which books actually changed. An
    // unusable shard's empty stand-in is not what is on disk, so it is recorded apart. A journaled
    // book is dropped only when its shard is gone: dropping one still in storage would strand it,
    // with neither the manifest nor the journal left to name it.
    const loadedByBook = booksToRead
      .map((bookCode, i) => ({ bookCode, ...shards[i] }))
      .filter(({ bookCode, state }) => state !== 'absent' || !orphaned.includes(bookCode));
    perfTime('getDraft:compare', () => {
      this.writtenShards = new Map(
        loadedByBook
          .filter(({ state }) => state === 'loaded')
          .map(({ bookCode, analysis }) => [bookCode, JSON.stringify(analysis)]),
      );
    });
    this.unreadableShards = new Set(
      loadedByBook.filter(({ state }) => state !== 'loaded').map(({ bookCode }) => bookCode),
    );
    return perfTime('getDraft:parse', () => {
      // Checked once merged: a link and its payload can sit in different shards, so a violation
      // is only real of the whole.
      const analysis = mergeAnalyses(shards.map((shard) => shard.analysis));
      reportAnalysisViolations(this.logger, analysis, describeDraft);
      return { ...draft, analysis };
    });
  }

  /**
   * Parses one book's analysis shard as read from `key`, treating a missing or unusable one as
   * empty so a single lost book does not fail the whole load. A shard holding a link with no id is
   * unusable.
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
   * Guards an otherwise blind draft write against clobbering a record this build cannot read. The
   * draft in hand is not evidence about what is on disk: a caller that could not read the stored
   * draft holds an empty one stamped with this revision, and writing that would land on the very
   * record the refused read protected.
   *
   * A draft that is absent or unparseable carries no stamp to refuse, so the write proceeds and
   * replaces it. A read that fails for any other reason cannot rule out the very record this guard
   * protects: a refused write costs a retry, where an overwritten record is gone for good.
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
   * Reads the shard journal, recovering a missing, unparseable, or malformed one as empty. A
   * journal is a recovery hint rather than a record of truth: every book it names is cross-checked
   * against storage before it is acted on, so losing one costs an orphaned shard, never
   * correctness.
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
   * Writes the shard journal, deleting the record instead when it names nothing, so a settled draft
   * leaves no journal behind.
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
