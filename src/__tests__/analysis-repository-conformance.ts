/// <reference types="jest" />

import type { DraftProject, TextAnalysis } from 'interlinearizer';
import type { AnalysisLinks, AnalysisRepository, ChangeSet } from '../types/analysis-repository';
import { emptyAnalysis, emptyDraft } from '../types/empty-factories';
import { CURRENT_MODEL_VERSION } from '../types/model-version';
import { ReadOnlyAnalysisError } from '../types/read-only-analysis-error';
import { normalizeSurfaceForm } from '../utils/analysis-identity';
import { scopeRecordOf } from '../utils/change-set';
import { FIXTURE_STAMPS, makePhraseLink, makeTokenLink } from './test-helpers';

/**
 * A group of conformance tests an implementation opts into. The core tests, of records by id,
 * lookups, and all-or-nothing applies, always run.
 *
 * - `scope`: {@link AnalysisRepository.getScope} and {@link ChangeSet.scope}.
 * - `undo`: the inverse that {@link AnalysisRepository.apply} returns. Without it, `apply` may return
 *   an inverse that restores nothing (`{ intent }`), which no other group reads.
 * - `draftState`: the unsaved mark (`dirty`, `keepDirty`, `wasDirty`, and
 *   {@link AnalysisRepository.markClean}) and {@link AnalysisRepository.exportForCopy}. Without it,
 *   `apply` may report `wasDirty: false`, which no other group reads.
 * - `wholeRead`: {@link AnalysisRepository.exportAll} and {@link AnalysisRepository.getWholeDraft}
 *   themselves, and loading a draft again through `exportAll` after another repository changes it.
 * - `storage`: how today's storage keeps a draft: unreadable books, the refusal of a newer build's
 *   draft, cleanup and leftovers, and the whole-draft save. It runs only alongside `scope`,
 *   `draftState`, and `wholeRead`, and needs {@link ConformanceStore.storage}.
 */
export type ConformanceGroup = 'scope' | 'undo' | 'draftState' | 'wholeRead' | 'storage';

/** One empty store an {@link AnalysisRepository} implementation keeps drafts in. */
export interface ConformanceStore {
  /** Reaches into how drafts are stored, for the `storage` group. */
  storage?: StorageHooks;

  /**
   * Opens a repository for `sourceProjectId`. Every repository this store opens reaches the same
   * stored drafts, as one opened after a restart would.
   */
  open(sourceProjectId: string): Promise<AnalysisRepository>;

  /**
   * Stores `draft` for `sourceProjectId`, which has no draft stored yet. An implementation may drop
   * any part of `draft` that only a group it leaves out covers, such as the draft's own record
   * without `scope`, or its unsaved mark without `draftState`.
   */
  seed(sourceProjectId: string, draft: DraftProject): Promise<void>;

  /**
   * Reads every record stored for `sourceProjectId`, for a test to check what its calls left. It
   * need not go through a repository. It fills only the parts that a group the implementation opts
   * into covers.
   *
   * @throws If part of what is stored cannot be read.
   */
  readAll(sourceProjectId: string): Promise<DraftProject>;
}

/** How the `storage` group reaches into the drafts a {@link ConformanceStore} keeps. */
export interface StorageHooks {
  /** Stores a draft for `sourceProjectId` as a build with a newer model version would write it. */
  storeNewerBuildDraft(sourceProjectId: string): Promise<void>;

  /**
   * Leaves the stored analysis of one book of the draft for `sourceProjectId` unreadable, corrupt
   * or lost outright, with the rest of the draft as it stands.
   */
  damageBook(sourceProjectId: string, bookCode: string, damage: 'corrupt' | 'lost'): Promise<void>;

  /**
   * Leaves the stored draft for `sourceProjectId` well-formed but unusable, so no book in it can be
   * vouched for.
   */
  damageDraft(sourceProjectId: string): Promise<void>;

  /**
   * Makes the cleanup each save of the draft for `sourceProjectId` does after its content lands
   * fail, leaving storage that {@link StorageHooks.holdsLeftovers} reports, until the returned
   * function is called.
   */
  failCleanup(sourceProjectId: string): () => void;

  /** Whether storage holds anything for `sourceProjectId` that its stored draft no longer needs. */
  holdsLeftovers(sourceProjectId: string): Promise<boolean>;
}

/** A store whose drafts a read-only {@link AnalysisRepository} keeps apart from. */
export type ReadOnlyConformanceStore = ConformanceStore & {
  /**
   * Stores `draft`'s analysis where only a read-only repository reaches it, as for a Paratext 9
   * import of `draft`'s source project, and opens that repository.
   */
  openReadOnly: (draft: DraftProject) => Promise<AnalysisRepository>;
};

/** The timestamps on every record, which an implementation may stamp itself rather than keep. */
type Stamps = 'createdAt' | 'updatedAt';

/** {@link TextAnalysis} with its records' timestamps left out. */
type UnstampedAnalysis = {
  [Kind in keyof TextAnalysis]: Omit<TextAnalysis[Kind][number], Stamps>[];
};

/** The parts of a draft that a test may compare under the groups that an implementation opts into. */
type ComparableDraft = Partial<Omit<DraftProject, 'analysis'>> & { analysis: UnstampedAnalysis };

/** `records` in id order, each without its timestamps, since lookups promise no order. */
function unstampedInIdOrder<T extends { id: string } & Record<Stamps, string>>(
  records: readonly T[],
) {
  return [...records].sort((a, b) => a.id.localeCompare(b.id)).map(unstamped);
}

/** `record` without its timestamps. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- named only to leave them out
function unstamped<T extends Record<Stamps, string>>({ createdAt, updatedAt, ...rest }: T) {
  return rest;
}

const SOURCE = 'source-project';

/**
 * Every record kind and every optional field, spread over GEN and EXO. One payload is linked from
 * both books and one from neither. Arrays inside records are out of sorted order, so a repository
 * that sorts them fails.
 */
function fullAnalysis(): TextAnalysis {
  return {
    segmentAnalyses: [
      {
        id: 'sa-exo',
        ...FIXTURE_STAMPS,
        surfaceText: 'And these',
        confidence: 'high',
        producer: 'human',
        sourceUser: 'consultant',
        freeTranslation: { en: 'And these are the names.' },
        literalTranslation: { en: 'And these the names.' },
      },
    ],
    segmentAnalysisLinks: [
      {
        id: 'sl-exo',
        analysisId: 'sa-exo',
        ...FIXTURE_STAMPS,
        status: 'approved',
        confidence: 'high',
        segmentId: 'EXO 1:1',
      },
    ],
    tokenAnalyses: [
      { id: 'ta-and', ...FIXTURE_STAMPS, surfaceText: 'and', gloss: { en: 'and', fr: 'et' } },
      {
        id: 'ta-beginning',
        ...FIXTURE_STAMPS,
        surfaceText: 'beginning',
        confidence: 'medium',
        producer: 'pt9-import',
        sourceUser: 'translator',
        morphemes: [
          {
            id: 'm-2',
            form: 'begin',
            writingSystem: 'en',
            entryRef: { authority: 'fwlite', projectId: 'lex', entryId: 'e-begin' },
            senseRef: { authority: 'fwlite', senseId: 's-begin' },
            allomorphRef: { authority: 'fwlite', allomorphId: 'a-begin' },
            grammarRef: { authority: 'fwlite', msaId: 'msa-verb' },
            gloss: { en: 'start' },
          },
          { id: 'm-1', form: '-ning', writingSystem: 'en' },
        ],
        morphemesStale: true,
        pos: 'noun',
        features: { case: 'nominative', number: 'singular' },
        gloss: { en: 'start' },
        glossSenseRef: { authority: 'fwlite', senseId: 's-start' },
      },
      { id: 'ta-unlinked', ...FIXTURE_STAMPS, surfaceText: 'spare', gloss: { en: 'spare' } },
    ],
    tokenAnalysisLinks: [
      makeTokenLink('ta-and', 'GEN 1:1:0', { id: 'tl-gen-and', surfaceText: 'and' }),
      makeTokenLink('ta-and', 'EXO 1:1:0', { id: 'tl-exo-and', surfaceText: 'and' }),
      {
        ...makeTokenLink('ta-beginning', 'GEN 1:1:9', {
          id: 'tl-gen-beginning',
          surfaceText: 'beginning',
          status: 'suggested',
        }),
        confidence: 'low',
      },
    ],
    phraseAnalyses: [
      {
        id: 'pa-in-the',
        ...FIXTURE_STAMPS,
        surfaceText: 'in the',
        confidence: 'guess',
        producer: 'eflomal',
        sourceUser: 'reviewer',
        gloss: { en: 'in' },
        senseRef: { authority: 'fwlite', senseId: 's-in' },
      },
    ],
    phraseAnalysisLinks: [
      {
        ...makePhraseLink('pa-in-the', ['GEN 1:1:4', 'GEN 1:1:2'], ['the', 'in']),
        confidence: 'guess',
      },
    ],
  };
}

/** A draft setting every optional field, around {@link fullAnalysis}. */
function fullDraft(): DraftProject {
  return {
    sourceProjectId: SOURCE,
    modelVersion: CURRENT_MODEL_VERSION,
    analysisLanguages: ['fr', 'en'],
    targetProjectId: 'target-project',
    suggestedName: 'Genesis draft',
    suggestedDescription: 'A draft of Genesis and Exodus.',
    analysis: fullAnalysis(),
    dirty: true,
    segmentation: {
      removedVerseStarts: ['GEN 1:2'],
      addedStarts: [{ tokenRef: 'GEN 1:1:4', surfaceText: 'the' }],
    },
  };
}

/**
 * {@link fullDraft} cut to EXO's records, with the draft's optional fields dropped and its other
 * metadata changed, so a save that keeps any of the stored draft shows.
 */
function exodusOnlyDraft(): DraftProject {
  const { analysis } = fullDraft();
  return {
    sourceProjectId: SOURCE,
    modelVersion: CURRENT_MODEL_VERSION,
    analysisLanguages: ['en'],
    analysis: {
      ...emptyAnalysis(),
      segmentAnalyses: analysis.segmentAnalyses,
      segmentAnalysisLinks: analysis.segmentAnalysisLinks,
      tokenAnalyses: analysis.tokenAnalyses.filter(({ id }) => id === 'ta-and'),
      tokenAnalysisLinks: analysis.tokenAnalysisLinks.filter(({ id }) => id === 'tl-exo-and'),
    },
    dirty: false,
  };
}

/** {@link fullDraft} without GEN's records, as it loads once GEN's stored analysis is unreadable. */
function fullDraftWithoutGenesis(): DraftProject {
  const draft = fullDraft();
  const { analysis } = draft;
  return {
    ...draft,
    analysis: {
      ...analysis,
      tokenAnalyses: analysis.tokenAnalyses.filter(({ id }) => id !== 'ta-beginning'),
      tokenAnalysisLinks: analysis.tokenAnalysisLinks.filter(({ id }) => id === 'tl-exo-and'),
      phraseAnalyses: [],
      phraseAnalysisLinks: [],
    },
  };
}

/** One record of every kind in GEN, none of which {@link fullDraft} holds. */
function newRecords() {
  return {
    segmentAnalyses: [
      {
        id: 'sa-gen',
        ...FIXTURE_STAMPS,
        surfaceText: 'In the beginning',
        freeTranslation: { en: 'At first' },
      },
    ],
    segmentAnalysisLinks: [
      {
        id: 'sl-gen',
        analysisId: 'sa-gen',
        ...FIXTURE_STAMPS,
        status: 'approved' as const,
        segmentId: 'GEN 1:1',
      },
    ],
    tokenAnalyses: [{ id: 'ta-god', ...FIXTURE_STAMPS, surfaceText: 'God', gloss: { en: 'God' } }],
    tokenAnalysisLinks: [
      makeTokenLink('ta-god', 'GEN 1:1:17', { id: 'tl-gen-god', surfaceText: 'God' }),
    ],
    phraseAnalyses: [
      {
        id: 'pa-the-beginning',
        ...FIXTURE_STAMPS,
        surfaceText: 'the beginning',
        gloss: { en: 'start' },
      },
    ],
    phraseAnalysisLinks: [
      makePhraseLink('pa-the-beginning', ['GEN 1:1:9', 'GEN 1:1:13'], ['the', 'beginning']),
    ],
  };
}

/** Puts {@link newRecords}, one list per record kind. */
function puttingNewRecords(): ChangeSet {
  const records = newRecords();
  return {
    intent: 'putNewRecords',
    segmentAnalyses: { puts: records.segmentAnalyses, deletes: [] },
    segmentAnalysisLinks: { puts: records.segmentAnalysisLinks, deletes: [] },
    tokenAnalyses: { puts: records.tokenAnalyses, deletes: [] },
    tokenAnalysisLinks: { puts: records.tokenAnalysisLinks, deletes: [] },
    phraseAnalyses: { puts: records.phraseAnalyses, deletes: [] },
    phraseAnalysisLinks: { puts: records.phraseAnalysisLinks, deletes: [] },
  };
}

/** {@link fullDraft} holding {@link newRecords} as well. */
function fullDraftWithNewRecords(): DraftProject {
  const draft = fullDraft();
  const records = newRecords();
  const { analysis } = draft;
  analysis.segmentAnalyses.push(...records.segmentAnalyses);
  analysis.segmentAnalysisLinks.push(...records.segmentAnalysisLinks);
  analysis.tokenAnalyses.push(...records.tokenAnalyses);
  analysis.tokenAnalysisLinks.push(...records.tokenAnalysisLinks);
  analysis.phraseAnalyses.push(...records.phraseAnalyses);
  analysis.phraseAnalysisLinks.push(...records.phraseAnalysisLinks);
  return draft;
}

/**
 * Changes to {@link fullDraft}'s records of every sort: new records and deleted ones in every kind,
 * and a replaced payload.
 */
function mixedChanges(): ChangeSet {
  const { analysis } = fullDraft();
  const records = newRecords();
  return {
    intent: 'mixedChanges',
    segmentAnalyses: { puts: records.segmentAnalyses, deletes: ['sa-exo'] },
    segmentAnalysisLinks: { puts: records.segmentAnalysisLinks, deletes: ['sl-exo'] },
    tokenAnalyses: {
      puts: [{ ...analysis.tokenAnalyses[0], gloss: { en: 'and then' } }, ...records.tokenAnalyses],
      deletes: ['ta-unlinked'],
    },
    tokenAnalysisLinks: { puts: records.tokenAnalysisLinks, deletes: ['tl-gen-beginning'] },
    phraseAnalyses: { puts: records.phraseAnalyses, deletes: ['pa-in-the'] },
    phraseAnalysisLinks: { puts: records.phraseAnalysisLinks, deletes: ['pa-in-the'] },
  };
}

/** Boundaries {@link fullDraft} lacks: a segment starting at GEN 1:1's "beginning". */
function newSegmentation(): NonNullable<DraftProject['segmentation']> {
  return {
    removedVerseStarts: [],
    addedStarts: [{ tokenRef: 'GEN 1:1:9', surfaceText: 'beginning' }],
  };
}

/** Replaces {@link fullDraft}'s boundaries with {@link newSegmentation} in the scope's record. */
function resegmenting(): ChangeSet {
  return {
    intent: 'splitSegment',
    scope: { ...scopeRecordOf(fullDraft()), segmentation: newSegmentation() },
  };
}

/** Replaces EXO's segment payload with one carrying a new free translation. */
function translatingExodus(): ChangeSet {
  const [segment] = fullAnalysis().segmentAnalyses;
  return {
    intent: 'writeFreeTranslation',
    segmentAnalyses: {
      puts: [{ ...segment, freeTranslation: { en: 'And then.' } }],
      deletes: [],
    },
  };
}

/** Deletes every record that only EXO holds, leaving EXO no stored analysis. */
function deletingExodus(): ChangeSet {
  return {
    intent: 'deleteExodus',
    segmentAnalyses: { puts: [], deletes: ['sa-exo'] },
    segmentAnalysisLinks: { puts: [], deletes: ['sl-exo'] },
    tokenAnalysisLinks: { puts: [], deletes: ['tl-exo-and'] },
  };
}

/** {@link fullDraft} after {@link deletingExodus}. */
function fullDraftWithoutExodus(): DraftProject {
  const draft = fullDraft();
  const { analysis } = draft;
  return {
    ...draft,
    analysis: {
      ...analysis,
      segmentAnalyses: [],
      segmentAnalysisLinks: [],
      tokenAnalysisLinks: analysis.tokenAnalysisLinks.filter(({ id }) => id !== 'tl-exo-and'),
    },
  };
}

/**
 * The draft with each record list sorted by id. Lists of records promise no order, but the arrays
 * inside a record keep theirs.
 */
function inIdOrder(draft: DraftProject): DraftProject {
  const byId = <T extends { id: string }>(records: readonly T[]): T[] =>
    [...records].sort((a, b) => a.id.localeCompare(b.id));
  const { analysis } = draft;
  return {
    ...draft,
    analysis: {
      ...analysis,
      segmentAnalyses: byId(analysis.segmentAnalyses),
      segmentAnalysisLinks: byId(analysis.segmentAnalysisLinks),
      tokenAnalyses: byId(analysis.tokenAnalyses),
      tokenAnalysisLinks: byId(analysis.tokenAnalysisLinks),
      phraseAnalyses: byId(analysis.phraseAnalyses),
      phraseAnalysisLinks: byId(analysis.phraseAnalysisLinks),
    },
  };
}

/**
 * Changes `draft` in place at each level of nesting, so a repository still holding part of it
 * shows.
 */
function changeInPlace(draft: DraftProject): void {
  const { analysis, segmentation } = draft;
  draft.analysisLanguages.push('de');
  [
    ...analysis.segmentAnalyses,
    ...analysis.segmentAnalysisLinks,
    ...analysis.tokenAnalyses,
    ...analysis.tokenAnalysisLinks,
    ...analysis.phraseAnalyses,
    ...analysis.phraseAnalysisLinks,
  ].forEach((record) => {
    record.updatedAt = '2026-02-02T00:00:00.000Z';
  });
  analysis.segmentAnalyses.forEach((payload) => {
    if (payload.freeTranslation) payload.freeTranslation.en = 'changed';
  });
  analysis.tokenAnalyses.forEach((payload) => {
    if (payload.gloss) payload.gloss.en = 'changed';
    payload.morphemes?.forEach((morpheme) => {
      if (morpheme.gloss) morpheme.gloss.en = 'changed';
    });
  });
  analysis.phraseAnalyses.forEach((payload) => {
    if (payload.gloss) payload.gloss.en = 'changed';
  });
  analysis.tokenAnalysisLinks.forEach((link) => {
    link.token.surfaceText = 'changed';
  });
  analysis.phraseAnalysisLinks.forEach((link) => {
    link.tokens.forEach((token) => {
      token.surfaceText = 'changed';
    });
  });
  segmentation?.removedVerseStarts.push('EXO 1:2');
  segmentation?.addedStarts.forEach((start) => {
    start.surfaceText = 'changed';
  });
}

/** The ids of `records`, sorted, since lookups promise no order. */
function idsOf(records: readonly { id: string }[]): string[] {
  return records.map(({ id }) => id).sort();
}

/** The ids of each kind of link in `links`, sorted, since lookups promise no order. */
function linkIdsOf(links: Partial<AnalysisLinks>) {
  return {
    ...(links.tokenAnalysisLinks && { tokenAnalysisLinks: idsOf(links.tokenAnalysisLinks) }),
    ...(links.phraseAnalysisLinks && { phraseAnalysisLinks: idsOf(links.phraseAnalysisLinks) }),
    ...(links.segmentAnalysisLinks && {
      segmentAnalysisLinks: idsOf(links.segmentAnalysisLinks),
    }),
  };
}

/** Expects `value` to survive a JSON round trip unchanged and to hold no `null`. */
function expectJsonPlain(value: unknown): void {
  expect(JSON.parse(JSON.stringify(value))).toStrictEqual(value);
  expect(JSON.stringify(value)).not.toMatch(/\bnull\b/);
}

/** `analysis` with record lists in id order and each record's timestamps left out. */
function unstampedAnalysis(analysis: TextAnalysis): UnstampedAnalysis {
  const sorted = inIdOrder({ ...emptyDraft(SOURCE), analysis }).analysis;
  return {
    segmentAnalyses: sorted.segmentAnalyses.map(unstamped),
    segmentAnalysisLinks: sorted.segmentAnalysisLinks.map(unstamped),
    tokenAnalyses: sorted.tokenAnalyses.map(unstamped),
    tokenAnalysisLinks: sorted.tokenAnalysisLinks.map(unstamped),
    phraseAnalyses: sorted.phraseAnalyses.map(unstamped),
    phraseAnalysisLinks: sorted.phraseAnalysisLinks.map(unstamped),
  };
}

/**
 * The analysis that `repository` loads, expecting every book readable, with record lists in id
 * order.
 */
async function analysisLoadedBy(repository: AnalysisRepository): Promise<TextAnalysis> {
  const { draft, unreadableBooks } = await repository.exportAll();
  expect(unreadableBooks).toStrictEqual([]);
  return inIdOrder(draft).analysis;
}

/**
 * Declares the tests an {@link AnalysisRepository} implementation must pass, titled with the
 * implementation's name: the core tests, and those of each of `groups`. Each test runs against a
 * fresh store from `createStore`.
 */
export function describeAnalysisRepositoryConformance(
  implementationName: string,
  groups: readonly ConformanceGroup[],
  createStore: () => ConformanceStore,
): void {
  const supports = new Set(groups);
  if (
    supports.has('storage') &&
    !(supports.has('scope') && supports.has('draftState') && supports.has('wholeRead'))
  ) {
    throw new Error(
      "The 'storage' group runs only alongside 'scope', 'draftState', and 'wholeRead'.",
    );
  }

  /** `hook`, which the store must provide for a group that `groups` names. */
  function required<T>(hook: T | undefined, name: string): T {
    if (hook === undefined) {
      throw new Error(
        `${implementationName}'s store lacks ${name}, which a group it opts into needs.`,
      );
    }
    return hook;
  }

  /**
   * The parts of `draft` that a test may compare under the groups that were opted into: its
   * analysis with record lists in id order and no timestamps, its own record under `scope`, and its
   * unsaved mark under `draftState`.
   */
  function comparable(draft: DraftProject): ComparableDraft {
    return {
      ...(supports.has('scope') && scopeRecordOf(draft)),
      analysis: unstampedAnalysis(draft.analysis),
      ...(supports.has('draftState') && { dirty: draft.dirty }),
    };
  }

  /** Loads the draft through `repository`, expecting every book readable, as compared. */
  async function load(repository: AnalysisRepository): Promise<ComparableDraft> {
    const { draft, unreadableBooks } = await repository.exportAll();
    expect(unreadableBooks).toStrictEqual([]);
    return comparable(draft);
  }

  describe(`${implementationName} conforms to AnalysisRepository`, () => {
    let store: ConformanceStore;

    beforeEach(() => {
      store = createStore();
    });

    /** Every record stored for `sourceProjectId`, as compared. */
    async function readStored(sourceProjectId = SOURCE): Promise<ComparableDraft> {
      return comparable(await store.readAll(sourceProjectId));
    }

    /**
     * Loads the draft through a newly opened repository, expecting every book readable, as
     * compared.
     */
    async function reload(sourceProjectId = SOURCE): Promise<ComparableDraft> {
      return load(await store.open(sourceProjectId));
    }

    /** Loads the draft for copying through a newly opened repository, as compared. */
    async function reloadForCopy() {
      const { draft, unreadableBooks } = await (await store.open(SOURCE)).exportForCopy();
      return { draft: comparable(draft), unreadableBooks };
    }

    /**
     * A repository over {@link fullDraft}, opened after the seed so its first lookup loads the draft
     * from the store.
     */
    async function overFullDraft(): Promise<AnalysisRepository> {
      await store.seed(SOURCE, fullDraft());
      return store.open(SOURCE);
    }

    describe('core', () => {
      describe('apply', () => {
        it('puts new records of every kind', async () => {
          await store.seed(SOURCE, fullDraft());
          const repository = await store.open(SOURCE);

          await repository.apply(puttingNewRecords());

          await expect(readStored()).resolves.toStrictEqual(comparable(fullDraftWithNewRecords()));
        });

        it('replaces a stored record whole, dropping fields the put lacks', async () => {
          await store.seed(SOURCE, fullDraft());
          const repository = await store.open(SOURCE);
          const bare = { id: 'ta-beginning', ...FIXTURE_STAMPS, surfaceText: 'beginning' };

          await repository.apply({
            intent: 'replace',
            tokenAnalyses: { puts: [bare], deletes: [] },
          });

          const { analysis } = await readStored();
          expect(analysis.tokenAnalyses.find(({ id }) => id === 'ta-beginning')).toStrictEqual(
            unstamped(bare),
          );
        });

        it('deletes records of every kind', async () => {
          await store.seed(SOURCE, fullDraft());
          const repository = await store.open(SOURCE);

          await repository.apply(deletingExodus());

          await expect(readStored()).resolves.toStrictEqual(comparable(fullDraftWithoutExodus()));
        });

        it('skips a delete of a record that is not stored', async () => {
          await store.seed(SOURCE, fullDraft());
          const repository = await store.open(SOURCE);

          await repository.apply({
            intent: 'deleteMissing',
            tokenAnalyses: { puts: [], deletes: ['ta-missing'] },
          });

          await expect(readStored()).resolves.toStrictEqual(comparable(fullDraft()));
        });

        it('applies to a draft this repository never loaded', async () => {
          await store.seed(SOURCE, fullDraft());

          await (await store.open(SOURCE)).apply(puttingNewRecords());

          await expect(readStored()).resolves.toStrictEqual(comparable(fullDraftWithNewRecords()));
        });

        it('applies to a draft never saved as to an empty one', async () => {
          await (await store.open(SOURCE)).apply(puttingNewRecords());

          await expect(readStored()).resolves.toStrictEqual(
            comparable({
              ...emptyDraft(SOURCE),
              dirty: true,
              analysis: { ...emptyAnalysis(), ...newRecords() },
            }),
          );
        });

        it('builds each apply on the one before it', async () => {
          const repository = await store.open(SOURCE);
          const { tokenAnalyses, tokenAnalysisLinks } = newRecords();

          await repository.apply({
            intent: 'first',
            tokenAnalyses: { puts: tokenAnalyses, deletes: [] },
          });
          await repository.apply({
            intent: 'second',
            tokenAnalysisLinks: { puts: tokenAnalysisLinks, deletes: [] },
          });

          await expect(readStored()).resolves.toStrictEqual(
            comparable({
              ...emptyDraft(SOURCE),
              dirty: true,
              analysis: { ...emptyAnalysis(), tokenAnalyses, tokenAnalysisLinks },
            }),
          );
        });

        it('saves an edit to a payload linked from several books, for both books to load', async () => {
          await store.seed(SOURCE, fullDraft());
          const repository = await store.open(SOURCE);
          const edited = { ...fullAnalysis().tokenAnalyses[0], gloss: { en: 'and then' } };

          await repository.apply({
            intent: 'writeGloss',
            tokenAnalyses: { puts: [edited], deletes: [] },
          });

          const { analysis } = await readStored();
          expect(analysis.tokenAnalyses.filter(({ id }) => id === 'ta-and')).toStrictEqual([
            unstamped(edited),
          ]);
          expect(
            analysis.tokenAnalysisLinks.filter(({ analysisId }) => analysisId === 'ta-and'),
          ).toHaveLength(2);
        });

        it('stores what it was given, unaffected by later changes to the changes', async () => {
          const repository = await store.open(SOURCE);
          const changes = puttingNewRecords();
          await repository.apply(changes);

          changes.tokenAnalyses?.puts.push({
            id: 'ta-later',
            ...FIXTURE_STAMPS,
            surfaceText: 'later',
          });
          const [god] = changes.tokenAnalyses?.puts ?? [];
          god.surfaceText = 'changed';

          await expect(
            repository.getTokenAnalyses(['ta-god', 'ta-later']).then(unstampedInIdOrder),
          ).resolves.toStrictEqual(unstampedInIdOrder(newRecords().tokenAnalyses));
        });

        it('refuses an id named twice in one record kind, applying nothing', async () => {
          await store.seed(SOURCE, fullDraft());
          const repository = await store.open(SOURCE);
          const [and] = fullAnalysis().tokenAnalyses;

          await expect(
            repository.apply({
              intent: 'conflicting',
              tokenAnalyses: { puts: [{ ...and, gloss: { en: 'also' } }], deletes: ['ta-and'] },
            }),
          ).rejects.toThrow();

          await expect(readStored()).resolves.toStrictEqual(comparable(fullDraft()));
        });

        it('keeps the drafts of different source projects apart', async () => {
          await store.seed(SOURCE, fullDraft());

          await (await store.open('other-project')).apply(puttingNewRecords());

          await expect(readStored()).resolves.toStrictEqual(comparable(fullDraft()));
          await expect(readStored('other-project')).resolves.toStrictEqual(
            comparable({
              ...emptyDraft('other-project'),
              dirty: true,
              analysis: { ...emptyAnalysis(), ...newRecords() },
            }),
          );
        });
      });

      describe('lookups', () => {
        it('gets each payload kind by id, once per id, skipping ids with nothing stored', async () => {
          const repository = await overFullDraft();

          await expect(
            repository.getTokenAnalyses(['ta-and', 'ta-missing', 'ta-and']).then(idsOf),
          ).resolves.toStrictEqual(['ta-and']);
          await expect(
            repository.getPhraseAnalyses(['pa-in-the']).then((found) => found.map(unstamped)),
          ).resolves.toStrictEqual(fullAnalysis().phraseAnalyses.map(unstamped));
          await expect(
            repository
              .getSegmentAnalyses(['sa-exo', 'sa-missing'])
              .then((found) => found.map(unstamped)),
          ).resolves.toStrictEqual(fullAnalysis().segmentAnalyses.map(unstamped));
        });

        it('gets phrase links by id, once per id, skipping ids with nothing stored', async () => {
          const repository = await overFullDraft();

          await expect(
            repository
              .getPhraseAnalysisLinks(['pa-in-the', 'pl-missing', 'pa-in-the'])
              .then((found) => found.map(unstamped)),
          ).resolves.toStrictEqual(fullAnalysis().phraseAnalysisLinks.map(unstamped));
        });

        it('finds the token links on tokens, and the phrase links touching them, each once', async () => {
          const repository = await overFullDraft();

          await expect(
            repository.findLinksByToken(['GEN 1:1:0', 'GEN 1:1:2', 'GEN 1:1:4']).then(linkIdsOf),
          ).resolves.toStrictEqual({
            tokenAnalysisLinks: ['tl-gen-and'],
            phraseAnalysisLinks: ['pa-in-the'],
          });
        });

        it('finds the segment links on segments', async () => {
          const repository = await overFullDraft();

          await expect(
            repository.findLinksBySegment(['EXO 1:1', 'GEN 1:1']).then(idsOf),
          ).resolves.toStrictEqual(['sl-exo']);
        });

        it('finds the links of every kind to analyses', async () => {
          const repository = await overFullDraft();

          await expect(
            repository.findLinksToAnalyses(['ta-and', 'pa-in-the', 'sa-exo']).then(linkIdsOf),
          ).resolves.toStrictEqual({
            tokenAnalysisLinks: ['tl-exo-and', 'tl-gen-and'],
            phraseAnalysisLinks: ['pa-in-the'],
            segmentAnalysisLinks: ['sl-exo'],
          });
        });

        it('finds the links of every kind into books', async () => {
          const repository = await overFullDraft();

          await expect(repository.findLinksInBooks(['GEN']).then(linkIdsOf)).resolves.toStrictEqual(
            {
              tokenAnalysisLinks: ['tl-gen-and', 'tl-gen-beginning'],
              phraseAnalysisLinks: ['pa-in-the'],
              segmentAnalysisLinks: [],
            },
          );
        });

        it('finds the links into books with the statuses asked for', async () => {
          const repository = await overFullDraft();

          await expect(
            repository.findLinksInBooks(['GEN', 'EXO'], ['suggested']).then(linkIdsOf),
          ).resolves.toStrictEqual({
            tokenAnalysisLinks: ['tl-gen-beginning'],
            phraseAnalysisLinks: [],
            segmentAnalysisLinks: [],
          });
        });

        it('finds the books the links point into, each once', async () => {
          const repository = await overFullDraft();

          await expect(repository.findLinkedBooks().then((books) => books.sort())).resolves.toEqual(
            ['EXO', 'GEN'],
          );
        });

        it('finds a book only a phrase or segment link points into', async () => {
          const repository = await overFullDraft();

          await repository.apply({
            intent: 'unlinkTokens',
            tokenAnalysisLinks: {
              puts: [],
              deletes: ['tl-gen-and', 'tl-exo-and', 'tl-gen-beginning'],
            },
          });

          await expect(repository.findLinkedBooks().then((books) => books.sort())).resolves.toEqual(
            ['EXO', 'GEN'],
          );
        });

        it('finds a linked book whose code is outside the canon', async () => {
          const repository = await overFullDraft();

          await repository.apply({
            intent: 'linkOutsideCanon',
            tokenAnalysisLinks: {
              puts: [
                makeTokenLink('ta-and', 'ZZZ front1:0', { id: 'tl-zzz-and', surfaceText: 'and' }),
              ],
              deletes: [],
            },
          });

          await expect(repository.findLinkedBooks().then((books) => books.sort())).resolves.toEqual(
            ['EXO', 'GEN', 'ZZZ'],
          );
        });

        it('drops a book once no link points into it', async () => {
          const repository = await overFullDraft();

          await repository.apply({
            intent: 'unlinkExodus',
            tokenAnalysisLinks: { puts: [], deletes: ['tl-exo-and'] },
            segmentAnalysisLinks: { puts: [], deletes: ['sl-exo'] },
          });

          await expect(repository.findLinkedBooks()).resolves.toEqual(['GEN']);
        });

        it('finds no linked books in a draft never saved', async () => {
          await expect((await store.open(SOURCE)).findLinkedBooks()).resolves.toEqual([]);
        });

        it('finds the payloads whose surface text normalizes to a form', async () => {
          const repository = await overFullDraft();
          await repository.apply({
            intent: 'addCapitalized',
            tokenAnalyses: {
              puts: [{ id: 'ta-And', ...FIXTURE_STAMPS, surfaceText: 'And' }],
              deletes: [],
            },
          });

          await expect(
            repository.findTokenAnalysesByForm([normalizeSurfaceForm('AND')]).then(idsOf),
          ).resolves.toStrictEqual(['ta-And', 'ta-and']);
          await expect(
            repository.findPhraseAnalysesByForm([normalizeSurfaceForm('In The')]).then(idsOf),
          ).resolves.toStrictEqual(['pa-in-the']);
        });

        it('counts the tokens approving each analysis, leaving out those none approves', async () => {
          const repository = await overFullDraft();

          await expect(
            repository.countApprovals(['ta-and', 'ta-beginning', 'ta-unlinked', 'ta-missing']),
          ).resolves.toStrictEqual({ 'ta-and': 2 });
        });

        it('counts a token once, for the approved link an approval tie picks', async () => {
          const repository = await overFullDraft();
          const [genAnd, , beginning] = fullAnalysis().tokenAnalysisLinks;

          await repository.apply({
            intent: 'approveTwice',
            tokenAnalysisLinks: {
              puts: [
                {
                  ...beginning,
                  token: genAnd.token,
                  status: 'approved',
                  updatedAt: '2026-02-01T00:00:00.000Z',
                },
              ],
              deletes: [],
            },
          });

          await expect(
            repository.countApprovals(['ta-and', 'ta-beginning']),
          ).resolves.toStrictEqual({ 'ta-and': 1, 'ta-beginning': 1 });
        });

        it('passes over an approved link naming no stored payload when picking a tie', async () => {
          const repository = await overFullDraft();
          const [genAnd] = fullAnalysis().tokenAnalysisLinks;

          await repository.apply({
            intent: 'approveMissing',
            tokenAnalysisLinks: {
              puts: [
                {
                  ...genAnd,
                  id: 'tl-gen-missing',
                  analysisId: 'ta-missing',
                  updatedAt: '2026-02-01T00:00:00.000Z',
                },
              ],
              deletes: [],
            },
          });

          await expect(repository.countApprovals(['ta-and', 'ta-missing'])).resolves.toStrictEqual({
            'ta-and': 2,
          });
        });

        it('counts from the records the applied changes leave', async () => {
          const repository = await overFullDraft();
          await repository.countApprovals(['ta-and']);
          const [, , beginning] = fullAnalysis().tokenAnalysisLinks;
          const approvedBeginning = { ...beginning, status: 'approved' as const };

          await repository.apply({
            intent: 'approveAndDelete',
            tokenAnalysisLinks: { puts: [approvedBeginning], deletes: ['tl-exo-and'] },
          });
          await expect(
            repository.countApprovals(['ta-and', 'ta-beginning']),
          ).resolves.toStrictEqual({ 'ta-and': 1, 'ta-beginning': 1 });
          await repository.apply({
            intent: 'deleteAnalysis',
            tokenAnalyses: { puts: [], deletes: ['ta-beginning'] },
            tokenAnalysisLinks: { puts: [], deletes: ['tl-gen-beginning'] },
          });
          await expect(
            repository.countApprovals(['ta-and', 'ta-beginning']),
          ).resolves.toStrictEqual({ 'ta-and': 1 });
          await repository.apply({
            intent: 'restoreAnalysis',
            tokenAnalyses: { puts: [fullAnalysis().tokenAnalyses[1]], deletes: [] },
            tokenAnalysisLinks: { puts: [approvedBeginning], deletes: [] },
          });
          await expect(
            repository.countApprovals(['ta-and', 'ta-beginning']),
          ).resolves.toStrictEqual({ 'ta-and': 1, 'ta-beginning': 1 });
        });

        it('finds nothing in a draft never saved', async () => {
          const repository = await store.open(SOURCE);

          await expect(repository.findLinksInBooks(['GEN']).then(linkIdsOf)).resolves.toStrictEqual(
            {
              tokenAnalysisLinks: [],
              phraseAnalysisLinks: [],
              segmentAnalysisLinks: [],
            },
          );
          await expect(repository.getTokenAnalyses(['ta-and'])).resolves.toStrictEqual([]);
        });

        it('answers from the records the applied changes leave', async () => {
          const repository = await overFullDraft();
          await repository.findLinksInBooks(['GEN']);

          await repository.apply(mixedChanges());

          await expect(
            repository.findLinksToAnalyses(['ta-beginning', 'ta-god']).then(linkIdsOf),
          ).resolves.toStrictEqual({
            tokenAnalysisLinks: ['tl-gen-god'],
            phraseAnalysisLinks: [],
            segmentAnalysisLinks: [],
          });
          await expect(
            repository.findLinksBySegment(['GEN 1:1', 'EXO 1:1']).then(idsOf),
          ).resolves.toStrictEqual(['sl-gen']);
          await expect(
            repository.findLinksByToken(['GEN 1:1:2', 'GEN 1:1:13']).then(linkIdsOf),
          ).resolves.toStrictEqual({
            tokenAnalysisLinks: [],
            phraseAnalysisLinks: ['pa-the-beginning'],
          });
          await expect(
            repository.getTokenAnalyses(['ta-and']).then((found) => found.map(unstamped)),
          ).resolves.toStrictEqual([
            unstamped({ ...fullAnalysis().tokenAnalyses[0], gloss: { en: 'and then' } }),
          ]);
        });

        it('files an edited record under its new keys only', async () => {
          const repository = await overFullDraft();
          await repository.findLinksInBooks(['GEN']);
          const [, , beginning] = fullAnalysis().tokenAnalysisLinks;

          await repository.apply({
            intent: 'approve',
            tokenAnalysisLinks: { puts: [{ ...beginning, status: 'approved' }], deletes: [] },
          });

          await expect(
            repository.findLinksInBooks(['GEN'], ['suggested']).then(linkIdsOf),
          ).resolves.toMatchObject({ tokenAnalysisLinks: [] });
          await expect(
            repository.findLinksInBooks(['GEN'], ['approved']).then(linkIdsOf),
          ).resolves.toMatchObject({ tokenAnalysisLinks: ['tl-gen-and', 'tl-gen-beginning'] });
        });

        it('keeps the records of different source projects apart', async () => {
          await overFullDraft();

          const other = await store.open('other-project');

          await expect(other.getTokenAnalyses(['ta-and'])).resolves.toStrictEqual([]);
        });

        it('returns records the caller may change without changing what is stored', async () => {
          const repository = await overFullDraft();

          const [and] = await repository.getTokenAnalyses(['ta-and']);
          and.surfaceText = 'changed';
          const { tokenAnalysisLinks } = await repository.findLinksToAnalyses(['ta-and']);
          tokenAnalysisLinks[0].status = 'rejected';

          await expect(
            repository.getTokenAnalyses(['ta-and']).then((found) => found.map(unstamped)),
          ).resolves.toStrictEqual([unstamped(fullAnalysis().tokenAnalyses[0])]);
          await expect(
            repository.findLinksInBooks(['GEN', 'EXO'], ['rejected']).then(linkIdsOf),
          ).resolves.toMatchObject({ tokenAnalysisLinks: [] });
        });

        it('keeps indexes that match its records through applies', async () => {
          const repository = await overFullDraft();
          await repository.findLinksInBooks(['GEN']);

          await repository.apply(mixedChanges());
          await repository.apply(deletingExodus());
          await repository.apply(puttingNewRecords());

          await expect(repository.checkIndexes()).resolves.toStrictEqual([]);
        });
      });

      describe('capabilities', () => {
        it("lets a source project's draft be written", async () => {
          expect((await store.open(SOURCE)).capabilities.readOnly).toBe(false);
        });
      });
    });

    if (supports.has('scope')) {
      describe('scope', () => {
        it("reads the draft's own record", async () => {
          const repository = await overFullDraft();

          await expect(repository.getScope()).resolves.toStrictEqual(scopeRecordOf(fullDraft()));
        });

        it("reads the record of a draft never saved as an empty draft's", async () => {
          await expect((await store.open(SOURCE)).getScope()).resolves.toStrictEqual(
            scopeRecordOf(emptyDraft(SOURCE)),
          );
        });

        it('reads the record the applied changes leave', async () => {
          const repository = await overFullDraft();
          const scope = { ...scopeRecordOf(fullDraft()), analysisLanguages: ['de'] };

          await repository.apply({ intent: 'rescope', scope });

          await expect(repository.getScope()).resolves.toStrictEqual(scope);
        });

        it("carries boundary changes in the scope's record", async () => {
          await store.seed(SOURCE, fullDraft());
          const repository = await store.open(SOURCE);

          await repository.apply(resegmenting());

          await expect(readStored()).resolves.toStrictEqual(
            comparable({ ...fullDraft(), segmentation: newSegmentation() }),
          );
        });

        it("clears the boundaries when the scope's record carries none", async () => {
          await store.seed(SOURCE, fullDraft());
          const repository = await store.open(SOURCE);
          const { segmentation, ...withoutBoundaries } = scopeRecordOf(fullDraft());

          await repository.apply({ intent: 'resetBoundaries', scope: withoutBoundaries });

          const stored = await readStored();
          expect(segmentation).toBeDefined();
          expect(stored).not.toHaveProperty('segmentation');
        });

        it("refuses a scope's record of another source project, applying nothing", async () => {
          await store.seed(SOURCE, fullDraft());
          const repository = await store.open(SOURCE);

          await expect(
            repository.apply({
              intent: 'wrongScope',
              scope: { ...scopeRecordOf(fullDraft()), sourceProjectId: 'other-project' },
            }),
          ).rejects.toThrow();

          await expect(readStored()).resolves.toStrictEqual(comparable(fullDraft()));
        });

        if (supports.has('undo')) {
          it('undoes and redoes boundary changes through the inverse', async () => {
            await store.seed(SOURCE, fullDraft());
            const repository = await store.open(SOURCE);
            const { inverse } = await repository.apply(resegmenting());
            const changed = await readStored();

            const { inverse: redo } = await repository.apply(inverse);

            await expect(readStored()).resolves.toStrictEqual(comparable(fullDraft()));
            await repository.apply(redo);
            await expect(readStored()).resolves.toStrictEqual(changed);
          });
        }
      });
    }

    if (supports.has('undo')) {
      describe('undo', () => {
        it('returns an inverse that undoes the changes', async () => {
          await store.seed(SOURCE, fullDraft());
          const repository = await store.open(SOURCE);

          const { inverse } = await repository.apply(mixedChanges());
          await repository.apply(inverse);

          await expect(readStored()).resolves.toStrictEqual(comparable(fullDraft()));
        });

        it("redoes the changes when the inverse's inverse is applied", async () => {
          await store.seed(SOURCE, fullDraft());
          const repository = await store.open(SOURCE);
          const { inverse } = await repository.apply(mixedChanges());
          const changed = await readStored();
          const { inverse: redo } = await repository.apply(inverse);

          await repository.apply(redo);

          await expect(readStored()).resolves.toStrictEqual(changed);
        });

        it('undoes the changes through a newly opened repository', async () => {
          await store.seed(SOURCE, fullDraft());
          const { inverse } = await (await store.open(SOURCE)).apply(mixedChanges());

          await (await store.open(SOURCE)).apply(inverse);

          await expect(readStored()).resolves.toStrictEqual(comparable(fullDraft()));
        });

        it('names the intent of the changes in their inverse, as JSON-plain values', async () => {
          await store.seed(SOURCE, fullDraft());
          const repository = await store.open(SOURCE);

          const { inverse } = await repository.apply(mixedChanges());

          expect(inverse.intent).toBe('mixedChanges');
          expectJsonPlain(inverse);
        });

        it('stores what it applied, unaffected by later changes to the inverse', async () => {
          await store.seed(SOURCE, fullDraft());
          const repository = await store.open(SOURCE);
          const { inverse } = await repository.apply(mixedChanges());

          inverse.tokenAnalyses?.puts.forEach((payload) => {
            payload.surfaceText = 'changed';
          });
          inverse.tokenAnalyses?.deletes.push('ta-and');

          await expect(
            repository
              .getTokenAnalyses(['ta-and', 'ta-god', 'ta-unlinked'])
              .then(unstampedInIdOrder),
          ).resolves.toStrictEqual(
            unstampedInIdOrder([
              { ...fullAnalysis().tokenAnalyses[0], gloss: { en: 'and then' } },
              ...newRecords().tokenAnalyses,
            ]),
          );
        });

        it('returns an inverse with nothing to restore for a delete it skipped', async () => {
          await store.seed(SOURCE, fullDraft());
          const repository = await store.open(SOURCE);

          const { inverse } = await repository.apply({
            intent: 'deleteMissing',
            tokenAnalyses: { puts: [], deletes: ['ta-missing'] },
          });

          expect(inverse).toStrictEqual({ intent: 'deleteMissing' });
        });

        it('keeps indexes that match its records through undo and redo', async () => {
          const repository = await overFullDraft();
          await repository.findLinksInBooks(['GEN']);

          const { inverse } = await repository.apply(mixedChanges());
          const { inverse: redo } = await repository.apply(inverse);
          await repository.apply(redo);

          await expect(repository.checkIndexes()).resolves.toStrictEqual([]);
        });
      });
    }

    if (supports.has('draftState')) {
      describe('draft state', () => {
        describe('exportForCopy', () => {
          it('exports a saved draft whole, naming no book', async () => {
            await store.seed(SOURCE, fullDraft());

            await expect(reloadForCopy()).resolves.toStrictEqual({
              draft: comparable(fullDraft()),
              unreadableBooks: [],
            });
          });

          it('exports an empty draft for its source project when none is saved', async () => {
            await expect(reloadForCopy()).resolves.toStrictEqual({
              draft: comparable(emptyDraft(SOURCE)),
              unreadableBooks: [],
            });
          });
        });

        describe('markClean', () => {
          it('records the stored draft as clean, leaving its content as it stands', async () => {
            await store.seed(SOURCE, fullDraft());

            await (await store.open(SOURCE)).markClean();

            await expect(readStored()).resolves.toStrictEqual(
              comparable({ ...fullDraft(), dirty: false }),
            );
          });

          it('leaves an already-clean draft as it stands', async () => {
            await store.seed(SOURCE, exodusOnlyDraft());

            await (await store.open(SOURCE)).markClean();

            await expect(readStored()).resolves.toStrictEqual(comparable(exodusOnlyDraft()));
          });

          it('resolves when no draft is saved, which still loads as empty', async () => {
            await (await store.open(SOURCE)).markClean();

            await expect(readStored()).resolves.toStrictEqual(comparable(emptyDraft(SOURCE)));
          });
        });

        describe('apply', () => {
          it('marks a clean draft unsaved', async () => {
            await store.seed(SOURCE, exodusOnlyDraft());

            await (await store.open(SOURCE)).apply(translatingExodus());

            const { dirty } = await readStored();
            expect(dirty).toBe(true);
          });

          it.each([false, true])(
            'leaves a draft whose unsaved mark is %s as it was when asked to keep the mark',
            async (dirty) => {
              await store.seed(SOURCE, { ...exodusOnlyDraft(), dirty });

              await (await store.open(SOURCE)).apply(translatingExodus(), { keepDirty: true });

              await expect(readStored()).resolves.toMatchObject({
                dirty,
                analysis: {
                  segmentAnalyses: [
                    expect.objectContaining({ freeTranslation: { en: 'And then.' } }),
                  ],
                },
              });
            },
          );

          it.each([false, true])(
            'reports whether the draft was marked unsaved before the apply, when that mark was %s',
            async (dirty) => {
              await store.seed(SOURCE, { ...exodusOnlyDraft(), dirty });

              await expect(
                (await store.open(SOURCE)).apply(translatingExodus()),
              ).resolves.toMatchObject({ wasDirty: dirty });
            },
          );

          it('keeps the clean mark markClean left when asked to keep the mark', async () => {
            await store.seed(SOURCE, exodusOnlyDraft());
            const repository = await store.open(SOURCE);
            await repository.apply(translatingExodus());
            await repository.markClean();

            await repository.apply(deletingExodus(), { keepDirty: true });

            const { dirty } = await readStored();
            expect(dirty).toBe(false);
          });

          if (supports.has('wholeRead')) {
            it('keeps the clean mark markClean left after a load when asked to keep the mark', async () => {
              await store.seed(SOURCE, { ...exodusOnlyDraft(), dirty: true });
              const repository = await store.open(SOURCE);
              await repository.exportAll();
              await repository.markClean();

              await repository.apply(translatingExodus(), { keepDirty: true });

              const { dirty } = await readStored();
              expect(dirty).toBe(false);
            });
          }

          if (supports.has('undo')) {
            it('leaves the draft unsaved when undoing an edit made before it was marked clean', async () => {
              await store.seed(SOURCE, exodusOnlyDraft());
              const repository = await store.open(SOURCE);
              const { inverse } = await repository.apply(translatingExodus());
              await repository.markClean();

              await repository.apply(inverse);

              await expect(readStored()).resolves.toStrictEqual(
                comparable({ ...exodusOnlyDraft(), dirty: true }),
              );
            });
          }
        });

        if (supports.has('wholeRead')) {
          describe('getWholeDraft', () => {
            it('reads the whole draft as saved once marked clean', async () => {
              const repository = await overFullDraft();
              await repository.apply({
                intent: 'unlinkExodus',
                tokenAnalysisLinks: { puts: [], deletes: ['tl-exo-and'] },
              });

              await repository.markClean();

              await expect(repository.getWholeDraft()).resolves.toMatchObject({ dirty: false });
            });
          });
        }
      });
    }

    if (supports.has('wholeRead')) {
      describe('whole read', () => {
        describe('exportAll', () => {
          it('loads an empty draft for its source project when none is saved', async () => {
            await expect(reload()).resolves.toStrictEqual(comparable(emptyDraft(SOURCE)));
          });

          it('returns a saved draft as JSON-plain values, omitting absent optional fields rather than nulling them', async () => {
            const minimal: DraftProject = {
              ...emptyDraft(SOURCE),
              analysis: {
                ...emptyAnalysis(),
                tokenAnalyses: [{ id: 'ta-and', ...FIXTURE_STAMPS, surfaceText: 'and' }],
                tokenAnalysisLinks: [
                  makeTokenLink('ta-and', 'GEN 1:1:0', { id: 'tl-and', surfaceText: 'and' }),
                ],
              },
            };
            await store.seed(SOURCE, minimal);

            expectJsonPlain(await (await store.open(SOURCE)).exportAll());
            await expect(reload()).resolves.toStrictEqual(comparable(minimal));
          });

          it('returns a never-saved draft as JSON-plain values', async () => {
            expectJsonPlain(await (await store.open(SOURCE)).exportAll());
          });

          it('returns a draft the caller may change without changing what is stored', async () => {
            await store.seed(SOURCE, fullDraft());
            const repository = await store.open(SOURCE);

            changeInPlace((await repository.exportAll()).draft);

            await expect(load(repository)).resolves.toStrictEqual(comparable(fullDraft()));
          });

          it('loads what its own applies leave', async () => {
            await store.seed(SOURCE, fullDraft());
            const repository = await store.open(SOURCE);
            await repository.exportAll();

            await repository.apply(puttingNewRecords());

            await expect(load(repository)).resolves.toStrictEqual(
              comparable(fullDraftWithNewRecords()),
            );
          });

          it('applies over a draft another repository changed, once reloaded', async () => {
            await store.seed(SOURCE, fullDraft());
            const repository = await store.open(SOURCE);
            await repository.exportAll();
            const translating = translatingExodus();
            await (await store.open(SOURCE)).apply(translating);
            await repository.exportAll();

            await repository.apply({
              intent: 'unlinkExodus',
              tokenAnalysisLinks: { puts: [], deletes: ['tl-exo-and'] },
            });

            const expected = fullDraft();
            expected.analysis.segmentAnalyses = translating.segmentAnalyses?.puts ?? [];
            expected.analysis.tokenAnalysisLinks = expected.analysis.tokenAnalysisLinks.filter(
              ({ id }) => id !== 'tl-exo-and',
            );
            await expect(readStored()).resolves.toStrictEqual(comparable(expected));
          });

          it('answers from a draft another repository changed, once reloaded', async () => {
            const repository = await overFullDraft();
            await repository.findLinksInBooks(['GEN', 'EXO']);
            await (await store.open(SOURCE)).apply(deletingExodus());

            await repository.exportAll();

            await expect(
              repository.findLinksInBooks(['GEN', 'EXO']).then(linkIdsOf),
            ).resolves.toStrictEqual({
              tokenAnalysisLinks: ['tl-gen-and', 'tl-gen-beginning'],
              phraseAnalysisLinks: ['pa-in-the'],
              segmentAnalysisLinks: [],
            });
          });

          it('answers and applies unaffected by changes to a draft it exported', async () => {
            const repository = await overFullDraft();
            changeInPlace((await repository.exportAll()).draft);

            await expect(
              repository.getTokenAnalyses(['ta-and']).then(unstampedInIdOrder),
            ).resolves.toStrictEqual([unstamped(fullAnalysis().tokenAnalyses[0])]);
            await repository.apply(puttingNewRecords());

            await expect(
              readStored().then(({ analysis }) =>
                analysis.tokenAnalyses.find(({ id }) => id === 'ta-and'),
              ),
            ).resolves.toStrictEqual(unstamped(fullAnalysis().tokenAnalyses[0]));
          });
        });

        describe('getWholeDraft', () => {
          it('reads the whole draft the applied changes leave', async () => {
            const repository = await overFullDraft();

            await repository.apply({
              intent: 'unlinkExodus',
              tokenAnalysisLinks: { puts: [], deletes: ['tl-exo-and'] },
            });

            const expected = fullDraft();
            expected.analysis.tokenAnalysisLinks = expected.analysis.tokenAnalysisLinks.filter(
              (link) => link.id !== 'tl-exo-and',
            );
            await expect(repository.getWholeDraft().then(comparable)).resolves.toStrictEqual(
              comparable(expected),
            );
          });

          it('reads a draft the caller may change without changing later reads', async () => {
            const repository = await overFullDraft();

            changeInPlace(await repository.getWholeDraft());

            await expect(repository.getWholeDraft().then(comparable)).resolves.toStrictEqual(
              comparable(fullDraft()),
            );
          });

          it('reads a draft never saved as an empty one', async () => {
            await expect(
              (await store.open(SOURCE)).getWholeDraft().then(comparable),
            ).resolves.toStrictEqual(comparable(emptyDraft(SOURCE)));
          });
        });
      });
    }

    if (supports.has('storage')) {
      describe('storage', () => {
        let hooks: StorageHooks;

        beforeEach(() => {
          hooks = required(store.storage, 'storage hooks');
        });

        /** A repository that has loaded {@link fullDraft} with GEN's stored analysis unreadable. */
        async function loadedWithUnreadableGenesis(): Promise<AnalysisRepository> {
          await store.seed(SOURCE, fullDraft());
          await hooks.damageBook(SOURCE, 'GEN', 'corrupt');
          const repository = await store.open(SOURCE);
          await repository.exportAll();
          return repository;
        }

        describe('exportAll', () => {
          it('refuses a draft written by a newer build', async () => {
            await hooks.storeNewerBuildDraft(SOURCE);

            await expect((await store.open(SOURCE)).exportAll()).rejects.toThrow();
          });

          it.each(['corrupt', 'lost'] as const)(
            'names a book whose stored analysis is %s, and loads the rest',
            async (damage) => {
              await store.seed(SOURCE, fullDraft());
              await hooks.damageBook(SOURCE, 'GEN', damage);

              const { draft, unreadableBooks } = await (await store.open(SOURCE)).exportAll();

              expect(unreadableBooks).toStrictEqual(['GEN']);
              expect(comparable(draft)).toStrictEqual(comparable(fullDraftWithoutGenesis()));
            },
          );

          it('loads an unusable draft as an empty one', async () => {
            await store.seed(SOURCE, fullDraft());
            await hooks.damageDraft(SOURCE);

            await expect(reload()).resolves.toStrictEqual(comparable(emptyDraft(SOURCE)));
          });
        });

        describe('exportForCopy', () => {
          it.each(['corrupt', 'lost'] as const)(
            'names a book whose stored analysis is %s, and exports the rest',
            async (damage) => {
              await store.seed(SOURCE, fullDraft());
              await hooks.damageBook(SOURCE, 'GEN', damage);

              await expect(reloadForCopy()).resolves.toStrictEqual({
                draft: comparable(fullDraftWithoutGenesis()),
                unreadableBooks: ['GEN'],
              });
            },
          );

          it('refuses an unusable draft rather than exporting it empty', async () => {
            await store.seed(SOURCE, fullDraft());
            await hooks.damageDraft(SOURCE);

            await expect((await store.open(SOURCE)).exportForCopy()).rejects.toThrow();
          });

          it('refuses a draft written by a newer build', async () => {
            await hooks.storeNewerBuildDraft(SOURCE);

            await expect((await store.open(SOURCE)).exportForCopy()).rejects.toThrow();
          });
        });

        describe('replaceAll', () => {
          it('saves every record kind and optional field for the same repository to load', async () => {
            const repository = await store.open(SOURCE);
            await repository.replaceAll(fullDraft());

            await expect(load(repository)).resolves.toStrictEqual(comparable(fullDraft()));
          });

          it('saves a draft for a newly opened repository to load', async () => {
            await (await store.open(SOURCE)).replaceAll(fullDraft());

            await expect(reload()).resolves.toStrictEqual(comparable(fullDraft()));
          });

          it('keeps a payload linked from several books as one record', async () => {
            await (await store.open(SOURCE)).replaceAll(fullDraft());

            const { analysis } = await reload();

            expect(analysis.tokenAnalyses.filter(({ id }) => id === 'ta-and')).toHaveLength(1);
          });

          it('saves an edit to a payload linked from several books', async () => {
            const repository = await store.open(SOURCE);
            await repository.replaceAll(fullDraft());
            const { draft } = await repository.exportAll();
            draft.analysis.tokenAnalyses = draft.analysis.tokenAnalyses.map((payload) =>
              payload.id === 'ta-and' ? { ...payload, gloss: { en: 'and then' } } : payload,
            );

            await repository.replaceAll(draft);

            await expect(reload()).resolves.toStrictEqual(comparable(draft));
            await hooks.damageBook(SOURCE, 'GEN', 'corrupt');
            const {
              draft: { analysis },
            } = await reloadForCopy();
            expect(analysis.tokenAnalyses.find(({ id }) => id === 'ta-and')?.gloss).toStrictEqual({
              en: 'and then',
            });
          });

          it('stamps what it saves with the current model version', async () => {
            await (
              await store.open(SOURCE)
            ).replaceAll({ ...fullDraft(), modelVersion: CURRENT_MODEL_VERSION - 1 });

            const { modelVersion } = await reload();

            expect(modelVersion).toBe(CURRENT_MODEL_VERSION);
          });

          it('replaces the stored draft whole, dropping records the saved draft lacks', async () => {
            const repository = await store.open(SOURCE);
            await repository.replaceAll(fullDraft());
            await repository.exportAll();

            await repository.replaceAll(exodusOnlyDraft());

            await expect(reload()).resolves.toStrictEqual(comparable(exodusOnlyDraft()));
          });

          it('drops records the saved draft lacks even when this repository never loaded them', async () => {
            await (await store.open(SOURCE)).replaceAll(fullDraft());

            await (await store.open(SOURCE)).replaceAll(exodusOnlyDraft());

            await expect(reload()).resolves.toStrictEqual(comparable(exodusOnlyDraft()));
          });

          it('saves in full after reloading a draft another repository replaced', async () => {
            const repository = await store.open(SOURCE);
            await repository.replaceAll(fullDraft());
            await (await store.open(SOURCE)).replaceAll(exodusOnlyDraft());
            await expect(load(repository)).resolves.toStrictEqual(comparable(exodusOnlyDraft()));

            await repository.replaceAll(fullDraft());

            await expect(reload()).resolves.toStrictEqual(comparable(fullDraft()));
          });

          it('saves an emptied analysis as empty', async () => {
            const repository = await store.open(SOURCE);
            await repository.replaceAll(fullDraft());

            await repository.replaceAll({ ...fullDraft(), analysis: emptyAnalysis() });

            await expect(reload()).resolves.toStrictEqual(
              comparable({ ...fullDraft(), analysis: emptyAnalysis() }),
            );
          });

          it('restores records a later save brings back', async () => {
            const repository = await store.open(SOURCE);
            await repository.replaceAll(fullDraft());
            await repository.replaceAll(exodusOnlyDraft());

            await repository.replaceAll(fullDraft());

            await expect(reload()).resolves.toStrictEqual(comparable(fullDraft()));
          });

          it('stores what it was given, unaffected by later changes to that draft', async () => {
            const repository = await store.open(SOURCE);
            const draft = fullDraft();
            await repository.replaceAll(draft);

            changeInPlace(draft);

            await expect(load(repository)).resolves.toStrictEqual(comparable(fullDraft()));
            await expect(reload()).resolves.toStrictEqual(comparable(fullDraft()));
          });

          it('stores in-place changes to a saved draft when that draft is saved again', async () => {
            const repository = await store.open(SOURCE);
            const draft = fullDraft();
            await repository.replaceAll(draft);
            changeInPlace(draft);

            await repository.replaceAll(draft);

            await expect(reload()).resolves.toStrictEqual(comparable(draft));
          });

          it('keeps the drafts of different source projects apart', async () => {
            const other = { ...exodusOnlyDraft(), sourceProjectId: 'other-project' };
            await (await store.open(SOURCE)).replaceAll(fullDraft());

            await (await store.open('other-project')).replaceAll(other);

            await expect(reload()).resolves.toStrictEqual(comparable(fullDraft()));
            await expect(reload('other-project')).resolves.toStrictEqual(comparable(other));
          });

          it('leaves a draft written by a newer build in place, refusing to overwrite it', async () => {
            await hooks.storeNewerBuildDraft(SOURCE);

            await expect((await store.open(SOURCE)).replaceAll(fullDraft())).rejects.toThrow();

            await expect((await store.open(SOURCE)).exportAll()).rejects.toThrow();
          });

          it('resolves once the draft has landed even if cleanup after it fails, and a later save finishes that cleanup', async () => {
            await (await store.open(SOURCE)).replaceAll(fullDraft());
            const restore = hooks.failCleanup(SOURCE);

            await expect(
              (await store.open(SOURCE)).replaceAll(exodusOnlyDraft()),
            ).resolves.toStrictEqual([]);
            await expect(hooks.holdsLeftovers(SOURCE)).resolves.toBe(true);

            restore();
            await expect(reload()).resolves.toStrictEqual(comparable(exodusOnlyDraft()));
            await (await store.open(SOURCE)).replaceAll(exodusOnlyDraft());
            await expect(hooks.holdsLeftovers(SOURCE)).resolves.toBe(false);
          });

          it('lets the next apply build on the save, not on an apply before it', async () => {
            const repository = await store.open(SOURCE);
            await repository.apply(puttingNewRecords());
            await repository.replaceAll(fullDraft());

            await repository.apply({
              intent: 'deleteUnlinked',
              tokenAnalyses: { puts: [], deletes: ['ta-unlinked'] },
            });

            await expect(reload()).resolves.toStrictEqual(
              comparable({
                ...fullDraft(),
                analysis: {
                  ...fullAnalysis(),
                  tokenAnalyses: fullAnalysis().tokenAnalyses.filter(
                    ({ id }) => id !== 'ta-unlinked',
                  ),
                },
              }),
            );
          });
        });

        describe('replaceAll after loading a book that could not be read', () => {
          it('keeps the book as stored when the draft carries nothing for it, leaving out no book', async () => {
            const repository = await loadedWithUnreadableGenesis();

            await expect(repository.replaceAll(exodusOnlyDraft())).resolves.toStrictEqual([]);

            await expect(reloadForCopy()).resolves.toStrictEqual({
              draft: comparable(exodusOnlyDraft()),
              unreadableBooks: ['GEN'],
            });
          });

          it('resolves with the book, keeping it as stored, when the draft carries analysis for it', async () => {
            const repository = await loadedWithUnreadableGenesis();
            const withoutSegments = (draft: DraftProject): DraftProject => ({
              ...draft,
              analysis: { ...draft.analysis, segmentAnalyses: [], segmentAnalysisLinks: [] },
            });

            await expect(
              repository.replaceAll(withoutSegments(fullDraft())),
            ).resolves.toStrictEqual(['GEN']);

            await expect(reloadForCopy()).resolves.toStrictEqual({
              draft: comparable(withoutSegments(fullDraftWithoutGenesis())),
              unreadableBooks: ['GEN'],
            });
          });

          it('writes the book like any other once told to discard what could not be read', async () => {
            const repository = await loadedWithUnreadableGenesis();

            await expect(
              repository.replaceAll(fullDraft(), { discardUnreadable: true }),
            ).resolves.toStrictEqual([]);

            await expect(reload()).resolves.toStrictEqual(comparable(fullDraft()));
          });

          it('wipes the book the draft carries nothing for once told to discard what could not be read', async () => {
            const repository = await loadedWithUnreadableGenesis();

            await repository.replaceAll(exodusOnlyDraft(), { discardUnreadable: true });

            await expect(reload()).resolves.toStrictEqual(comparable(exodusOnlyDraft()));
            await expect(hooks.holdsLeftovers(SOURCE)).resolves.toBe(false);
          });
        });

        describe('markClean', () => {
          it('keeps a book that could not be read as stored', async () => {
            await store.seed(SOURCE, fullDraft());
            await hooks.damageBook(SOURCE, 'GEN', 'corrupt');

            await (await store.open(SOURCE)).markClean();

            await expect(reloadForCopy()).resolves.toStrictEqual({
              draft: comparable({ ...fullDraftWithoutGenesis(), dirty: false }),
              unreadableBooks: ['GEN'],
            });
          });

          it('refuses a draft written by a newer build, leaving it in place', async () => {
            await hooks.storeNewerBuildDraft(SOURCE);

            await expect((await store.open(SOURCE)).markClean()).rejects.toThrow();

            await expect((await store.open(SOURCE)).exportAll()).rejects.toThrow();
          });

          it('refuses an unusable draft, leaving it in place', async () => {
            await store.seed(SOURCE, fullDraft());
            await hooks.damageDraft(SOURCE);

            await expect((await store.open(SOURCE)).markClean()).rejects.toThrow();

            await expect((await store.open(SOURCE)).exportForCopy()).rejects.toThrow();
          });
        });

        describe('apply', () => {
          it("saves an edit to a payload linked from several books into each book's stored analysis", async () => {
            await store.seed(SOURCE, fullDraft());
            const edited = { ...fullAnalysis().tokenAnalyses[0], gloss: { en: 'and then' } };

            await (
              await store.open(SOURCE)
            ).apply({ intent: 'writeGloss', tokenAnalyses: { puts: [edited], deletes: [] } });

            await hooks.damageBook(SOURCE, 'GEN', 'corrupt');
            const { draft } = await reloadForCopy();
            expect(draft.analysis.tokenAnalyses.filter(({ id }) => id === 'ta-and')).toStrictEqual([
              unstamped(edited),
            ]);
          });

          it('stamps what it applies with the current model version', async () => {
            await (
              await store.open(SOURCE)
            ).apply({
              intent: 'stamp',
              scope: { ...scopeRecordOf(fullDraft()), modelVersion: CURRENT_MODEL_VERSION - 1 },
            });

            const { modelVersion } = await reload();

            expect(modelVersion).toBe(CURRENT_MODEL_VERSION);
          });

          it('resolves once the changes have landed even if cleanup after them fails, and a later apply finishes that cleanup', async () => {
            await store.seed(SOURCE, fullDraft());
            const restore = hooks.failCleanup(SOURCE);

            await (await store.open(SOURCE)).apply(deletingExodus());
            await expect(hooks.holdsLeftovers(SOURCE)).resolves.toBe(true);

            restore();
            await expect(reload()).resolves.toStrictEqual(comparable(fullDraftWithoutExodus()));
            await (await store.open(SOURCE)).apply({ intent: 'nothing' });
            await expect(hooks.holdsLeftovers(SOURCE)).resolves.toBe(false);
          });

          it('leaves a draft written by a newer build in place, refusing to apply over it', async () => {
            await hooks.storeNewerBuildDraft(SOURCE);

            await expect((await store.open(SOURCE)).apply(puttingNewRecords())).rejects.toThrow();

            await expect((await store.open(SOURCE)).exportAll()).rejects.toThrow();
          });
        });

        describe('apply after loading a book that could not be read', () => {
          it('refuses changes that reach the book, applying nothing', async () => {
            const repository = await loadedWithUnreadableGenesis();

            await expect(repository.apply(puttingNewRecords())).rejects.toThrow();

            await expect(reloadForCopy()).resolves.toStrictEqual({
              draft: comparable(fullDraftWithoutGenesis()),
              unreadableBooks: ['GEN'],
            });
          });

          it('applies changes elsewhere, keeping the book as stored', async () => {
            const repository = await loadedWithUnreadableGenesis();
            const changes = translatingExodus();

            await repository.apply(changes);

            await expect(reloadForCopy()).resolves.toStrictEqual({
              draft: comparable({
                ...fullDraftWithoutGenesis(),
                analysis: {
                  ...fullDraftWithoutGenesis().analysis,
                  segmentAnalyses: changes.segmentAnalyses?.puts ?? [],
                },
              }),
              unreadableBooks: ['GEN'],
            });
          });
        });
      });
    }
  });
}

/**
 * Declares the tests a read-only {@link AnalysisRepository} implementation must pass, as a Paratext
 * 9 import's does, titled with the implementation's name. Each test runs against a fresh store from
 * `createStore`.
 */
export function describeReadOnlyRepositoryConformance(
  implementationName: string,
  createStore: () => ReadOnlyConformanceStore,
): void {
  describe(`${implementationName} conforms to a read-only AnalysisRepository`, () => {
    let store: ReadOnlyConformanceStore;

    beforeEach(() => {
      store = createStore();
    });

    it('is marked read-only', async () => {
      expect((await store.openReadOnly(fullDraft())).capabilities.readOnly).toBe(true);
    });

    it('loads the analysis it was opened over', async () => {
      const repository = await store.openReadOnly(fullDraft());

      await expect(analysisLoadedBy(repository)).resolves.toStrictEqual(
        inIdOrder(fullDraft()).analysis,
      );
    });

    it('loads JSON-plain values', async () => {
      expectJsonPlain(await (await store.openReadOnly(fullDraft())).exportAll());
    });

    it('returns a draft the caller may change without changing what is stored', async () => {
      const repository = await store.openReadOnly(fullDraft());

      const { draft: loaded } = await repository.exportAll();
      loaded.analysis.tokenAnalyses[0].surfaceText = 'changed';

      await expect(analysisLoadedBy(repository)).resolves.toStrictEqual(
        inIdOrder(fullDraft()).analysis,
      );
    });

    it('answers lookups from the analysis it was opened over, with indexes that match it', async () => {
      const repository = await store.openReadOnly(fullDraft());

      await expect(
        repository.findLinksToAnalyses(['ta-and']).then(linkIdsOf),
      ).resolves.toStrictEqual({
        tokenAnalysisLinks: ['tl-exo-and', 'tl-gen-and'],
        phraseAnalysisLinks: [],
        segmentAnalysisLinks: [],
      });
      await expect(repository.checkIndexes()).resolves.toStrictEqual([]);
    });

    it('answers lookups unaffected by changes to a draft it exported', async () => {
      const repository = await store.openReadOnly(fullDraft());

      changeInPlace((await repository.exportAll()).draft);

      await expect(repository.getTokenAnalyses(['ta-and'])).resolves.toStrictEqual([
        fullAnalysis().tokenAnalyses[0],
      ]);
    });

    it('refuses a save, leaving what it loads unchanged', async () => {
      const repository = await store.openReadOnly(fullDraft());

      await expect(repository.replaceAll(exodusOnlyDraft())).rejects.toThrow(ReadOnlyAnalysisError);

      await expect(analysisLoadedBy(repository)).resolves.toStrictEqual(
        inIdOrder(fullDraft()).analysis,
      );
    });

    it('loads for copying what it loads', async () => {
      const repository = await store.openReadOnly(fullDraft());

      const { draft, unreadableBooks } = await repository.exportForCopy();

      expect(unreadableBooks).toStrictEqual([]);
      expect(inIdOrder(draft).analysis).toStrictEqual(inIdOrder(fullDraft()).analysis);
    });

    it('refuses to be marked clean', async () => {
      const repository = await store.openReadOnly(fullDraft());

      await expect(repository.markClean()).rejects.toThrow(ReadOnlyAnalysisError);
    });

    it('refuses to apply changes, leaving what it loads unchanged', async () => {
      const repository = await store.openReadOnly(fullDraft());

      await expect(repository.apply(puttingNewRecords())).rejects.toThrow(ReadOnlyAnalysisError);

      await expect(analysisLoadedBy(repository)).resolves.toStrictEqual(
        inIdOrder(fullDraft()).analysis,
      );
    });

    it("keeps apart from the source project's draft", async () => {
      await store.seed(SOURCE, exodusOnlyDraft());

      const repository = await store.openReadOnly(fullDraft());
      const translating = translatingExodus();
      await (await store.open(SOURCE)).apply(translating);

      await expect(analysisLoadedBy(repository)).resolves.toStrictEqual(
        inIdOrder(fullDraft()).analysis,
      );
      const { analysis } = exodusOnlyDraft();
      await expect(
        store.readAll(SOURCE).then((draft) => unstampedAnalysis(draft.analysis)),
      ).resolves.toStrictEqual(
        unstampedAnalysis({
          ...analysis,
          segmentAnalyses: translating.segmentAnalyses?.puts ?? [],
        }),
      );
    });
  });
}
