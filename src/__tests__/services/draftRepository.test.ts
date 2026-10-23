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

  describe('exportForCopy', () => {
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

    it('keeps an unreadable book when the saving repository never loaded the draft', async () => {
      const { storage, draft, records } = await loadedWithUnreadableGen();

      await new DraftRepository(storage, 'src', silentLogger()).replaceAll({
        ...draft,
        analysis: emptyAnalysis(),
      });

      expect(records.get(draftAnalysisKey('src', 'GEN'))).toBe('not json');
    });

    it('leaves out the analysis a draft carries for an unreadable book, keeping its shard', async () => {
      const { repository, records } = await loadedWithUnreadableGen();

      await expect(repository.replaceAll(twoBookDraft())).resolves.toEqual(['GEN']);

      expect(records.get(draftAnalysisKey('src', 'GEN'))).toBe('not json');
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

  describe('apply', () => {
    it('rewrites only the books whose records the changes alter', async () => {
      const { storage, writes } = memoryStorage();
      const repository = new DraftRepository(storage, 'src', silentLogger());
      await repository.replaceAll(twoBookDraft());
      writes.length = 0;
      const [segment] = twoBookAnalysis().segmentAnalyses;

      await repository.apply({
        intent: 'writeFreeTranslation',
        segmentAnalyses: {
          puts: [{ ...segment, freeTranslation: { en: 'And then.' } }],
          deletes: [],
        },
      });

      expect(writes).toContain(draftAnalysisKey('src', 'EXO'));
      expect(writes).not.toContain(draftAnalysisKey('src', 'GEN'));
    });

    it('rewrites every book linking a payload it edits', async () => {
      const { storage, records } = memoryStorage();
      const repository = new DraftRepository(storage, 'src', silentLogger());
      await repository.replaceAll(twoBookDraft());
      const [payload] = twoBookAnalysis().tokenAnalyses;

      await repository.apply({
        intent: 'writeGloss',
        tokenAnalyses: { puts: [{ ...payload, gloss: { en: 'and then' } }], deletes: [] },
      });

      expect(records.get(draftAnalysisKey('src', 'GEN'))).toContain('and then');
      expect(records.get(draftAnalysisKey('src', 'EXO'))).toContain('and then');
    });

    describe('with a book whose shard could not be read', () => {
      /** A repository that loaded {@link twoBookDraft} with its GEN shard unusable. */
      async function loadedWithUnusableGenesis() {
        const { storage, records, writes } = memoryStorage();
        await new DraftRepository(storage, 'src', silentLogger()).replaceAll(twoBookDraft());
        records.set(draftAnalysisKey('src', 'GEN'), 'not json');
        const repository = new DraftRepository(storage, 'src', silentLogger());
        await repository.exportAll();
        writes.length = 0;
        return { repository, records, writes };
      }

      it('refuses changes that reach that book, writing nothing', async () => {
        const { repository, records, writes } = await loadedWithUnusableGenesis();
        const [payload] = twoBookAnalysis().tokenAnalyses;

        await expect(
          repository.apply({
            intent: 'writeGloss',
            tokenAnalyses: { puts: [{ ...payload, gloss: { en: 'and then' } }], deletes: [] },
            tokenAnalysisLinks: { puts: twoBookAnalysis().tokenAnalysisLinks, deletes: [] },
          }),
        ).rejects.toThrow('could not read the stored analysis of GEN');

        expect(writes).toEqual([]);
        expect(records.get(draftAnalysisKey('src', 'GEN'))).toBe('not json');
      });

      it('applies changes elsewhere, keeping its shard', async () => {
        const { repository, records } = await loadedWithUnusableGenesis();
        const [segment] = twoBookAnalysis().segmentAnalyses;

        await repository.apply({
          intent: 'writeFreeTranslation',
          segmentAnalyses: {
            puts: [{ ...segment, freeTranslation: { en: 'And then.' } }],
            deletes: [],
          },
        });

        expect(records.get(draftAnalysisKey('src', 'EXO'))).toContain('And then.');
        expect(records.get(draftAnalysisKey('src', 'GEN'))).toBe('not json');
      });
    });

    it('keeps its draft as it was when a write fails, so the next apply leaves the failed one out', async () => {
      const { storage, records } = memoryStorage();
      const repository = new DraftRepository(storage, 'src', silentLogger());
      await repository.replaceAll(twoBookDraft());
      const [payload] = twoBookAnalysis().tokenAnalyses;
      const [segment] = twoBookAnalysis().segmentAnalyses;
      const write = jest.spyOn(storage, 'write').mockRejectedValueOnce(new Error('disk full'));

      await expect(
        repository.apply({
          intent: 'writeGloss',
          tokenAnalyses: { puts: [{ ...payload, gloss: { en: 'and then' } }], deletes: [] },
        }),
      ).rejects.toThrow('disk full');
      write.mockRestore();
      await repository.apply({
        intent: 'writeFreeTranslation',
        segmentAnalyses: {
          puts: [{ ...segment, freeTranslation: { en: 'And then.' } }],
          deletes: [],
        },
      });

      const {
        draft: { analysis },
      } = await new DraftRepository(storage, 'src', silentLogger()).exportAll();
      expect(analysis.tokenAnalyses[0].gloss).toEqual({ en: 'and' });
      expect(analysis.segmentAnalyses[0].freeTranslation).toEqual({ en: 'And then.' });
      expect(records.get(draftAnalysisKey('src', 'GEN'))).not.toContain('and then');
    });
  });

  describe('lookups', () => {
    it('load the draft once, answering later lookups from what they kept', async () => {
      const { storage } = memoryStorage();
      await new DraftRepository(storage, 'src', silentLogger()).replaceAll(twoBookDraft());
      const repository = new DraftRepository(storage, 'src', silentLogger());
      const read = jest.spyOn(storage, 'read');

      await repository.findLinksInBooks(['GEN']);
      const readsAfterFirst = read.mock.calls.length;
      await repository.findLinksToAnalyses(['ta-and']);

      expect(readsAfterFirst).toBeGreaterThan(0);
      expect(read).toHaveBeenCalledTimes(readsAfterFirst);
    });

    it('answer from what an apply left without loading the draft again', async () => {
      const { storage } = memoryStorage();
      const repository = new DraftRepository(storage, 'src', silentLogger());
      await repository.apply({
        intent: 'add',
        tokenAnalyses: { puts: twoBookAnalysis().tokenAnalyses, deletes: [] },
      });
      const read = jest.spyOn(storage, 'read');

      await expect(repository.getTokenAnalyses(['ta-and'])).resolves.toStrictEqual(
        twoBookAnalysis().tokenAnalyses,
      );
      expect(read).not.toHaveBeenCalled();
    });
  });

  describe('checkIndexes', () => {
    it('reports nothing while it keeps no index', async () => {
      const { storage } = memoryStorage();
      const repository = new DraftRepository(storage, 'src', silentLogger());
      await repository.replaceAll(twoBookDraft());

      await expect(repository.checkIndexes()).resolves.toStrictEqual([]);
    });
  });
});
