/// <reference types="jest" />

import type { DraftProject, TextAnalysis } from 'interlinearizer';
import { DraftRepository } from '../../services/draftRepository';
import { draftAnalysisKey, draftJournalKey, draftKey } from '../../services/storageKeys';
import type { ChangeSet, KeyValueStorage } from '../../types/analysis-repository';
import { emptyAnalysis, emptyDraft } from '../../types/empty-factories';
import { CURRENT_MODEL_VERSION } from '../../types/model-version';
import { BOOKLESS_PARTITION } from '../../utils/analysis-book';
import {
  creating,
  deleting,
  FIXTURE_STAMPS,
  makePhraseLink,
  memoryStorage,
  seedRepository,
  silentLogger,
  updating,
} from '../test-helpers';

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

/**
 * Applies a gloss edit to the payload that GEN and EXO share, failing the write of `failing`'s
 * shard. The other book's shard lands with a gloss the draft never takes.
 */
async function failGlossEdit(
  repository: DraftRepository,
  storage: KeyValueStorage,
  failing: string,
): Promise<void> {
  const [payload] = twoBookAnalysis().tokenAnalyses;
  const { write: writeThrough } = storage;
  const write = jest
    .spyOn(storage, 'write')
    .mockImplementation((key, data) =>
      key === draftAnalysisKey('src', failing)
        ? Promise.reject(new Error('disk full'))
        : writeThrough(key, data),
    );
  await expect(
    repository.apply({
      intent: 'writeGloss',
      tokenAnalyses: updating({
        before: payload,
        after: { ...payload, gloss: { en: 'and then' } },
      }),
    }),
  ).rejects.toThrow('disk full');
  write.mockRestore();
}

describe('DraftRepository', () => {
  it('loads a payload shared by several books once', async () => {
    const { storage, records } = memoryStorage();
    await seedRepository(new DraftRepository(storage, 'src', silentLogger()), twoBookDraft());
    expect(records.get(draftAnalysisKey('src', 'EXO'))).toContain('ta-and');
    expect(records.get(draftAnalysisKey('src', 'GEN'))).toContain('ta-and');

    const { analysis } = (await new DraftRepository(storage, 'src', silentLogger()).exportAll())
      .draft;

    expect(analysis.tokenAnalyses).toHaveLength(1);
  });

  it('rewrites only the books whose records changed since the load', async () => {
    const { storage, writes } = memoryStorage();
    await new DraftRepository(storage, 'src', silentLogger()).startOver(twoBookDraft());
    const repository = new DraftRepository(storage, 'src', silentLogger());
    const { draft } = await repository.exportAll();
    writes.length = 0;
    draft.analysis.segmentAnalyses[0].freeTranslation = { en: 'And then.' };

    await repository.startOver(draft);

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
      new DraftRepository(storage, 'src', silentLogger()).startOver(twoBookDraft()),
    ).rejects.toThrow(/newer than this build supports/);

    expect(writes).toEqual([]);
    expect(records.get(draftKey('src'))).toBe(newer);
  });

  it('reports a stored shard it cannot use to its logger', async () => {
    const { storage, records } = memoryStorage();
    await seedRepository(new DraftRepository(storage, 'src', silentLogger()), twoBookDraft());
    records.set(draftAnalysisKey('src', 'GEN'), 'not json');
    const logger = silentLogger();

    await new DraftRepository(storage, 'src', logger).exportAll();

    expect(logger.warn).toHaveBeenCalledWith(
      `Interlinearizer: analysis shard ${draftAnalysisKey('src', 'GEN')} is not valid JSON; treating as empty`,
    );
  });

  it('reads an envelope whose shard manifest is malformed as naming no shard', async () => {
    const { storage, records } = memoryStorage();
    await seedRepository(new DraftRepository(storage, 'src', silentLogger()), twoBookDraft());
    const envelope = JSON.parse(records.get(draftKey('src')) ?? '{}');
    records.set(draftKey('src'), JSON.stringify({ ...envelope, analysisBooks: 'GEN' }));

    const { draft } = await new DraftRepository(storage, 'src', silentLogger()).exportAll();

    expect(draft).not.toHaveProperty('analysisBooks');
  });

  it.each([
    [
      'links without ids',
      JSON.stringify({
        ...emptyAnalysis(),
        tokenAnalysisLinks: [{ ...FIXTURE_STAMPS, analysisId: 'ta', status: 'approved' }],
      }),
    ],
    ['failed validation', JSON.stringify({ tokenAnalyses: 'none' })],
  ])('reads a stored shard with %s as empty, telling its logger', async (reason, shard) => {
    const { storage, records } = memoryStorage();
    await seedRepository(new DraftRepository(storage, 'src', silentLogger()), twoBookDraft());
    records.set(draftAnalysisKey('src', 'GEN'), shard);
    const logger = silentLogger();

    const { draft, unreadableBooks } = await new DraftRepository(
      storage,
      'src',
      logger,
    ).exportAll();

    expect(unreadableBooks).toEqual(['GEN']);
    expect(draft.analysis.tokenAnalysisLinks.map((l) => l.token.tokenRef)).not.toContainEqual(
      expect.stringMatching(/^GEN /),
    );
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining(reason));
  });

  it.each([
    ['is not valid JSON', 'not json'],
    ['is no draft', JSON.stringify({ sourceProjectId: 'src' })],
  ])('starts the draft over in place of a stored envelope that %s', async (_case, stored) => {
    const { storage, records } = memoryStorage({ [draftKey('src')]: stored });

    await new DraftRepository(storage, 'src', silentLogger()).startOver(twoBookDraft());

    const { draft } = await new DraftRepository(storage, 'src', silentLogger()).exportAll();
    expect(draft.analysis.tokenAnalyses).toHaveLength(twoBookDraft().analysis.tokenAnalyses.length);
    expect(records.get(draftKey('src'))).not.toBe(stored);
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

  describe('keptForCopy', () => {
    /** A repository over a stored {@link twoBookDraft}, with the storage under it. */
    async function overTwoBooks() {
      const store = memoryStorage();
      await seedRepository(
        new DraftRepository(store.storage, 'src', silentLogger()),
        twoBookDraft(),
      );
      return { ...store, repository: new DraftRepository(store.storage, 'src', silentLogger()) };
    }

    /** What a repository opened afresh over `storage` exports for copying. */
    function freshExport(storage: KeyValueStorage) {
      return new DraftRepository(storage, 'src', silentLogger()).exportForCopy();
    }

    it('answers undefined before the repository keeps a draft', async () => {
      const { repository } = await overTwoBooks();

      expect(repository.keptForCopy()).toBeUndefined();
    });

    it('answers undefined after a whole read, until a lookup keeps the draft', async () => {
      const { repository } = await overTwoBooks();
      await repository.exportAll();

      expect(repository.keptForCopy()).toBeUndefined();
    });

    it('answers what the store holds once a lookup keeps the draft', async () => {
      const { storage, repository } = await overTwoBooks();
      await repository.getScope();

      expect(repository.keptForCopy()).toEqual(await freshExport(storage));
    });

    it('answers what the store holds after an apply', async () => {
      const { storage, repository } = await overTwoBooks();
      const [payload] = twoBookAnalysis().tokenAnalyses;

      await repository.apply({
        intent: 'writeGloss',
        tokenAnalyses: updating({
          before: payload,
          after: { ...payload, gloss: { en: 'and then' } },
        }),
      });

      expect(repository.keptForCopy()).toEqual(await freshExport(storage));
    });

    it('names the books whose shard could not be read', async () => {
      const { records, repository } = await overTwoBooks();
      records.set(draftAnalysisKey('src', 'GEN'), 'not json');
      await repository.getScope();

      expect(repository.keptForCopy()?.unreadableBooks).toEqual(['GEN']);
    });

    it('answers undefined once an apply fails, since the store may hold part of it', async () => {
      const { storage, repository } = await overTwoBooks();
      await repository.getScope();

      await failGlossEdit(repository, storage, 'GEN');

      expect(repository.keptForCopy()).toBeUndefined();
    });

    it('answers again once the draft is loaded afresh after a failed apply', async () => {
      const { storage, repository } = await overTwoBooks();
      await failGlossEdit(repository, storage, 'GEN');
      await repository.exportAll();
      await repository.getScope();

      expect(repository.keptForCopy()).toEqual(await freshExport(storage));
    });

    it.each([
      ['a lookup', async (repository: DraftRepository) => repository.getScope()],
      [
        'a whole read and then a lookup',
        async (repository: DraftRepository) => {
          await repository.exportAll();
          await repository.getScope();
        },
      ],
    ])(
      'answers undefined over a draft that loaded empty because it was unreadable, after %s',
      async (_case, load) => {
        const { storage } = memoryStorage({ [draftKey('src')]: JSON.stringify({ nope: true }) });
        const repository = new DraftRepository(storage, 'src', silentLogger());

        await load(repository);

        expect(repository.keptForCopy()).toBeUndefined();
      },
    );

    it('leaves a draft it answered as it was when a later apply changes the kept one', async () => {
      const { repository } = await overTwoBooks();
      await repository.getScope();
      const answered = repository.keptForCopy();
      const before = JSON.stringify(answered);
      const [payload] = twoBookAnalysis().tokenAnalyses;

      await repository.apply({
        intent: 'writeGloss',
        tokenAnalyses: updating({
          before: payload,
          after: { ...payload, gloss: { en: 'and then' } },
        }),
      });

      expect(JSON.stringify(answered)).toBe(before);
    });
  });

  describe('markClean', () => {
    it('records the stored draft as clean, rewriting only its envelope', async () => {
      const { storage, records, writes } = memoryStorage();
      await seedRepository(new DraftRepository(storage, 'src', silentLogger()), {
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
      await seedRepository(new DraftRepository(storage, 'src', silentLogger()), twoBookDraft());
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
      await new DraftRepository(memory.storage, 'src', silentLogger()).startOver(twoBookDraft());
      memory.records.set(draftAnalysisKey('src', 'GEN'), 'not json');
      const repository = new DraftRepository(memory.storage, 'src', silentLogger());
      const { draft } = await repository.exportAll();
      return { ...memory, repository, draft };
    }

    it('wipes an unreadable book the draft carries nothing for once the draft is started over', async () => {
      const { repository, draft, records } = await loadedWithUnreadableGen();

      await repository.startOver({ ...draft, analysis: emptyAnalysis() });

      expect(records.has(draftAnalysisKey('src', 'GEN'))).toBe(false);
    });

    it('wipes an unreadable book that a started-over draft carries nothing for', async () => {
      const { repository, draft, records } = await loadedWithUnreadableGen();

      await repository.startOver({ ...draft, analysis: emptyAnalysis() });

      expect(records.has(draftAnalysisKey('src', 'GEN'))).toBe(false);
    });

    it('writes what a started-over draft carries for an unreadable book', async () => {
      const { repository, storage } = await loadedWithUnreadableGen();

      await repository.startOver(twoBookDraft());

      await expect(
        new DraftRepository(storage, 'src', silentLogger()).exportAll(),
      ).resolves.toEqual({ draft: twoBookDraft(), unreadableBooks: [] });
    });
  });

  describe('apply', () => {
    it('rewrites only the books whose records the changes alter', async () => {
      const { storage, writes } = memoryStorage();
      const repository = new DraftRepository(storage, 'src', silentLogger());
      await seedRepository(repository, twoBookDraft());
      writes.length = 0;
      const [segment] = twoBookAnalysis().segmentAnalyses;

      await repository.apply({
        intent: 'writeFreeTranslation',
        segmentAnalyses: updating({
          before: segment,
          after: { ...segment, freeTranslation: { en: 'And then.' } },
        }),
      });

      expect(writes).toContain(draftAnalysisKey('src', 'EXO'));
      expect(writes).not.toContain(draftAnalysisKey('src', 'GEN'));
    });

    it('rewrites every book linking a payload it edits', async () => {
      const { storage, records } = memoryStorage();
      const repository = new DraftRepository(storage, 'src', silentLogger());
      await seedRepository(repository, twoBookDraft());
      const [payload] = twoBookAnalysis().tokenAnalyses;

      await repository.apply({
        intent: 'writeGloss',
        tokenAnalyses: updating({
          before: payload,
          after: { ...payload, gloss: { en: 'and then' } },
        }),
      });

      expect(records.get(draftAnalysisKey('src', 'GEN'))).toContain('and then');
      expect(records.get(draftAnalysisKey('src', 'EXO'))).toContain('and then');
    });

    // The conformance suite leaves timestamps out, since an implementation may stamp records
    // itself. Undo, Save As, and imports rely on this one keeping what a put carries.
    it('keeps the timestamps a put carries', async () => {
      const { storage } = memoryStorage();
      await seedRepository(new DraftRepository(storage, 'src', silentLogger()), twoBookDraft());
      const stamps = {
        createdAt: '2025-06-01T00:00:00.000Z',
        updatedAt: '2025-07-01T00:00:00.000Z',
      };
      const [payload] = twoBookAnalysis().tokenAnalyses;
      const [link] = twoBookAnalysis().tokenAnalysisLinks;

      await new DraftRepository(storage, 'src', silentLogger()).apply({
        intent: 'restamp',
        tokenAnalyses: updating({ before: payload, after: { ...payload, ...stamps } }),
        tokenAnalysisLinks: updating({ before: link, after: { ...link, ...stamps } }),
      });

      const reopened = new DraftRepository(storage, 'src', silentLogger());
      await expect(reopened.getTokenAnalyses([payload.id])).resolves.toStrictEqual([
        { ...payload, ...stamps },
      ]);
      await expect(reopened.findLinksToAnalyses([payload.id])).resolves.toMatchObject({
        tokenAnalysisLinks: expect.arrayContaining([{ ...link, ...stamps }]),
      });
    });

    describe('with a book whose shard could not be read', () => {
      /** A repository that loaded {@link twoBookDraft} with its GEN shard unusable. */
      async function loadedWithUnusableGenesis() {
        const { storage, records, writes } = memoryStorage();
        await seedRepository(new DraftRepository(storage, 'src', silentLogger()), twoBookDraft());
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
            tokenAnalyses: updating({
              before: payload,
              after: { ...payload, gloss: { en: 'and then' } },
            }),
            tokenAnalysisLinks: creating(
              twoBookAnalysis().tokenAnalysisLinks.filter(({ id }) => id === 'tl-GEN'),
            ),
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
          segmentAnalyses: updating({
            before: segment,
            after: { ...segment, freeTranslation: { en: 'And then.' } },
          }),
        });

        expect(records.get(draftAnalysisKey('src', 'EXO'))).toContain('And then.');
        expect(records.get(draftAnalysisKey('src', 'GEN'))).toBe('not json');
      });
    });

    it('keeps its draft as it was when a write fails, so the next apply leaves the failed one out', async () => {
      const { storage, records } = memoryStorage();
      const repository = new DraftRepository(storage, 'src', silentLogger());
      await seedRepository(repository, twoBookDraft());
      const [payload] = twoBookAnalysis().tokenAnalyses;
      const [segment] = twoBookAnalysis().segmentAnalyses;
      const write = jest.spyOn(storage, 'write').mockRejectedValueOnce(new Error('disk full'));

      await expect(
        repository.apply({
          intent: 'writeGloss',
          tokenAnalyses: updating({
            before: payload,
            after: { ...payload, gloss: { en: 'and then' } },
          }),
        }),
      ).rejects.toThrow('disk full');
      write.mockRestore();
      await repository.apply({
        intent: 'writeFreeTranslation',
        segmentAnalyses: updating({
          before: segment,
          after: { ...segment, freeTranslation: { en: 'And then.' } },
        }),
      });

      const {
        draft: { analysis },
      } = await new DraftRepository(storage, 'src', silentLogger()).exportAll();
      expect(analysis.tokenAnalyses[0].gloss).toEqual({ en: 'and' });
      expect(analysis.segmentAnalyses[0].freeTranslation).toEqual({ en: 'And then.' });
      expect(records.get(draftAnalysisKey('src', 'GEN'))).not.toContain('and then');
    });

    it('writes every book of a draft loaded inline, though the changes reach only one', async () => {
      const { storage } = memoryStorage({ [draftKey('src')]: JSON.stringify(twoBookDraft()) });
      const repository = new DraftRepository(storage, 'src', silentLogger());
      const [phrase] = twoBookAnalysis().phraseAnalyses;

      await repository.apply({
        intent: 'writePhraseGloss',
        phraseAnalyses: updating({ before: phrase, after: { ...phrase, gloss: { en: 'within' } } }),
      });

      const loaded = await new DraftRepository(storage, 'src', silentLogger()).exportAll();
      expect(loaded.unreadableBooks).toEqual([]);
      expect(loaded.draft.analysis.segmentAnalysisLinks).toEqual(
        twoBookAnalysis().segmentAnalysisLinks,
      );
    });

    // The restarted load keeps the first copy of the shared payload in manifest order, GEN's.
    it.each([
      ['GEN', 'and'],
      ['EXO', 'and then'],
    ])(
      'brings the books back in step after a restart when the %s write fails, both glossed %p',
      async (failing, gloss) => {
        const { storage, records } = memoryStorage();
        await seedRepository(new DraftRepository(storage, 'src', silentLogger()), twoBookDraft());
        const [phrase] = twoBookAnalysis().phraseAnalyses;
        await failGlossEdit(new DraftRepository(storage, 'src', silentLogger()), storage, failing);

        const restarted = new DraftRepository(storage, 'src', silentLogger());
        await restarted.apply({
          intent: 'writePhraseGloss',
          phraseAnalyses: updating({
            before: phrase,
            after: { ...phrase, gloss: { en: 'within' } },
          }),
        });

        const glossIn = (bookCode: string) =>
          JSON.parse(records.get(draftAnalysisKey('src', bookCode)) ?? '').tokenAnalyses[0].gloss;
        expect(glossIn('GEN')).toEqual({ en: gloss });
        expect(glossIn('EXO')).toEqual({ en: gloss });
        expect(records.has(draftJournalKey('src'))).toBe(false);
      },
    );

    it.each([
      ['no journal at all', 'null'],
      ['not valid JSON', 'not json'],
      ['malformed', JSON.stringify({ adding: [], removing: [], unsettled: 'EXO' })],
    ])(
      'brings back in step a book that a failed apply wrote, after a restart, though the journal is %s',
      async (_, journal) => {
        const { storage, records } = memoryStorage();
        await seedRepository(new DraftRepository(storage, 'src', silentLogger()), twoBookDraft());
        await failGlossEdit(new DraftRepository(storage, 'src', silentLogger()), storage, 'GEN');
        records.set(draftJournalKey('src'), journal);
        const [phrase] = twoBookAnalysis().phraseAnalyses;

        await new DraftRepository(storage, 'src', silentLogger()).apply({
          intent: 'writePhraseGloss',
          phraseAnalyses: updating({
            before: phrase,
            after: { ...phrase, gloss: { en: 'within' } },
          }),
        });

        expect(records.get(draftAnalysisKey('src', 'EXO'))).not.toContain('and then');
        expect(records.has(draftJournalKey('src'))).toBe(false);
      },
    );

    it('rewrites a book a failed apply wrote, though the next apply does not reach it', async () => {
      const { storage, records } = memoryStorage();
      const repository = new DraftRepository(storage, 'src', silentLogger());
      await seedRepository(repository, twoBookDraft());
      const [phrase] = twoBookAnalysis().phraseAnalyses;
      await failGlossEdit(repository, storage, 'GEN');
      expect(records.get(draftAnalysisKey('src', 'EXO'))).toContain('and then');

      await repository.apply({
        intent: 'writePhraseGloss',
        phraseAnalyses: updating({ before: phrase, after: { ...phrase, gloss: { en: 'within' } } }),
      });

      expect(records.get(draftAnalysisKey('src', 'EXO'))).not.toContain('and then');
      expect((await repository.getTokenAnalyses(['ta-and']))[0].gloss).toEqual({ en: 'and' });
    });

    it("stores each book's records in its shard, the bookless ones apart, dropping an emptied book's", async () => {
      const { storage, records } = memoryStorage();
      const repository = new DraftRepository(storage, 'src', silentLogger());
      await seedRepository(repository, twoBookDraft());
      const {
        tokenAnalyses: [payload],
        tokenAnalysisLinks: [genesisLink, exodusLink],
        phraseAnalyses: [phrase],
        segmentAnalyses: [segment],
        segmentAnalysisLinks: [segmentLink],
      } = twoBookAnalysis();
      const unlinked = { id: 'ta-so', ...FIXTURE_STAMPS, surfaceText: 'so' };
      const leviticusLink = {
        ...genesisLink,
        id: 'tl-LEV',
        token: { tokenRef: 'LEV 1:1!0', surfaceText: 'and' },
      };
      const relinked = { ...genesisLink, analysisId: unlinked.id };
      // Unlinks a payload, adds a book, empties EXO of links, then links a bookless payload.
      const changeSets: ChangeSet[] = [
        {
          intent: 'removePhrase',
          phraseAnalysisLinks: deleting(twoBookAnalysis().phraseAnalysisLinks),
          tokenAnalyses: creating([unlinked]),
        },
        { intent: 'writeGloss', tokenAnalysisLinks: creating([leviticusLink]) },
        {
          intent: 'clear',
          tokenAnalysisLinks: deleting([exodusLink]),
          segmentAnalysisLinks: deleting([segmentLink]),
        },
        {
          intent: 'relink',
          tokenAnalysisLinks: updating({ before: genesisLink, after: relinked }),
        },
      ];

      await changeSets.reduce(async (prior, changes) => {
        await prior;
        await repository.apply(changes);
      }, Promise.resolve());

      /** Each record parsed, with the envelope's manifest sorted. */
      const parsed = (stored: Map<string, string>) =>
        new Map(
          [...stored].map(([key, json]) => {
            const value = JSON.parse(json);
            if (key === draftKey('src')) value.analysisBooks.sort();
            return [key, value];
          }),
        );
      const shard = (analysis: Partial<TextAnalysis>) => ({ ...emptyAnalysis(), ...analysis });
      expect(parsed(records)).toEqual(
        new Map<string, unknown>([
          [
            draftKey('src'),
            {
              ...twoBookDraft(),
              analysis: emptyAnalysis(),
              dirty: true,
              analysisBooks: ['GEN', 'LEV', BOOKLESS_PARTITION],
            },
          ],
          [
            draftAnalysisKey('src', 'GEN'),
            shard({ tokenAnalyses: [unlinked], tokenAnalysisLinks: [relinked] }),
          ],
          [
            draftAnalysisKey('src', 'LEV'),
            shard({ tokenAnalyses: [payload], tokenAnalysisLinks: [leviticusLink] }),
          ],
          [
            draftAnalysisKey('src', BOOKLESS_PARTITION),
            shard({ segmentAnalyses: [segment], phraseAnalyses: [phrase] }),
          ],
        ]),
      );
    });
  });

  describe('anchored versions', () => {
    /** A repository over a seeded draft, with Genesis recorded as anchored to `v1`. */
    async function anchoredGenesis() {
      const { storage, records } = memoryStorage();
      const repository = new DraftRepository(storage, 'src', silentLogger());
      await seedRepository(repository, twoBookDraft());
      await repository.apply(
        { intent: 'reanchor' },
        { keepDirty: true, anchoredTo: { bookCode: 'GEN', textVersion: 'v1' } },
      );
      return { storage, records, repository };
    }

    it('reports the version an apply recorded', async () => {
      const { repository } = await anchoredGenesis();

      expect((await repository.getDraftState()).anchoredVersions).toEqual({ GEN: 'v1' });
    });

    it('loads the recorded versions with the draft', async () => {
      const { storage } = await anchoredGenesis();

      expect(
        (await new DraftRepository(storage, 'src', silentLogger()).getDraftState())
          .anchoredVersions,
      ).toEqual({ GEN: 'v1' });
    });

    it('keeps the recorded versions out of the loaded draft', async () => {
      const { storage } = await anchoredGenesis();

      const { draft } = await new DraftRepository(storage, 'src', silentLogger()).exportAll();

      expect(draft).not.toHaveProperty('anchoredVersions');
    });

    it('keeps the recorded versions through later applies', async () => {
      const { storage, repository } = await anchoredGenesis();
      await repository.apply(
        { intent: 'reanchor' },
        { anchoredTo: { bookCode: 'EXO', textVersion: 'v2' } },
      );

      expect(
        (await new DraftRepository(storage, 'src', silentLogger()).getDraftState())
          .anchoredVersions,
      ).toEqual({ GEN: 'v1', EXO: 'v2' });
    });

    it('drops the version of a book an apply names as unanchored', async () => {
      const { storage, repository } = await anchoredGenesis();

      await repository.apply({ intent: 'relink' }, { unanchored: ['GEN'] });

      expect(
        (await new DraftRepository(storage, 'src', silentLogger()).getDraftState())
          .anchoredVersions,
      ).toEqual({});
    });

    it('keeps the recorded versions when the draft is marked clean', async () => {
      const { storage, repository } = await anchoredGenesis();

      await repository.markClean();

      expect(
        (await new DraftRepository(storage, 'src', silentLogger()).getDraftState())
          .anchoredVersions,
      ).toEqual({ GEN: 'v1' });
    });

    it('records no version from a failed apply', async () => {
      const { storage, repository } = await anchoredGenesis();
      jest.spyOn(storage, 'write').mockRejectedValue(new Error('disk full'));

      await expect(
        repository.apply(
          { intent: 'reanchor' },
          { anchoredTo: { bookCode: 'EXO', textVersion: 'v2' } },
        ),
      ).rejects.toThrow('disk full');

      expect((await repository.getDraftState()).anchoredVersions).toEqual({ GEN: 'v1' });
    });

    it('drops the recorded versions when the draft starts over', async () => {
      const { storage, repository } = await anchoredGenesis();

      await repository.startOver(twoBookDraft());

      expect(
        (await new DraftRepository(storage, 'src', silentLogger()).getDraftState())
          .anchoredVersions,
      ).toEqual({});
    });

    it('drops, after a restart, the version of a book whose shard a start-over rewrote before its envelope failed', async () => {
      const { storage, repository } = await anchoredGenesis();
      await repository.apply(
        { intent: 'reanchor' },
        { anchoredTo: { bookCode: 'EXO', textVersion: 'v2' } },
      );
      const started = twoBookDraft();
      const [phrase] = started.analysis.phraseAnalyses;
      started.analysis.phraseAnalyses = [{ ...phrase, gloss: { en: 'within' } }];
      const { write: writeThrough } = storage;
      const write = jest
        .spyOn(storage, 'write')
        .mockImplementation((key, data) =>
          key === draftKey('src')
            ? Promise.reject(new Error('disk full'))
            : writeThrough(key, data),
        );
      await expect(repository.startOver(started)).rejects.toThrow('disk full');
      write.mockRestore();

      expect(
        (await new DraftRepository(storage, 'src', silentLogger()).getDraftState())
          .anchoredVersions,
      ).toEqual({ EXO: 'v2' });
    });

    it('drops, after a restart, the version of a book whose shard a retried apply found already rewritten', async () => {
      const { storage, repository } = await anchoredGenesis();
      await repository.apply(
        { intent: 'reanchor' },
        { keepDirty: true, anchoredTo: { bookCode: 'EXO', textVersion: 'v1' } },
      );
      const [segment] = twoBookAnalysis().segmentAnalyses;
      const { write: writeThrough } = storage;
      const write = jest
        .spyOn(storage, 'write')
        .mockImplementation((key, data) =>
          key === draftKey('src')
            ? Promise.reject(new Error('disk full'))
            : writeThrough(key, data),
        );
      const reanchorExodus = () =>
        repository.apply(
          {
            intent: 'reanchor',
            segmentAnalyses: updating({
              before: segment,
              after: { ...segment, freeTranslation: { en: 'And then.' } },
            }),
          },
          { keepDirty: true, anchoredTo: { bookCode: 'EXO', textVersion: 'v2' } },
        );
      await expect(reanchorExodus()).rejects.toThrow('disk full');
      await expect(reanchorExodus()).rejects.toThrow('disk full');
      write.mockRestore();

      expect(
        (await new DraftRepository(storage, 'src', silentLogger()).getDraftState())
          .anchoredVersions,
      ).toEqual({ GEN: 'v1' });
    });

    it('drops every recorded version when the shard journal is unusable', async () => {
      const { storage, records } = await anchoredGenesis();
      records.set(draftJournalKey('src'), 'not json');

      expect(
        (await new DraftRepository(storage, 'src', silentLogger()).getDraftState())
          .anchoredVersions,
      ).toEqual({});
    });

    it('loads unusable recorded versions as none', async () => {
      const { storage, records } = await anchoredGenesis();
      const envelope = JSON.parse(records.get(draftKey('src')) ?? '');
      records.set(draftKey('src'), JSON.stringify({ ...envelope, anchoredVersions: ['v1'] }));

      expect(
        (await new DraftRepository(storage, 'src', silentLogger()).getDraftState())
          .anchoredVersions,
      ).toEqual({});
    });
  });

  describe('lookups', () => {
    it('load the draft once, answering later lookups from what they kept', async () => {
      const { storage } = memoryStorage();
      await seedRepository(new DraftRepository(storage, 'src', silentLogger()), twoBookDraft());
      const repository = new DraftRepository(storage, 'src', silentLogger());
      const read = jest.spyOn(storage, 'read');

      await repository.findLinksInBooks(['GEN']);
      const readsAfterFirst = read.mock.calls.length;
      await repository.findLinksToAnalyses(['ta-and']);

      expect(readsAfterFirst).toBeGreaterThan(0);
      expect(read).toHaveBeenCalledTimes(readsAfterFirst);
    });

    it('read the whole draft from what they kept, keeping it for the next lookup', async () => {
      const { storage } = memoryStorage();
      await seedRepository(new DraftRepository(storage, 'src', silentLogger()), twoBookDraft());
      const repository = new DraftRepository(storage, 'src', silentLogger());
      await repository.findLinksInBooks(['GEN']);
      const read = jest.spyOn(storage, 'read');

      await expect(repository.getWholeDraft()).resolves.toMatchObject({
        analysis: twoBookAnalysis(),
      });
      await repository.findLinksInBooks(['GEN']);

      expect(read).not.toHaveBeenCalled();
    });

    it.each(['exportForCopy', 'markClean'] as const)(
      'keep what they kept across %s',
      async (call) => {
        const { storage } = memoryStorage();
        const repository = new DraftRepository(storage, 'src', silentLogger());
        await seedRepository(repository, { ...twoBookDraft(), dirty: true });
        await repository.findLinksInBooks(['GEN']);
        await repository[call]();
        const read = jest.spyOn(storage, 'read');

        await repository.findLinksInBooks(['GEN']);

        expect(read).not.toHaveBeenCalled();
      },
    );

    it('answer from what exportAll loaded, reading nothing more', async () => {
      const { storage } = memoryStorage();
      await seedRepository(new DraftRepository(storage, 'src', silentLogger()), twoBookDraft());
      const repository = new DraftRepository(storage, 'src', silentLogger());
      await repository.exportAll();
      const read = jest.spyOn(storage, 'read');

      await expect(repository.getTokenAnalyses(['ta-and'])).resolves.toHaveLength(1);
      expect(read).not.toHaveBeenCalled();
    });

    it('answer from what exportAll loaded, not from what an earlier lookup kept', async () => {
      const { storage } = memoryStorage();
      const repository = new DraftRepository(storage, 'src', silentLogger());
      await seedRepository(repository, twoBookDraft());
      await repository.findLinksInBooks(['GEN']);
      await new DraftRepository(storage, 'src', silentLogger()).apply({
        intent: 'deletePayload',
        tokenAnalyses: deleting(twoBookAnalysis().tokenAnalyses),
        tokenAnalysisLinks: deleting(twoBookAnalysis().tokenAnalysisLinks),
      });

      await repository.exportAll();

      await expect(repository.getTokenAnalyses(['ta-and'])).resolves.toEqual([]);
    });

    it('read the draft again after a later exportAll fails', async () => {
      const { storage, records } = memoryStorage();
      await seedRepository(new DraftRepository(storage, 'src', silentLogger()), twoBookDraft());
      const repository = new DraftRepository(storage, 'src', silentLogger());
      await repository.exportAll();
      records.set(draftKey('src'), '{');
      await expect(repository.exportAll()).rejects.toThrow(SyntaxError);

      await expect(repository.getTokenAnalyses(['ta-and'])).rejects.toThrow(SyntaxError);
    });

    it('are unchanged by changes to the draft exportAll returned', async () => {
      const { storage } = memoryStorage();
      await seedRepository(new DraftRepository(storage, 'src', silentLogger()), twoBookDraft());
      const repository = new DraftRepository(storage, 'src', silentLogger());
      const { draft } = await repository.exportAll();

      draft.analysis.tokenAnalyses.length = 0;

      await expect(repository.getTokenAnalyses(['ta-and'])).resolves.toHaveLength(1);
    });

    it('read the draft again after a whole save', async () => {
      const { storage } = memoryStorage();
      const repository = new DraftRepository(storage, 'src', silentLogger());
      await repository.exportAll();
      await repository.startOver(twoBookDraft());
      const read = jest.spyOn(storage, 'read');

      await repository.findLinksInBooks(['GEN']);

      expect(read).toHaveBeenCalled();
    });

    it("return a book's links in stored order after an edit replaces one", async () => {
      const { storage } = memoryStorage();
      const [genesis] = twoBookAnalysis().tokenAnalysisLinks;
      const later = {
        ...genesis,
        id: 'tl-GEN-later',
        token: { ...genesis.token, tokenRef: 'GEN 1:1!4' },
      };
      const repository = new DraftRepository(storage, 'src', silentLogger());
      await seedRepository(repository, {
        ...twoBookDraft(),
        analysis: { ...twoBookAnalysis(), tokenAnalysisLinks: [genesis, later] },
      });
      await repository.findLinksInBooks(['GEN']);

      await repository.apply({
        intent: 'reject',
        tokenAnalysisLinks: updating({
          before: genesis,
          after: { ...genesis, status: 'rejected' },
        }),
      });

      const { tokenAnalysisLinks } = await repository.findLinksInBooks(['GEN']);
      const stored = (await new DraftRepository(storage, 'src', silentLogger()).exportAll()).draft
        .analysis.tokenAnalysisLinks;
      expect(tokenAnalysisLinks.map(({ id }) => id)).toStrictEqual(['tl-GEN', 'tl-GEN-later']);
      expect(stored.map(({ id }) => id)).toStrictEqual(['tl-GEN', 'tl-GEN-later']);
    });

    it('answer from what an apply left without loading the draft again', async () => {
      const { storage } = memoryStorage();
      const repository = new DraftRepository(storage, 'src', silentLogger());
      await repository.apply({
        intent: 'add',
        tokenAnalyses: creating(twoBookAnalysis().tokenAnalyses),
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
      await seedRepository(new DraftRepository(storage, 'src', silentLogger()), twoBookDraft());

      await expect(
        new DraftRepository(storage, 'src', silentLogger()).checkIndexes(),
      ).resolves.toStrictEqual([]);
    });

    it('reports nothing while every shard holds its part of the draft', async () => {
      const { storage } = memoryStorage();
      const repository = new DraftRepository(storage, 'src', silentLogger());
      await seedRepository(repository, twoBookDraft());
      const [payload] = twoBookAnalysis().tokenAnalyses;

      await repository.apply({
        intent: 'writeGloss',
        tokenAnalyses: updating({
          before: payload,
          after: { ...payload, gloss: { en: 'and then' } },
        }),
      });

      await expect(repository.checkIndexes()).resolves.toStrictEqual([]);
    });

    it('reports a shard that a failed apply left out of step once the journal is lost', async () => {
      const { storage, records } = memoryStorage();
      await seedRepository(new DraftRepository(storage, 'src', silentLogger()), twoBookDraft());
      await failGlossEdit(new DraftRepository(storage, 'src', silentLogger()), storage, 'GEN');
      records.delete(draftJournalKey('src'));
      const restarted = new DraftRepository(storage, 'src', silentLogger());
      await restarted.getTokenAnalyses([]);

      await expect(restarted.checkIndexes()).resolves.toStrictEqual([
        { index: 'tokenAnalyses in shard', key: 'EXO', missing: ['ta-and'], extra: ['ta-and'] },
      ]);
    });

    it('reports the records of a shard gone from storage as missing', async () => {
      const { storage, records } = memoryStorage();
      const repository = new DraftRepository(storage, 'src', silentLogger());
      await seedRepository(repository, twoBookDraft());
      await repository.getTokenAnalyses([]);
      records.delete(draftAnalysisKey('src', 'EXO'));

      await expect(repository.checkIndexes()).resolves.toContainEqual({
        index: 'segmentAnalysisLinks in shard',
        key: 'EXO',
        missing: ['sl-1'],
        extra: [],
      });
    });

    it('reports the records of a listed shard the draft carries nothing for as extra', async () => {
      const { storage, records } = memoryStorage();
      const repository = new DraftRepository(storage, 'src', silentLogger());
      await seedRepository(repository, twoBookDraft());
      await repository.getTokenAnalyses([]);
      const envelope = JSON.parse(records.get(draftKey('src')) ?? '');
      records.set(
        draftKey('src'),
        JSON.stringify({ ...envelope, analysisBooks: [...envelope.analysisBooks, 'LEV'] }),
      );
      records.set(
        draftAnalysisKey('src', 'LEV'),
        JSON.stringify({
          ...emptyAnalysis(),
          tokenAnalyses: [{ id: 'ta-so', ...FIXTURE_STAMPS, surfaceText: 'so' }],
        }),
      );

      await expect(repository.checkIndexes()).resolves.toStrictEqual([
        { index: 'tokenAnalyses in shard', key: 'LEV', missing: [], extra: ['ta-so'] },
      ]);
    });

    it('reports nothing for a book whose shard could not be read', async () => {
      const { storage, records } = memoryStorage();
      await seedRepository(new DraftRepository(storage, 'src', silentLogger()), twoBookDraft());
      records.set(draftAnalysisKey('src', 'GEN'), 'not json');
      const repository = new DraftRepository(storage, 'src', silentLogger());
      await repository.getTokenAnalyses([]);

      await expect(repository.checkIndexes()).resolves.toStrictEqual([]);
    });

    it.each([
      ['stored inline', { [draftKey('src')]: JSON.stringify(twoBookDraft()) }],
      ['never saved', {}],
    ])('reports no shards for a draft %s', async (_, initial) => {
      const repository = new DraftRepository(memoryStorage(initial).storage, 'src', silentLogger());
      await repository.getTokenAnalyses([]);

      await expect(repository.checkIndexes()).resolves.toStrictEqual([]);
    });
  });
});
