/* eslint-disable no-console -- a command-line tool reports to its terminal */
import type { Book, DraftProject, TextAnalysis } from 'interlinearizer';
import path from 'path';
import { tokenizeBook } from '../../src/parsers/papi/bookTokenizer';
import { DraftRepository } from '../../src/services/draftRepository';
import { extractBookFromUsj } from '../../src/parsers/papi/usjBookExtractor';
import { selectCatalogRows } from '../../src/utils/analysis-selectors';
import type { ChangeSet, KeyValueStorage } from '../../src/types/analysis-repository';
import { emptyAnalysis } from '../../src/types/empty-factories';
import {
  booksLinkedIn,
  booksMissingFrom,
  mergeAnalyses,
  splitAnalysisByBook,
} from '../../src/utils/analysis-book';
import {
  approvedAnalysisByToken,
  buildConcordanceEntries,
  deriveConcordanceRows,
  indexBook,
} from '../../src/utils/concordance';
import { FormIndex, formsOfBook } from '../../src/utils/form-index';
import { collatorForTag } from '../../src/utils/language-tags';
import { missingBook } from '../../src/utils/reanchor-analysis';
import { reanchorChangesForBook } from '../../src/utils/reanchor-changes';
import { loadBooks, readUsj } from '../books';
import { readDraftJson, readManifest } from '../dataset/store';
import { TIERS, type TierSpec } from '../dataset/tiers';
import { provenance, writeResults } from '../results';
import { readCaptureMeta } from '../usj-cache';
import { measure, measureAsync, retainedBytes, type Timing } from './measure';

const RUNS = Number(process.env.PERF_RUNS ?? 10);
const WARMUP = 1;

/** Storage held in memory, so an apply's timing leaves out the disk. */
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

/** The token payload the most links reference, so an edit to it rewrites the most books. */
function mostLinkedTokenAnalysis(analysis: TextAnalysis) {
  const linkCounts = new Map<string, number>();
  analysis.tokenAnalysisLinks.forEach(({ analysisId }) =>
    linkCounts.set(analysisId, (linkCounts.get(analysisId) ?? 0) + 1),
  );
  return analysis.tokenAnalyses.reduce((most, payload) =>
    (linkCounts.get(payload.id) ?? 0) > (linkCounts.get(most.id) ?? 0) ? payload : most,
  );
}

async function benchTier(tier: TierSpec, allBooks: () => Book[]): Promise<Record<string, unknown>> {
  const tierName = tier.name;
  const meta = readCaptureMeta();
  const manifest = readManifest(tierName, meta);
  const viewBookCode = tier.viewBook;
  const usj = readUsj(meta, viewBookCode);
  const draftJson = readDraftJson(tierName);
  const draft: DraftProject = JSON.parse(draftJson);
  const { analysis } = draft;
  const language = draft.analysisLanguages[0];
  const opts = { runs: RUNS, warmup: WARMUP };
  const noSetup = () => undefined;
  const timings: Record<string, Timing> = {};
  const time = (name: string, timing: Timing) => {
    timings[name] = timing;
    console.log(`  ${name.padEnd(22)} median ${timing.medianMs} ms, p90 ${timing.p90Ms} ms`);
  };

  console.log(
    `${tierName} (view ${viewBookCode}, ${(draftJson.length / 1e6).toFixed(1)} MB draft)`,
  );

  time(
    'load.tokenize',
    measure(opts, noSetup, () => tokenizeBook(extractBookFromUsj(usj, meta.languageTag || 'und'))),
  );
  time(
    'load.parseDraft',
    measure(opts, noSetup, () => JSON.parse(draftJson)),
  );
  const shards = [...splitAnalysisByBook(analysis).values()].map((shard) => JSON.stringify(shard));
  time(
    'storage.readShards',
    measure(opts, noSetup, () =>
      mergeAnalyses(shards.map((json): TextAnalysis => JSON.parse(json))),
    ),
  );
  time(
    'storage.writeShards',
    measure(opts, noSetup, () =>
      [...splitAnalysisByBook(analysis).values()].map((shard) => JSON.stringify(shard)),
    ),
  );

  // The host's edit path: the repository has loaded the draft and built its index, so each run
  // times one apply, its writes to storage included. Each run edits a different link, and each
  // gloss differs, so every apply changes what it reaches.
  const repository = new DraftRepository(memoryStorage(), draft.sourceProjectId, {
    warn: () => {},
  });
  await repository.startOver(draft);
  await repository.getTokenAnalyses([]);
  const links = analysis.tokenAnalysisLinks;
  time(
    'apply.link',
    await measureAsync(
      opts,
      (i): ChangeSet => {
        const link = links[(i * 7919) % links.length];
        const status = link.status === 'suggested' ? 'approved' : 'suggested';
        return {
          intent: 'bench',
          tokenAnalysisLinks: { puts: [{ ...link, status }], deletes: [] },
        };
      },
      (changes) => repository.apply(changes),
    ),
  );
  const widest = mostLinkedTokenAnalysis(analysis);
  time(
    'apply.widePayload',
    await measureAsync(
      opts,
      (i): ChangeSet => ({
        intent: 'bench',
        tokenAnalyses: { puts: [{ ...widest, gloss: { [language]: `bench-${i}` } }], deletes: [] },
      }),
      (changes) => repository.apply(changes),
    ),
  );
  // A status change stays in its link's book; a payload edit reaches every book linking it.
  const applyBooksReached = {
    link: 1,
    widePayload: booksLinkedIn({
      ...emptyAnalysis(),
      tokenAnalysisLinks: links.filter(({ analysisId }) => analysisId === widest.id),
    }).size,
  };
  console.log(
    `  books an apply reaches: ${applyBooksReached.link} by apply.link, ${applyBooksReached.widePayload} by apply.widePayload`,
  );

  const books = allBooks();
  const collator = collatorForTag(meta.languageTag || 'und');
  time(
    'concordance.build',
    measure(opts, noSetup, () => {
      const entries = buildConcordanceEntries(books.map(indexBook), collator);
      deriveConcordanceRows(
        entries,
        approvedAnalysisByToken(
          analysis.tokenAnalysisLinks,
          new Map(analysis.tokenAnalyses.map((ta) => [ta.id, ta])),
        ),
        viewBookCode,
      );
    }),
  );

  const indexForms = () => {
    const index = new FormIndex();
    books.forEach((book) => index.setBook(book.bookRef, formsOfBook(book)));
    return index;
  };
  time('text.formIndex', measure(opts, noSetup, indexForms));
  // The host's form index and the WebView's read must agree on which catalog forms are missing.
  const index = indexForms();
  const textForms = new Set(books.flatMap((book) => [...indexBook(book).occurrencesByForm.keys()]));
  const catalogForms = selectCatalogRows(
    { analysis, analysisLanguage: language },
    viewBookCode,
  ).map((row) => row.form);
  const byWebViewRead = catalogForms.filter((form) => !textForms.has(form));
  const byHostIndex = catalogForms.filter((form) => !index.has(form));
  const disagreeing = catalogForms.filter((form) => textForms.has(form) !== index.has(form)).length;
  console.log(
    `  forms not in the text: ${byWebViewRead.length} by the WebView's read, ${byHostIndex.length} by the host's index, ${disagreeing} disagreeing`,
  );

  // The host's re-anchor, over one book's links at a time, for every book of the text and every
  // linked book it lacks.
  const byBook = splitAnalysisByBook(analysis);
  // As the host reads a book: its links, and the segment analyses they reference.
  const bookAlone = (bookCode: string): DraftProject => {
    const inBook = byBook.get(bookCode) ?? emptyAnalysis();
    return {
      ...draft,
      analysis: {
        ...emptyAnalysis(),
        tokenAnalysisLinks: inBook.tokenAnalysisLinks,
        phraseAnalysisLinks: inBook.phraseAnalysisLinks,
        segmentAnalysisLinks: inBook.segmentAnalysisLinks,
        segmentAnalyses: inBook.segmentAnalyses,
      },
    };
  };
  const textBookCodes = books.map((book) => book.bookRef);
  const reanchoredBooks = [
    ...books,
    ...booksMissingFrom(booksLinkedIn(analysis), textBookCodes).map(missingBook),
  ];
  time(
    'reanchor.hostText',
    measure(opts, noSetup, () =>
      reanchoredBooks.forEach((book) => reanchorChangesForBook(bookAlone(book.bookRef), book)),
    ),
  );

  const analysisBytes = retainedBytes(() => JSON.parse(draftJson));

  return {
    viewBook: viewBookCode,
    dataset: { counts: manifest.counts, bytes: manifest.bytes },
    timings,
    formsNotInText: {
      byWebViewRead: byWebViewRead.length,
      byHostIndex: byHostIndex.length,
      disagreeing,
    },
    applyBooksReached,
    memory: { parsedDraftBytes: analysisBytes },
  };
}

async function main(): Promise<void> {
  if (typeof globalThis.gc !== 'function')
    console.warn('Run with `node --expose-gc` for stable timings and memory readings.');
  const meta = readCaptureMeta();
  let books: Book[] | undefined;
  const allBooks = () => {
    books ??= loadBooks(meta, meta.books);
    return books;
  };
  const requested = process.argv.slice(2);
  const tiers = TIERS.filter((t) => requested.length === 0 || requested.includes(t.name));

  const results: [string, Record<string, unknown>][] = [];
  // eslint-disable-next-line no-restricted-syntax -- tiers run one at a time so timings don't overlap
  for (const tier of tiers) {
    // eslint-disable-next-line no-await-in-loop -- tiers run one at a time so timings don't overlap
    results.push([tier.name, await benchTier(tier, allBooks)]);
  }
  const file = await writeResults('bench', {
    ...provenance(meta.coreCommit),
    runs: RUNS,
    tiers: Object.fromEntries(results),
  });
  console.log(`Wrote ${path.relative(process.cwd(), file)}`);
}

main();
