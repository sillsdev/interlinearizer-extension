import papi, { logger } from '@papi/backend';
import type { ExecutionToken } from '@papi/core';
import type { AlignmentLink, InterlinearProject, TextAnalysis } from 'interlinearizer';

const PROJECT_IDS_KEY = 'projectIds';

/**
 * Serializes all read-modify-write operations on the shared `projectIds` index. Every operation
 * that reads then writes the index must be enqueued here so concurrent calls (e.g. from two open
 * WebView tabs) cannot interleave at await boundaries and silently overwrite each other's updates.
 */
let indexQueue: Promise<unknown> = Promise.resolve();

/**
 * Enqueues `fn` on the index serialization queue and returns a promise that resolves or rejects
 * with `fn`'s result. The queue always advances regardless of whether `fn` throws.
 *
 * @param fn - The async function to serialize.
 * @returns A promise that resolves or rejects with the return value of `fn`.
 */
function enqueueIndexOp<T>(fn: () => Promise<T>): Promise<T> {
  const result = indexQueue.then(fn);
  indexQueue = result.catch(() => {});
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
 * Returns a `TextAnalysis` with empty collections for all three analysis arrays.
 *
 * @returns A new, empty `TextAnalysis` object.
 */
function emptyAnalysis(): TextAnalysis {
  return { segmentAnalyses: [], tokenAnalyses: [], phrases: [] };
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
 * @param analysisLanguages - BCP 47 tags for all languages used in glosses and annotations.
 * @param targetProjectId - Optional Platform.Bible project ID of the target text. Set for bilateral
 *   alignment projects (e.g. BT Extension) so that `AlignmentLink.targetEndpoints` can be resolved
 *   at runtime.
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
    links: [],
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
 * after a failed delete) are silently omitted.
 *
 * @param token - The execution token for storage access.
 * @returns All stored projects, ordered by creation time.
 * @throws {SyntaxError} If `projectIds` or any project's storage value contains invalid JSON.
 * @throws If `papi.storage.readUserData` rejects for any non-ENOENT reason.
 */
export async function listProjects(token: ExecutionToken): Promise<InterlinearProject[]> {
  const ids = await readIds(token);
  const projects = await Promise.all(ids.map((id) => getProject(token, id)));
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
 * Updates the metadata of an existing interlinearizer project.
 *
 * @param token - The execution token for storage access.
 * @param id - The interlinearizer project UUID to update.
 * @param name - New user-facing name, or `undefined` to clear it.
 * @param description - New user-facing description, or `undefined` to clear it.
 * @param analysisLanguages - New BCP 47 analysis language tags. Must be a non-empty array; pass the
 *   current value to leave it unchanged. The field is required and cannot be cleared.
 * @param targetProjectId - New target-project ID, or `undefined` to clear it (removes the
 *   target-side text binding).
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
}

/**
 * Writes updated `analysis` and `links` back to storage for an existing project, leaving all
 * metadata fields untouched. This is the designated save path for annotation and alignment
 * mutations; use {@link updateProjectMetadata} for name / description / writing-system changes.
 *
 * @param token - The execution token for storage access.
 * @param id - The interlinearizer project UUID to update.
 * @param analysis - The updated analysis layer to persist.
 * @param links - The updated alignment links to persist.
 * @returns The updated project record, or `undefined` if no project with the given ID exists.
 * @throws {SyntaxError} If the project's storage value contains invalid JSON.
 * @throws If `papi.storage.readUserData` or `papi.storage.writeUserData` rejects for a non-ENOENT
 *   reason.
 */
export async function saveProjectAnalysis(
  token: ExecutionToken,
  id: string,
  analysis: TextAnalysis,
  links: AlignmentLink[],
): Promise<InterlinearProject | undefined> {
  const project = await getProject(token, id);
  if (!project) return undefined;
  const updated: InterlinearProject = { ...project, analysis, links };
  await papi.storage.writeUserData(token, projectKey(id), JSON.stringify(updated));
  return updated;
}

/**
 * Deletes the project with the given ID from storage and removes it from the index.
 *
 * @param token - The execution token for storage access.
 * @param id - The project UUID to delete.
 * @throws {RangeError} If the ID is not present in the stored index.
 * @throws {SyntaxError} If the `projectIds` storage value contains invalid JSON.
 * @throws If `papi.storage.readUserData` rejects for a non-ENOENT reason (e.g. the index is
 *   missing) or `papi.storage.writeUserData` rejects when updating the index.
 * @throws If `papi.storage.deleteUserData` rejects for a non-ENOENT reason.
 */
export async function deleteProject(token: ExecutionToken, id: string): Promise<void> {
  await enqueueIndexOp(async () => {
    const ids: string[] = JSON.parse(await papi.storage.readUserData(token, PROJECT_IDS_KEY));
    if (!ids.includes(id)) throw new RangeError(`Project not found in index: ${id}`);
    await papi.storage.writeUserData(
      token,
      PROJECT_IDS_KEY,
      JSON.stringify(ids.filter((i) => i !== id)),
    );
  });
  try {
    await papi.storage.deleteUserData(token, projectKey(id));
  } catch (e) {
    if (!isNotFound(e)) throw e;
  }
}
