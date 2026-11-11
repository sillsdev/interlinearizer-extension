/* eslint-disable no-console -- a command-line tool reports to its terminal */
import type { Book, DraftProject, SessionAnalysisChange } from 'interlinearizer';
import path from 'path';
import { performance } from 'perf_hooks';
import { tokenizeBook } from '../../src/parsers/papi/bookTokenizer';
import { extractBookFromUsj, type UsjDocument } from '../../src/parsers/papi/usjBookExtractor';
import { WholeAnalysis } from '../../src/cache/wholeAnalysis';
import { AnalysisSessions, type SessionHost } from '../../src/services/analysisSessions';
import { DraftRepository } from '../../src/services/draftRepository';
import type { KeyValueStorage, WarningLogger } from '../../src/types/analysis-repository';
import { emptyAnalysis } from '../../src/types/empty-factories';
import { applyChangeSet } from '../../src/utils/change-set';
import { missingBook } from '../../src/utils/reanchor-analysis';
import { reanchorChangesForBook } from '../../src/utils/reanchor-changes';
import { readUsj } from '../books';
import { collectGarbage, summarize, type Timing } from '../bench/measure';
import { readDraftJson, readManifest } from '../dataset/store';
import { TIERS } from '../dataset/tiers';
import { provenance, writeResults } from '../results';
import { readCaptureMeta, type UsjCaptureMeta } from '../usj-cache';

const RUNS = Number(process.env.PERF_RUNS ?? 5);

const SILENT: WarningLogger = { warn: () => {} };

function memoryStorage(): KeyValueStorage {
  const records = new Map<string, string>();
  return {
    async read(key) {
      return records.get(key);
    },
    async write(key, data) {
      records.set(key, data);
    },
    async delete(key) {
      records.delete(key);
    },
  };
}

function sessionHost(
  storage: KeyValueStorage,
  reportChange: (change: SessionAnalysisChange) => void,
): SessionHost {
  return {
    findProject: async () => undefined,
    openDraftRepository: (sourceProjectId) => new DraftRepository(storage, sourceProjectId, SILENT),
    releaseDraftRepository: async () => {},
    openPt9ImportRepository: () => {
      throw new Error('no imports here');
    },
    getInterfaceLanguages: async () => ['en'],
    startTextRead: async () => {},
    stopTextRead: async () => {},
    heldBook: () => undefined,
    reportChange,
  };
}

/**
 * `usj` with `edit` applied to each nonblank text string after its first verse, outside notes, up
 * to `limit` of them.
 */
function editUsj(usj: UsjDocument, edit: (text: string) => string, limit = Infinity): UsjDocument {
  let edited = 0;
  let inVerses = false;
  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') {
      if (!inVerses || edited >= limit || node.trim().length === 0) return node;
      edited += 1;
      return edit(node);
    }
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      if ('type' in node && node.type === 'verse') inVerses = true;
      if ('type' in node && node.type === 'note') return node;
      return Object.fromEntries(
        Object.entries(node).map(([key, value]) => [key, key === 'content' ? walk(value) : value]),
      );
    }
    return node;
  };
  return { ...usj, content: usj.content.map(walk) };
}

const alterFirstWord = (text: string) => text.replace(/\p{L}+/u, (word) => `${word}x`);
const alterEveryWord = (text: string) => text.replace(/\p{L}+/gu, (word) => `${word}x`);

/** The unedited text of `bookCode`, then each measured edit of that text under its name. */
function texts(meta: UsjCaptureMeta, bookCode: string): [Book, [string, Book][]] {
  const usj = readUsj(meta, bookCode);
  const tag = meta.languageTag || 'und';
  return [
    tokenizeBook(extractBookFromUsj(usj, tag)),
    [
      ['one word', tokenizeBook(extractBookFromUsj(editUsj(usj, alterFirstWord, 1), tag))],
      ['every word', tokenizeBook(extractBookFromUsj(editUsj(usj, alterEveryWord), tag))],
    ],
  ];
}

/**
 * `draftJson` re-anchored to the unedited `book`. A pass over an edit of `book` then changes only
 * what the edit reaches.
 */
function settledTo(draftJson: string, book: Book): string {
  const draft: DraftProject = JSON.parse(draftJson);
  const changes = reanchorChangesForBook(draft, book);
  if (!changes) return draftJson;
  applyChangeSet(draft, changes);
  return JSON.stringify(draft);
}

/** Times the steps of one pass over `book`, as `reanchorStoredBook` runs them. */
async function timePassSteps(repository: DraftRepository, book: Book) {
  // A session builds its indexes on open, so the first lookup's index build is not part of a pass.
  await repository.findLinksInBooks([book.bookRef]);
  let started = performance.now();
  const scope = await repository.getScope();
  const links = await repository.findLinksInBooks([book.bookRef]);
  const segmentAnalyses = await repository.getSegmentAnalyses([
    ...new Set(links.segmentAnalysisLinks.map(({ analysisId }) => analysisId)),
  ]);
  const draft: DraftProject = {
    ...scope,
    dirty: false,
    analysis: { ...emptyAnalysis(), ...links, segmentAnalyses },
  };
  const readBooks = performance.now() - started;
  started = performance.now();
  const changes = reanchorChangesForBook(draft, book);
  const changesOfPass = performance.now() - started;
  if (changes) applyChangeSet(draft, changes);
  const reanchorInTurn = performance.now() - started;
  return { readBooks, reanchorInTurn, changesOfPass };
}

/** A case to measure. The last change that the session reports during the case is measured. */
type Scenario = (sessions: AnalysisSessions, sourceProjectId: string) => Promise<void>;

/** Runs `scenario` once over a fresh copy of the draft, measuring its pass and its report. */
async function runOnce(draftJson: string, book: Book, scenario: Scenario) {
  const draft: DraftProject = JSON.parse(draftJson);
  const storage = memoryStorage();
  await new DraftRepository(storage, draft.sourceProjectId, SILENT).startOver(draft);
  const steps = await timePassSteps(
    new DraftRepository(storage, draft.sourceProjectId, SILENT),
    book,
  );

  const reported: SessionAnalysisChange[] = [];
  const sessions = new AnalysisSessions(sessionHost(storage, (c) => reported.push(c)));
  await sessions.open(draft.sourceProjectId);
  collectGarbage();
  let started = performance.now();
  await scenario(sessions, draft.sourceProjectId);
  const pass = performance.now() - started;
  await sessions.closeAll();
  const report = reported.at(-1);
  if (!report?.passChanges) throw new Error('the scenario reported no passes');

  started = performance.now();
  const serialized = JSON.stringify(report);
  const serialize = performance.now() - started;
  started = performance.now();
  const parsed: SessionAnalysisChange = JSON.parse(serialized);
  const parse = performance.now() - started;

  const whole = new WholeAnalysis(async () => draft);
  await whole.refresh();
  collectGarbage();
  started = performance.now();
  parsed.passChanges?.forEach((changes) => whole.take(changes, 'kept'));
  const apply = performance.now() - started;

  return {
    bytes: Buffer.byteLength(serialized),
    passes: report.passChanges.length,
    records: report.passChanges.reduce(
      (n, changes) =>
        n +
        [changes.tokenAnalysisLinks, changes.phraseAnalysisLinks, changes.segmentAnalysisLinks]
          .map((c) => (c?.puts?.length ?? 0) + (c?.deletes?.length ?? 0))
          .reduce((a, b) => a + b, 0),
      0,
    ),
    times: { ...steps, pass, serialize, parse, apply },
  };
}

async function measureScenario(draftJson: string, book: Book, scenario: Scenario) {
  const runs = [];
  for (let i = 0; i < RUNS; i += 1) {
    // eslint-disable-next-line no-await-in-loop -- each run is timed on its own
    runs.push(await runOnce(draftJson, book, scenario));
  }
  const [{ bytes, passes, records }] = runs;
  const times: Record<string, Timing> = {};
  Object.keys(runs[0].times).forEach((key) => {
    times[key] = summarize(
      runs.map((r) => Object.entries(r.times).find(([k]) => k === key)?.[1] ?? 0),
    );
  });
  return { bytes, passes, records, times };
}

/** The linked books of `draftJson`, most links first, with their link counts. */
async function linksByBook(draftJson: string): Promise<[string, number][]> {
  const draft: DraftProject = JSON.parse(draftJson);
  const storage = memoryStorage();
  await new DraftRepository(storage, draft.sourceProjectId, SILENT).startOver(draft);
  const repository = new DraftRepository(storage, draft.sourceProjectId, SILENT);
  const counts: [string, number][] = [];
  // eslint-disable-next-line no-restricted-syntax -- reads of one draft must not overlap
  for (const bookCode of await repository.findLinkedBooks()) {
    // eslint-disable-next-line no-await-in-loop -- reads of one draft must not overlap
    const links = await repository.findLinksInBooks([bookCode]);
    counts.push([
      bookCode,
      links.tokenAnalysisLinks.length +
        links.phraseAnalysisLinks.length +
        links.segmentAnalysisLinks.length,
    ]);
  }
  return counts.sort((a, b) => b[1] - a[1]);
}

const mb = (bytes: number) => `${(bytes / 2 ** 20).toFixed(2)} MiB`;

async function measureTier(tierName: string, meta: UsjCaptureMeta) {
  const manifest = readManifest(tierName, meta);
  const generated = readDraftJson(tierName);
  const [[heaviest, links]] = await linksByBook(generated);
  const [unedited, edits] = texts(meta, heaviest);
  const draftJson = settledTo(generated, unedited);
  console.log(
    `${tierName}: draft ${mb(Buffer.byteLength(draftJson))}, ${heaviest} has ${links} links`,
  );
  const textBooks = manifest.books.filter((code) => code !== heaviest);
  const scenarios: Record<string, Awaited<ReturnType<typeof measureScenario>>> = {};

  scenarios['missing book'] = await measureScenario(
    draftJson,
    missingBook(heaviest),
    (sessions, source) => sessions.reanchorMissingBooks(source, textBooks),
  );
  // eslint-disable-next-line no-restricted-syntax -- runs go one at a time so timings don't overlap
  for (const [name, edited] of edits) {
    // eslint-disable-next-line no-await-in-loop -- runs go one at a time so timings don't overlap
    scenarios[`edit, ${name}`] = await measureScenario(
      draftJson,
      edited,
      async (sessions, source) => {
        await sessions.reanchorBook(source, edited, true);
        await sessions.reportScriptureEdit(source, heaviest);
      },
    );
  }
  Object.entries(scenarios).forEach(([name, { bytes, passes, records, times }]) => {
    const ms = (key: string) => `${key} ${times[key].medianMs.toFixed(0)} ms`;
    console.log(
      `  ${name.padEnd(16)} ${mb(bytes)} (${passes} passes, ${records} records)  ${['pass', 'readBooks', 'reanchorInTurn', 'changesOfPass', 'serialize', 'parse', 'apply'].map(ms).join(', ')}`,
    );
  });
  return scenarios;
}

async function main(): Promise<void> {
  const requested = process.argv.slice(2);
  const names = requested.length > 0 ? requested : ['large-loadable'];
  const unknown = names.filter((name) => !TIERS.some((t) => t.name === name));
  if (unknown.length > 0) throw new Error(`Unknown tiers: ${unknown.join(', ')}`);
  const meta = readCaptureMeta();
  const tiers: Record<string, unknown> = {};
  // eslint-disable-next-line no-restricted-syntax -- tiers run one at a time to bound memory
  for (const name of names) {
    // eslint-disable-next-line no-await-in-loop -- tiers run one at a time to bound memory
    tiers[name] = await measureTier(name, meta);
  }
  const file = await writeResults('reports', {
    ...provenance(meta.coreCommit),
    runs: RUNS,
    tiers,
  });
  console.log(`Wrote ${path.relative(process.cwd(), file)}`);
}

main();
