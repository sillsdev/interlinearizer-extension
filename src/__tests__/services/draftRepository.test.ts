/// <reference types="jest" />

import type { DraftProject, TextAnalysis } from 'interlinearizer';
import { DraftRepository } from '../../services/draftRepository';
import { draftAnalysisKey, draftJournalKey, draftKey } from '../../services/storageKeys';
import type { ChangeSet, KeyValueStorage } from '../../types/analysis-repository';
import { emptyAnalysis, emptyDraft } from '../../types/empty-factories';
import { CURRENT_MODEL_VERSION } from '../../types/model-version';
import { applyChangeSet } from '../../utils/change-set';
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
      tokenAnalyses: { puts: [{ ...payload, gloss: { en: 'and then' } }], deletes: [] },
    }),
  ).rejects.toThrow('disk full');
  write.mockRestore();
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

    it('writes every book of a draft loaded inline, though the changes reach only one', async () => {
      const { storage } = memoryStorage({ [draftKey('src')]: JSON.stringify(twoBookDraft()) });
      const repository = new DraftRepository(storage, 'src', silentLogger());
      const [phrase] = twoBookAnalysis().phraseAnalyses;

      await repository.apply({
        intent: 'writePhraseGloss',
        phraseAnalyses: { puts: [{ ...phrase, gloss: { en: 'within' } }], deletes: [] },
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
        await new DraftRepository(storage, 'src', silentLogger()).replaceAll(twoBookDraft());
        const [phrase] = twoBookAnalysis().phraseAnalyses;
        await failGlossEdit(new DraftRepository(storage, 'src', silentLogger()), storage, failing);

        const restarted = new DraftRepository(storage, 'src', silentLogger());
        await restarted.apply({
          intent: 'writePhraseGloss',
          phraseAnalyses: { puts: [{ ...phrase, gloss: { en: 'within' } }], deletes: [] },
        });

        const glossIn = (bookCode: string) =>
          JSON.parse(records.get(draftAnalysisKey('src', bookCode)) ?? '').tokenAnalyses[0].gloss;
        expect(glossIn('GEN')).toEqual({ en: gloss });
        expect(glossIn('EXO')).toEqual({ en: gloss });
        expect(records.has(draftJournalKey('src'))).toBe(false);
      },
    );

    it.each([
      ['not valid JSON', 'not json'],
      ['malformed', JSON.stringify({ adding: [], removing: [], unsettled: 'EXO' })],
    ])(
      'brings back in step a book that a failed apply wrote, after a restart, though the journal is %s',
      async (_, journal) => {
        const { storage, records } = memoryStorage();
        await new DraftRepository(storage, 'src', silentLogger()).replaceAll(twoBookDraft());
        await failGlossEdit(new DraftRepository(storage, 'src', silentLogger()), storage, 'GEN');
        records.set(draftJournalKey('src'), journal);
        const [phrase] = twoBookAnalysis().phraseAnalyses;

        await new DraftRepository(storage, 'src', silentLogger()).apply({
          intent: 'writePhraseGloss',
          phraseAnalyses: { puts: [{ ...phrase, gloss: { en: 'within' } }], deletes: [] },
        });

        expect(records.get(draftAnalysisKey('src', 'EXO'))).not.toContain('and then');
        expect(records.has(draftJournalKey('src'))).toBe(false);
      },
    );

    it('rewrites a book a failed apply wrote, though the next apply does not reach it', async () => {
      const { storage, records } = memoryStorage();
      const repository = new DraftRepository(storage, 'src', silentLogger());
      await repository.replaceAll(twoBookDraft());
      const [phrase] = twoBookAnalysis().phraseAnalyses;
      await failGlossEdit(repository, storage, 'GEN');
      expect(records.get(draftAnalysisKey('src', 'EXO'))).toContain('and then');

      await repository.apply({
        intent: 'writePhraseGloss',
        phraseAnalyses: { puts: [{ ...phrase, gloss: { en: 'within' } }], deletes: [] },
      });

      expect(records.get(draftAnalysisKey('src', 'EXO'))).not.toContain('and then');
      expect((await repository.getTokenAnalyses(['ta-and']))[0].gloss).toEqual({ en: 'and' });
    });

    it('stores what a whole save of the same draft would, up to the order of its books', async () => {
      const { storage, records } = memoryStorage();
      const repository = new DraftRepository(storage, 'src', silentLogger());
      await repository.replaceAll(twoBookDraft());
      const [genesisLink, exodusLink] = twoBookAnalysis().tokenAnalysisLinks;
      const [segmentLink] = twoBookAnalysis().segmentAnalysisLinks;
      const unlinked = { id: 'ta-so', ...FIXTURE_STAMPS, surfaceText: 'so' };
      // Unlinks a payload, adds a book, empties EXO of links, then links a bookless payload.
      const changeSets: ChangeSet[] = [
        {
          intent: 'removePhrase',
          phraseAnalysisLinks: { puts: [], deletes: ['pa-1'] },
          tokenAnalyses: { puts: [unlinked], deletes: [] },
        },
        {
          intent: 'writeGloss',
          tokenAnalysisLinks: {
            puts: [
              {
                ...genesisLink,
                id: 'tl-LEV',
                token: { tokenRef: 'LEV 1:1!0', surfaceText: 'and' },
              },
            ],
            deletes: [],
          },
        },
        {
          intent: 'clear',
          tokenAnalysisLinks: { puts: [], deletes: [exodusLink.id] },
          segmentAnalysisLinks: { puts: [], deletes: [segmentLink.id] },
        },
        {
          intent: 'relink',
          tokenAnalysisLinks: { puts: [{ ...genesisLink, analysisId: unlinked.id }], deletes: [] },
        },
      ];

      await changeSets.reduce(async (prior, changes) => {
        await prior;
        await repository.apply(changes);
      }, Promise.resolve());

      const whole = memoryStorage();
      const expected = changeSets.reduce(
        (draft, changes) => applyChangeSet(draft, changes).draft,
        twoBookDraft(),
      );
      await new DraftRepository(whole.storage, 'src', silentLogger()).replaceAll(expected);
      /** Each record parsed, with the envelope's manifest sorted. */
      const parsed = (stored: Map<string, string>) =>
        new Map(
          [...stored].map(([key, json]) => {
            const value = JSON.parse(json);
            if (key === draftKey('src')) value.analysisBooks.sort();
            return [key, value];
          }),
        );
      expect(parsed(records)).toEqual(parsed(whole.records));
      expect(records.has(draftAnalysisKey('src', 'EXO'))).toBe(false);
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

    it.each(['exportForCopy', 'markClean'] as const)(
      'keep what they kept across %s',
      async (call) => {
        const { storage } = memoryStorage();
        const repository = new DraftRepository(storage, 'src', silentLogger());
        await repository.replaceAll({ ...twoBookDraft(), dirty: true });
        await repository.findLinksInBooks(['GEN']);
        await repository[call]();
        const read = jest.spyOn(storage, 'read');

        await repository.findLinksInBooks(['GEN']);

        expect(read).not.toHaveBeenCalled();
      },
    );

    it('answer from what exportAll loaded, reading nothing more', async () => {
      const { storage } = memoryStorage();
      await new DraftRepository(storage, 'src', silentLogger()).replaceAll(twoBookDraft());
      const repository = new DraftRepository(storage, 'src', silentLogger());
      await repository.exportAll();
      const read = jest.spyOn(storage, 'read');

      await expect(repository.getTokenAnalyses(['ta-and'])).resolves.toHaveLength(1);
      expect(read).not.toHaveBeenCalled();
    });

    it('answer from what exportAll loaded, not from what an earlier lookup kept', async () => {
      const { storage } = memoryStorage();
      const repository = new DraftRepository(storage, 'src', silentLogger());
      await repository.replaceAll(twoBookDraft());
      await repository.findLinksInBooks(['GEN']);
      await new DraftRepository(storage, 'src', silentLogger()).replaceAll(emptyDraft('src'));

      await repository.exportAll();

      await expect(repository.getTokenAnalyses(['ta-and'])).resolves.toEqual([]);
    });

    it('read the draft again after a later exportAll fails', async () => {
      const { storage, records } = memoryStorage();
      await new DraftRepository(storage, 'src', silentLogger()).replaceAll(twoBookDraft());
      const repository = new DraftRepository(storage, 'src', silentLogger());
      await repository.exportAll();
      records.set(draftKey('src'), '{');
      await expect(repository.exportAll()).rejects.toThrow(SyntaxError);

      await expect(repository.getTokenAnalyses(['ta-and'])).rejects.toThrow(SyntaxError);
    });

    it('are unchanged by changes to the draft exportAll returned', async () => {
      const { storage } = memoryStorage();
      await new DraftRepository(storage, 'src', silentLogger()).replaceAll(twoBookDraft());
      const repository = new DraftRepository(storage, 'src', silentLogger());
      const { draft } = await repository.exportAll();

      draft.analysis.tokenAnalyses.length = 0;

      await expect(repository.getTokenAnalyses(['ta-and'])).resolves.toHaveLength(1);
    });

    it('read the draft again after a whole save', async () => {
      const { storage } = memoryStorage();
      const repository = new DraftRepository(storage, 'src', silentLogger());
      await repository.exportAll();
      await repository.replaceAll(twoBookDraft());
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
      await repository.replaceAll({
        ...twoBookDraft(),
        analysis: { ...twoBookAnalysis(), tokenAnalysisLinks: [genesis, later] },
      });
      await repository.findLinksInBooks(['GEN']);

      await repository.apply({
        intent: 'reject',
        tokenAnalysisLinks: { puts: [{ ...genesis, status: 'rejected' }], deletes: [] },
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

    it('reports nothing while every shard holds its part of the draft', async () => {
      const { storage } = memoryStorage();
      const repository = new DraftRepository(storage, 'src', silentLogger());
      await repository.replaceAll(twoBookDraft());
      const [payload] = twoBookAnalysis().tokenAnalyses;

      await repository.apply({
        intent: 'writeGloss',
        tokenAnalyses: { puts: [{ ...payload, gloss: { en: 'and then' } }], deletes: [] },
      });

      await expect(repository.checkIndexes()).resolves.toStrictEqual([]);
    });

    it('reports a shard that a failed apply left out of step once the journal is lost', async () => {
      const { storage, records } = memoryStorage();
      await new DraftRepository(storage, 'src', silentLogger()).replaceAll(twoBookDraft());
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
      await repository.replaceAll(twoBookDraft());
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
      await repository.replaceAll(twoBookDraft());
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
      await new DraftRepository(storage, 'src', silentLogger()).replaceAll(twoBookDraft());
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
