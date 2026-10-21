/// <reference types="jest" />

import type { DraftProject, TextAnalysis } from 'interlinearizer';
import type { AnalysisRepository } from '../types/analysis-repository';
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

/** Expects `draft` to survive a JSON round trip unchanged and to hold no `null`. */
function expectJsonPlain(draft: DraftProject): void {
  expect(JSON.parse(JSON.stringify(draft))).toStrictEqual(draft);
  expect(JSON.stringify(draft)).not.toMatch(/\bnull\b/);
}

/** Loads the draft through a newly opened repository, with its record lists in id order. */
async function reload(store: ConformanceStore, sourceProjectId = SOURCE): Promise<DraftProject> {
  const repository = await store.open(sourceProjectId);
  return inIdOrder(await repository.exportAll());
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

        const loaded = await repository.exportAll();
        loaded.analysisLanguages.push('de');
        loaded.analysis.tokenAnalyses[0].surfaceText = 'changed';

        await expect(repository.exportAll().then(inIdOrder)).resolves.toStrictEqual(
          inIdOrder(fullDraft()),
        );
      });

      it('refuses a draft written by a newer build', async () => {
        await store.storeNewerBuildDraft(SOURCE);

        await expect((await store.open(SOURCE)).exportAll()).rejects.toThrow();
      });
    });

    describe('replaceAll', () => {
      it('saves every record kind and optional field for the same repository to load', async () => {
        const repository = await store.open(SOURCE);
        await repository.replaceAll(fullDraft());

        await expect(repository.exportAll().then(inIdOrder)).resolves.toStrictEqual(
          inIdOrder(fullDraft()),
        );
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
        const draft = await repository.exportAll();
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
        await repository.exportAll();

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

        draft.analysisLanguages.push('de');
        draft.analysis.tokenAnalyses[0].surfaceText = 'changed';

        await expect(repository.exportAll().then(inIdOrder)).resolves.toStrictEqual(
          inIdOrder(fullDraft()),
        );
        await expect(reload(store)).resolves.toStrictEqual(inIdOrder(fullDraft()));
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
    });
  });
}
