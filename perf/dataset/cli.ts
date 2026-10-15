/* eslint-disable no-console -- a command-line tool reports to its terminal */
import { execSync } from 'child_process';
import fs from 'fs';
import type { Book, DraftProject, TextAnalysis } from 'interlinearizer';
import { CURRENT_MODEL_VERSION } from '../../src/types/model-version';
import { validateTextAnalysis } from '../../src/types/type-guards';
import { splitAnalysisByBook } from '../../src/utils/analysis-book';
import { reanchorAnalysisToBook } from '../../src/utils/reanchor-analysis';
import { loadBooks } from '../books';
import { USJ_CACHE_DIR } from '../paths';
import { readCaptureMeta } from '../usj-cache';
import { generateAnalysis } from './generate';
import { writeDataset, type DatasetManifest } from './store';
import { DATASET_SEED, TIERS } from './tiers';

const ANALYSIS_LANGUAGE = 'en';

/**
 * Fails unless the analysis is one the app loads without complaint or change: no invariant
 * violations, and a re-anchor pass over every book that leaves it as it is.
 */
function assertSteadyState(analysis: TextAnalysis, books: Book[]): void {
  const violations = validateTextAnalysis(analysis);
  if (violations.length > 0)
    throw new Error(`Generated analysis breaks invariants: ${JSON.stringify(violations)}`);
  const now = new Date(0).toISOString();
  const moved = books.filter((book) => reanchorAnalysisToBook(analysis, book, now) !== analysis);
  if (moved.length > 0)
    throw new Error(
      `Re-anchoring changes the generated analysis in ${moved.map((b) => b.bookRef)}`,
    );
}

function countByStatus(statuses: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  statuses.forEach((status) => {
    counts[status] = (counts[status] ?? 0) + 1;
  });
  return counts;
}

function main(): void {
  if (!fs.existsSync(USJ_CACHE_DIR)) execSync('npm run perf:capture', { stdio: 'inherit' });
  const meta = readCaptureMeta();
  const requested = process.argv.slice(2);
  const tiers = requested.length ? TIERS.filter((t) => requested.includes(t.name)) : TIERS;

  tiers.forEach((tier) => {
    const started = Date.now();
    const bookCodes = tier.books === 'all' ? meta.books : tier.books;
    const books = loadBooks(meta, bookCodes);
    const analysis = generateAnalysis(books, tier, {
      seed: DATASET_SEED,
      analysisLanguage: ANALYSIS_LANGUAGE,
    });
    assertSteadyState(analysis, books);

    const draft: DraftProject = {
      sourceProjectId: meta.projectId,
      modelVersion: CURRENT_MODEL_VERSION,
      analysisLanguages: [ANALYSIS_LANGUAGE],
      analysis,
      dirty: false,
    };
    const draftJson = JSON.stringify(draft);
    const shardBytes = [...splitAnalysisByBook(analysis).values()].map(
      (shard) => JSON.stringify(shard).length,
    );

    const manifest: DatasetManifest = {
      tier,
      seed: DATASET_SEED,
      sourceProjectId: meta.projectId,
      coreCommit: meta.coreCommit,
      books: bookCodes,
      counts: {
        segments: books.reduce((n, b) => n + b.segments.length, 0),
        wordTokens: books.reduce(
          (n, b) =>
            n +
            b.segments.reduce((m, s) => m + s.tokens.filter((t) => t.type === 'word').length, 0),
          0,
        ),
        tokenAnalyses: analysis.tokenAnalyses.length,
        tokenAnalysisLinks: countByStatus(analysis.tokenAnalysisLinks.map((l) => l.status)),
        phraseAnalyses: analysis.phraseAnalyses.length,
        phraseAnalysisLinks: analysis.phraseAnalysisLinks.length,
        segmentAnalyses: analysis.segmentAnalyses.length,
      },
      bytes: { draftJson: Buffer.byteLength(draftJson), largestShard: Math.max(0, ...shardBytes) },
    };
    writeDataset(manifest, draftJson);
    console.log(
      `${tier.name}: ${bookCodes.length} book(s), ${manifest.counts.wordTokens} words, ` +
        `${analysis.tokenAnalysisLinks.length} token links, ` +
        `${(manifest.bytes.draftJson / 1e6).toFixed(1)} MB draft (${Date.now() - started} ms)`,
    );
  });
}

main();
