/// <reference types="jest" />

import type { Book, DraftProject, TextAnalysis } from 'interlinearizer';
import { DraftRepository } from '../../services/draftRepository';
import {
  booksLinkedAmong,
  reanchorRestored,
  reanchorStoredBook,
} from '../../services/reanchorPasses';
import { emptyAnalysis, emptyDraft } from '../../types/empty-factories';
import { missingBook } from '../../utils/reanchor-draft';
import {
  FIXTURE_STAMPS,
  makeTokenLink,
  makeVerseBook,
  memoryStorage,
  silentLogger,
} from '../test-helpers';

const SOURCE = 'src';

/** A book of one verse reading `text`. */
function verseBook(sid: string, text: string): Book {
  return makeVerseBook([{ sid, text }]);
}

/** The ref of the token reading `surfaceText` in `book`. */
function refOf(book: Book, surfaceText: string): string {
  const token = book.segments[0].tokens.find((t) => t.surfaceText === surfaceText);
  if (!token) throw new Error(`fixture missing token ${surfaceText}`);
  return token.ref;
}

/** An analysis glossing `word` where `book` has it, under the link id `linkId`. */
function glossing(book: Book, word: string, linkId: string): TextAnalysis {
  return {
    ...emptyAnalysis(),
    tokenAnalyses: [{ ...FIXTURE_STAMPS, id: `ta-${word}`, surfaceText: word }],
    tokenAnalysisLinks: [
      makeTokenLink(`ta-${word}`, refOf(book, word), { surfaceText: word, id: linkId }),
    ],
  };
}

/** Genesis glossed on "beta" and Exodus on "delta", stored in memory. */
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
  await new DraftRepository(storage, SOURCE, silentLogger()).replaceAll(draft);
  const repository = new DraftRepository(storage, SOURCE, silentLogger());
  const stored = async () =>
    (await new DraftRepository(storage, SOURCE, silentLogger()).exportAll()).draft;
  return { repository, stored };
}

function linkNamed(draft: DraftProject, id: string) {
  const link = draft.analysis.tokenAnalysisLinks.find((l) => l.id === id);
  if (!link) throw new Error(`no link ${id}`);
  return link;
}

describe('reanchorStoredBook', () => {
  it("re-anchors the stored draft to the book's current text, leaving other books alone", async () => {
    const { repository, stored } = await storedDraft();
    const edited = verseBook('GEN 1:1', 'alpha and beta');

    const changes = await reanchorStoredBook(repository, edited);

    const draft = await stored();
    expect(linkNamed(draft, 'tl-gen').token.tokenRef).toBe(refOf(edited, 'beta'));
    expect(linkNamed(draft, 'tl-exo').token.tokenRef).toBe('EXO 1:1:6');
    expect(changes?.tokenAnalysisLinks?.puts.map(({ id }) => id)).toEqual(['tl-gen']);
  });

  it('applies nothing when the draft already reads as the book does', async () => {
    const { repository } = await storedDraft();
    const apply = jest.spyOn(repository, 'apply');

    await expect(
      reanchorStoredBook(repository, verseBook('GEN 1:1', 'alpha beta')),
    ).resolves.toBeUndefined();

    expect(apply).not.toHaveBeenCalled();
  });

  it("moves the draft's splits in the book, keeping its record", async () => {
    const before = verseBook('GEN 1:1', 'alpha beta');
    const { repository, stored } = await storedDraft({
      suggestedName: 'Named',
      segmentation: {
        removedVerseStarts: [],
        addedStarts: [{ tokenRef: refOf(before, 'beta'), surfaceText: 'beta' }],
      },
    });
    const edited = verseBook('GEN 1:1', 'alpha and beta');

    await reanchorStoredBook(repository, edited);

    const draft = await stored();
    expect(draft.segmentation?.addedStarts).toEqual([
      { tokenRef: refOf(edited, 'beta'), surfaceText: 'beta' },
    ]);
    expect(draft.suggestedName).toBe('Named');
  });

  it('stales the links into a book the text lacks', async () => {
    const { repository, stored } = await storedDraft();

    await reanchorStoredBook(repository, missingBook('GEN'));

    const draft = await stored();
    expect(linkNamed(draft, 'tl-gen').status).toBe('stale');
    expect(linkNamed(draft, 'tl-exo').status).toBe('approved');
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
          makeTokenLink('ta-beta', refOf(before, 'beta'), { surfaceText: 'beta', id: 'tl-2' }),
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
        token: { tokenRef: refOf(edited, 'beta'), surfaceText: 'beta' },
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

  it('gives nothing when what the changes would restore already reads as the books do', async () => {
    const { repository } = await storedDraft();

    await expect(
      reanchorRestored(repository)({ intent: 'undo' }, [verseBook('GEN 1:1', 'alpha beta')]),
    ).resolves.toBeUndefined();
  });
});

describe('booksLinkedAmong', () => {
  it('names the books given that the draft links into', async () => {
    const { repository } = await storedDraft();

    await expect(booksLinkedAmong(repository, ['GEN', 'LEV'])).resolves.toEqual(['GEN']);
  });
});
