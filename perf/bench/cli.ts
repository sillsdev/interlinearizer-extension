/* eslint-disable no-console -- a command-line tool reports to its terminal */
import type { Book, DraftProject, TextAnalysis } from 'interlinearizer';
import path from 'path';
import { tokenizeBook } from '../../src/parsers/papi/bookTokenizer';
import { extractBookFromUsj } from '../../src/parsers/papi/usjBookExtractor';
import analysisReducer, {
  type AnalysisState,
  selectApprovedGloss,
  selectCatalogRows,
  selectPhraseLinkByTokenRef,
  selectPoolIndex,
  selectStaleTokenLinks,
  writeGloss,
} from '../../src/store/analysisSlice';
import { createAnalysisStore } from '../../src/store';
import { mergeAnalyses, splitAnalysisByBook } from '../../src/utils/analysis-book';
import {
  approvedAnalysisByToken,
  buildConcordanceEntries,
  deriveConcordanceRows,
  indexBook,
} from '../../src/utils/concordance';
import { collatorForTag } from '../../src/utils/language-tags';
import { reanchorAnalysisToBook } from '../../src/utils/reanchor-analysis';
import { MAX_UNDO_STEPS } from '../../src/utils/undo-history';
import { loadBooks, readUsj } from '../books';
import { readDraftJson, readManifest } from '../dataset/store';
import { TIERS, type TierSpec } from '../dataset/tiers';
import { provenance, writeResults } from '../results';
import { readCaptureMeta } from '../usj-cache';
import { measure, retainedBytes, type Timing } from './measure';

const RUNS = Number(process.env.PERF_RUNS ?? 7);
const WARMUP = 1;

/** Reads the store through the indexing selectors a mounted view recomputes after a dispatch. */
function readViewSelectors(state: AnalysisState, book: Book): void {
  const tokenRef = book.segments[0].tokens[0].ref;
  selectPoolIndex(state);
  selectCatalogRows(state, book.bookRef);
  selectPhraseLinkByTokenRef(state);
  selectStaleTokenLinks(state);
  selectApprovedGloss(state, tokenRef);
}

/** The word tokens of `book`, in document order. */
function wordsOf(book: Book) {
  return book.segments.flatMap((s) => s.tokens.filter((t) => t.type === 'word'));
}

function benchTier(tier: TierSpec, allBooks: () => Book[]): Record<string, unknown> {
  const tierName = tier.name;
  const meta = readCaptureMeta();
  const manifest = readManifest(tierName);
  const viewBookCode = tier.viewBook;
  const usj = readUsj(meta, viewBookCode);
  const [viewBook] = loadBooks(meta, [viewBookCode]);
  const draftJson = readDraftJson(tierName);
  const draft: DraftProject = JSON.parse(draftJson);
  const { analysis } = draft;
  const language = draft.analysisLanguages[0];
  const opts = { runs: RUNS, warmup: WARMUP };
  const noSetup = () => undefined;
  const timings: Record<string, Timing> = {};
  const time = (name: string, timing: Timing) => {
    timings[name] = timing;
    console.log(`  ${name.padEnd(22)} median ${timing.medianMs} ms, p95 ${timing.p95Ms} ms`);
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
  const now = new Date(0).toISOString();
  time(
    'load.reanchor',
    measure(opts, noSetup, () => reanchorAnalysisToBook(analysis, viewBook, now)),
  );
  // A fresh copy per run: selectors memoize on the analysis object itself.
  time(
    'load.storeMount',
    measure(
      opts,
      () => structuredClone(analysis),
      (copy) => {
        const store = createAnalysisStore({
          analysis: { analysis: copy, analysisLanguage: language },
        });
        readViewSelectors(store.getState().analysis, viewBook);
      },
    ),
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

  // Each run glosses a different word, so no selector can answer from its memo.
  const words = wordsOf(viewBook);
  const store = createAnalysisStore({ analysis: { analysis, analysisLanguage: language } });
  readViewSelectors(store.getState().analysis, viewBook);
  time(
    'edit.dispatch',
    measure(
      opts,
      (i) => words[(i * 97) % words.length],
      (token, i) => {
        store.dispatch(writeGloss(token.ref, token.surfaceText, `bench-${i}`));
        readViewSelectors(store.getState().analysis, viewBook);
      },
    ),
  );
  time(
    'edit.serializeDraft',
    measure(opts, noSetup, () =>
      JSON.stringify({ ...draft, analysis: store.getState().analysis.analysis }),
    ),
  );

  const books = allBooks();
  const collator = collatorForTag(meta.languageTag || 'und');
  time(
    'concordance.build',
    measure(opts, noSetup, () => {
      const entries = buildConcordanceEntries(books.map(indexBook), collator);
      deriveConcordanceRows(
        entries,
        approvedAnalysisByToken(analysis.tokenAnalysisLinks),
        viewBookCode,
      );
    }),
  );

  // The undo history holds a snapshot of the analysis before each of its steps.
  const undoBytes = retainedBytes(() => {
    let state: AnalysisState = { analysis, analysisLanguage: language };
    const snapshots: AnalysisState[] = [];
    for (let i = 0; i < MAX_UNDO_STEPS; i += 1) {
      snapshots.push(state);
      const token = words[(i * 89) % words.length];
      state = analysisReducer(state, writeGloss(token.ref, token.surfaceText, `undo-${i}`));
    }
    return snapshots;
  });
  const analysisBytes = retainedBytes(() => JSON.parse(draftJson));

  return {
    viewBook: viewBookCode,
    dataset: { counts: manifest.counts, bytes: manifest.bytes },
    timings,
    memory: { parsedDraftBytes: analysisBytes, undoHistoryBytes: undoBytes },
  };
}

function main(): void {
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

  const file = writeResults('bench', {
    ...provenance(meta.coreCommit),
    runs: RUNS,
    tiers: Object.fromEntries(tiers.map((t) => [t.name, benchTier(t, allBooks)])),
  });
  console.log(`Wrote ${path.relative(process.cwd(), file)}`);
}

main();
