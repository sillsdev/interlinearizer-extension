import papi, { logger } from '@papi/backend';
import type { ExecutionToken } from '@papi/core';
import type {
  DraftProject,
  InterlinearProject,
  SegmentationDelta,
  TextAnalysis,
} from 'interlinearizer';
import { emptyAnalysis, emptyDraft } from '../types/empty-factories';
import { isDraftProject } from '../types/type-guards';

const PROJECT_IDS_KEY = 'projectIds';

/**
 * Storage key holding the set of project IDs whose records were orphaned by a failed rollback (see
 * {@link createProject}). Each entry is a `project:{id}` record that was written but never added to
 * the index and could not be deleted at the time; {@link sweepPendingCleanup} retries their
 * deletion.
 */
const PENDING_CLEANUP_KEY = 'pendingCleanup';

/**
 * Serializes all read-modify-write operations on the shared `projectIds` index. Every operation
 * that reads then writes the index must be enqueued here so concurrent calls (e.g. from two open
 * WebView tabs) cannot interleave at await boundaries and silently overwrite each other's updates.
 */
let indexQueue: Promise<unknown> = Promise.resolve();

/**
 * Serializes all read-modify-write operations on the shared `pendingCleanup` set. Recording a new
 * orphan (from a failed rollback) and the sweep that retries deletions must not interleave at await
 * boundaries, or one could overwrite the other's changes to the set.
 */
let pendingCleanupQueue: Promise<unknown> = Promise.resolve();

/**
 * Per-project serialization queues. Keyed by project ID; each entry serializes all
 * read-modify-write operations on that project's storage record so concurrent update and delete
 * calls cannot interleave and create orphaned or stale records.
 */
const projectQueues = new Map<string, Promise<unknown>>();

/**
 * Per-source draft serialization queues. Keyed by `sourceProjectId`; serializes writes to a single
 * draft record so a WebView's rapid auto-saves cannot interleave at await boundaries and persist
 * out of order.
 */
const draftQueues = new Map<string, Promise<unknown>>();

/**
 * Enqueues `fn` on a single shared serialization queue and returns a promise that resolves or
 * rejects with `fn`'s result. The queue always advances regardless of whether `fn` throws, so a
 * failed operation does not block later ones.
 *
 * @param get - Returns the current tail of the queue to chain `fn` after.
 * @param set - Stores the new tail of the queue (a promise that settles once `fn` settles).
 * @param fn - The async function to serialize.
 * @throws Whatever `fn` throws; the queue advances past the error so later operations are not
 *   blocked.
 */
function enqueueOnQueue<T>(
  get: () => Promise<unknown>,
  set: (queue: Promise<unknown>) => void,
  fn: () => Promise<T>,
): Promise<T> {
  const result = get().then(fn);
  set(result.catch(() => {}));
  return result;
}

/**
 * Enqueues `fn` on the index serialization queue, so it runs only once every index operation
 * enqueued before it has settled.
 *
 * @throws Whatever `fn` throws; the queue advances past the error so later operations are not
 *   blocked.
 */
function enqueueIndexOp<T>(fn: () => Promise<T>): Promise<T> {
  return enqueueOnQueue(
    () => indexQueue,
    (q) => {
      indexQueue = q;
    },
    fn,
  );
}

/**
 * Enqueues `fn` on the pending-cleanup serialization queue, so it runs only once every
 * pending-cleanup operation enqueued before it has settled.
 *
 * @throws Whatever `fn` throws; the queue advances past the error so later operations are not
 *   blocked.
 */
function enqueuePendingCleanupOp<T>(fn: () => Promise<T>): Promise<T> {
  return enqueueOnQueue(
    () => pendingCleanupQueue,
    (q) => {
      pendingCleanupQueue = q;
    },
    fn,
  );
}

/**
 * Enqueues `fn` on the serialization queue identified by `key` within `queues` and returns a
 * promise that resolves or rejects with `fn`'s result. Cleans up the queue entry when the operation
 * settles.
 *
 * @param queues - The queue map to serialize on; one chain per `key`.
 * @param key - The key whose queue `fn` should join.
 * @param fn - The async function to serialize.
 * @throws Whatever `fn` throws; the queue entry is removed and the rejection propagates to the
 *   caller.
 */
function enqueueSerialized<T>(
  queues: Map<string, Promise<unknown>>,
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const result = previous.then(fn);
  let settled: Promise<void>;
  const cleanup = () => {
    if (queues.get(key) === settled) queues.delete(key);
  };
  settled = result.then(cleanup, cleanup);
  queues.set(key, settled);
  return result;
}

/**
 * Enqueues `fn` on the serialization queue for project `id`, so it runs only once every operation
 * enqueued before it on that same project has settled; other projects proceed independently.
 *
 * @throws Whatever `fn` throws; the queue entry is removed and the rejection propagates to the
 *   caller.
 */
function enqueueProjectOp<T>(id: string, fn: () => Promise<T>): Promise<T> {
  return enqueueSerialized(projectQueues, id, fn);
}

/** Returns the storage key for a project by ID. */
function projectKey(id: string): string {
  return `project:${id}`;
}

/** Returns the storage key for a source project's draft. */
function draftKey(sourceProjectId: string): string {
  return `draft:${sourceProjectId}`;
}

/**
 * Returns true when `e` is a file-not-found error (ENOENT) from the Node.js file system, which is
 * what `papi.storage.readUserData` throws when the requested key has never been written.
 */
function isNotFound(e: unknown): boolean {
  return !!e && typeof e === 'object' && 'code' in e && e.code === 'ENOENT';
}

/**
 * Type guard for a JSON-parsed value that must be an array of strings — the shape of both the
 * `projectIds` index and the `pendingCleanup` set.
 */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((id) => typeof id === 'string');
}

/**
 * Reads and JSON-parses the value stored at `key`, treating a never-written key as an empty array.
 * Returns the raw parsed value as `unknown` and does not validate that it is an array of strings.
 *
 * @throws {SyntaxError} If the stored value contains invalid JSON.
 * @throws If `papi.storage.readUserData` rejects for any non-ENOENT reason (e.g. permission denied,
 *   I/O error).
 */
async function readJsonArray(token: ExecutionToken, key: string): Promise<unknown> {
  try {
    return JSON.parse(await papi.storage.readUserData(token, key));
  } catch (e) {
    if (isNotFound(e)) return [];
    throw e;
  }
}

/**
 * Reads the stored list of project IDs. Unlike the pending-cleanup set, a corrupt index is never
 * silently reset to an empty array — that would drop every project's id at once and orphan all
 * their records — so a stored value that is not an array of strings throws a clear corruption error
 * rather than being coerced into subtle downstream failures (e.g. spreading a string into
 * characters in {@link createProject}, or calling `.filter` on a non-array in
 * {@link deleteProject}).
 *
 * @returns The stored project ID array, or an empty array if `projectIds` has never been written
 *   (ENOENT).
 * @throws {SyntaxError} If the `projectIds` storage value contains invalid JSON.
 * @throws {Error} If the parsed `projectIds` value is not an array of strings (a corrupt index).
 * @throws If `papi.storage.readUserData` rejects for any non-ENOENT reason (e.g. permission denied,
 *   I/O error).
 */
async function readIds(token: ExecutionToken): Promise<string[]> {
  const parsed = await readJsonArray(token, PROJECT_IDS_KEY);
  if (!isStringArray(parsed)) {
    throw new Error(
      `Interlinearizer: '${PROJECT_IDS_KEY}' index is corrupt (expected an array of strings)`,
    );
  }
  return parsed;
}

/**
 * Outcome of reading the pending-cleanup set, distinguishing a genuinely-empty (or well-formed) set
 * from a corrupt stored value. {@link sweepPendingCleanup} uses `corrupt` to decide whether it must
 * overwrite the stored value even when there are no ids to process, so a bad value is repaired
 * rather than re-read (and re-warned about) on every launch.
 */
interface PendingCleanupRead {
  /** The recovered pending-cleanup ids: the parsed array, or `[]` when the stored value was corrupt. */
  ids: string[];
  /** Whether the stored value was unparseable or not an array of strings. */
  corrupt: boolean;
}

/**
 * Reads the stored set of orphaned project IDs awaiting cleanup, tolerating corruption so a bad
 * value can never wedge {@link sweepPendingCleanup} (which runs fire-and-forget at activation, where
 * a thrown error would be invisible and would recur on every launch). A value that is missing
 * (ENOENT), unparseable, or not an array of strings is recovered as an empty set; when the value
 * was present but corrupt, `corrupt` is set so the caller can rewrite the key with a valid value,
 * self-healing it instead of re-reading (and re-warning about) the bad value on every launch.
 *
 * @throws If `papi.storage.readUserData` rejects for any non-ENOENT reason.
 */
async function readPendingCleanup(token: ExecutionToken): Promise<PendingCleanupRead> {
  let parsed: unknown;
  try {
    parsed = await readJsonArray(token, PENDING_CLEANUP_KEY);
  } catch (e) {
    if (e instanceof SyntaxError) {
      logger.warn('Interlinearizer: pending-cleanup set contains invalid JSON; resetting to empty');
      return { ids: [], corrupt: true };
    }
    throw e;
  }
  if (!isStringArray(parsed)) {
    logger.warn(
      'Interlinearizer: pending-cleanup set is not an array of strings; resetting to empty',
    );
    return { ids: [], corrupt: true };
  }
  return { ids: parsed, corrupt: false };
}

/**
 * Records `id` in the persistent `pendingCleanup` set so a later {@link sweepPendingCleanup} can
 * retry deleting its orphaned `project:{id}` record. Serialized with every other write to the set,
 * so concurrent updates cannot overwrite each other, and idempotent: an id already in the set is
 * not added twice.
 *
 * @throws If `papi.storage.readUserData` or `papi.storage.writeUserData` rejects for a non-ENOENT
 *   reason. A corrupt `pendingCleanup` value is not thrown; it is recovered as an empty set.
 */
function recordPendingCleanup(token: ExecutionToken, id: string): Promise<void> {
  return enqueuePendingCleanupOp(async () => {
    const { ids } = await readPendingCleanup(token);
    if (ids.includes(id)) return;
    await papi.storage.writeUserData(token, PENDING_CLEANUP_KEY, JSON.stringify([...ids, id]));
  });
}

/**
 * Retries deleting the orphaned project records recorded in the `pendingCleanup` set (see
 * {@link createProject}). For each recorded id:
 *
 * - If the id is still present in the `projectIds` index, it belongs to a live project — its record
 *   must not be deleted. The id is dropped from the set without touching its record; it should
 *   never have been recorded (or has since become live) and is not an orphan to clean.
 * - Otherwise the record is an orphan: its `project:{id}` deletion is attempted, treating ENOENT as
 *   success (already gone). On success the id is dropped from the set; on failure it is retained
 *   for the next attempt and logged.
 *
 * Consulting the index guards against destroying a live project's record if an id ever lands in the
 * set while still indexed (e.g. an index write that persists but then reports failure). Intended to
 * run opportunistically at activation.
 *
 * The whole read-delete-rewrite cycle is serialized with every other write to the set, so it cannot
 * interleave with a concurrent {@link recordPendingCleanup} and drop a newly recorded orphan. The
 * per-record deletions run concurrently within the cycle; the set is small and each targets a
 * distinct key.
 *
 * @returns A promise resolving to the number of orphaned records successfully deleted this pass
 *   (live ids dropped from the set without deleting their record are not counted).
 * @throws {SyntaxError} If the `projectIds` storage value contains invalid JSON.
 * @throws {Error} If the stored `projectIds` value is not an array of strings (a corrupt index).
 * @throws If reading the set or the index, or rewriting the set (`papi.storage.writeUserData`),
 *   rejects for a non-ENOENT reason. A per-record delete failure is not thrown; the id is retained
 *   instead.
 */
export function sweepPendingCleanup(token: ExecutionToken): Promise<number> {
  return enqueuePendingCleanupOp(async () => {
    const { ids, corrupt } = await readPendingCleanup(token);
    if (ids.length === 0) {
      // Nothing to sweep. If the stored value was corrupt, overwrite it with a valid empty set so
      // it self-heals; otherwise it would be re-read and re-warned about on every launch.
      if (corrupt) await papi.storage.writeUserData(token, PENDING_CLEANUP_KEY, JSON.stringify([]));
      return 0;
    }
    // Read the index directly rather than on the index queue: this snapshot is consulted only
    // to protect live projects from deletion, and both directions of a stale read are safe. A read
    // that misses a just-created project is harmless (a live project's id is never in the
    // pending-cleanup work set), and a read that still shows a since-deleted project only makes the
    // sweep conservatively skip a deletion. A stale snapshot can never make the sweep delete a
    // record it should keep, so serializing this read would add contention for no benefit.
    const indexed = new Set(await readIds(token));
    // For each id, decide whether to keep it in the set and whether its record was cleaned.
    const outcomes = await Promise.all(
      ids.map(async (id) => {
        if (indexed.has(id)) {
          // Live project: never delete its record. Drop it from the set as a non-orphan.
          logger.warn(`Interlinearizer: pending-cleanup id ${id} is a live project; not deleting`);
          return { keep: false, cleaned: false };
        }
        try {
          await papi.storage.deleteUserData(token, projectKey(id));
          return { keep: false, cleaned: true };
        } catch (e) {
          if (isNotFound(e)) return { keep: false, cleaned: true };
          logger.error(`Interlinearizer: cleanup of orphaned project ${id} failed again:`, e);
          return { keep: true, cleaned: false };
        }
      }),
    );
    const remaining = ids.filter((_id, i) => outcomes[i].keep);
    if (remaining.length !== ids.length) {
      await papi.storage.writeUserData(token, PENDING_CLEANUP_KEY, JSON.stringify(remaining));
    }
    return outcomes.filter((o) => o.cleaned).length;
  });
}

/**
 * Creates a new interlinearizer project with empty analysis data and writes it to extension
 * storage. Appends the project ID to the stored index. `createdAt` and `updatedAt` are set to the
 * same creation timestamp.
 *
 * @param token - The execution token for storage access.
 * @param sourceProjectId - The Platform.Bible project ID of the source text.
 * @param analysisLanguages - BCP 47 tags for languages used in glosses and annotations. Required
 *   and must contain at least one entry.
 * @param targetProjectId - Optional Platform.Bible project ID of the target text. When provided,
 *   the project is created as a bilateral alignment project and `links` is initialized to `[]`;
 *   when omitted the project is analysis-only and `links` is left undefined.
 * @param name - Optional user-facing name for the project.
 * @param description - Optional user-facing description for the project.
 * @throws {SyntaxError} If the `projectIds` storage value contains invalid JSON.
 * @throws {Error} If the stored `projectIds` value is not an array of strings (a corrupt index).
 * @throws If `papi.storage.readUserData` rejects for any non-ENOENT reason when reading the index.
 * @throws If the project or index `papi.storage.writeUserData` rejects. On an index-write failure
 *   the original error is rethrown after best-effort rollback; a failed rollback does not throw —
 *   the orphaned record is instead recorded for a later {@link sweepPendingCleanup} (and a failure
 *   to even record it is logged and swallowed).
 */
export async function createProject(
  token: ExecutionToken,
  sourceProjectId: string,
  analysisLanguages: string[],
  targetProjectId?: string,
  name?: string,
  description?: string,
): Promise<InterlinearProject> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const project: InterlinearProject = {
    id,
    createdAt: now,
    updatedAt: now,
    ...(name !== undefined && { name }),
    ...(description !== undefined && { description }),
    sourceProjectId,
    ...(targetProjectId !== undefined && { targetProjectId }),
    analysisLanguages,
    analysis: emptyAnalysis(),
    ...(targetProjectId !== undefined && { links: [] }),
  };

  await papi.storage.writeUserData(token, projectKey(id), JSON.stringify(project));
  try {
    await enqueueIndexOp(async () => {
      const ids = await readIds(token);
      await papi.storage.writeUserData(token, PROJECT_IDS_KEY, JSON.stringify([...ids, id]));
    });
  } catch (indexError) {
    try {
      await papi.storage.deleteUserData(token, projectKey(id));
    } catch (rollbackError) {
      logger.error(`Failed to roll back project ${id} after index write failure:`, rollbackError);
      // The orphaned record was written but never indexed and could not be deleted. Record it so a
      // later sweep retries the deletion; a failure to even record it is logged and swallowed so it
      // never masks the original index error the caller needs to see.
      await recordPendingCleanup(token, id).catch((recordError) => {
        logger.error(`Failed to record orphaned project ${id} for cleanup:`, recordError);
      });
    }
    throw indexError;
  }

  return project;
}

/**
 * Returns the project with the given ID.
 *
 * @returns The project record, or `undefined` if it does not exist in storage (ENOENT).
 * @throws {SyntaxError} If the project's storage value contains invalid JSON.
 * @throws If `papi.storage.readUserData` rejects for any non-ENOENT reason.
 */
export async function getProject(
  token: ExecutionToken,
  id: string,
): Promise<InterlinearProject | undefined> {
  try {
    return JSON.parse(await papi.storage.readUserData(token, projectKey(id)));
  } catch (e) {
    if (isNotFound(e)) return undefined;
    throw e;
  }
}

/**
 * Returns all stored projects in creation order. Projects whose storage keys are missing (e.g.
 * after a failed delete) are silently omitted. Projects that fail to read or parse are logged and
 * skipped so a single corrupted record does not prevent access to the rest.
 *
 * @throws {SyntaxError} If `projectIds` contains invalid JSON.
 * @throws {Error} If the stored `projectIds` value is not an array of strings (a corrupt index).
 * @throws If `papi.storage.readUserData` rejects for any non-ENOENT reason when reading the index.
 */
export async function listProjects(token: ExecutionToken): Promise<InterlinearProject[]> {
  const ids = await readIds(token);
  const projects = await Promise.all(
    ids.map(async (id) => {
      try {
        return await getProject(token, id);
      } catch (e) {
        logger.error(`Interlinearizer: failed to read project ${id}:`, e);
        return undefined;
      }
    }),
  );
  return projects.filter((p): p is InterlinearProject => p !== undefined);
}

/**
 * Returns all interlinearizer projects whose `sourceProjectId` matches the given value, in creation
 * order.
 *
 * @throws {SyntaxError} If `projectIds` or any project's storage value contains invalid JSON.
 * @throws {Error} If the stored `projectIds` value is not an array of strings (a corrupt index).
 * @throws If `papi.storage.readUserData` rejects for any non-ENOENT reason.
 */
export async function getProjectsForSource(
  token: ExecutionToken,
  sourceProjectId: string,
): Promise<InterlinearProject[]> {
  const all = await listProjects(token);
  return all.filter((p) => p.sourceProjectId === sourceProjectId);
}

/**
 * Replaces the analysis of an existing interlinearizer project, and optionally its custom segment
 * boundaries, in one atomic write. Refreshes `updatedAt` to the current time.
 *
 * @param token - The execution token for storage access.
 * @param id - The interlinearizer project UUID to update.
 * @param analysis - The new `TextAnalysis` to persist.
 * @param segmentation - The new boundary delta to persist (`SegmentationDelta`), `null` to clear
 *   any stored boundaries, or `undefined` to leave the project's existing boundaries unchanged.
 * @returns The updated project record, or `undefined` if no project with the given ID exists.
 * @throws {SyntaxError} If the project's storage value contains invalid JSON.
 * @throws If `papi.storage.readUserData` or `papi.storage.writeUserData` rejects for a non-ENOENT
 *   reason.
 */
export async function updateAnalysis(
  token: ExecutionToken,
  id: string,
  analysis: TextAnalysis,
  segmentation?: SegmentationDelta | null,
): Promise<InterlinearProject | undefined> {
  return enqueueProjectOp(id, async () => {
    const project = await getProject(token, id);
    if (!project) return undefined;
    const updated: InterlinearProject = {
      ...project,
      analysis,
      updatedAt: new Date().toISOString(),
    };
    // eslint-disable-next-line no-null/no-null -- null is the explicit "clear stored boundaries" sentinel
    if (segmentation === null) delete updated.segmentation;
    else if (segmentation !== undefined) updated.segmentation = segmentation;
    await papi.storage.writeUserData(token, projectKey(id), JSON.stringify(updated));
    return updated;
  });
}

/**
 * Updates the metadata of an existing interlinearizer project. Refreshes `updatedAt` to the current
 * time.
 *
 * @param token - The execution token for storage access.
 * @param id - The interlinearizer project UUID to update.
 * @param name - New user-facing name, or `undefined` to clear it.
 * @param description - New user-facing description, or `undefined` to clear it.
 * @param analysisLanguages - New BCP 47 analysis language tags. Required and must be non-empty;
 *   pass the current value to leave the field unchanged (it cannot be cleared).
 * @param targetProjectId - New target-project ID. `undefined` removes the target binding (the
 *   project becomes analysis-only); a string overwrites the existing value.
 * @returns The updated project record, or `undefined` if no project with the given ID exists.
 * @throws {SyntaxError} If the project's storage value contains invalid JSON.
 * @throws If `papi.storage.readUserData` or `papi.storage.writeUserData` rejects for a non-ENOENT
 *   reason.
 */
export async function updateProjectMetadata(
  token: ExecutionToken,
  id: string,
  name: string | undefined,
  description: string | undefined,
  analysisLanguages: string[],
  targetProjectId?: string,
): Promise<InterlinearProject | undefined> {
  return enqueueProjectOp(id, async () => {
    const project = await getProject(token, id);
    if (!project) return undefined;
    const updated: InterlinearProject = { ...project, updatedAt: new Date().toISOString() };
    if (name === undefined) {
      delete updated.name;
    } else {
      updated.name = name;
    }
    if (description === undefined) {
      delete updated.description;
    } else {
      updated.description = description;
    }
    updated.analysisLanguages = analysisLanguages;
    if (targetProjectId === undefined) {
      delete updated.targetProjectId;
    } else {
      updated.targetProjectId = targetProjectId;
    }
    await papi.storage.writeUserData(token, projectKey(id), JSON.stringify(updated));
    return updated;
  });
}

/**
 * Deletes the project with the given ID from storage and removes it from the index. No-ops silently
 * if the project does not exist.
 *
 * @throws {SyntaxError} If the `projectIds` storage value contains invalid JSON.
 * @throws {Error} If the stored `projectIds` value is not an array of strings (a corrupt index).
 * @throws If `papi.storage.readUserData` rejects for any non-ENOENT reason when reading the index.
 * @throws If `papi.storage.deleteUserData` throws for a reason other than ENOENT.
 * @throws If `papi.storage.writeUserData` rejects when updating `PROJECT_IDS_KEY`.
 */
export async function deleteProject(token: ExecutionToken, id: string): Promise<void> {
  await enqueueProjectOp(id, async () => {
    try {
      await papi.storage.deleteUserData(token, projectKey(id));
    } catch (e) {
      if (!isNotFound(e)) throw e;
    }
    await enqueueIndexOp(async () => {
      const ids = await readIds(token);
      const updated = ids.filter((i) => i !== id);
      await papi.storage.writeUserData(token, PROJECT_IDS_KEY, JSON.stringify(updated));
    });
  });
}

/**
 * Reads the draft working buffer for a source project, returning a fresh empty draft when none has
 * been written yet (ENOENT), when the stored draft fails validation, or when it belongs to a
 * different source project — the invalid draft is logged and silently discarded. Drafts are never
 * added to the `projectIds` index, so they stay out of {@link listProjects} and
 * {@link getProjectsForSource} and never appear in the project picker.
 *
 * @throws {SyntaxError} If the draft's storage value contains invalid JSON.
 * @throws If `papi.storage.readUserData` rejects for any non-ENOENT reason.
 */
export async function getDraft(
  token: ExecutionToken,
  sourceProjectId: string,
): Promise<DraftProject> {
  try {
    const parsed: unknown = JSON.parse(
      await papi.storage.readUserData(token, draftKey(sourceProjectId)),
    );
    if (!isDraftProject(parsed) || parsed.sourceProjectId !== sourceProjectId) {
      logger.warn('Interlinearizer: stored draft failed validation; resetting to empty draft');
      return emptyDraft(sourceProjectId);
    }
    return parsed;
  } catch (e) {
    if (isNotFound(e)) return emptyDraft(sourceProjectId);
    throw e;
  }
}

/**
 * Writes the draft working buffer for a source project, replacing any existing draft. Writes are
 * serialized per source project, so a WebView's rapid auto-saves cannot persist out of order. The
 * caller owns the whole envelope — including the `dirty` flag — so this function is a plain write
 * with no read-modify-merge.
 *
 * @throws If `papi.storage.writeUserData` rejects.
 */
export async function saveDraft(
  token: ExecutionToken,
  sourceProjectId: string,
  draft: DraftProject,
): Promise<void> {
  await enqueueSerialized(draftQueues, sourceProjectId, () =>
    papi.storage.writeUserData(token, draftKey(sourceProjectId), JSON.stringify(draft)),
  );
}

/**
 * Resets module-level queue state between tests. Jest's `resetMocks` resets mock implementations
 * but does not re-execute modules, so the serialization queues would otherwise persist across tests
 * and allow promise chains from one test to bleed into the next.
 */
export function resetQueuesForTesting(): void {
  indexQueue = Promise.resolve();
  pendingCleanupQueue = Promise.resolve();
  projectQueues.clear();
  draftQueues.clear();
}
