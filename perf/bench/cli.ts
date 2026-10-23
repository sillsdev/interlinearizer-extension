/* eslint-disable no-console -- a command-line tool reports to its terminal */
import type { Book, DraftProject, TextAnalysis } from 'interlinearizer';
import path from 'path';
import { isDeepStrictEqual } from 'util';
import type { DraftContent } from '../../src/hooks/useDraftProject';
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
import { emptyAnalysis } from '../../src/types/empty-factories';
import { booksLinkedIn, mergeAnalyses, splitAnalysisByBook } from '../../src/utils/analysis-book';
import { applyChangeSet } from '../../src/utils/change-set';
import {
  approvedAnalysisByToken,
  buildConcordanceEntries,
  deriveConcordanceRows,
  indexBook,
} from '../../src/utils/concordance';
import { FormIndex, formsOfBook } from '../../src/utils/form-index';
import { collatorForTag } from '../../src/utils/language-tags';
import { reanchorAnalysisToBook } from '../../src/utils/reanchor-analysis';
import { changesOfReanchor } from '../../src/utils/reanchor-changes';
import { reanchorDraftToBook, reanchorDraftToMissingBook } from '../../src/utils/reanchor-draft';
import { type BookPass, MAX_UNDO_STEPS } from '../../src/utils/undo-history';
import { loadBooks, readUsj } from '../books';
import { readDraftJson, readManifest } from '../dataset/store';
import { TIERS, type TierSpec } from '../dataset/tiers';
import { provenance, writeResults } from '../results';
import { readCaptureMeta } from '../usj-cache';
import { measure, retainedBytes, type Timing } from './measure';

const RUNS = Number(process.env.PERF_RUNS ?? 10);
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

  // The host's re-anchor, over one book's analysis at a time, and the WebView's passes over the whole
  // draft must agree on every book of the text and every linked book it lacks.
  const content: DraftContent = { analysis, segmentation: draft.segmentation };
  const byBook = splitAnalysisByBook(analysis);
  const bookAlone = (bookCode: string): DraftProject => ({
    ...draft,
    analysis: byBook.get(bookCode) ?? emptyAnalysis(),
  });
  const textBookCodes = new Set(books.map((book) => book.bookRef));
  const passes: [string, BookPass<DraftContent>][] = [
    ...books.map((book): [string, BookPass<DraftContent>] => [
      book.bookRef,
      reanchorDraftToBook(book),
    ]),
    ...[...booksLinkedIn(analysis)]
      .filter((bookCode) => !textBookCodes.has(bookCode))
      .map((bookCode): [string, BookPass<DraftContent>] => [
        bookCode,
        reanchorDraftToMissingBook(bookCode),
      ]),
  ];
  const hostChanges = (bookCode: string, pass: BookPass<DraftContent>) => {
    const alone = bookAlone(bookCode);
    return changesOfReanchor(alone, pass(alone));
  };
  time(
    'reanchor.hostText',
    measure(opts, noSetup, () => passes.forEach(([bookCode, pass]) => hostChanges(bookCode, pass))),
  );
  // Each pass stamps what it rewrites with the time it ran, so two passes over a book differ there.
  const unstamped = (records: TextAnalysis) =>
    JSON.stringify(records, (key, value) => (key === 'updatedAt' ? undefined : value));
  let changedByWebView = 0;
  let changedByHost = 0;
  let reanchorDisagreeing = 0;
  passes.forEach(([bookCode, pass]) => {
    const byWebView = pass(content);
    const changes = hostChanges(bookCode, pass);
    const webViewChanged =
      byWebView.analysis !== analysis || byWebView.segmentation !== draft.segmentation;
    if (webViewChanged) changedByWebView += 1;
    if (changes) changedByHost += 1;
    if (!webViewChanged && !changes) return;
    const byHost = changes ? applyChangeSet(draft, changes).draft : draft;
    if (
      unstamped(byHost.analysis) !== unstamped(byWebView.analysis) ||
      !isDeepStrictEqual(byHost.segmentation, byWebView.segmentation)
    )
      reanchorDisagreeing += 1;
  });
  console.log(
    `  books re-anchored: ${passes.length}, changed by the WebView's passes ${changedByWebView}, by the host's ${changedByHost}, ${reanchorDisagreeing} disagreeing`,
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
    formsNotInText: {
      byWebViewRead: byWebViewRead.length,
      byHostIndex: byHostIndex.length,
      disagreeing,
    },
    hostReanchor: {
      books: passes.length,
      changedByWebView,
      changedByHost,
      disagreeing: reanchorDisagreeing,
    },
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
