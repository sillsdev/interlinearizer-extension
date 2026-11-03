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

/** The projects the current store opened, closed after its test so the next may reopen them. */
let opened: Set<string>;

afterEach(async () => {
  await Promise.all(
    [...opened].map((projectId) =>
      papi.invoke(`command:${REPOSITORY_COMMAND_PREFIX}closeProject`, { projectId }),
    ),
  );
});

/** One store of host projects, each over its own database in a folder of its own. */
function createStore(): ConformanceStore {
  const directory = mkdtempSync(path.join(dataDirectory, 'store-'));
  opened = new Set();
  const open = async (sourceProjectId: string) => {
    if (!opened.has(sourceProjectId)) {
      await papi.invoke(`command:${REPOSITORY_COMMAND_PREFIX}openProject`, {
        projectId: sourceProjectId,
        dbPath: path.join(directory, `${sourceProjectId}.sqlite`),
      });
      opened.add(sourceProjectId);
    }
    return new CSharpRepository(
      (command, args) => papi.invoke(`command:${command}`, args),
      sourceProjectId,
      sourceProjectId,
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
