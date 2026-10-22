/// <reference types="jest" />

import type { DraftProject, TextAnalysis } from 'interlinearizer';
import type {
  AnalysisLinks,
  AnalysisRepository,
  ChangeSet,
  DraftExport,
} from '../types/analysis-repository';
import { emptyAnalysis, emptyDraft } from '../types/empty-factories';
import { CURRENT_MODEL_VERSION } from '../types/model-version';
import { ReadOnlyAnalysisError } from '../types/read-only-analysis-error';
import { normalizeSurfaceForm } from '../utils/analysis-identity';
import { scopeRecordOf } from '../utils/change-set';
import { FIXTURE_STAMPS, makePhraseLink } from './test-helpers';

/** One empty store an {@link AnalysisRepository} implementation keeps drafts in. */
export interface ConformanceStore {
  /**
   * Opens a repository for `sourceProjectId`. Every repository this store opens reaches the same
   * stored drafts, as one opened after a restart would.
   */
  open(sourceProjectId: string): Promise<AnalysisRepository>;

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
   * fail, leaving storage that {@link ConformanceStore.holdsLeftovers} reports, until the returned
   * function is called.
   */
  failCleanup(sourceProjectId: string): () => void;

  /** Whether storage holds anything for `sourceProjectId` that its stored draft no longer needs. */
  holdsLeftovers(sourceProjectId: string): Promise<boolean>;

  /**
   * Stores `draft`'s analysis where only a read-only repository reaches it, as for a Paratext 9
   * import of `draft`'s source project, and opens that repository.
   */
  openReadOnly(draft: DraftProject): Promise<AnalysisRepository>;
}

const SOURCE = 'source-project';

function tokenLink(id: string, analysisId: string, tokenRef: string, surfaceText: string) {
  return {
    id,
    analysisId,
    ...FIXTURE_STAMPS,
    status: 'approved' as const,
    token: { tokenRef, surfaceText },
  };
}

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
      tokenLink('tl-gen-and', 'ta-and', 'GEN 1:1:0', 'and'),
      tokenLink('tl-exo-and', 'ta-and', 'EXO 1:1:0', 'and'),
      {
        ...tokenLink('tl-gen-beginning', 'ta-beginning', 'GEN 1:1:9', 'beginning'),
        status: 'suggested',
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
    tokenAnalysisLinks: [tokenLink('tl-gen-god', 'ta-god', 'GEN 1:1:17', 'God')],
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
 * Changes to {@link fullDraft} of every sort: new records and deleted ones in every kind, a replaced
 * payload, and new boundaries in the scope's record.
 */
function mixedChanges(): ChangeSet {
  const { analysis } = fullDraft();
  const records = newRecords();
  return {
    intent: 'mixedChanges',
    scope: {
      ...scopeRecordOf(fullDraft()),
      dirty: false,
      segmentation: {
        removedVerseStarts: [],
        addedStarts: [{ tokenRef: 'GEN 1:1:9', surfaceText: 'beginning' }],
      },
    },
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

/**
 * Expects `exported` to name no unreadable book, and returns its draft with record lists in id
 * order.
 */
function readableDraft(exported: DraftExport): DraftProject {
  expect(exported.unreadableBooks).toStrictEqual([]);
  return inIdOrder(exported.draft);
}

/**
 * Loads the draft through `repository`, expecting every book readable, with record lists in id
 * order.
 */
async function load(repository: AnalysisRepository): Promise<DraftProject> {
  return readableDraft(await repository.exportAll());
}

/**
 * Loads the draft through a newly opened repository, expecting every book readable, with record
 * lists in id order.
 */
async function reload(store: ConformanceStore, sourceProjectId = SOURCE): Promise<DraftProject> {
  return load(await store.open(sourceProjectId));
}

/** Loads the draft for copying through a newly opened repository, with record lists in id order. */
async function reloadForCopy(store: ConformanceStore): Promise<DraftExport> {
  const { draft, unreadableBooks } = await (await store.open(SOURCE)).exportForCopy();
  return { draft: inIdOrder(draft), unreadableBooks };
}

/** A repository that has loaded {@link fullDraft} with GEN's stored analysis unreadable. */
async function loadedWithUnreadableGenesis(store: ConformanceStore): Promise<AnalysisRepository> {
  await (await store.open(SOURCE)).replaceAll(fullDraft());
  await store.damageBook(SOURCE, 'GEN', 'corrupt');
  const repository = await store.open(SOURCE);
  await repository.exportAll();
  return repository;
}

/**
 * Declares the tests every {@link AnalysisRepository} implementation must pass, titled with the
 * implementation's name. Each test runs against a fresh store from `createStore`.
 */
export function describeAnalysisRepositoryConformance(
  implementationName: string,
  createStore: () => ConformanceStore,
): void {
  describe(`${implementationName} conforms to AnalysisRepository`, () => {
    let store: ConformanceStore;

    beforeEach(() => {
      store = createStore();
    });

    describe('exportAll', () => {
      it('loads an empty draft for its source project when none is saved', async () => {
        await expect(reload(store)).resolves.toStrictEqual(emptyDraft(SOURCE));
      });

      it('returns a saved draft as JSON-plain values, omitting absent optional fields rather than nulling them', async () => {
        const minimal: DraftProject = {
          ...emptyDraft(SOURCE),
          analysis: {
            ...emptyAnalysis(),
            tokenAnalyses: [{ id: 'ta-and', ...FIXTURE_STAMPS, surfaceText: 'and' }],
            tokenAnalysisLinks: [tokenLink('tl-and', 'ta-and', 'GEN 1:1:0', 'and')],
          },
        };
        await (await store.open(SOURCE)).replaceAll(minimal);

        expectJsonPlain(await (await store.open(SOURCE)).exportAll());
        await expect(reload(store)).resolves.toStrictEqual(minimal);
      });

      it('returns a never-saved draft as JSON-plain values', async () => {
        expectJsonPlain(await (await store.open(SOURCE)).exportAll());
      });

      it('returns a draft the caller may change without changing what is stored', async () => {
        const repository = await store.open(SOURCE);
        await repository.replaceAll(fullDraft());

        changeInPlace((await repository.exportAll()).draft);

        await expect(load(repository)).resolves.toStrictEqual(inIdOrder(fullDraft()));
      });

      it('refuses a draft written by a newer build', async () => {
        await store.storeNewerBuildDraft(SOURCE);

        await expect((await store.open(SOURCE)).exportAll()).rejects.toThrow();
      });

      it.each(['corrupt', 'lost'] as const)(
        'names a book whose stored analysis is %s, and loads the rest',
        async (damage) => {
          await (await store.open(SOURCE)).replaceAll(fullDraft());
          await store.damageBook(SOURCE, 'GEN', damage);

          const { draft, unreadableBooks } = await (await store.open(SOURCE)).exportAll();

          expect(unreadableBooks).toStrictEqual(['GEN']);
          expect(inIdOrder(draft)).toStrictEqual(inIdOrder(fullDraftWithoutGenesis()));
        },
      );

      it('loads an unusable draft as an empty one', async () => {
        await (await store.open(SOURCE)).replaceAll(fullDraft());
        await store.damageDraft(SOURCE);

        await expect(reload(store)).resolves.toStrictEqual(emptyDraft(SOURCE));
      });
    });

    describe('exportForCopy', () => {
      it('exports a saved draft whole, naming no book', async () => {
        await (await store.open(SOURCE)).replaceAll(fullDraft());

        await expect(reloadForCopy(store)).resolves.toStrictEqual({
          draft: inIdOrder(fullDraft()),
          unreadableBooks: [],
        });
      });

      it('exports an empty draft for its source project when none is saved', async () => {
        await expect(reloadForCopy(store)).resolves.toStrictEqual({
          draft: emptyDraft(SOURCE),
          unreadableBooks: [],
        });
      });

      it.each(['corrupt', 'lost'] as const)(
        'names a book whose stored analysis is %s, and exports the rest',
        async (damage) => {
          await (await store.open(SOURCE)).replaceAll(fullDraft());
          await store.damageBook(SOURCE, 'GEN', damage);

          await expect(reloadForCopy(store)).resolves.toStrictEqual({
            draft: inIdOrder(fullDraftWithoutGenesis()),
            unreadableBooks: ['GEN'],
          });
        },
      );

      it('refuses an unusable draft rather than exporting it empty', async () => {
        await (await store.open(SOURCE)).replaceAll(fullDraft());
        await store.damageDraft(SOURCE);

        await expect((await store.open(SOURCE)).exportForCopy()).rejects.toThrow();
      });

      it('refuses a draft written by a newer build', async () => {
        await store.storeNewerBuildDraft(SOURCE);

        await expect((await store.open(SOURCE)).exportForCopy()).rejects.toThrow();
      });
    });

    describe('replaceAll', () => {
      it('saves every record kind and optional field for the same repository to load', async () => {
        const repository = await store.open(SOURCE);
        await repository.replaceAll(fullDraft());

        await expect(load(repository)).resolves.toStrictEqual(inIdOrder(fullDraft()));
      });

      it('saves a draft for a newly opened repository to load', async () => {
        await (await store.open(SOURCE)).replaceAll(fullDraft());

        await expect(reload(store)).resolves.toStrictEqual(inIdOrder(fullDraft()));
      });

      it('keeps a payload linked from several books as one record', async () => {
        await (await store.open(SOURCE)).replaceAll(fullDraft());

        const { analysis } = await reload(store);

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

        await expect(reload(store)).resolves.toStrictEqual(inIdOrder(draft));
      });

      it('stamps what it saves with the current model version', async () => {
        await (
          await store.open(SOURCE)
        ).replaceAll({ ...fullDraft(), modelVersion: CURRENT_MODEL_VERSION - 1 });

        const { modelVersion } = await reload(store);

        expect(modelVersion).toBe(CURRENT_MODEL_VERSION);
      });

      it('replaces the stored draft whole, dropping records the saved draft lacks', async () => {
        const repository = await store.open(SOURCE);
        await repository.replaceAll(fullDraft());
        await repository.exportAll();

        await repository.replaceAll(exodusOnlyDraft());

        await expect(reload(store)).resolves.toStrictEqual(inIdOrder(exodusOnlyDraft()));
      });

      it('drops records the saved draft lacks even when this repository never loaded them', async () => {
        await (await store.open(SOURCE)).replaceAll(fullDraft());

        await (await store.open(SOURCE)).replaceAll(exodusOnlyDraft());

        await expect(reload(store)).resolves.toStrictEqual(inIdOrder(exodusOnlyDraft()));
      });

      it('saves in full after reloading a draft another repository replaced', async () => {
        const repository = await store.open(SOURCE);
        await repository.replaceAll(fullDraft());
        await (await store.open(SOURCE)).replaceAll(exodusOnlyDraft());
        await expect(load(repository)).resolves.toStrictEqual(inIdOrder(exodusOnlyDraft()));

        await repository.replaceAll(fullDraft());

        await expect(reload(store)).resolves.toStrictEqual(inIdOrder(fullDraft()));
      });

      it('saves an emptied analysis as empty', async () => {
        const repository = await store.open(SOURCE);
        await repository.replaceAll(fullDraft());

        await repository.replaceAll({ ...fullDraft(), analysis: emptyAnalysis() });

        await expect(reload(store)).resolves.toStrictEqual({
          ...fullDraft(),
          analysis: emptyAnalysis(),
        });
      });

      it('restores records a later save brings back', async () => {
        const repository = await store.open(SOURCE);
        await repository.replaceAll(fullDraft());
        await repository.replaceAll(exodusOnlyDraft());

        await repository.replaceAll(fullDraft());

        await expect(reload(store)).resolves.toStrictEqual(inIdOrder(fullDraft()));
      });

      it('stores what it was given, unaffected by later changes to that draft', async () => {
        const repository = await store.open(SOURCE);
        const draft = fullDraft();
        await repository.replaceAll(draft);

        changeInPlace(draft);

        await expect(load(repository)).resolves.toStrictEqual(inIdOrder(fullDraft()));
        await expect(reload(store)).resolves.toStrictEqual(inIdOrder(fullDraft()));
      });

      it('stores in-place changes to a saved draft when that draft is saved again', async () => {
        const repository = await store.open(SOURCE);
        const draft = fullDraft();
        await repository.replaceAll(draft);
        changeInPlace(draft);

        await repository.replaceAll(draft);

        await expect(reload(store)).resolves.toStrictEqual(inIdOrder(draft));
      });

      it('keeps the drafts of different source projects apart', async () => {
        const other = { ...exodusOnlyDraft(), sourceProjectId: 'other-project' };
        await (await store.open(SOURCE)).replaceAll(fullDraft());

        await (await store.open('other-project')).replaceAll(other);

        await expect(reload(store)).resolves.toStrictEqual(inIdOrder(fullDraft()));
        await expect(reload(store, 'other-project')).resolves.toStrictEqual(inIdOrder(other));
      });

      it('leaves a draft written by a newer build in place, refusing to overwrite it', async () => {
        await store.storeNewerBuildDraft(SOURCE);

        await expect((await store.open(SOURCE)).replaceAll(fullDraft())).rejects.toThrow();

        await expect((await store.open(SOURCE)).exportAll()).rejects.toThrow();
      });

      it('resolves once the draft has landed even if cleanup after it fails, and a later save finishes that cleanup', async () => {
        await (await store.open(SOURCE)).replaceAll(fullDraft());
        const restore = store.failCleanup(SOURCE);

        await expect(
          (await store.open(SOURCE)).replaceAll(exodusOnlyDraft()),
        ).resolves.toStrictEqual([]);
        await expect(store.holdsLeftovers(SOURCE)).resolves.toBe(true);

        restore();
        await expect(reload(store)).resolves.toStrictEqual(inIdOrder(exodusOnlyDraft()));
        await (await store.open(SOURCE)).replaceAll(exodusOnlyDraft());
        await expect(store.holdsLeftovers(SOURCE)).resolves.toBe(false);
      });
    });

    describe('replaceAll after loading a book that could not be read', () => {
      it('keeps the book as stored when the draft carries nothing for it, leaving out no book', async () => {
        const repository = await loadedWithUnreadableGenesis(store);

        await expect(repository.replaceAll(exodusOnlyDraft())).resolves.toStrictEqual([]);

        await expect(reloadForCopy(store)).resolves.toStrictEqual({
          draft: inIdOrder(exodusOnlyDraft()),
          unreadableBooks: ['GEN'],
        });
      });

      it('resolves with the book, keeping it as stored, when the draft carries analysis for it', async () => {
        const repository = await loadedWithUnreadableGenesis(store);
        const withoutSegments = (draft: DraftProject): DraftProject => ({
          ...draft,
          analysis: { ...draft.analysis, segmentAnalyses: [], segmentAnalysisLinks: [] },
        });

        await expect(repository.replaceAll(withoutSegments(fullDraft()))).resolves.toStrictEqual([
          'GEN',
        ]);

        await expect(reloadForCopy(store)).resolves.toStrictEqual({
          draft: inIdOrder(withoutSegments(fullDraftWithoutGenesis())),
          unreadableBooks: ['GEN'],
        });
      });

      it('writes the book like any other once told to discard what could not be read', async () => {
        const repository = await loadedWithUnreadableGenesis(store);

        await expect(
          repository.replaceAll(fullDraft(), { discardUnreadable: true }),
        ).resolves.toStrictEqual([]);

        await expect(reload(store)).resolves.toStrictEqual(inIdOrder(fullDraft()));
      });

      it('wipes the book the draft carries nothing for once told to discard what could not be read', async () => {
        const repository = await loadedWithUnreadableGenesis(store);

        await repository.replaceAll(exodusOnlyDraft(), { discardUnreadable: true });

        await expect(reload(store)).resolves.toStrictEqual(inIdOrder(exodusOnlyDraft()));
        await expect(store.holdsLeftovers(SOURCE)).resolves.toBe(false);
      });
    });

    describe('markClean', () => {
      it('records the stored draft as clean, leaving its content as it stands', async () => {
        await (await store.open(SOURCE)).replaceAll(fullDraft());

        await (await store.open(SOURCE)).markClean();

        await expect(reload(store)).resolves.toStrictEqual(
          inIdOrder({ ...fullDraft(), dirty: false }),
        );
      });

      it('keeps a book that could not be read as stored', async () => {
        await (await store.open(SOURCE)).replaceAll(fullDraft());
        await store.damageBook(SOURCE, 'GEN', 'corrupt');

        await (await store.open(SOURCE)).markClean();

        await expect(reloadForCopy(store)).resolves.toStrictEqual({
          draft: inIdOrder({ ...fullDraftWithoutGenesis(), dirty: false }),
          unreadableBooks: ['GEN'],
        });
      });

      it('leaves an already-clean draft as it stands', async () => {
        await (await store.open(SOURCE)).replaceAll(exodusOnlyDraft());

        await (await store.open(SOURCE)).markClean();

        await expect(reload(store)).resolves.toStrictEqual(inIdOrder(exodusOnlyDraft()));
      });

      it('resolves when no draft is saved, which still loads as empty', async () => {
        await (await store.open(SOURCE)).markClean();

        await expect(reload(store)).resolves.toStrictEqual(emptyDraft(SOURCE));
      });

      it('refuses a draft written by a newer build, leaving it in place', async () => {
        await store.storeNewerBuildDraft(SOURCE);

        await expect((await store.open(SOURCE)).markClean()).rejects.toThrow();

        await expect((await store.open(SOURCE)).exportAll()).rejects.toThrow();
      });

      it('refuses an unusable draft, leaving it in place', async () => {
        await (await store.open(SOURCE)).replaceAll(fullDraft());
        await store.damageDraft(SOURCE);

        await expect((await store.open(SOURCE)).markClean()).rejects.toThrow();

        await expect((await store.open(SOURCE)).exportForCopy()).rejects.toThrow();
      });
    });

    describe('apply', () => {
      it('puts new records of every kind, for the same repository and a newly opened one to load', async () => {
        const repository = await store.open(SOURCE);
        await repository.replaceAll(fullDraft());

        await repository.apply(puttingNewRecords());

        await expect(load(repository)).resolves.toStrictEqual(inIdOrder(fullDraftWithNewRecords()));
        await expect(reload(store)).resolves.toStrictEqual(inIdOrder(fullDraftWithNewRecords()));
      });

      it('replaces a stored record whole, dropping fields the put lacks', async () => {
        const repository = await store.open(SOURCE);
        await repository.replaceAll(fullDraft());
        const bare = { id: 'ta-beginning', ...FIXTURE_STAMPS, surfaceText: 'beginning' };

        await repository.apply({ intent: 'replace', tokenAnalyses: { puts: [bare], deletes: [] } });

        const { analysis } = await reload(store);
        expect(analysis.tokenAnalyses.find(({ id }) => id === 'ta-beginning')).toStrictEqual(bare);
      });

      it('deletes records of every kind', async () => {
        const repository = await store.open(SOURCE);
        await repository.replaceAll(fullDraft());

        await repository.apply({
          intent: 'deleteExodus',
          segmentAnalyses: { puts: [], deletes: ['sa-exo'] },
          segmentAnalysisLinks: { puts: [], deletes: ['sl-exo'] },
          tokenAnalysisLinks: { puts: [], deletes: ['tl-exo-and'] },
        });

        await expect(reload(store)).resolves.toStrictEqual(
          inIdOrder({
            ...fullDraft(),
            analysis: {
              ...fullAnalysis(),
              segmentAnalyses: [],
              segmentAnalysisLinks: [],
              tokenAnalysisLinks: fullAnalysis().tokenAnalysisLinks.filter(
                ({ id }) => id !== 'tl-exo-and',
              ),
            },
          }),
        );
      });

      it('skips a delete of a record that is not stored, with nothing for its inverse to restore', async () => {
        const repository = await store.open(SOURCE);
        await repository.replaceAll(fullDraft());

        const { inverse } = await repository.apply({
          intent: 'deleteMissing',
          tokenAnalyses: { puts: [], deletes: ['ta-missing'] },
        });

        expect(inverse).toStrictEqual({ intent: 'deleteMissing' });
        await expect(reload(store)).resolves.toStrictEqual(inIdOrder(fullDraft()));
      });

      it('applies to a draft this repository never loaded', async () => {
        await (await store.open(SOURCE)).replaceAll(fullDraft());

        await (await store.open(SOURCE)).apply(puttingNewRecords());

        await expect(reload(store)).resolves.toStrictEqual(inIdOrder(fullDraftWithNewRecords()));
      });

      it('applies to a draft never saved as to an empty one', async () => {
        await (await store.open(SOURCE)).apply(puttingNewRecords());

        await expect(reload(store)).resolves.toStrictEqual(
          inIdOrder({ ...emptyDraft(SOURCE), analysis: { ...emptyAnalysis(), ...newRecords() } }),
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

        await expect(reload(store)).resolves.toStrictEqual(
          inIdOrder({
            ...emptyDraft(SOURCE),
            analysis: { ...emptyAnalysis(), tokenAnalyses, tokenAnalysisLinks },
          }),
        );
      });

      it('builds on a whole save made since the last apply', async () => {
        const repository = await store.open(SOURCE);
        await repository.apply(puttingNewRecords());
        await repository.replaceAll(fullDraft());

        await repository.apply({
          intent: 'deleteUnlinked',
          tokenAnalyses: { puts: [], deletes: ['ta-unlinked'] },
        });

        await expect(reload(store)).resolves.toStrictEqual(
          inIdOrder({
            ...fullDraft(),
            analysis: {
              ...fullAnalysis(),
              tokenAnalyses: fullAnalysis().tokenAnalyses.filter(({ id }) => id !== 'ta-unlinked'),
            },
          }),
        );
      });

      it('applies over a draft another repository replaced, once reloaded', async () => {
        const repository = await store.open(SOURCE);
        await repository.apply(puttingNewRecords());
        await (await store.open(SOURCE)).replaceAll(fullDraft());
        await repository.exportAll();

        await repository.apply({
          intent: 'deleteUnlinked',
          tokenAnalyses: { puts: [], deletes: ['ta-unlinked'] },
        });

        await expect(reload(store)).resolves.toStrictEqual(
          inIdOrder({
            ...fullDraft(),
            analysis: {
              ...fullAnalysis(),
              tokenAnalyses: fullAnalysis().tokenAnalyses.filter(({ id }) => id !== 'ta-unlinked'),
            },
          }),
        );
      });

      it('saves an edit to a payload linked from several books, for both books to load', async () => {
        const repository = await store.open(SOURCE);
        await repository.replaceAll(fullDraft());
        const edited = { ...fullAnalysis().tokenAnalyses[0], gloss: { en: 'and then' } };

        await repository.apply({
          intent: 'writeGloss',
          tokenAnalyses: { puts: [edited], deletes: [] },
        });

        const { analysis } = await reload(store);
        expect(analysis.tokenAnalyses.filter(({ id }) => id === 'ta-and')).toStrictEqual([edited]);
        expect(
          analysis.tokenAnalysisLinks.filter(({ analysisId }) => analysisId === 'ta-and'),
        ).toHaveLength(2);
      });

      it("carries boundary changes in the scope's record", async () => {
        const repository = await store.open(SOURCE);
        await repository.replaceAll(fullDraft());
        const segmentation = {
          removedVerseStarts: [],
          addedStarts: [{ tokenRef: 'GEN 1:1:9', surfaceText: 'beginning' }],
        };

        await repository.apply({
          intent: 'splitSegment',
          scope: { ...scopeRecordOf(fullDraft()), segmentation },
        });

        await expect(reload(store)).resolves.toStrictEqual(
          inIdOrder({ ...fullDraft(), segmentation }),
        );
      });

      it("clears the boundaries when the scope's record carries none", async () => {
        const repository = await store.open(SOURCE);
        await repository.replaceAll(fullDraft());
        const { segmentation, ...withoutBoundaries } = scopeRecordOf(fullDraft());

        await repository.apply({ intent: 'resetBoundaries', scope: withoutBoundaries });

        const reloaded = await reload(store);
        expect(segmentation).toBeDefined();
        expect(reloaded).not.toHaveProperty('segmentation');
      });

      it('stamps what it applies with the current model version', async () => {
        await (
          await store.open(SOURCE)
        ).apply({
          intent: 'stamp',
          scope: { ...scopeRecordOf(fullDraft()), modelVersion: CURRENT_MODEL_VERSION - 1 },
        });

        const { modelVersion } = await reload(store);

        expect(modelVersion).toBe(CURRENT_MODEL_VERSION);
      });

      it('returns an inverse that undoes the changes, boundaries included', async () => {
        const repository = await store.open(SOURCE);
        await repository.replaceAll(fullDraft());

        const { inverse } = await repository.apply(mixedChanges());
        await repository.apply(inverse);

        await expect(reload(store)).resolves.toStrictEqual(inIdOrder(fullDraft()));
      });

      it("redoes the changes when the inverse's inverse is applied", async () => {
        const repository = await store.open(SOURCE);
        await repository.replaceAll(fullDraft());
        const { inverse } = await repository.apply(mixedChanges());
        const changed = await reload(store);
        const { inverse: redo } = await repository.apply(inverse);

        await repository.apply(redo);

        await expect(reload(store)).resolves.toStrictEqual(changed);
      });

      it('undoes the changes through a newly opened repository', async () => {
        await (await store.open(SOURCE)).replaceAll(fullDraft());
        const { inverse } = await (await store.open(SOURCE)).apply(mixedChanges());

        await (await store.open(SOURCE)).apply(inverse);

        await expect(reload(store)).resolves.toStrictEqual(inIdOrder(fullDraft()));
      });

      it('names the intent of the changes in their inverse, as JSON-plain values', async () => {
        const repository = await store.open(SOURCE);
        await repository.replaceAll(fullDraft());

        const { inverse } = await repository.apply(mixedChanges());

        expect(inverse.intent).toBe('mixedChanges');
        expectJsonPlain(inverse);
      });

      it('stores what it was given, unaffected by later changes to the changes or their inverse', async () => {
        const repository = await store.open(SOURCE);
        const changes = puttingNewRecords();
        const { inverse } = await repository.apply(changes);
        const applied = await reload(store);

        changes.tokenAnalyses?.puts.push({
          id: 'ta-later',
          ...FIXTURE_STAMPS,
          surfaceText: 'later',
        });
        inverse.tokenAnalyses?.deletes.push('ta-later');
        const [god] = changes.tokenAnalyses?.puts ?? [];
        god.surfaceText = 'changed';

        await expect(load(repository)).resolves.toStrictEqual(applied);
        await repository.apply({ intent: 'nothing' });
        await expect(reload(store)).resolves.toStrictEqual(applied);
      });

      it('refuses an id named twice in one record kind, applying nothing', async () => {
        const repository = await store.open(SOURCE);
        await repository.replaceAll(fullDraft());
        const [and] = fullAnalysis().tokenAnalyses;

        await expect(
          repository.apply({
            intent: 'conflicting',
            tokenAnalyses: { puts: [{ ...and, gloss: { en: 'also' } }], deletes: ['ta-and'] },
          }),
        ).rejects.toThrow();

        await expect(load(repository)).resolves.toStrictEqual(inIdOrder(fullDraft()));
      });

      it("refuses a scope's record of another source project, applying nothing", async () => {
        const repository = await store.open(SOURCE);
        await repository.replaceAll(fullDraft());

        await expect(
          repository.apply({
            intent: 'wrongScope',
            scope: { ...scopeRecordOf(fullDraft()), sourceProjectId: 'other-project' },
          }),
        ).rejects.toThrow();

        await expect(reload(store)).resolves.toStrictEqual(inIdOrder(fullDraft()));
      });

      it('keeps the drafts of different source projects apart', async () => {
        await (await store.open(SOURCE)).replaceAll(fullDraft());

        await (await store.open('other-project')).apply(puttingNewRecords());

        await expect(reload(store)).resolves.toStrictEqual(inIdOrder(fullDraft()));
        await expect(reload(store, 'other-project')).resolves.toStrictEqual(
          inIdOrder({
            ...emptyDraft('other-project'),
            analysis: { ...emptyAnalysis(), ...newRecords() },
          }),
        );
      });

      it('leaves a draft written by a newer build in place, refusing to apply over it', async () => {
        await store.storeNewerBuildDraft(SOURCE);

        await expect((await store.open(SOURCE)).apply(puttingNewRecords())).rejects.toThrow();

        await expect((await store.open(SOURCE)).exportAll()).rejects.toThrow();
      });
    });

    describe('lookups', () => {
      /** A repository over {@link fullDraft}, saved through another one so its lookups load it. */
      async function overFullDraft(): Promise<AnalysisRepository> {
        await (await store.open(SOURCE)).replaceAll(fullDraft());
        return store.open(SOURCE);
      }

      it('gets each payload kind by id, once per id, skipping ids with nothing stored', async () => {
        const repository = await overFullDraft();

        await expect(
          repository.getTokenAnalyses(['ta-and', 'ta-missing', 'ta-and']).then(idsOf),
        ).resolves.toStrictEqual(['ta-and']);
        await expect(repository.getPhraseAnalyses(['pa-in-the'])).resolves.toStrictEqual(
          fullAnalysis().phraseAnalyses,
        );
        await expect(
          repository.getSegmentAnalyses(['sa-exo', 'sa-missing']),
        ).resolves.toStrictEqual(fullAnalysis().segmentAnalyses);
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

        await expect(repository.findLinksInBooks(['GEN']).then(linkIdsOf)).resolves.toStrictEqual({
          tokenAnalysisLinks: ['tl-gen-and', 'tl-gen-beginning'],
          phraseAnalysisLinks: ['pa-in-the'],
          segmentAnalysisLinks: [],
        });
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

      it('finds nothing in a draft never saved', async () => {
        const repository = await store.open(SOURCE);

        await expect(repository.findLinksInBooks(['GEN']).then(linkIdsOf)).resolves.toStrictEqual({
          tokenAnalysisLinks: [],
          phraseAnalysisLinks: [],
          segmentAnalysisLinks: [],
        });
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
        await expect(repository.getTokenAnalyses(['ta-and'])).resolves.toStrictEqual([
          { ...fullAnalysis().tokenAnalyses[0], gloss: { en: 'and then' } },
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

      it('answers from a draft another repository replaced, once reloaded', async () => {
        const repository = await overFullDraft();
        await repository.findLinksInBooks(['GEN']);
        await (await store.open(SOURCE)).replaceAll(exodusOnlyDraft());

        await repository.exportAll();

        await expect(
          repository.findLinksInBooks(['GEN', 'EXO']).then(linkIdsOf),
        ).resolves.toStrictEqual({
          tokenAnalysisLinks: ['tl-exo-and'],
          phraseAnalysisLinks: [],
          segmentAnalysisLinks: ['sl-exo'],
        });
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

        await expect(repository.getTokenAnalyses(['ta-and'])).resolves.toStrictEqual([
          fullAnalysis().tokenAnalyses[0],
        ]);
        await expect(
          repository.findLinksInBooks(['GEN', 'EXO'], ['rejected']).then(linkIdsOf),
        ).resolves.toMatchObject({ tokenAnalysisLinks: [] });
      });

      it('keeps indexes that match its records through applies, undo and redo', async () => {
        const repository = await overFullDraft();
        await repository.findLinksInBooks(['GEN']);

        const { inverse } = await repository.apply(mixedChanges());
        const { inverse: redo } = await repository.apply(inverse);
        await repository.apply(redo);
        await repository.apply(puttingNewRecords());

        await expect(repository.checkIndexes()).resolves.toStrictEqual([]);
      });

      it('answers from a read-only repository', async () => {
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
    });

    describe('capabilities', () => {
      it("lets a source project's draft be written", async () => {
        expect((await store.open(SOURCE)).capabilities.readOnly).toBe(false);
      });

      it('marks a read-only repository as read-only', async () => {
        expect((await store.openReadOnly(fullDraft())).capabilities.readOnly).toBe(true);
      });
    });

    describe('a read-only repository', () => {
      /** The analysis that `repository` loads, with its record lists in id order. */
      async function analysisOf(repository: AnalysisRepository): Promise<TextAnalysis> {
        return (await load(repository)).analysis;
      }

      it('loads the analysis it was opened over', async () => {
        const repository = await store.openReadOnly(fullDraft());

        await expect(analysisOf(repository)).resolves.toStrictEqual(
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

        await expect(analysisOf(repository)).resolves.toStrictEqual(
          inIdOrder(fullDraft()).analysis,
        );
      });

      it('refuses a save, leaving what it loads unchanged', async () => {
        const repository = await store.openReadOnly(fullDraft());

        await expect(repository.replaceAll(exodusOnlyDraft())).rejects.toThrow(
          ReadOnlyAnalysisError,
        );

        await expect(analysisOf(repository)).resolves.toStrictEqual(
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

        await expect(analysisOf(repository)).resolves.toStrictEqual(
          inIdOrder(fullDraft()).analysis,
        );
      });

      it("keeps apart from the source project's draft", async () => {
        await (await store.open(SOURCE)).replaceAll(exodusOnlyDraft());

        const repository = await store.openReadOnly(fullDraft());
        await (await store.open(SOURCE)).replaceAll({ ...exodusOnlyDraft(), dirty: true });

        await expect(analysisOf(repository)).resolves.toStrictEqual(
          inIdOrder(fullDraft()).analysis,
        );
        await expect(reload(store)).resolves.toStrictEqual(
          inIdOrder({ ...exodusOnlyDraft(), dirty: true }),
        );
      });
    });
  });
}
