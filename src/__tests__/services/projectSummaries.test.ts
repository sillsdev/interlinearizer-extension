/// <reference types="jest" />

import type { InterlinearProject } from 'interlinearizer';
import { ProjectSummaries, summarizeProject } from '../../services/projectSummaries';
import type { KeyValueStorage } from '../../types/analysis-repository';
import { CURRENT_MODEL_VERSION } from '../../types/model-version';
import { FIXTURE_STAMPS, makeStubProject } from '../test-helpers';

const KEY = 'projectSummaries';

/** Storage held in a map, recording every write in order. */
function memoryStorage(initial: Record<string, string> = {}) {
  const records = new Map(Object.entries(initial));
  const writes: string[] = [];
  const storage: KeyValueStorage = {
    read: async (key) => records.get(key),
    write: async (key, data) => {
      writes.push(key);
      records.set(key, data);
    },
    delete: async (key) => {
      records.delete(key);
    },
  };
  return { storage, records, writes };
}

/** A project of `sourceProjectId` with one approved analysis in EXO and one in GEN. */
function analyzedProject(id: string, sourceProjectId = 'src-project'): InterlinearProject {
  const project = { ...makeStubProject(id), sourceProjectId };
  ['EXO', 'GEN'].forEach((book) => {
    project.analysis.tokenAnalyses.push({
      id: `ta-${book}`,
      ...FIXTURE_STAMPS,
      surfaceText: 'word',
      gloss: { en: 'gloss' },
    });
    project.analysis.tokenAnalysisLinks.push({
      id: `tl-${book}`,
      analysisId: `ta-${book}`,
      ...FIXTURE_STAMPS,
      status: 'approved',
      token: { tokenRef: `${book} 1:1!0`, surfaceText: 'word' },
    });
  });
  return project;
}

describe('ProjectSummaries', () => {
  it('lists nothing when no summaries are stored', async () => {
    const { storage } = memoryStorage();

    await expect(new ProjectSummaries(storage).list()).resolves.toEqual([]);
  });

  it('lists added projects in the order they were added', async () => {
    const summaries = new ProjectSummaries(memoryStorage().storage);
    await summaries.add(summarizeProject(makeStubProject('first')));
    await summaries.add(summarizeProject(makeStubProject('second')));

    expect((await summaries.list()).map(({ id }) => id)).toEqual(['first', 'second']);
  });

  it('stamps the model version this build writes', async () => {
    const { storage, records } = memoryStorage();
    await new ProjectSummaries(storage).add(summarizeProject(makeStubProject('p1')));

    expect(JSON.parse(records.get(KEY) ?? '{}').modelVersion).toBe(CURRENT_MODEL_VERSION);
  });

  it("lists only the given source's projects", async () => {
    const summaries = new ProjectSummaries(memoryStorage().storage);
    await summaries.add(summarizeProject(analyzedProject('a1', 'src-a')));
    await summaries.add(summarizeProject(analyzedProject('b1', 'src-b')));
    await summaries.add(summarizeProject(analyzedProject('a2', 'src-a')));

    expect((await summaries.listForSource('src-a')).map(({ id }) => id)).toEqual(['a1', 'a2']);
  });

  it("brings a listed project's summary up to date in place", async () => {
    const summaries = new ProjectSummaries(memoryStorage().storage);
    await summaries.add(summarizeProject(makeStubProject('first')));
    await summaries.add(summarizeProject(makeStubProject('second')));

    await summaries.replace(summarizeProject({ ...analyzedProject('first'), name: 'Renamed' }));

    expect(await summaries.list()).toEqual([
      expect.objectContaining({ id: 'first', name: 'Renamed', tokenAnalysisCount: 2 }),
      expect.objectContaining({ id: 'second' }),
    ]);
  });

  it('leaves a project that is not listed unlisted when replacing it', async () => {
    const { storage, writes } = memoryStorage();
    const summaries = new ProjectSummaries(storage);
    await summaries.add(summarizeProject(makeStubProject('listed')));

    await summaries.replace(summarizeProject(makeStubProject('unlisted')));

    expect((await summaries.list()).map(({ id }) => id)).toEqual(['listed']);
    expect(writes).toHaveLength(1);
  });

  it('answers true when replacing a listed project', async () => {
    const summaries = new ProjectSummaries(memoryStorage().storage);
    await summaries.add(summarizeProject(makeStubProject('listed')));

    await expect(summaries.replace(summarizeProject(makeStubProject('listed')))).resolves.toBe(
      true,
    );
  });

  it('answers false when replacing a project that is not listed', async () => {
    const summaries = new ProjectSummaries(memoryStorage().storage);

    await expect(summaries.replace(summarizeProject(makeStubProject('unlisted')))).resolves.toBe(
      false,
    );
  });

  it('unlists a removed project', async () => {
    const summaries = new ProjectSummaries(memoryStorage().storage);
    await summaries.add(summarizeProject(makeStubProject('kept')));
    await summaries.add(summarizeProject(makeStubProject('removed')));

    await summaries.remove('removed');

    expect((await summaries.list()).map(({ id }) => id)).toEqual(['kept']);
  });

  it('writes nothing when removing a project that is not listed', async () => {
    const { storage, writes } = memoryStorage();

    await new ProjectSummaries(storage).remove('missing');

    expect(writes).toEqual([]);
  });

  it('refuses summaries written by a newer build', async () => {
    const { storage } = memoryStorage({
      [KEY]: JSON.stringify({ modelVersion: CURRENT_MODEL_VERSION + 1, summaries: [] }),
    });

    await expect(new ProjectSummaries(storage).list()).rejects.toThrow('newer than this build');
  });

  it('leaves summaries written by a newer build unwritten', async () => {
    const { storage, writes } = memoryStorage({
      [KEY]: JSON.stringify({ modelVersion: CURRENT_MODEL_VERSION + 1, summaries: [] }),
    });

    await expect(
      new ProjectSummaries(storage).add(summarizeProject(makeStubProject('p1'))),
    ).rejects.toThrow();
    expect(writes).toEqual([]);
  });

  it('throws on summaries holding invalid JSON', async () => {
    const { storage } = memoryStorage({ [KEY]: '{ not json' });

    await expect(new ProjectSummaries(storage).list()).rejects.toThrow(SyntaxError);
  });

  it('throws on summaries carrying no model version', async () => {
    const { storage } = memoryStorage({ [KEY]: JSON.stringify({ summaries: [] }) });

    await expect(new ProjectSummaries(storage).list()).rejects.toThrow('is corrupt');
  });

  it('throws on summaries that are not a list', async () => {
    const { storage } = memoryStorage({
      [KEY]: JSON.stringify({ modelVersion: CURRENT_MODEL_VERSION, summaries: {} }),
    });

    await expect(new ProjectSummaries(storage).list()).rejects.toThrow('is corrupt');
  });

  it('throws on summaries holding an entry that is not a project summary', async () => {
    const { storage } = memoryStorage({
      [KEY]: JSON.stringify({ modelVersion: CURRENT_MODEL_VERSION, summaries: [{ id: 'p1' }] }),
    });

    await expect(new ProjectSummaries(storage).list()).rejects.toThrow('is corrupt');
  });

  it('leaves corrupt summaries unwritten', async () => {
    const { storage, writes } = memoryStorage({ [KEY]: 'null' });

    await expect(
      new ProjectSummaries(storage).add(summarizeProject(makeStubProject('p1'))),
    ).rejects.toThrow('is corrupt');
    expect(writes).toEqual([]);
  });
});

describe('summarizeProject', () => {
  it("describes a project's analysis by its books and payload count", () => {
    expect(summarizeProject(analyzedProject('p1'))).toEqual(
      expect.objectContaining({ id: 'p1', books: ['GEN', 'EXO'], tokenAnalysisCount: 2 }),
    );
  });

  it("carries no part of a project's analysis", () => {
    const summary = JSON.stringify(summarizeProject(analyzedProject('p1')));

    expect(summary).not.toContain('"analysis"');
    expect(summary).not.toContain('tokenAnalysisLinks');
  });
});
