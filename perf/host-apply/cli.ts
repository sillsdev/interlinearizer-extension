/* eslint-disable no-console -- a command-line tool reports to its terminal */
import type { DraftProject, TokenAnalysis } from 'interlinearizer';
import { mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { performance } from 'perf_hooks';
import { CSharpRepository, REPOSITORY_COMMAND_PREFIX } from '../../src/services/csharpRepository';
import type { ChangeSet } from '../../src/types/analysis-repository';
import { FakePapi } from '../../src/__tests__/c-sharp-host/fake-papi';
import { summarize, type Timing } from '../bench/measure';
import { readDraftJson, readManifest } from '../dataset/store';
import { provenance, writeResults } from '../results';
import { readCaptureMeta } from '../usj-cache';

const RUNS = Number(process.env.PERF_RUNS ?? 10);
const WARMUP = 2;
/** Records per seeding apply, so no one message or commit holds a whole tier. */
const SEED_CHUNK = 5000;

/** A repository over a new project in its own source on the host. */
async function openProject(papi: FakePapi, sourceProjectId: string): Promise<CSharpRepository> {
  const projectId = crypto.randomUUID();
  await papi.invoke(`command:${REPOSITORY_COMMAND_PREFIX}createProject`, {
    sourceProjectId,
    projectId,
  });
  return new CSharpRepository(
    (command, args) => papi.invoke(`command:${command}`, args),
    sourceProjectId,
    projectId,
  );
}

function chunks<T>(records: T[]): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < records.length; i += SEED_CHUNK)
    result.push(records.slice(i, i + SEED_CHUNK));
  return result;
}

/** Stores the draft's analysis, its analyses before the links that name them. */
async function seed(repository: CSharpRepository, draft: DraftProject): Promise<void> {
  const { analysis } = draft;
  const creating = <T>(records: T[]) => ({ creates: records, updates: [], deletes: [] });
  const sets: ChangeSet[] = [
    ...chunks(analysis.segmentAnalyses).map((r) => ({
      intent: 'seed',
      segmentAnalyses: creating(r),
    })),
    ...chunks(analysis.tokenAnalyses).map((r) => ({ intent: 'seed', tokenAnalyses: creating(r) })),
    ...chunks(analysis.phraseAnalyses).map((r) => ({
      intent: 'seed',
      phraseAnalyses: creating(r),
    })),
    ...chunks(analysis.segmentAnalysisLinks).map((r) => ({
      intent: 'seed',
      segmentAnalysisLinks: creating(r),
    })),
    ...chunks(analysis.tokenAnalysisLinks).map((r) => ({
      intent: 'seed',
      tokenAnalysisLinks: creating(r),
    })),
    ...chunks(analysis.phraseAnalysisLinks).map((r) => ({
      intent: 'seed',
      phraseAnalysisLinks: creating(r),
    })),
  ];
  // eslint-disable-next-line no-restricted-syntax -- links must follow the analyses they name
  for (const changes of sets) {
    // eslint-disable-next-line no-await-in-loop -- links must follow the analyses they name
    await repository.apply(changes);
  }
}

/**
 * Times creating an unlinked token analysis, then deleting it, so that a delete's cost can be read
 * against a create's.
 */
async function timeCreateAndDelete(
  repository: CSharpRepository,
  template: TokenAnalysis,
): Promise<Record<string, Timing>> {
  const creates: number[] = [];
  const deletes: number[] = [];
  for (let i = 0; i < WARMUP + RUNS; i += 1) {
    const analysis: TokenAnalysis = { ...template, id: crypto.randomUUID() };
    let started = performance.now();
    // eslint-disable-next-line no-await-in-loop -- each run is timed on its own
    await repository.apply({
      intent: 'create',
      tokenAnalyses: { creates: [analysis], updates: [], deletes: [] },
    });
    const created = performance.now() - started;
    started = performance.now();
    // eslint-disable-next-line no-await-in-loop -- each run is timed on its own
    await repository.apply({
      intent: 'delete',
      tokenAnalyses: { creates: [], updates: [], deletes: [analysis] },
    });
    const deleted = performance.now() - started;
    if (i >= WARMUP) {
      creates.push(created);
      deletes.push(deleted);
    }
  }
  return { createUnlinked: summarize(creates), deleteUnlinked: summarize(deletes) };
}

function report(name: string, links: number, timings: Record<string, Timing>): void {
  Object.entries(timings).forEach(([operation, timing]) =>
    console.log(
      `${name.padEnd(8)} ${String(links).padStart(7)} links  ${operation.padEnd(15)} median ${timing.medianMs} ms, p90 ${timing.p90Ms} ms`,
    ),
  );
}

async function main(): Promise<void> {
  const requested = process.argv.slice(2);
  const names = requested.length > 0 ? requested : ['small', 'medium'];
  const meta = readCaptureMeta();
  names.forEach((name) => readManifest(name, meta));
  const dataDirectory = mkdtempSync(path.join(os.tmpdir(), 'i13r-perf-host-'));
  const papi = await FakePapi.start(dataDirectory);
  const tiers: Record<string, unknown> = {};
  try {
    // eslint-disable-next-line no-restricted-syntax -- tiers run one at a time so timings don't overlap
    for (const name of ['empty', ...names]) {
      const draft: DraftProject | undefined =
        name === 'empty' ? undefined : JSON.parse(readDraftJson(name));
      const template = (draft ?? JSON.parse(readDraftJson(names[0]))).analysis.tokenAnalyses[0];
      // eslint-disable-next-line no-await-in-loop -- tiers run one at a time so timings don't overlap
      const repository = await openProject(papi, `perf-${name}`);
      const links = draft
        ? draft.analysis.segmentAnalysisLinks.length +
          draft.analysis.tokenAnalysisLinks.length +
          draft.analysis.phraseAnalysisLinks.length
        : 0;
      const seedStarted = performance.now();
      // eslint-disable-next-line no-await-in-loop -- tiers run one at a time so timings don't overlap
      if (draft) await seed(repository, draft);
      const seedMs = Math.round(performance.now() - seedStarted);
      if (draft) console.log(`${name} seeded ${links} links in ${seedMs} ms`);
      // eslint-disable-next-line no-await-in-loop -- tiers run one at a time so timings don't overlap
      const timings = await timeCreateAndDelete(repository, template);
      report(name, links, timings);
      tiers[name] = { links, seedMs, ...timings };
    }
  } finally {
    await papi.stop();
    rmSync(dataDirectory, { recursive: true, force: true });
  }
  const file = await writeResults('host-apply', {
    ...provenance(meta.coreCommit),
    runs: RUNS,
    tiers,
  });
  console.log(`Wrote ${path.relative(process.cwd(), file)}`);
}

main();
