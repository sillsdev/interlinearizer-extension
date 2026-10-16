/* eslint-disable no-console -- a command-line tool reports to its terminal */
import type { TextAnalysis } from 'interlinearizer';
import { isTextAnalysis } from '../../src/types/type-guards';
import { normalizeSurfaceForm } from '../../src/utils/analysis-identity';
import { verseOfTokenRef } from '../../src/utils/reanchor-analysis';
import { percentile } from '../bench/measure';
import { readDraftJson } from '../dataset/store';
import { TIERS } from '../dataset/tiers';
import { DEV_STORAGE_DIR } from '../paths';
import { fileStorage, readDraft } from '../storage';

async function readStored(dir: string, key: string): Promise<unknown> {
  const raw = await fileStorage(dir).read(key);
  if (raw === undefined) throw new Error(`Nothing is stored at ${key}`);
  return JSON.parse(raw);
}

function asAnalysis(value: unknown, what: string): TextAnalysis {
  if (!isTextAnalysis(value)) throw new Error(`${what} is not an analysis`);
  return value;
}

function analysisOf(value: unknown, what: string): TextAnalysis {
  if (!value || typeof value !== 'object' || !('analysis' in value))
    throw new Error(`${what} holds no analysis`);
  return asAnalysis(value.analysis, what);
}

/** Resolves one argument: a tier name, or a `draft:<sourceProjectId>` / `project:<id>` storage key. */
async function load(arg: string, storageDir: string): Promise<TextAnalysis> {
  if (TIERS.some((tier) => tier.name === arg))
    return analysisOf(JSON.parse(readDraftJson(arg)), arg);
  if (arg.startsWith('draft:')) {
    // A load stands an empty draft in for a missing one, which would measure as all zeros.
    await readStored(storageDir, arg);
    return (await readDraft(storageDir, arg.slice('draft:'.length))).analysis;
  }
  if (arg.startsWith('project:')) return analysisOf(await readStored(storageDir, arg), arg);
  throw new Error(`Unknown dataset ${arg}: expected a tier name, draft:<id> or project:<id>`);
}

const round = (n: number, places = 3) => Math.round(n * 10 ** places) / 10 ** places;
const share = (part: number, whole: number) => (whole === 0 ? 0 : round(part / whole));

function countBy<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  items.forEach((item) => counts.set(keyOf(item), (counts.get(keyOf(item)) ?? 0) + 1));
  return counts;
}

/** Text-independent measures of an analysis's shape, comparable between synthetic and real data. */
function shapeOf(analysis: TextAnalysis) {
  const links = analysis.tokenAnalysisLinks;
  const statuses = Object.fromEntries(
    [...countBy(links, (l) => l.status)].map(([status, n]) => [status, share(n, links.length)]),
  );
  const linksPerToken = [...countBy(links, (l) => l.token.tokenRef).values()];
  const linksPerPayload = [...countBy(links, (l) => l.analysisId).values()];
  const usedPayloads = new Set(links.map((l) => l.analysisId));
  const used = analysis.tokenAnalyses.filter((a) => usedPayloads.has(a.id));
  const payloadsPerForm = [...countBy(used, (a) => normalizeSurfaceForm(a.surfaceText)).values()];
  const glossLengths = used.flatMap((a) => Object.values(a.gloss ?? {}).map((g) => g.length));
  const phrases = analysis.phraseAnalysisLinks;
  const approved = links.filter((l) => l.status === 'approved').length;
  const sorted = [...linksPerPayload].sort((a, b) => b - a);
  const topPercent = sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 100)));

  return {
    tokenLinks: links.length,
    tokenPayloads: analysis.tokenAnalyses.length,
    statusShare: statuses,
    competingTokenShare: share(linksPerToken.filter((n) => n > 1).length, linksPerToken.length),
    linksPerPayload: {
      mean: round(links.length / Math.max(1, usedPayloads.size), 2),
      p95:
        linksPerPayload.length === 0
          ? 0
          : percentile(
              [...linksPerPayload].sort((a, b) => a - b),
              95,
            ),
      max: sorted[0] ?? 0,
      usedOnceShare: share(linksPerPayload.filter((n) => n === 1).length, linksPerPayload.length),
      topPercentLinkShare: share(
        topPercent.reduce((n, m) => n + m, 0),
        links.length,
      ),
    },
    payloadsPerForm: {
      mean: round(used.length / Math.max(1, payloadsPerForm.length), 2),
      multiSenseFormShare: share(
        payloadsPerForm.filter((n) => n > 1).length,
        payloadsPerForm.length,
      ),
    },
    morphemeShare: share(used.filter((a) => (a.morphemes?.length ?? 0) > 0).length, used.length),
    glossLanguagesPerPayload: round(
      used.reduce((n, a) => n + Object.keys(a.gloss ?? {}).length, 0) / Math.max(1, used.length),
      2,
    ),
    meanGlossLength: round(
      glossLengths.reduce((n, m) => n + m, 0) / Math.max(1, glossLengths.length),
      1,
    ),
    phrasesPerApprovedLink: share(phrases.length, approved),
    meanPhraseTokens: round(
      phrases.reduce((n, p) => n + p.tokens.length, 0) / Math.max(1, phrases.length),
      2,
    ),
    crossVersePhraseShare: share(
      phrases.filter((p) => new Set(p.tokens.map((t) => verseOfTokenRef(t.tokenRef))).size > 1)
        .length,
      phrases.length,
    ),
    segmentTranslationsPerApprovedLink: share(analysis.segmentAnalysisLinks.length, approved),
    booklessLinkShare: share(
      links.filter((l) => !/^[A-Z0-9]{3} /.test(l.token.tokenRef)).length,
      links.length,
    ),
  };
}

async function main(): Promise<void> {
  const storageDir = process.env.PERF_STORAGE_DIR ?? DEV_STORAGE_DIR;
  const args = process.argv.slice(2);
  if (args.length === 0)
    throw new Error(
      `Name datasets to compare: tier names, or draft:<sourceProjectId> / project:<id> keys in ${storageDir}`,
    );
  const shapes = Object.fromEntries(
    await Promise.all(args.map(async (arg) => [arg, shapeOf(await load(arg, storageDir))])),
  );
  console.log(JSON.stringify(shapes, undefined, 2));
}

main();
