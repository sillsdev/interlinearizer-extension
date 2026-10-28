/* eslint-disable no-console -- a command-line tool reports to its terminal */
import type { AssignmentStatus, DraftProject, TextAnalysis } from 'interlinearizer';
import { DraftRepository } from '../../src/services/draftRepository';
import { EditHistory } from '../../src/services/editHistory';
import type {
  AnalysisRepository,
  ChangeSet,
  KeyValueStorage,
  WarningLogger,
} from '../../src/types/analysis-repository';
import { bookOfRef, booksLinkedIn } from '../../src/utils/analysis-book';
import { normalizeSurfaceForm } from '../../src/utils/analysis-identity';
import { preferredLinkByKey } from '../../src/utils/pick-rules';
import { chance, createRng, type Rng } from '../dataset/rng';
import { readDraftJson } from '../dataset/store';
import { TIERS, type TierSpec } from '../dataset/tiers';

const STATUSES: AssignmentStatus[] = ['approved', 'suggested', 'candidate', 'rejected', 'stale'];

const STAMP = '2026-01-01T00:00:00.000Z';

/** How many token refs the random edits draw from, so the final lookups revisit what they changed. */
const EDITED_TOKENS = 200;

/** How many keys of each kind the final lookups add from the whole analysis. */
const SAMPLED_KEYS = 50;

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

/** Random edits break invariants that a load reports, so its warnings say nothing here. */
const SILENT: WarningLogger = { warn: () => {} };

function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)];
}

function sample<T>(rng: Rng, items: readonly T[], count: number): T[] {
  return Array.from({ length: Math.min(count, items.length) }, () => pick(rng, items));
}

/** A random edit to the links on one of `tokenRefs`, read through `repository` as it stands. */
async function randomChanges(
  repository: AnalysisRepository,
  tokenRefs: readonly string[],
  surfaceTexts: readonly string[],
  rng: Rng,
  step: number,
): Promise<ChangeSet> {
  const tokenRef = pick(rng, tokenRefs);
  const { tokenAnalysisLinks, phraseAnalysisLinks } = await repository.findLinksByToken([tokenRef]);
  const changes: ChangeSet = { intent: `check-${step}` };
  const link = tokenAnalysisLinks.length > 0 ? pick(rng, tokenAnalysisLinks) : undefined;
  const roll = rng();
  if (link && roll < 0.3) {
    const status = pick(
      rng,
      STATUSES.filter((s) => s !== link.status),
    );
    changes.tokenAnalysisLinks = { puts: [{ ...link, status }], deletes: [] };
  } else if (link && roll < 0.45) {
    changes.tokenAnalysisLinks = { puts: [], deletes: [link.id] };
  } else if (link && roll < 0.7) {
    // A respelled payload moves to another form's entry.
    const [payload] = await repository.getTokenAnalyses([link.analysisId]);
    if (payload) {
      const surfaceText = pick(rng, surfaceTexts);
      changes.tokenAnalyses = { puts: [{ ...payload, surfaceText }], deletes: [] };
    }
  } else {
    const surfaceText = pick(rng, surfaceTexts);
    const analysisId = `check-ta-${step}`;
    changes.tokenAnalyses = {
      puts: [{ id: analysisId, createdAt: STAMP, updatedAt: STAMP, surfaceText }],
      deletes: [],
    };
    changes.tokenAnalysisLinks = {
      puts: [
        {
          id: `check-tl-${step}`,
          analysisId,
          createdAt: STAMP,
          updatedAt: STAMP,
          status: 'suggested',
          token: { tokenRef, surfaceText },
        },
      ],
      deletes: [],
    };
  }
  if (phraseAnalysisLinks.length > 0 && chance(rng, 0.2)) {
    const phrase = pick(rng, phraseAnalysisLinks);
    changes.phraseAnalysisLinks = chance(rng, 0.5)
      ? { puts: [], deletes: [phrase.id] }
      : { puts: [{ ...phrase, status: pick(rng, STATUSES) }], deletes: [] };
  }
  return changes;
}

/** Records in id order, serialized, so two answers compare without regard to order. */
function canonical(records: readonly { id: string }[]): string {
  return JSON.stringify([...records].sort((a, b) => a.id.localeCompare(b.id)));
}

/**
 * Compares the repository's lookups with a scan of `stored`, over keys revisiting `tokenRefs` and
 * drawn afresh from `stored`.
 *
 * @returns The lookups whose answers differ from the scan's.
 */
async function lookupMismatches(
  repository: AnalysisRepository,
  stored: TextAnalysis,
  tokenRefs: readonly string[],
  rng: Rng,
): Promise<string[]> {
  const ids = (records: readonly { id: string }[]) => [
    ...sample(
      rng,
      records.map(({ id }) => id),
      SAMPLED_KEYS,
    ),
    'check-missing',
  ];
  const refs = new Set([
    ...tokenRefs,
    ...sample(
      rng,
      stored.tokenAnalysisLinks.map((l) => l.token.tokenRef),
      SAMPLED_KEYS,
    ),
  ]);
  const segmentIds = new Set(
    sample(
      rng,
      stored.segmentAnalysisLinks.map((l) => l.segmentId),
      SAMPLED_KEYS,
    ),
  );
  const analysisIds = new Set([
    ...ids(stored.tokenAnalyses),
    ...ids(stored.phraseAnalyses),
    ...ids(stored.segmentAnalyses),
  ]);
  const books = new Set(
    sample(
      rng,
      stored.tokenAnalysisLinks.map((l) => bookOfRef(l.token.tokenRef)),
      2,
    ),
  );
  const statuses = new Set(sample(rng, STATUSES, 2));
  const forms = new Set(
    sample(
      rng,
      [...stored.tokenAnalyses, ...stored.phraseAnalyses].map((a) =>
        normalizeSurfaceForm(a.surfaceText),
      ),
      SAMPLED_KEYS,
    ),
  );
  const tokenIds = ids(stored.tokenAnalyses);
  const phraseIds = ids(stored.phraseAnalyses);
  const segmentPayloadIds = ids(stored.segmentAnalyses);
  const phraseBook = (l: { tokens: { tokenRef: string }[] }) => bookOfRef(l.tokens[0].tokenRef);

  const byToken = await repository.findLinksByToken([...refs]);
  const toAnalyses = await repository.findLinksToAnalyses([...analysisIds]);
  const inBooks = await repository.findLinksInBooks([...books]);
  const inBooksByStatus = await repository.findLinksInBooks([...books], [...statuses]);
  const checks: [string, readonly { id: string }[], readonly { id: string }[]][] = [
    [
      'getTokenAnalyses',
      await repository.getTokenAnalyses(tokenIds),
      stored.tokenAnalyses.filter((a) => tokenIds.includes(a.id)),
    ],
    [
      'getPhraseAnalyses',
      await repository.getPhraseAnalyses(phraseIds),
      stored.phraseAnalyses.filter((a) => phraseIds.includes(a.id)),
    ],
    [
      'getSegmentAnalyses',
      await repository.getSegmentAnalyses(segmentPayloadIds),
      stored.segmentAnalyses.filter((a) => segmentPayloadIds.includes(a.id)),
    ],
    [
      'findLinksByToken (token links)',
      byToken.tokenAnalysisLinks,
      stored.tokenAnalysisLinks.filter((l) => refs.has(l.token.tokenRef)),
    ],
    [
      'findLinksByToken (phrase links)',
      byToken.phraseAnalysisLinks,
      stored.phraseAnalysisLinks.filter((l) => l.tokens.some((t) => refs.has(t.tokenRef))),
    ],
    [
      'findLinksBySegment',
      await repository.findLinksBySegment([...segmentIds]),
      stored.segmentAnalysisLinks.filter((l) => segmentIds.has(l.segmentId)),
    ],
    [
      'findLinksToAnalyses',
      [
        ...toAnalyses.tokenAnalysisLinks,
        ...toAnalyses.phraseAnalysisLinks,
        ...toAnalyses.segmentAnalysisLinks,
      ],
      [
        ...stored.tokenAnalysisLinks,
        ...stored.phraseAnalysisLinks,
        ...stored.segmentAnalysisLinks,
      ].filter((l) => analysisIds.has(l.analysisId)),
    ],
    [
      'findLinksInBooks',
      [
        ...inBooks.tokenAnalysisLinks,
        ...inBooks.phraseAnalysisLinks,
        ...inBooks.segmentAnalysisLinks,
      ],
      [
        ...stored.tokenAnalysisLinks.filter((l) => books.has(bookOfRef(l.token.tokenRef))),
        ...stored.phraseAnalysisLinks.filter((l) => books.has(phraseBook(l))),
        ...stored.segmentAnalysisLinks.filter((l) => books.has(bookOfRef(l.segmentId))),
      ],
    ],
    [
      'findLinksInBooks (by status)',
      [
        ...inBooksByStatus.tokenAnalysisLinks,
        ...inBooksByStatus.phraseAnalysisLinks,
        ...inBooksByStatus.segmentAnalysisLinks,
      ],
      [
        ...stored.tokenAnalysisLinks.filter((l) => books.has(bookOfRef(l.token.tokenRef))),
        ...stored.phraseAnalysisLinks.filter((l) => books.has(phraseBook(l))),
        ...stored.segmentAnalysisLinks.filter((l) => books.has(bookOfRef(l.segmentId))),
      ].filter((l) => statuses.has(l.status)),
    ],
    [
      'findTokenAnalysesByForm',
      await repository.findTokenAnalysesByForm([...forms]),
      stored.tokenAnalyses.filter((a) => forms.has(normalizeSurfaceForm(a.surfaceText))),
    ],
    [
      'findPhraseAnalysesByForm',
      await repository.findPhraseAnalysesByForm([...forms]),
      stored.phraseAnalyses.filter((a) => forms.has(normalizeSurfaceForm(a.surfaceText))),
    ],
  ];
  const linkedBooks = (await repository.findLinkedBooks()).sort();
  const scannedBooks = [...booksLinkedIn(stored)].sort();
  const storedIds = new Set(stored.tokenAnalyses.map(({ id }) => id));
  const winners = preferredLinkByKey(stored.tokenAnalysisLinks, (l) =>
    l.status === 'approved' && storedIds.has(l.analysisId) ? l.token.tokenRef : undefined,
  );
  const scannedCounts: Record<string, number> = {};
  winners.forEach(({ analysisId }) => {
    if (tokenIds.includes(analysisId))
      scannedCounts[analysisId] = (scannedCounts[analysisId] ?? 0) + 1;
  });
  const counted = await repository.countApprovals(tokenIds);
  const sortedEntries = (counts: Record<string, number>) =>
    JSON.stringify(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
  return [
    ...checks
      .filter(([, answered, scanned]) => canonical(answered) !== canonical(scanned))
      .map(([name]) => name),
    ...(linkedBooks.join() === scannedBooks.join() ? [] : ['findLinkedBooks']),
    ...(sortedEntries(counted) === sortedEntries(scannedCounts) ? [] : ['countApprovals']),
  ];
}

/**
 * Loads a tier, applies random edits and undoes some, then compares the kept indexes with ones
 * built afresh and the lookups with a scan of what storage holds.
 *
 * @returns Whether the indexes and lookups agreed throughout.
 */
async function checkTier(tier: TierSpec): Promise<boolean> {
  const draft: DraftProject = JSON.parse(readDraftJson(tier.name));
  const { sourceProjectId, analysis } = draft;
  const storage = memoryStorage();
  await new DraftRepository(storage, sourceProjectId, SILENT).replaceAll(draft);
  const repository = new DraftRepository(storage, sourceProjectId, SILENT);
  const history = new EditHistory(repository);
  const rng = createRng('indexes', tier.name);
  const links = analysis.tokenAnalysisLinks.length;
  // Each apply rewrites the draft, so larger tiers get fewer.
  const steps = Math.min(300, Math.max(15, Math.round(5e6 / links)));
  const tokenRefs = [
    ...new Set(
      sample(
        rng,
        analysis.tokenAnalysisLinks.map((l) => l.token.tokenRef),
        EDITED_TOKENS,
      ),
    ),
  ];
  const surfaceTexts = sample(
    rng,
    analysis.tokenAnalyses.map((a) => a.surfaceText),
    EDITED_TOKENS,
  );

  await repository.getTokenAnalyses([]);
  const atLoad = await repository.checkIndexes();
  let undos = 0;
  for (let step = 0; step < steps; step += 1) {
    if (step > 0 && chance(rng, 0.25)) {
      // eslint-disable-next-line no-await-in-loop -- each edit builds on the one before
      await history.undo();
      undos += 1;
    } else {
      // eslint-disable-next-line no-await-in-loop -- each edit builds on the one before
      await history.apply(await randomChanges(repository, tokenRefs, surfaceTexts, rng, step));
    }
  }
  const after = await repository.checkIndexes();
  const reader = new DraftRepository(storage, sourceProjectId, SILENT);
  const stored = (await reader.exportAll()).draft.analysis;
  const mismatches = await lookupMismatches(repository, stored, tokenRefs, rng);

  console.log(
    `${tier.name.padEnd(15)} ${links.toLocaleString('en').padStart(8)} links  ${steps} steps (${undos} undos)  differences: ${atLoad.length} at load, ${after.length} after  lookup mismatches: ${mismatches.length}`,
  );
  if (mismatches.length > 0) console.log(`  mismatched: ${mismatches.join(', ')}`);
  return atLoad.length === 0 && after.length === 0 && mismatches.length === 0;
}

async function main(): Promise<void> {
  const requested = process.argv.slice(2);
  const unknown = requested.filter((name) => !TIERS.some((t) => t.name === name));
  if (unknown.length > 0) {
    console.error(
      `Unknown tiers: ${unknown.join(', ')}. Expected any of ${TIERS.map((t) => t.name).join(', ')}.`,
    );
    process.exitCode = 1;
    return;
  }
  const tiers = TIERS.filter((t) => requested.length === 0 || requested.includes(t.name));
  let agreed = true;
  // eslint-disable-next-line no-restricted-syntax -- tiers run one at a time to bound memory
  for (const tier of tiers) {
    // eslint-disable-next-line no-await-in-loop -- tiers run one at a time to bound memory
    if (!(await checkTier(tier))) agreed = false;
  }
  if (!agreed) process.exitCode = 1;
}

main();
