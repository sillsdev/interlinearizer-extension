/// <reference types="jest" />

import type { DraftProject, TextAnalysis } from 'interlinearizer';
import { DraftRepository } from '../../services/draftRepository';
import { draftAnalysisKey, draftKey } from '../../services/storageKeys';
import { emptyAnalysis, emptyDraft } from '../../types/empty-factories';
import { CURRENT_MODEL_VERSION } from '../../types/model-version';
import { FIXTURE_STAMPS, makePhraseLink, memoryStorage, silentLogger } from '../test-helpers';

/** An analysis with a token payload shared by GEN and EXO, a phrase in GEN and a segment in EXO. */
function twoBookAnalysis(): TextAnalysis {
  return {
    ...emptyAnalysis(),
    tokenAnalyses: [{ id: 'ta-and', ...FIXTURE_STAMPS, surfaceText: 'and', gloss: { en: 'and' } }],
    tokenAnalysisLinks: ['GEN', 'EXO'].map((book) => ({
      id: `tl-${book}`,
      analysisId: 'ta-and',
      ...FIXTURE_STAMPS,
      status: 'approved' as const,
      token: { tokenRef: `${book} 1:1!0`, surfaceText: 'and' },
    })),
    phraseAnalyses: [{ id: 'pa-1', ...FIXTURE_STAMPS, surfaceText: 'in the', gloss: { en: 'in' } }],
    phraseAnalysisLinks: [makePhraseLink('pa-1', ['GEN 1:1!0', 'GEN 1:1!4'])],
    segmentAnalyses: [
      { id: 'sa-1', ...FIXTURE_STAMPS, surfaceText: 'And so', freeTranslation: { en: 'And so.' } },
    ],
    segmentAnalysisLinks: [
      {
        id: 'sl-1',
        analysisId: 'sa-1',
        ...FIXTURE_STAMPS,
        status: 'approved',
        segmentId: 'EXO 1:1',
      },
    ],
  };
}

function twoBookDraft(): DraftProject {
  return { ...emptyDraft('src'), analysisLanguages: ['en'], analysis: twoBookAnalysis() };
}

describe('DraftRepository', () => {
  it('loads an empty draft for its source project when none is stored', async () => {
    const { storage } = memoryStorage();

    await expect(new DraftRepository(storage, 'src', silentLogger()).exportAll()).resolves.toEqual({
      draft: emptyDraft('src'),
      unreadableBooks: [],
    });
  });

  it('loads in a new instance what another saved', async () => {
    const { storage } = memoryStorage();
    await new DraftRepository(storage, 'src', silentLogger()).replaceAll(twoBookDraft());

    await expect(new DraftRepository(storage, 'src', silentLogger()).exportAll()).resolves.toEqual({
      draft: twoBookDraft(),
      unreadableBooks: [],
    });
  });

  it('loads a payload shared by several books once', async () => {
    const { storage, records } = memoryStorage();
    await new DraftRepository(storage, 'src', silentLogger()).replaceAll(twoBookDraft());
    expect(records.get(draftAnalysisKey('src', 'EXO'))).toContain('ta-and');
    expect(records.get(draftAnalysisKey('src', 'GEN'))).toContain('ta-and');

    const { analysis } = (await new DraftRepository(storage, 'src', silentLogger()).exportAll())
      .draft;

    expect(analysis.tokenAnalyses).toHaveLength(1);
  });

  it('rewrites only the books whose records changed since the load', async () => {
    const { storage, writes } = memoryStorage();
    await new DraftRepository(storage, 'src', silentLogger()).replaceAll(twoBookDraft());
    const repository = new DraftRepository(storage, 'src', silentLogger());
    const { draft } = await repository.exportAll();
    writes.length = 0;
    draft.analysis.segmentAnalyses[0].freeTranslation = { en: 'And then.' };

    await repository.replaceAll(draft);

    expect(writes).toContain(draftAnalysisKey('src', 'EXO'));
    expect(writes).not.toContain(draftAnalysisKey('src', 'GEN'));
  });

  it('refuses to load a draft written by a newer build', async () => {
    const newer = JSON.stringify({ ...emptyDraft('src'), modelVersion: CURRENT_MODEL_VERSION + 1 });
    const { storage } = memoryStorage({ [draftKey('src')]: newer });

    await expect(new DraftRepository(storage, 'src', silentLogger()).exportAll()).rejects.toThrow(
      /newer than this build supports/,
    );
  });

  it('leaves a draft written by a newer build as it stands', async () => {
    const newer = JSON.stringify({ ...emptyDraft('src'), modelVersion: CURRENT_MODEL_VERSION + 1 });
    const { storage, records, writes } = memoryStorage({ [draftKey('src')]: newer });

    await expect(
      new DraftRepository(storage, 'src', silentLogger()).replaceAll(twoBookDraft()),
    ).rejects.toThrow(/newer than this build supports/);

    expect(writes).toEqual([]);
    expect(records.get(draftKey('src'))).toBe(newer);
  });

  it('reports a stored shard it cannot use to its logger', async () => {
    const { storage, records } = memoryStorage();
    await new DraftRepository(storage, 'src', silentLogger()).replaceAll(twoBookDraft());
    records.set(draftAnalysisKey('src', 'GEN'), 'not json');
    const logger = silentLogger();

    await new DraftRepository(storage, 'src', logger).exportAll();

    expect(logger.warn).toHaveBeenCalledWith(
      `Interlinearizer: analysis shard ${draftAnalysisKey('src', 'GEN')} is not valid JSON; treating as empty`,
    );
  });

  it('names a book whose shard is unusable, and loads the rest', async () => {
    const { storage, records } = memoryStorage();
    await new DraftRepository(storage, 'src', silentLogger()).replaceAll(twoBookDraft());
    records.set(draftAnalysisKey('src', 'GEN'), 'not json');

    const { draft, unreadableBooks } = await new DraftRepository(
      storage,
      'src',
      silentLogger(),
    ).exportAll();

    expect(unreadableBooks).toEqual(['GEN']);
    expect(draft.analysis.tokenAnalysisLinks.map(({ id }) => id)).toEqual(['tl-EXO']);
  });

  describe('exportForCopy', () => {
    it('exports a readable draft whole, naming no book', async () => {
      const { storage } = memoryStorage();
      await new DraftRepository(storage, 'src', silentLogger()).replaceAll(twoBookDraft());

      await expect(
        new DraftRepository(storage, 'src', silentLogger()).exportForCopy(),
      ).resolves.toEqual({ draft: twoBookDraft(), unreadableBooks: [] });
    });

    it('names a book whose shard is unusable, and exports the rest', async () => {
      const { storage, records } = memoryStorage();
      await new DraftRepository(storage, 'src', silentLogger()).replaceAll(twoBookDraft());
      records.set(draftAnalysisKey('src', 'GEN'), 'not json');

      const { draft, unreadableBooks } = await new DraftRepository(
        storage,
        'src',
        silentLogger(),
      ).exportForCopy();

      expect(unreadableBooks).toEqual(['GEN']);
      expect(draft.analysis.tokenAnalysisLinks.map(({ id }) => id)).toEqual(['tl-EXO']);
    });

    it('names a book whose shard the manifest lists but storage lacks', async () => {
      const { storage, records } = memoryStorage();
      await new DraftRepository(storage, 'src', silentLogger()).replaceAll(twoBookDraft());
      records.delete(draftAnalysisKey('src', 'EXO'));

      const { unreadableBooks } = await new DraftRepository(
        storage,
        'src',
        silentLogger(),
      ).exportForCopy();

      expect(unreadableBooks).toEqual(['EXO']);
    });

    it('exports a fresh empty draft when none is stored', async () => {
      const { storage } = memoryStorage();

      await expect(
        new DraftRepository(storage, 'src', silentLogger()).exportForCopy(),
      ).resolves.toEqual({ draft: emptyDraft('src'), unreadableBooks: [] });
    });

    it('exports an inline draft whole, naming no book', async () => {
      const inline = twoBookDraft();
      const { storage } = memoryStorage({ [draftKey('src')]: JSON.stringify(inline) });

      await expect(
        new DraftRepository(storage, 'src', silentLogger()).exportForCopy(),
      ).resolves.toEqual({ draft: inline, unreadableBooks: [] });
    });

    it('rejects a draft that fails validation rather than exporting it empty', async () => {
      const { storage } = memoryStorage({ [draftKey('src')]: JSON.stringify({ nope: true }) });

      await expect(
        new DraftRepository(storage, 'src', silentLogger()).exportForCopy(),
      ).rejects.toThrow(
        'Interlinearizer: stored draft failed validation; resetting to empty draft',
      );
    });

    it('rejects a draft holding a link with no id inline', async () => {
      const inline = JSON.stringify(twoBookDraft()).replace(/"id":"tl-[A-Z]+",/g, '');
      const { storage } = memoryStorage({ [draftKey('src')]: inline });

      await expect(
        new DraftRepository(storage, 'src', silentLogger()).exportForCopy(),
      ).rejects.toThrow('has links without ids');
    });
  });

  describe('markClean', () => {
    it('records the stored draft as clean, rewriting only its envelope', async () => {
      const { storage, records, writes } = memoryStorage();
      await new DraftRepository(storage, 'src', silentLogger()).replaceAll({
        ...twoBookDraft(),
        dirty: true,
      });
      writes.length = 0;

      await new DraftRepository(storage, 'src', silentLogger()).markClean();

      expect(writes).toEqual([draftKey('src')]);
      await expect(
        new DraftRepository(storage, 'src', silentLogger()).exportAll(),
      ).resolves.toEqual({ draft: { ...twoBookDraft(), dirty: false }, unreadableBooks: [] });
      expect(JSON.parse(records.get(draftKey('src')) ?? '{}').analysisBooks).toEqual([
        'GEN',
        'EXO',
      ]);
    });

    it('writes nothing when no draft is stored', async () => {
      const { storage, writes } = memoryStorage();

      await new DraftRepository(storage, 'src', silentLogger()).markClean();

      expect(writes).toEqual([]);
    });

    it('writes nothing when the stored draft is already clean', async () => {
      const { storage, writes } = memoryStorage();
      await new DraftRepository(storage, 'src', silentLogger()).replaceAll(twoBookDraft());
      writes.length = 0;

      await new DraftRepository(storage, 'src', silentLogger()).markClean();

      expect(writes).toEqual([]);
    });

    it('refuses a draft written by a newer build, writing nothing', async () => {
      const newer = JSON.stringify({
        ...emptyDraft('src'),
        dirty: true,
        modelVersion: CURRENT_MODEL_VERSION + 1,
      });
      const { storage, writes } = memoryStorage({ [draftKey('src')]: newer });

      await expect(new DraftRepository(storage, 'src', silentLogger()).markClean()).rejects.toThrow(
        /newer than this build supports/,
      );
      expect(writes).toEqual([]);
    });

    it('refuses a draft that fails validation, writing nothing', async () => {
      const { storage, writes } = memoryStorage({
        [draftKey('src')]: JSON.stringify({ ...emptyDraft('other'), dirty: true }),
      });

      await expect(new DraftRepository(storage, 'src', silentLogger()).markClean()).rejects.toThrow(
        'failed validation; not marking it clean',
      );
      expect(writes).toEqual([]);
    });
  });

  describe('unreadable books', () => {
    /**
     * Storage holding the two-book draft with GEN's shard unusable, and a repository that loaded
     * it.
     */
    async function loadedWithUnreadableGen() {
      const memory = memoryStorage();
      await new DraftRepository(memory.storage, 'src', silentLogger()).replaceAll(twoBookDraft());
      memory.records.set(draftAnalysisKey('src', 'GEN'), 'not json');
      const repository = new DraftRepository(memory.storage, 'src', silentLogger());
      const { draft } = await repository.exportAll();
      return { ...memory, repository, draft };
    }

    it('keeps an unreadable book the draft carries nothing for', async () => {
      const { repository, draft, records } = await loadedWithUnreadableGen();

      await repository.replaceAll({ ...draft, analysis: emptyAnalysis() });

      expect(records.get(draftAnalysisKey('src', 'GEN'))).toBe('not json');
    });

    it('leaves out no book when the draft carries nothing for an unreadable one', async () => {
      const { repository, draft } = await loadedWithUnreadableGen();

      await expect(repository.replaceAll({ ...draft, analysis: emptyAnalysis() })).resolves.toEqual(
        [],
      );
    });

    it('leaves out the analysis a draft carries for an unreadable book, keeping its shard', async () => {
      const { repository, records } = await loadedWithUnreadableGen();

      await expect(repository.replaceAll(twoBookDraft())).resolves.toEqual(['GEN']);

      expect(records.get(draftAnalysisKey('src', 'GEN'))).toBe('not json');
    });

    it('saves the rest of a draft carrying analysis for an unreadable book', async () => {
      const { repository, storage } = await loadedWithUnreadableGen();
      const draft = twoBookDraft();

      await repository.replaceAll({
        ...draft,
        analysis: { ...draft.analysis, segmentAnalyses: [], segmentAnalysisLinks: [] },
      });

      const reloaded = await new DraftRepository(storage, 'src', silentLogger()).exportForCopy();
      expect(reloaded.unreadableBooks).toEqual(['GEN']);
      expect(reloaded.draft.analysis.segmentAnalysisLinks).toEqual([]);
      expect(reloaded.draft.analysis.tokenAnalysisLinks.map(({ id }) => id)).toEqual(['tl-EXO']);
    });

    it('writes over an unreadable book once the draft is started over', async () => {
      const { repository, records } = await loadedWithUnreadableGen();

      await repository.replaceAll(twoBookDraft(), { discardUnreadable: true });

      expect(records.get(draftAnalysisKey('src', 'GEN'))).not.toBe('not json');
    });

    it('wipes an unreadable book the draft carries nothing for once the draft is started over', async () => {
      const { repository, draft, records } = await loadedWithUnreadableGen();

      await repository.replaceAll(
        { ...draft, analysis: emptyAnalysis() },
        { discardUnreadable: true },
      );

      expect(records.has(draftAnalysisKey('src', 'GEN'))).toBe(false);
    });
  });
});
