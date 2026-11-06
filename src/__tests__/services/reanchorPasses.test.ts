/// <reference types="jest" />

import type { Book, DraftProject, TextAnalysis } from 'interlinearizer';
import { DraftRepository } from '../../services/draftRepository';
import { EditHistory } from '../../services/editHistory';
import { reanchorRestored, reanchorStoredBook } from '../../services/reanchorPasses';
import { emptyAnalysis, emptyDraft } from '../../types/empty-factories';
import { missingBook } from '../../utils/reanchor-analysis';
import {
  FIXTURE_STAMPS,
  makeTokenLink,
  makeVerseBook,
  memoryStorage,
  seedRepository,
  silentLogger,
  tokenRefOf,
} from '../test-helpers';

const SOURCE = 'src';

/** A book of one verse reading `text`. */
function verseBook(sid: string, text: string): Book {
  return makeVerseBook([{ sid, text }]);
}

/** An analysis glossing `word` where `book` has it, under the link id `linkId`. */
function glossing(book: Book, word: string, linkId: string): TextAnalysis {
  return {
    ...emptyAnalysis(),
    tokenAnalyses: [{ ...FIXTURE_STAMPS, id: `ta-${word}`, surfaceText: word }],
    tokenAnalysisLinks: [
      makeTokenLink(`ta-${word}`, tokenRefOf(book, word), { surfaceText: word, id: linkId }),
    ],
  };
}

/**
 * Genesis glossed on "beta" and Exodus on "delta", stored in memory, with a history over the draft
 * that re-anchors what it restores.
 */
async function storedDraft(extra: Partial<DraftProject> = {}) {
  const { storage } = memoryStorage();
  const genesis = glossing(verseBook('GEN 1:1', 'alpha beta'), 'beta', 'tl-gen');
  const exodus = glossing(verseBook('EXO 1:1', 'gamma delta'), 'delta', 'tl-exo');
  const draft: DraftProject = {
    ...emptyDraft(SOURCE),
    analysis: {
      ...emptyAnalysis(),
      tokenAnalyses: [...genesis.tokenAnalyses, ...exodus.tokenAnalyses],
      tokenAnalysisLinks: [...genesis.tokenAnalysisLinks, ...exodus.tokenAnalysisLinks],
    },
    ...extra,
  };
  await seedRepository(new DraftRepository(storage, SOURCE, silentLogger()), draft);
  const repository = new DraftRepository(storage, SOURCE, silentLogger());
  const history = new EditHistory(repository, reanchorRestored(repository));
  const stored = async () =>
    (await new DraftRepository(storage, SOURCE, silentLogger()).exportAll()).draft;
  return { repository, history, stored };
}

function linkNamed(draft: DraftProject, id: string) {
  const link = draft.analysis.tokenAnalysisLinks.find((l) => l.id === id);
  if (!link) throw new Error(`no link ${id}`);
  return link;
}

describe('reanchorStoredBook', () => {
  it("re-anchors the stored draft to the book's current text, leaving other books alone", async () => {
    const { repository, history, stored } = await storedDraft();
    const edited = verseBook('GEN 1:1', 'alpha and beta');

    const applied = await reanchorStoredBook(repository, history, edited);

    const draft = await stored();
    expect(linkNamed(draft, 'tl-gen').token.tokenRef).toBe(tokenRefOf(edited, 'beta'));
    expect(linkNamed(draft, 'tl-exo').token.tokenRef).toBe('EXO 1:1:6');
    expect(applied?.changes.tokenAnalysisLinks?.puts.map(({ id }) => id)).toEqual(['tl-gen']);
  });

  it('returns what restores what the pass replaced', async () => {
    const { repository, history } = await storedDraft();
    const before = linkNamed((await repository.exportAll()).draft, 'tl-gen');

    const applied = await reanchorStoredBook(
      repository,
      history,
      verseBook('GEN 1:1', 'alpha and beta'),
    );

    expect(applied?.inverse.tokenAnalysisLinks).toStrictEqual({ puts: [before], deletes: [] });
  });

  it.each([false, true])(
    'leaves a draft whose unsaved mark is %s as it was, a pass being no edit',
    async (dirty) => {
      const { repository, history, stored } = await storedDraft({ dirty });

      await reanchorStoredBook(repository, history, verseBook('GEN 1:1', 'alpha and beta'));

      await expect(stored()).resolves.toMatchObject({ dirty });
    },
  );

  it('applies nothing when the draft already reads as the book does', async () => {
    const { repository, history } = await storedDraft();
    const apply = jest.spyOn(repository, 'apply');

    await expect(
      reanchorStoredBook(repository, history, verseBook('GEN 1:1', 'alpha beta')),
    ).resolves.toBeUndefined();

    expect(apply).not.toHaveBeenCalled();
  });

  it("moves the draft's splits in the book, keeping its record", async () => {
    const before = verseBook('GEN 1:1', 'alpha beta');
    const { repository, history, stored } = await storedDraft({
      suggestedDescription: 'Named',
      segmentation: {
        removedVerseStarts: [],
        addedStarts: [{ tokenRef: tokenRefOf(before, 'beta'), surfaceText: 'beta' }],
      },
    });
    const edited = verseBook('GEN 1:1', 'alpha and beta');

    await reanchorStoredBook(repository, history, edited);

    const draft = await stored();
    expect(draft.segmentation?.addedStarts).toEqual([
      { tokenRef: tokenRefOf(edited, 'beta'), surfaceText: 'beta' },
    ]);
    expect(draft.suggestedDescription).toBe('Named');
  });

  it('stales the links into a book the text lacks', async () => {
    const { repository, history, stored } = await storedDraft();

    await reanchorStoredBook(repository, history, missingBook('GEN'));

    const draft = await stored();
    expect(linkNamed(draft, 'tl-gen').status).toBe('stale');
    expect(linkNamed(draft, 'tl-exo').status).toBe('approved');
  });

  it('records the pass it applies, so that an undo re-anchors what it restores', async () => {
    const { repository, history, stored } = await storedDraft();
    const link = linkNamed(await stored(), 'tl-gen');
    await history.apply({
      intent: 'suggest',
      tokenAnalysisLinks: { puts: [{ ...link, status: 'suggested' }], deletes: [] },
    });
    const edited = verseBook('GEN 1:1', 'alpha and beta');

    await reanchorStoredBook(repository, history, edited);
    await history.undo();

    expect(linkNamed(await stored(), 'tl-gen')).toMatchObject({
      status: 'approved',
      token: { tokenRef: tokenRefOf(edited, 'beta') },
    });
  });

  it('records the pass over a book the draft links into, though it changes nothing', async () => {
    const { repository, history } = await storedDraft();
    const genesis = verseBook('GEN 1:1', 'alpha beta');
    const applyPass = jest.spyOn(history, 'applyPass');

    await reanchorStoredBook(repository, history, genesis);

    expect(applyPass).toHaveBeenCalledWith(genesis, undefined);
  });

  it('records no pass over a book the draft neither links into nor splits', async () => {
    const { repository, history } = await storedDraft();
    const applyPass = jest.spyOn(history, 'applyPass');

    await expect(
      reanchorStoredBook(repository, history, verseBook('LEV 1:1', 'epsilon zeta')),
    ).resolves.toBeUndefined();

    expect(applyPass).not.toHaveBeenCalled();
  });

  it('records the pass over a book the draft only splits', async () => {
    const leviticus = verseBook('LEV 1:1', 'epsilon zeta');
    const { repository, history } = await storedDraft({
      segmentation: {
        removedVerseStarts: [],
        addedStarts: [{ tokenRef: tokenRefOf(leviticus, 'zeta'), surfaceText: 'zeta' }],
      },
    });
    const applyPass = jest.spyOn(history, 'applyPass');

    await reanchorStoredBook(repository, history, leviticus);

    expect(applyPass).toHaveBeenCalledWith(leviticus, undefined);
  });
});

describe('reanchorRestored', () => {
  it('re-anchors what the changes would restore, applying nothing', async () => {
    const { repository, stored } = await storedDraft();
    const before = verseBook('GEN 1:1', 'alpha beta');
    const edited = verseBook('GEN 1:1', 'alpha and beta');
    const restoring = {
      intent: 'undo',
      tokenAnalysisLinks: {
        puts: [
          makeTokenLink('ta-beta', tokenRefOf(before, 'beta'), { surfaceText: 'beta', id: 'tl-2' }),
        ],
        deletes: [],
      },
    };
    const apply = jest.spyOn(repository, 'apply');

    const changes = await reanchorRestored(repository)(restoring, [edited]);

    expect(changes?.tokenAnalysisLinks?.puts).toEqual([
      expect.objectContaining({ id: 'tl-gen' }),
      expect.objectContaining({
        id: 'tl-2',
        token: { tokenRef: tokenRefOf(edited, 'beta'), surfaceText: 'beta' },
      }),
    ]);
    expect(apply).not.toHaveBeenCalled();
    expect((await stored()).analysis.tokenAnalysisLinks).toHaveLength(2);
  });

  it('re-anchors to each book in turn', async () => {
    const { repository } = await storedDraft();

    const changes = await reanchorRestored(repository)({ intent: 'undo' }, [
      verseBook('GEN 1:1', 'alpha and beta'),
      missingBook('EXO'),
    ]);

    expect(changes?.tokenAnalysisLinks?.puts.map(({ id, status }) => [id, status])).toEqual([
      ['tl-gen', 'approved'],
      ['tl-exo', 'stale'],
    ]);
  });

  it('stales a restored translation whose stored payload no link names', async () => {
    const before = verseBook('GEN 1:1', 'alpha beta');
    const { repository } = await storedDraft({
      analysis: {
        ...emptyAnalysis(),
        segmentAnalyses: [
          {
            ...FIXTURE_STAMPS,
            id: 'sa-1',
            surfaceText: before.segments[0].baselineText,
            freeTranslation: { en: 'first second' },
          },
        ],
      },
    });
    const restoring = {
      intent: 'undo',
      segmentAnalysisLinks: {
        puts: [
          {
            ...FIXTURE_STAMPS,
            id: 'sl-1',
            analysisId: 'sa-1',
            status: 'approved' as const,
            segmentId: before.segments[0].id,
          },
        ],
        deletes: [],
      },
    };

    const changes = await reanchorRestored(repository)(restoring, [
      verseBook('GEN 1:1', 'alpha gamma'),
    ]);

    expect(changes?.segmentAnalysisLinks?.puts).toEqual([
      expect.objectContaining({ id: 'sl-1', status: 'stale' }),
    ]);
  });

  it('gives nothing when what the changes would restore already reads as the books do', async () => {
    const { repository } = await storedDraft();

    await expect(
      reanchorRestored(repository)({ intent: 'undo' }, [verseBook('GEN 1:1', 'alpha beta')]),
    ).resolves.toBeUndefined();
  });
});
