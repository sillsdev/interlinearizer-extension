/// <reference types="jest" />

import { existsSync, mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import type { TokenAnalysis } from 'interlinearizer';
import { CSharpRepository, REPOSITORY_COMMAND_PREFIX } from '../../services/csharpRepository';
import { FIXTURE_STAMPS } from '../test-helpers';
import { FakePapi } from './fake-papi';

let dataDirectory: string;
let papi: FakePapi;

beforeAll(async () => {
  dataDirectory = mkdtempSync(path.join(os.tmpdir(), 'i13r-projects-'));
  papi = await FakePapi.start(dataDirectory);
}, 60_000);

afterAll(async () => {
  await papi.stop();
  rmSync(dataDirectory, { recursive: true, force: true });
});

/** Sends one of the host's repository commands. */
function command<T = void>(method: string, args: object): Promise<T> {
  return papi.invoke<T>(`command:${REPOSITORY_COMMAND_PREFIX}${method}`, args);
}

/** A project as `listProjects` answers it. */
type ListedProject = {
  id: string;
  name?: string;
  description?: string;
  targetProjectId?: string;
  analysisLanguages: string[];
  createdAt: string;
  updatedAt: string;
};

function repositoryFor(sourceProjectId: string, projectId: string): CSharpRepository {
  return new CSharpRepository(
    (name, args) => papi.invoke(`command:${name}`, args),
    sourceProjectId,
    projectId,
  );
}

/** Stores one token analysis in the repository's project and answers its id. */
async function seedToken(repository: CSharpRepository): Promise<string> {
  const put: TokenAnalysis = { id: crypto.randomUUID(), ...FIXTURE_STAMPS, surfaceText: 'and' };
  await repository.apply({ intent: 'seed', tokenAnalyses: { puts: [put], deletes: [] } });
  return put.id;
}

/** The ids of the token analyses the repository serves among `ids`. */
async function tokensHeld(repository: CSharpRepository, ids: string[]): Promise<string[]> {
  return (await repository.getTokenAnalyses(ids)).map((t) => t.id);
}

describe('the host over one source', () => {
  it('keeps the source in its data directory, under the sources folder', async () => {
    await command('openSource', { sourceProjectId: 'source-folder' });

    expect(existsSync(path.join(dataDirectory, 'sources', 'source-folder.sqlite'))).toBe(true);
  });

  it('refuses a source whose id cannot name a file', async () => {
    await expect(command('openSource', { sourceProjectId: 'a/b' })).rejects.toThrow('cannot');
    await expect(command('openSource', { sourceProjectId: '' })).rejects.toThrow('cannot');
  });

  it('serves no project of a source not open', async () => {
    await expect(command('listProjects', { sourceProjectId: 'never-opened' })).rejects.toThrow(
      'not open',
    );
  });

  it('holds several projects, each with its own records', async () => {
    const source = 'source-projects';
    await command('openSource', { sourceProjectId: source });
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    await command('createProject', {
      sourceProjectId: source,
      projectId: a,
      name: 'A',
      description: 'The first',
      targetProjectId: 'target',
      analysisLanguages: ['en', 'fr'],
    });
    await command('createProject', { sourceProjectId: source, projectId: b, name: 'B' });
    const tokenA = await seedToken(repositoryFor(source, a));
    const tokenB = await seedToken(repositoryFor(source, b));

    const listed = await command<ListedProject[]>('listProjects', { sourceProjectId: source });
    expect(listed.map((p) => p.name).sort()).toStrictEqual(['A', 'B']);
    const projectA = listed.find((p) => p.id === a);
    expect(projectA).toMatchObject({
      name: 'A',
      description: 'The first',
      targetProjectId: 'target',
      analysisLanguages: ['en', 'fr'],
    });
    expect(projectA?.createdAt).toBe(projectA?.updatedAt);
    await expect(tokensHeld(repositoryFor(source, a), [tokenA, tokenB])).resolves.toStrictEqual([
      tokenA,
    ]);
    await expect(tokensHeld(repositoryFor(source, b), [tokenA, tokenB])).resolves.toStrictEqual([
      tokenB,
    ]);
  });

  it('refuses to create a project under an id in use', async () => {
    const source = 'source-reused-id';
    await command('openSource', { sourceProjectId: source });
    const a = crypto.randomUUID();
    await command('createProject', { sourceProjectId: source, projectId: a });

    await expect(
      command('createProject', { sourceProjectId: source, projectId: a }),
    ).rejects.toThrow('already been stored');
  });

  it('updates the fields a patch sets and the languages it adds and removes', async () => {
    const source = 'source-update';
    await command('openSource', { sourceProjectId: source });
    const a = crypto.randomUUID();
    await command('createProject', {
      sourceProjectId: source,
      projectId: a,
      name: 'A',
      description: 'The first',
      targetProjectId: 'target',
      analysisLanguages: ['en', 'fr'],
    });

    await command('updateProject', {
      sourceProjectId: source,
      projectId: a,
      name: 'A again',
      // A null on the wire clears the field; leaving it out would leave the field alone.
      // eslint-disable-next-line no-null/no-null
      targetProjectId: null,
      addedAnalysisLanguages: ['de'],
      removedAnalysisLanguages: ['fr'],
    });

    const [listed] = await command<ListedProject[]>('listProjects', { sourceProjectId: source });
    expect(listed).toMatchObject({
      name: 'A again',
      description: 'The first',
      analysisLanguages: ['en', 'de'],
    });
    expect(listed.targetProjectId).toBeUndefined();
  });

  it('deletes a project with its records, serving it no longer', async () => {
    const source = 'source-delete';
    await command('openSource', { sourceProjectId: source });
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    await command('createProject', { sourceProjectId: source, projectId: a });
    await command('createProject', { sourceProjectId: source, projectId: b });
    const tokenA = await seedToken(repositoryFor(source, a));
    await seedToken(repositoryFor(source, b));

    await command('deleteProject', { sourceProjectId: source, projectId: b });

    const listed = await command<ListedProject[]>('listProjects', { sourceProjectId: source });
    expect(listed.map((p) => p.id)).toStrictEqual([a]);
    await expect(repositoryFor(source, b).findLinkedBooks()).rejects.toThrow('not stored');
    await expect(tokensHeld(repositoryFor(source, a), [tokenA])).resolves.toStrictEqual([tokenA]);
  });

  it('keeps its projects and their records across a close and reopen', async () => {
    const source = 'source-reopen';
    await command('openSource', { sourceProjectId: source });
    const a = crypto.randomUUID();
    await command('createProject', { sourceProjectId: source, projectId: a, name: 'A' });
    const tokenA = await seedToken(repositoryFor(source, a));

    await command('closeSource', { sourceProjectId: source });
    await expect(command('listProjects', { sourceProjectId: source })).rejects.toThrow('not open');
    await command('openSource', { sourceProjectId: source });

    const listed = await command<ListedProject[]>('listProjects', { sourceProjectId: source });
    expect(listed.map((p) => p.name)).toStrictEqual(['A']);
    await expect(tokensHeld(repositoryFor(source, a), [tokenA])).resolves.toStrictEqual([tokenA]);
  });
});
