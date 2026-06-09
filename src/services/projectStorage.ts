import papi, { logger } from '@papi/backend';
import type { ExecutionToken } from '@papi/core';
import type { InterlinearProject, TextAnalysis } from 'interlinearizer';
import { emptyAnalysis } from '../types/emptyFactories';

const PROJECT_IDS_KEY = 'projectIds';

/**
 * Serializes all read-modify-write operations on the shared `projectIds` index. Every operation
 * that reads then writes the index must be enqueued here so concurrent calls (e.g. from two open
 * WebView tabs) cannot interleave at await boundaries and silently overwrite each other's updates.
 */
let indexQueue: Promise<unknown> = Promise.resolve();

/**
 * Per-project serialization queues. Keyed by project ID; each entry serializes all
 * read-modify-write operations on that project's storage record so concurrent update and delete
 * calls cannot interleave and create orphaned or stale records.
 */
const projectQueues = new Map<string, Promise<unknown>>();

/**
 * Enqueues `fn` on the index serialization queue and returns a promise that resolves or rejects
 * with `fn`'s result. The queue always advances regardless of whether `fn` throws.
 *
 * @param fn - The async function to serialize.
 * @returns A promise that resolves or rejects with the return value of `fn`.
 * @throws Whatever `fn` throws; the queue advances past the error so later operations are not
 *   blocked.
 */
function enqueueIndexOp<T>(fn: () => Promise<T>): Promise<T> {
  const result = indexQueue.then(fn);
  indexQueue = result.catch(() => {});
  return result;
}

/**
 * Enqueues `fn` on the per-project serialization queue for `id` and returns a promise that resolves
 * or rejects with `fn`'s result. Cleans up the queue entry when the operation settles.
 *
 * @param id - The project UUID whose queue `fn` should join.
 * @param fn - The async function to serialize.
 * @returns A promise that resolves or rejects with the return value of `fn`.
 * @throws Whatever `fn` throws; the queue entry is removed and the rejection propagates to the
 *   caller.
 */
function enqueueProjectOp<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const previous = projectQueues.get(id) ?? Promise.resolve();
  const result = previous.then(fn);
  let settled: Promise<void>;
  const cleanup = () => {
    if (projectQueues.get(id) === settled) projectQueues.delete(id);
  };
  settled = result.then(cleanup, cleanup);
  projectQueues.set(id, settled);
  return result;
}

/**
 * Returns the storage key for a project by ID.
 *
 * @param id - The project UUID.
 * @returns The storage key string used to read and write the project record.
 */
function projectKey(id: string): string {
  return `project:${id}`;
}

/**
 * Returns true when `e` is a file-not-found error (ENOENT) from the Node.js file system, which is
 * what `papi.storage.readUserData` throws when the requested key has never been written.
 *
 * @param e - The caught value.
 * @returns Whether the error represents a missing storage key.
 */
function isNotFound(e: unknown): boolean {
  return !!e && typeof e === 'object' && 'code' in e && e.code === 'ENOENT';
}

/**
 * Reads the stored list of project IDs.
 *
 * @param token - The execution token for storage access.
 * @returns The stored project ID array, or an empty array if `projectIds` has never been written
 *   (ENOENT).
 * @throws {SyntaxError} If the `projectIds` storage value contains invalid JSON.
 * @throws If `papi.storage.readUserData` rejects for any non-ENOENT reason (e.g. permission denied,
 *   I/O error).
 */
async function readIds(token: ExecutionToken): Promise<string[]> {
  try {
    return JSON.parse(await papi.storage.readUserData(token, PROJECT_IDS_KEY));
  } catch (e) {
    if (isNotFound(e)) return [];
    throw e;
  }
}

/**
 * Creates a new interlinearizer project with empty analysis data and writes it to extension
 * storage. Appends the project ID to the stored index.
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
 * @returns The newly created project record.
 * @throws {SyntaxError} If the `projectIds` storage value contains invalid JSON.
 * @throws If `papi.storage.writeUserData` (project or index) or rollback via
 *   `papi.storage.deleteUserData` rejects for a non-ENOENT reason.
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
  const project: InterlinearProject = {
    id,
    createdAt: new Date().toISOString(),
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
    }
    throw indexError;
  }

  return project;
}

/**
 * Returns the project with the given ID.
 *
 * @param token - The execution token for storage access.
 * @param id - The project UUID.
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
 * @param token - The execution token for storage access.
 * @returns All stored projects, ordered by creation time.
 * @throws {SyntaxError} If `projectIds` contains invalid JSON.
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
 * @param token - The execution token for storage access.
 * @param sourceProjectId - The Platform.Bible project ID to filter by.
 * @returns All projects for the given source, ordered by creation time.
 * @throws {SyntaxError} If `projectIds` or any project's storage value contains invalid JSON.
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
 * Replaces the analysis of an existing interlinearizer project.
 *
 * @param token - The execution token for storage access.
 * @param id - The interlinearizer project UUID to update.
 * @param analysis - The new `TextAnalysis` to persist.
 * @returns The updated project record, or `undefined` if no project with the given ID exists.
 * @throws {SyntaxError} If the project's storage value contains invalid JSON.
 * @throws If `papi.storage.readUserData` or `papi.storage.writeUserData` rejects for a non-ENOENT
 *   reason.
 */
export async function updateAnalysis(
  token: ExecutionToken,
  id: string,
  analysis: TextAnalysis,
): Promise<InterlinearProject | undefined> {
  return enqueueProjectOp(id, async () => {
    const project = await getProject(token, id);
    if (!project) return undefined;
    const updated: InterlinearProject = { ...project, analysis };
    await papi.storage.writeUserData(token, projectKey(id), JSON.stringify(updated));
    return updated;
  });
}

/**
 * Updates the metadata of an existing interlinearizer project.
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
    const updated: InterlinearProject = { ...project };
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
 * @param token - The execution token for storage access.
 * @param id - The project UUID to delete.
 * @throws {SyntaxError} If the `projectIds` storage value contains invalid JSON (from
 *   {@link readIds}).
 * @throws If `papi.storage.deleteUserData` throws for a reason other than ENOENT.
 * @throws If `papi.storage.writeUserData` rejects when updating `PROJECT_IDS_KEY`.
 * @throws Any error propagated from {@link readIds}, {@link enqueueProjectOp}, or
 *   {@link enqueueIndexOp}.
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
 * Resets module-level queue state between tests. Jest's `resetMocks` resets mock implementations
 * but does not re-execute modules, so `indexQueue` and `projectQueues` would otherwise persist
 * across tests and allow promise chains from one test to bleed into the next.
 */
export function resetQueuesForTesting(): void {
  indexQueue = Promise.resolve();
  projectQueues.clear();
}
