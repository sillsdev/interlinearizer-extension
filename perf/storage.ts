import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import type { DraftProject, InterlinearProject } from 'interlinearizer';
import path from 'path';
import type { KeyValueStorage } from '../src/types/analysis-repository';
import { DraftRepository } from '../src/services/draftRepository';
import { projectKey } from '../src/services/storageKeys';
import { CURRENT_MODEL_VERSION } from '../src/types/model-version';

/** Key of the index listing every saved project's id. */
const PROJECT_IDS_KEY = 'projectIds';

function isNotFound(e: unknown): boolean {
  return !!e && typeof e === 'object' && 'code' in e && e.code === 'ENOENT';
}

/**
 * The extension's user data in `dir`, laid out as the platform stores it: one file per key, named
 * by the key's base64url encoding.
 */
export function fileStorage(dir: string): KeyValueStorage {
  const fileOf = (key: string) => path.join(dir, Buffer.from(key, 'utf-8').toString('base64url'));
  return {
    async read(key) {
      try {
        return await fs.readFile(fileOf(key), 'utf-8');
      } catch (e) {
        if (isNotFound(e)) return undefined;
        throw e;
      }
    },
    async write(key, data) {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(fileOf(key), data);
    },
    async delete(key) {
      await fs.rm(fileOf(key), { force: true });
    },
  };
}

/**
 * Reads a source project's draft from the extension storage in `dir` as the app would load it.
 *
 * @throws If the stored draft was written by a newer build, or a stored record cannot be read.
 */
export async function readDraft(dir: string, sourceProjectId: string): Promise<DraftProject> {
  return new DraftRepository(fileStorage(dir), sourceProjectId, console).exportAll();
}

/**
 * Writes a draft to the extension storage in `dir` as the app would save it. An app running over
 * `dir` sees it from its next load of that draft.
 *
 * @throws If the stored draft was written by a newer build, or a record cannot be written.
 */
export async function writeDraft(dir: string, draft: DraftProject): Promise<void> {
  await new DraftRepository(fileStorage(dir), draft.sourceProjectId, console).replaceAll(draft);
}

/**
 * Adds a saved project holding `draft`'s analysis and analysis languages to the extension storage
 * in `dir`.
 *
 * @returns The new project's id.
 * @throws If the project index is not an array of ids, or a record cannot be read or written.
 */
export async function addSavedProject(
  dir: string,
  draft: DraftProject,
  name: string,
): Promise<string> {
  const storage = fileStorage(dir);
  const now = new Date().toISOString();
  const project: InterlinearProject = {
    id: randomUUID(),
    modelVersion: CURRENT_MODEL_VERSION,
    createdAt: now,
    updatedAt: now,
    name,
    sourceProjectId: draft.sourceProjectId,
    analysisLanguages: draft.analysisLanguages,
    analysis: draft.analysis,
  };
  await storage.write(projectKey(project.id), JSON.stringify(project));
  const index: unknown = JSON.parse((await storage.read(PROJECT_IDS_KEY)) ?? '[]');
  if (!Array.isArray(index)) throw new Error(`${PROJECT_IDS_KEY} is not an array of ids`);
  await storage.write(PROJECT_IDS_KEY, JSON.stringify([...index, project.id]));
  return project.id;
}
