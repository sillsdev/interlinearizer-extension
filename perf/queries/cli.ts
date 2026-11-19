/* eslint-disable no-console -- a command-line tool reports to its terminal */
import type { Book, DraftProject } from 'interlinearizer';
import path from 'path';
import { AnalysisSessions, type SessionHost } from '../../src/services/analysisSessions';
import { DraftRepository } from '../../src/services/draftRepository';
import { sessionCatalogHandlers } from '../../src/services/sessionCatalogHandlers';
import { sessionConcordanceHandlers } from '../../src/services/sessionConcordanceHandlers';
import { sessionEditHandlers } from '../../src/services/sessionEditHandlers';
import {
  readBookOutline,
  readSegmentPage,
  readStaleSummary,
} from '../../src/services/sessionPages';
import type { KeyValueStorage } from '../../src/types/analysis-repository';
import { indexBook } from '../../src/utils/concordance';
import { AnalysisIndex } from '../../src/services/analysisIndex';
import { loadBooks } from '../books';
import { readDraftJson } from '../dataset/store';
import { TIERS, type TierSpec } from '../dataset/tiers';
import { readCaptureMeta } from '../usj-cache';
import { measureAsync, type Timing } from '../bench/measure';
import { provenance, writeResults } from '../results';

const RUNS = Number(process.env.PERF_RUNS ?? 10);
const opts = { runs: RUNS, warmup: 1 };
const PAGE_SIZE = 32;
const SILENT = { warn: () => {} };
const quiet = { error: () => {} };

/** Storage held in memory, so timings leave out the disk. */
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

/**
 * Opens a session over the tier's draft and times the queries a view sends it, through the same
 * handlers the host serves them with. `PERF_ONLY` narrows a run to the measurements whose names
 * start with it.
 */
async function benchTier(tier: TierSpec, books: readonly Book[]) {
  const only = process.env.PERF_ONLY;
  const draft: DraftProject = JSON.parse(readDraftJson(tier.name));
  const bookById = new Map(books.map((b) => [b.bookRef, b]));
  const viewBook = bookById.get(tier.viewBook);
  if (!viewBook) throw new Error(`no ${tier.viewBook}`);
  const storage = memoryStorage();
  await new DraftRepository(storage, draft.sourceProjectId, SILENT).startOver(draft);
  const held = (bookId: string) => bookById.get(bookId);
  const host: SessionHost = {
    findProject: async () => undefined,
    openDraftRepository: (id) => new DraftRepository(storage, id, SILENT),
    releaseDraftRepository: async () => {},
    openPt9ImportRepository: () => {
      throw new Error('no imports');
    },
    getInterfaceLanguages: async () => ['en'],
    startTextRead: async () => {},
    stopTextRead: async () => {},
    holdTextRead: () => {},
    heldBook: (_s, bookId) => held(bookId),
    getOpenVerseBook: async (_s, bookId) => held(bookId),
    reportChange: () => {},
  };
  const sessions = new AnalysisSessions(host);
  const { sessionId } = await sessions.open(draft.sourceProjectId);
  const concordanceBooks = only && !only.startsWith('concordance') ? [] : books.map(indexBook);
  const catalog = sessionCatalogHandlers({
    sessions,
    logger: quiet,
    getOpenVerseBook: async (_s, id) => held(id),
    getVerseBook: async (_s, id) => held(id),
    isFormInText: () => undefined,
  });
  const concordance = sessionConcordanceHandlers({
    sessions,
    logger: quiet,
    getConcordanceBooks: () => concordanceBooks,
    getWritingSystem: async () => 'en',
  });
  const edits = sessionEditHandlers({
    sessions,
    logger: quiet,
    getSegmentedBook: async (_s, id) => held(id),
    getVerseBook: async (_s, id) => held(id),
    getProject: async () => undefined,
  });

  const { analysis } = draft;
  const approvals = new Map<string, number>();
  analysis.tokenAnalysisLinks.forEach((l) => {
    if (l.status === 'approved')
      approvals.set(l.analysisId, (approvals.get(l.analysisId) ?? 0) + 1);
  });
  const used = [...approvals.entries()].sort((a, b) => a[1] - b[1]);
  const typical = used[Math.floor(used.length / 2)][0];
  const ids = analysis.tokenAnalyses.map((ta) => ta.id);
  const five = ids.slice(0, 5);
  const hundred = ids.slice(0, 100);

  const timings: Record<string, Timing> = {};
  const bytes: Record<string, number> = {};
  const time = async (name: string, run: () => Promise<unknown>) => {
    if (only && !name.startsWith(only)) return;
    const t = await measureAsync(opts, () => undefined, run);
    timings[name] = t;
    console.log(`  ${name.padEnd(34)} ${t.medianMs} / ${t.p90Ms} ms`);
  };
  const wants = (name: string) => !only || name.startsWith(only);
  const size = (name: string, json: string) => {
    bytes[name] = json.length;
    console.log(`  ${name.padEnd(34)} ${(json.length / 1024).toFixed(1)} KB`);
  };

  console.log(tier.name);
  await time('index build', async () => new AnalysisIndex(analysis));
  const catalogRequest = {
    search: '',
    sort: 'usageCount' as const,
    filters: {},
    sourceLanguageTag: 'en',
    offset: 0,
    count: 40,
  };
  const catalogArgs = { sessionId, request: { ...catalogRequest, currentBook: tier.viewBook } };
  await time('catalog first page', () => catalog['interlinearizer.getCatalogRows'](catalogArgs));
  if (wants('catalog'))
    size('catalog first page', await catalog['interlinearizer.getCatalogRows'](catalogArgs));
  await time('countUsages 5', () =>
    catalog['interlinearizer.countUsages']({ sessionId, analysisIds: five }),
  );
  await time('countUsages 100', () =>
    catalog['interlinearizer.countUsages']({ sessionId, analysisIds: hundred }),
  );
  await time('previewDeletion typical', () =>
    catalog['interlinearizer.previewDeletion']({ sessionId, analysisId: typical }),
  );
  await time('previewRemovals 5', () =>
    edits['interlinearizer.previewRemovals']({
      sessionId,
      request: { intent: 'clearAnalysisGlosses', analysisIds: five },
    }),
  );
  await time('previewRemovals 100', () =>
    edits['interlinearizer.previewRemovals']({
      sessionId,
      request: { intent: 'clearAnalysisGlosses', analysisIds: hundred },
    }),
  );
  const [formA, formB] = wants('concordance')
    ? JSON.parse(
        await concordance['interlinearizer.getConcordance']({
          sessionId,
          request: { currentBook: tier.viewBook, offset: 0, count: 40 },
        }),
      ).rows.map((r: { form: string }) => r.form)
    : [];
  await time('concordance same form next page', () =>
    concordance['interlinearizer.getConcordance']({
      sessionId,
      request: { form: formA, offset: 40, count: 40 },
    }),
  );
  let flip = 0;
  await time('concordance another form', () => {
    flip += 1;
    return concordance['interlinearizer.getConcordance']({
      sessionId,
      request: { form: flip % 2 ? formB : formA, offset: 0, count: 40 },
    });
  });
  const repo = new DraftRepository(storage, draft.sourceProjectId, SILENT);
  await repo.getDraftState();
  await time('stale summary', () => readStaleSummary(repo, viewBook));
  if (wants('outline'))
    size('outline', JSON.stringify(await readBookOutline(repo, viewBook, viewBook)));
  const mid = Math.floor(viewBook.segments.length / 2);
  await time('segment page', () => readSegmentPage(repo, viewBook, mid, mid + PAGE_SIZE));
  if (wants('segment')) {
    const page = JSON.stringify(await readSegmentPage(repo, viewBook, mid, mid + PAGE_SIZE));
    size('segment page', page);
    const parsed = JSON.parse(page);
    Object.entries(parsed).forEach(([k, v]) => size(`page ${k}`, JSON.stringify(v)));
    Object.entries(parsed.analysis ?? {}).forEach(([k, v]) =>
      size(`page analysis ${k}`, JSON.stringify(v)),
    );
  }
  await sessions.closeAll();
  return { viewBook: tier.viewBook, timings, bytes };
}

async function main() {
  const meta = readCaptureMeta();
  const books = loadBooks(meta, meta.books);
  const requested = process.argv.slice(2);
  const tiers = TIERS.filter((t) => requested.length === 0 || requested.includes(t.name));
  const results: [string, Record<string, unknown>][] = [];
  // eslint-disable-next-line no-restricted-syntax -- tiers run one at a time so timings don't overlap
  for (const tier of tiers) {
    // eslint-disable-next-line no-await-in-loop -- tiers run one at a time so timings don't overlap
    results.push([tier.name, await benchTier(tier, books)]);
  }
  const file = await writeResults('queries', {
    ...provenance(meta.coreCommit),
    runs: RUNS,
    tiers: Object.fromEntries(results),
  });
  console.log(`Wrote ${path.relative(process.cwd(), file)}`);
}

main();
