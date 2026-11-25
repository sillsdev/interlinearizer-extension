/// <reference types="jest" />

import { mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import type { TokenAnalysis } from 'interlinearizer';
import { CSharpRepository, REPOSITORY_COMMAND_PREFIX } from '../../services/csharpRepository';
import { EditHistory } from '../../services/editHistory';
import {
  describeAnalysisRepositoryConformance,
  type ConformanceStore,
} from '../analysis-repository-conformance';
import { creating, deleting, FIXTURE_STAMPS, makeTokenLink, updating } from '../test-helpers';
import { FakePapi } from './fake-papi';

let dataDirectory: string;
let papi: FakePapi;

beforeAll(async () => {
  dataDirectory = mkdtempSync(path.join(os.tmpdir(), 'i13r-conformance-'));
  papi = await FakePapi.start(dataDirectory);
}, 60_000);

afterAll(async () => {
  await papi.stop();
  rmSync(dataDirectory, { recursive: true, force: true });
});

/** The sources the current store had the host open, closed after its test. */
let opened: Set<string>;

afterEach(async () => {
  await Promise.all(
    [...opened].map((sourceProjectId) =>
      papi.invoke(`command:${REPOSITORY_COMMAND_PREFIX}closeSource`, { sourceProjectId }),
    ),
  );
});

let storeCount = 0;

/**
 * One store of host projects. The host keeps a database per source for the life of the run. Each
 * store names its sources after itself, so no store sees what an earlier one stored. The name only
 * stamps the draft read whole, which the groups opted into never compare. Each source holds one
 * project, under an id minted for it, because the host's project ids are GUIDs.
 */
function createStore(): ConformanceStore {
  storeCount += 1;
  const store = storeCount;
  const sourceOnHost = (sourceProjectId: string) => `store-${store}-${sourceProjectId}`;
  const storeOpened = new Set<string>();
  opened = storeOpened;
  const projectIds = new Map<string, string>();
  const open = async (sourceProjectId: string) => {
    const source = sourceOnHost(sourceProjectId);
    let projectId = projectIds.get(source);
    if (projectId === undefined) {
      projectId = crypto.randomUUID();
      projectIds.set(source, projectId);
      await papi.invoke(`command:${REPOSITORY_COMMAND_PREFIX}createProject`, {
        sourceProjectId: source,
        projectId,
      });
      storeOpened.add(source);
    }
    return new CSharpRepository(
      (command, args) => papi.invoke(`command:${command}`, args),
      source,
      projectId,
    );
  };
  return {
    open,
    seed: async (sourceProjectId, { analysis }) => {
      await (
        await open(sourceProjectId)
      ).apply({
        intent: 'seed',
        segmentAnalyses: creating(analysis.segmentAnalyses),
        segmentAnalysisLinks: creating(analysis.segmentAnalysisLinks),
        tokenAnalyses: creating(analysis.tokenAnalyses),
        tokenAnalysisLinks: creating(analysis.tokenAnalysisLinks),
        phraseAnalyses: creating(analysis.phraseAnalyses),
        phraseAnalysisLinks: creating(analysis.phraseAnalysisLinks),
      });
    },
    readAll: async (sourceProjectId) => (await (await open(sourceProjectId)).exportAll()).draft,
  };
}

describeAnalysisRepositoryConformance('CSharpRepository', ['undo'], createStore);

describe('EditHistory over CSharpRepository', () => {
  const analysis: TokenAnalysis = {
    id: crypto.randomUUID(),
    ...FIXTURE_STAMPS,
    surfaceText: 'beginning',
    gloss: { en: 'start' },
  };
  const link = makeTokenLink(analysis.id, 'GEN 1:1:9', { id: crypto.randomUUID() });

  /** A history over a host project holding `analysis` and `link`. */
  async function overLinkedAnalysis() {
    const store = createStore();
    const repository = await store.open('source');
    await repository.apply({
      intent: 'seed',
      tokenAnalyses: creating([analysis]),
      tokenAnalysisLinks: creating([link]),
    });
    return { history: new EditHistory(repository), repository };
  }

  it('undoes an edit, returning the analysis as it was', async () => {
    const { history, repository } = await overLinkedAnalysis();
    await history.apply({
      intent: 'gloss',
      tokenAnalyses: updating({
        before: analysis,
        after: { ...analysis, gloss: { en: 'origin' } },
      }),
    });

    await history.undo();

    const [stored] = await repository.getTokenAnalyses([analysis.id]);
    expect(stored.gloss).toStrictEqual({ en: 'start' });
  });

  it('redoes an undone edit', async () => {
    const { history, repository } = await overLinkedAnalysis();
    await history.apply({
      intent: 'gloss',
      tokenAnalyses: updating({
        before: analysis,
        after: { ...analysis, gloss: { en: 'origin' } },
      }),
    });
    await history.undo();

    await history.redo();

    const [stored] = await repository.getTokenAnalyses([analysis.id]);
    expect(stored.gloss).toStrictEqual({ en: 'origin' });
  });

  it('undoes an analysis delete, bringing back the links it took', async () => {
    const { history, repository } = await overLinkedAnalysis();
    await history.apply({ intent: 'delete', tokenAnalyses: deleting([analysis]) });

    await history.undo();

    const { tokenAnalysisLinks } = await repository.findLinksToAnalyses([analysis.id]);
    expect(tokenAnalysisLinks.map(({ id }) => id)).toStrictEqual([link.id]);
  });
});
