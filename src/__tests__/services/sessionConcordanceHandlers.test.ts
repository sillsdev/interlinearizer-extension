/// <reference types="jest" />

import type { TextAnalysis } from 'interlinearizer';
import { sessionConcordanceHandlers } from '../../services/sessionConcordanceHandlers';
import { indexBook, type BookConcordance } from '../../utils/concordance';
import { BOOK, GLOSSED, sessionOver } from '../cache/session-source';
import { makeVerseBook } from '../test-helpers';

/**
 * The concordance handlers over a session of a draft holding `analysis`, {@link GLOSSED} by default,
 * on a source whose whole text is `books`, {@link BOOK} alone by default, or still being read.
 */
async function handlersOver({
  analysis = GLOSSED,
  books = [indexBook(BOOK)],
}: {
  analysis?: Partial<TextAnalysis>;
  books?: BookConcordance[] | 'unread' | (() => BookConcordance[]);
} = {}) {
  const { sessions, sessionId, edit } = await sessionOver(analysis);
  const logger = { error: jest.fn() };
  const handlers = sessionConcordanceHandlers({
    sessions,
    logger,
    getConcordanceBooks: () => {
      if (books === 'unread') return undefined;
      return typeof books === 'function' ? books() : books;
    },
    getWritingSystem: async () => 'en',
  });
  return { handlers, sessionId, edit, logger };
}

describe('getConcordance', () => {
  it('serves a page of the rows, the most frequent forms first', async () => {
    const { handlers, sessionId } = await handlersOver();

    const json = await handlers['interlinearizer.getConcordance']({
      sessionId,
      request: { currentBook: 'GEN', offset: 0, count: 2 },
    });

    expect(JSON.parse(json)).toEqual({
      total: 7,
      bookCount: 1,
      rows: [
        {
          form: 'and',
          displayText: 'And',
          occurrenceCount: 2,
          occurrenceCountInBook: 2,
          analyzedCount: 0,
          status: 'unanalyzed',
        },
        {
          form: 'god',
          displayText: 'God',
          occurrenceCount: 2,
          occurrenceCountInBook: 2,
          analyzedCount: 1,
          status: 'partlyAnalyzed',
        },
      ],
    });
  });

  it('serves null while the source text is still being read', async () => {
    const { handlers, sessionId } = await handlersOver({ books: 'unread' });

    const json = await handlers['interlinearizer.getConcordance']({
      sessionId,
      request: { currentBook: 'GEN', offset: 0, count: 2 },
    });

    expect(JSON.parse(json)).toBeNull();
  });

  it("serves a page of a form's occurrences, each with the analysis it is approved to", async () => {
    const { handlers, sessionId } = await handlersOver();

    const json = await handlers['interlinearizer.getConcordance']({
      sessionId,
      request: { form: 'god', offset: 0, count: 2 },
    });

    expect(JSON.parse(json)).toEqual({
      total: 2,
      tallies: [{ analysisId: 'ta-god', gloss: 'God', count: 1 }],
      occurrences: [
        {
          tokenRef: 'GEN 1:1:17',
          book: 'GEN',
          chapter: 1,
          verse: 1,
          surfaceText: 'God',
          contextText: 'In the beginning God',
          charStart: 17,
          charEnd: 20,
          analysisId: 'ta-god',
        },
        {
          tokenRef: 'GEN 1:3:4',
          book: 'GEN',
          chapter: 1,
          verse: 3,
          surfaceText: 'God',
          contextText: 'And God said',
          charStart: 4,
          charEnd: 7,
        },
      ],
    });
  });

  it('serves no occurrences of a form the text lacks', async () => {
    const { handlers, sessionId } = await handlersOver();

    const json = await handlers['interlinearizer.getConcordance']({
      sessionId,
      request: { form: 'light', offset: 0, count: 2 },
    });

    expect(JSON.parse(json)).toEqual({ total: 0, tallies: [], occurrences: [] });
  });

  it('logs and rethrows when the session is not open', async () => {
    const { handlers, logger } = await handlersOver();

    await expect(
      handlers['interlinearizer.getConcordance']({
        sessionId: 'closed',
        request: { currentBook: 'GEN', offset: 0, count: 2 },
      }),
    ).rejects.toThrow();
    expect(logger.error).toHaveBeenCalledWith(
      'Interlinearizer: failed to serve the concordance of session closed',
      expect.any(Error),
    );
  });

  it('serves a book as it was last read', async () => {
    let books = [indexBook(BOOK)];
    const { handlers, sessionId } = await handlersOver({ books: () => books });
    const request = { currentBook: 'GEN', offset: 0, count: 1 };
    await handlers['interlinearizer.getConcordance']({ sessionId, request });

    books = [indexBook(makeVerseBook([{ sid: 'GEN 1:1', text: 'light' }]))];
    const json = await handlers['interlinearizer.getConcordance']({ sessionId, request });

    expect(JSON.parse(json).rows.map((row: { form: string }) => row.form)).toEqual(['light']);
  });
});
