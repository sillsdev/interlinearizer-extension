import type { SegmentationDelta } from 'interlinearizer';
import type { CommandHandlers } from 'papi-shared-types';
import type { AnalysisSessions, Session } from './analysisSessions';
import type * as bookService from './bookService';
import {
  readBookOutline,
  readDraftEnvelope,
  readSegmentPage,
  readStaleSummary,
} from './sessionPages';
import { logAndRethrow } from '../utils/log-and-rethrow';
import { perfTime, perfTimeAsync } from '../utils/perf-marks';

/** What the page handlers reach beyond the sessions' analysis. */
export type SessionPageHost = Readonly<{
  sessions: AnalysisSessions;
  logger: Readonly<{
    error: (message: string, error: unknown) => void;
    warn: (message: string, error: unknown) => void;
  }>;
  getOpenBook: typeof bookService.getOpenBook;
  getOpenVerseBook: typeof bookService.getOpenVerseBook;
  getSegmentedBook: typeof bookService.getSegmentedBook;
}>;

type ArgsOf<C extends keyof CommandHandlers> = Parameters<CommandHandlers[C]>[0];

/** The session that a page command reads. */
type SessionAddress = Readonly<{ sessionId: string }>;

/** The boundaries that the session's draft sets. */
async function sessionBoundaries(session: Session): Promise<SegmentationDelta | undefined> {
  return (await session.repository.getScope()).segmentation;
}

/**
 * The handlers of the commands that read a session's draft envelope, book outlines, segment pages
 * and stale summaries, keyed by command name.
 */
export function sessionPageHandlers({
  sessions,
  logger,
  getOpenBook,
  getOpenVerseBook,
  getSegmentedBook,
}: SessionPageHost) {
  async function getDraftEnvelope({
    sessionId,
  }: ArgsOf<'interlinearizer.getDraftEnvelope'>): Promise<string> {
    return logAndRethrow(logger, `read the draft envelope of session ${sessionId}`, async () =>
      JSON.stringify(
        await sessions.run(sessionId, ({ repository, analysisLanguage }) =>
          readDraftEnvelope(repository, analysisLanguage),
        ),
      ),
    );
  }

  /**
   * Outlines a book of the session's source. The draft is first re-anchored to the book's text,
   * unless the session last re-anchored that book to the same text. A failed re-anchor is only
   * logged.
   */
  async function getBookOutline(
    { sessionId }: SessionAddress,
    bookId: string,
  ): Promise<string | undefined> {
    return logAndRethrow(logger, `outline book ${bookId} of session ${sessionId}`, () =>
      perfTimeAsync('getBookOutline', () => {
        sessions
          .reanchorOpenedBook(sessionId, bookId)
          .catch((e) =>
            logger.warn(
              `Interlinearizer: could not re-anchor ${bookId} of session ${sessionId}`,
              e,
            ),
          );
        return sessions.run(sessionId, async (session) => {
          const book = await getOpenBook(
            session.scope.sourceProjectId,
            bookId,
            await sessionBoundaries(session),
          );
          const verseBook = await getOpenVerseBook(session.scope.sourceProjectId, bookId);
          if (!book || !verseBook) return undefined;
          const outline = await readBookOutline(session.repository, book, verseBook);
          return perfTime('getBookOutline:serialize', () => JSON.stringify(outline));
        });
      }),
    );
  }

  async function getStaleSummary({
    sessionId,
    bookId,
  }: ArgsOf<'interlinearizer.getStaleSummary'>): Promise<string | undefined> {
    return logAndRethrow(
      logger,
      `summarize the stale analyses of book ${bookId} of session ${sessionId}`,
      () =>
        sessions.run(sessionId, async (session) => {
          const book = await getOpenBook(
            session.scope.sourceProjectId,
            bookId,
            await sessionBoundaries(session),
          );
          return book && JSON.stringify(await readStaleSummary(session.repository, book));
        }),
    );
  }

  async function getSegments(
    { sessionId }: SessionAddress,
    bookId: string,
    start: number,
    end: number,
  ): Promise<string | undefined> {
    return logAndRethrow(
      logger,
      `serve segments ${start}-${end} of book ${bookId} of session ${sessionId}`,
      () =>
        perfTimeAsync('getSegments', () =>
          sessions.run(sessionId, async (session) => {
            const book = await getSegmentedBook(
              session.scope.sourceProjectId,
              bookId,
              await sessionBoundaries(session),
            );
            if (!book) return undefined;
            const page = await readSegmentPage(session.repository, book, start, end);
            return perfTime('getSegments:serialize', () => JSON.stringify(page));
          }),
        ),
    );
  }

  return {
    'interlinearizer.getDraftEnvelope': getDraftEnvelope,
    'interlinearizer.getBookOutline': getBookOutline,
    'interlinearizer.getStaleSummary': getStaleSummary,
    'interlinearizer.getSegments': getSegments,
  } satisfies Partial<CommandHandlers>;
}
