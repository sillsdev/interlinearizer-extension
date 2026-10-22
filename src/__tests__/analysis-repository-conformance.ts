/// <reference types="jest" />

import type { DraftProject, TextAnalysis } from 'interlinearizer';
import type { AnalysisRepository, DraftExport } from '../types/analysis-repository';
import { emptyAnalysis, emptyDraft } from '../types/empty-factories';
import { CURRENT_MODEL_VERSION } from '../types/model-version';
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
   * fail, until the returned function is called.
   */
  failCleanup(sourceProjectId: string): () => void;

  /** Whether storage holds anything for `sourceProjectId` that its stored draft no longer needs. */
  holdsLeftovers(sourceProjectId: string): Promise<boolean>;
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
 * Changes `draft` in place, from its own lists down to values nested in its records and its
 * segmentation, so a repository still holding any part of it shows.
 */
function changeInPlace(draft: DraftProject): void {
  draft.analysisLanguages.push('de');
  draft.analysis.tokenAnalyses.forEach((payload) => {
    payload.surfaceText = 'changed';
    if (payload.gloss) payload.gloss.en = 'changed';
    payload.morphemes?.forEach((morpheme) => {
      if (morpheme.gloss) morpheme.gloss.en = 'changed';
    });
  });
  draft.segmentation?.addedStarts.forEach((start) => {
    start.surfaceText = 'changed';
  });
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

      it('leaves no draft when none is saved', async () => {
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
  });
}
