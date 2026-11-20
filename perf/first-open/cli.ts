/* eslint-disable no-console -- a command-line tool reports to its terminal */
import type { Book, DraftProject } from 'interlinearizer';
import path from 'path';
import { performance } from 'perf_hooks';
import { tokenizeBook } from '../../src/parsers/papi/bookTokenizer';
import { extractBookFromUsj } from '../../src/parsers/papi/usjBookExtractor';
import { AnalysisSessions, type SessionHost } from '../../src/services/analysisSessions';
import { DraftRepository } from '../../src/services/draftRepository';
import type { KeyValueStorage, WarningLogger } from '../../src/types/analysis-repository';
import { readUsj } from '../books';
import { collectGarbage, summarize, type Timing } from '../bench/measure';
import { readDraftJson } from '../dataset/store';
import { TIERS } from '../dataset/tiers';
import { provenance, writeResults } from '../results';
import { readCaptureMeta } from '../usj-cache';

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

/** A host whose open book is always `book`. */
function sessionHost(storage: KeyValueStorage, book: Book): SessionHost {
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
    holdTextRead: () => {},
    heldBook: () => undefined,
    getOpenVerseBook: async () => book,
    reportChange: () => {},
  };
}

/**
 * Times one first open of `book` in a session over a fresh copy of the draft. When `recorded`, an
 * earlier session has opened the book first, so storage records it as anchored to its text.
 */
async function runOnce(draftJson: string, book: Book, recorded: boolean): Promise<number> {
  const draft: DraftProject = JSON.parse(draftJson);
  const source = draft.sourceProjectId;
  const storage = memoryStorage();
  await new DraftRepository(storage, source, SILENT).startOver(draft);
  const sessions = new AnalysisSessions(sessionHost(storage, book));
  if (recorded) {
    const earlier = await sessions.open(source);
    await sessions.reanchorOpenedBook(earlier.sessionId, book.bookRef);
    await sessions.close(earlier.sessionId);
  }
  const { sessionId } = await sessions.open(source);
  // A session builds its indexes on its first lookup, which is not part of opening a book.
  await sessions.run(sessionId, (session) => session.repository.findLinkedBooks());
  collectGarbage();
  const started = performance.now();
  await sessions.reanchorOpenedBook(sessionId, book.bookRef);
  const elapsed = performance.now() - started;
  await sessions.closeAll();
  return elapsed;
}

async function measureTier(tierName: string): Promise<Record<string, Timing>> {
  const meta = readCaptureMeta();
  const tier = TIERS.find((t) => t.name === tierName);
  if (!tier) throw new Error(`Unknown tier: ${tierName}`);
  const draftJson = readDraftJson(tierName);
  const book = tokenizeBook(
    extractBookFromUsj(readUsj(meta, tier.viewBook), meta.languageTag || 'und'),
  );
  const timings: Record<string, Timing> = {};
  // eslint-disable-next-line no-restricted-syntax -- runs go one at a time so timings don't overlap
  for (const recorded of [false, true]) {
    const durations: number[] = [];
    for (let i = 0; i < RUNS; i += 1) {
      // eslint-disable-next-line no-await-in-loop -- runs go one at a time so timings don't overlap
      durations.push(await runOnce(draftJson, book, recorded));
    }
    const name = recorded ? 'recorded' : 'unrecorded';
    timings[name] = summarize(durations);
    console.log(
      `${tierName} ${tier.viewBook} ${name.padEnd(10)} median ${timings[name].medianMs} ms, p90 ${timings[name].p90Ms} ms`,
    );
  }
  return timings;
}

async function main(): Promise<void> {
  const requested = process.argv.slice(2);
  const names = requested.length > 0 ? requested : ['large-loadable'];
  const meta = readCaptureMeta();
  const tiers: Record<string, unknown> = {};
  // eslint-disable-next-line no-restricted-syntax -- tiers run one at a time to bound memory
  for (const name of names) {
    // eslint-disable-next-line no-await-in-loop -- tiers run one at a time to bound memory
    tiers[name] = await measureTier(name);
  }
  const file = await writeResults('first-open', {
    ...provenance(meta.coreCommit),
    runs: RUNS,
    tiers,
  });
  console.log(`Wrote ${path.relative(process.cwd(), file)}`);
}

main();
