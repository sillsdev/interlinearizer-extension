/// <reference types="jest" />

import { mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { CSharpRepository, REPOSITORY_COMMAND_PREFIX } from '../../services/csharpRepository';
import {
  describeAnalysisRepositoryConformance,
  type ConformanceStore,
} from '../analysis-repository-conformance';
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

/** The sources the current store opened on the host, closed after its test. */
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
 * One store of host projects. The host keeps a database per source for the life of the run, so each
 * store names its sources after itself and no store sees what an earlier one stored; the name only
 * stamps the draft read whole, which the groups opted into never compare. Each source holds one
 * project, under an id minted for it, since the host's project ids are GUIDs.
 */
function createStore(): ConformanceStore {
  storeCount += 1;
  const sourceOnHost = (sourceProjectId: string) => `store-${storeCount}-${sourceProjectId}`;
  opened = new Set();
  const projectIds = new Map<string, string>();
  const open = async (sourceProjectId: string) => {
    const source = sourceOnHost(sourceProjectId);
    let projectId = projectIds.get(source);
    if (projectId === undefined) {
      projectId = crypto.randomUUID();
      projectIds.set(source, projectId);
      await papi.invoke(`command:${REPOSITORY_COMMAND_PREFIX}openSource`, {
        sourceProjectId: source,
      });
      opened.add(source);
      await papi.invoke(`command:${REPOSITORY_COMMAND_PREFIX}createProject`, {
        sourceProjectId: source,
        projectId,
      });
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
        segmentAnalyses: { puts: analysis.segmentAnalyses, deletes: [] },
        segmentAnalysisLinks: { puts: analysis.segmentAnalysisLinks, deletes: [] },
        tokenAnalyses: { puts: analysis.tokenAnalyses, deletes: [] },
        tokenAnalysisLinks: { puts: analysis.tokenAnalysisLinks, deletes: [] },
        phraseAnalyses: { puts: analysis.phraseAnalyses, deletes: [] },
        phraseAnalysisLinks: { puts: analysis.phraseAnalysisLinks, deletes: [] },
      });
    },
    readAll: async (sourceProjectId) => (await (await open(sourceProjectId)).exportAll()).draft,
  };
}

describeAnalysisRepositoryConformance('CSharpRepository', [], createStore);
