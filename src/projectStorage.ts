import papi from '@papi/backend';
import type { ExecutionToken } from '@papi/core';
import type { InterlinearProject, TextAnalysis } from 'interlinearizer';

const PROJECT_IDS_KEY = 'projectIds';

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
 * @returns The stored project ID array, or an empty array if `projectIds` has never been written.
 * @throws {SyntaxError} If the `projectIds` storage value contains invalid JSON.
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
 * @param targetProjectId - The Platform.Bible project ID of the target text.
 * @param analysisWritingSystem - The BCP 47 writing-system code used for analysis strings.
 * @returns The newly created project record.
 * @throws {SyntaxError} If the `projectIds` storage value contains invalid JSON.
 */
export async function createProject(
  token: ExecutionToken,
  sourceProjectId: string,
  targetProjectId: string,
  analysisWritingSystem: string,
): Promise<InterlinearProject> {
  const id = crypto.randomUUID();
  const project: InterlinearProject = {
    id,
    createdAt: new Date().toISOString(),
    sourceProjectId,
    targetProjectId,
    analysisWritingSystem,
    sourceAnalysis: emptyAnalysis(),
    targetAnalysis: emptyAnalysis(),
    links: [],
  };

  const ids = await readIds(token);
  await papi.storage.writeUserData(token, projectKey(id), JSON.stringify(project));
  await papi.storage.writeUserData(token, PROJECT_IDS_KEY, JSON.stringify([...ids, id]));

  return project;
}

/**
 * Returns the project with the given ID.
 *
 * @param token - The execution token for storage access.
 * @param id - The project UUID.
 * @returns The project record, or `undefined` if it does not exist in storage.
 * @throws {SyntaxError} If the project's storage value contains invalid JSON.
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
 */
export async function listProjects(token: ExecutionToken): Promise<InterlinearProject[]> {
  const ids = await readIds(token);
  const projects = await Promise.all(ids.map((id) => getProject(token, id)));
  return projects.filter((p): p is InterlinearProject => p !== undefined);
}

/**
 * Deletes the project with the given ID from storage and removes it from the index. No-ops silently
 * if the project does not exist.
 *
 * @param token - The execution token for storage access.
 * @param id - The project UUID to delete.
 * @throws {SyntaxError} If the `projectIds` storage value contains invalid JSON.
 */
export async function deleteProject(token: ExecutionToken, id: string): Promise<void> {
  try {
    await papi.storage.deleteUserData(token, projectKey(id));
  } catch (e) {
    if (!isNotFound(e)) throw e;
  }
  const ids = await readIds(token);
  const updated = ids.filter((i) => i !== id);
  await papi.storage.writeUserData(token, PROJECT_IDS_KEY, JSON.stringify(updated));
}
