import type { CommandHandlers } from 'papi-shared-types';
import type { AnalysisSessions, Session } from './analysisSessions';
import type * as bookService from './bookService';
import {
  countUsages as countAnalysisUsages,
  getCatalogPage,
  getHomographRows as homographRowsOf,
  getRowsByIds,
  restoreUntagged,
  summarizeSelection,
  type CatalogPageRequest,
} from './catalogPages';
import { placeHeadings, type CatalogRow, type CatalogScope } from '../utils/analysis-query';
import { bookOfRef } from '../utils/analysis-book';
import { selectAnalysisDeletionOutcome } from '../utils/analysis-selectors';

/** What a view asks of a session's catalog: a {@link CatalogPageRequest}, against one book. */
export type CatalogRowsRequest = CatalogPageRequest & {
  /** Book code the per-book usage count is taken against. */
  currentBook: string;
};

/** What the catalog handlers reach beyond the sessions' analysis. */
export type SessionCatalogHost = Readonly<{
  sessions: AnalysisSessions;
  logger: Readonly<{ error: (message: string, error: unknown) => void }>;
  getOpenVerseBook: typeof bookService.getOpenVerseBook;
  getVerseBook: typeof bookService.getVerseBook;
  /**
   * Whether the source's text holds a normalized word form, `undefined` until the whole text has
   * been read.
   */
  isFormInText: (sourceProjectId: string, form: string) => boolean | undefined;
}>;

type ArgsOf<C extends keyof CommandHandlers> = Parameters<CommandHandlers[C]>[0];

/** A row as JSON carries it, its books listed. */
function wireRow<T extends CatalogRow>(row: T) {
  return { ...row, books: [...row.books] };
}

/** The handlers of the commands that read a session's analysis catalog, keyed by command name. */
export function sessionCatalogHandlers({
  sessions,
  logger,
  getOpenVerseBook,
  getVerseBook,
  isFormInText,
}: SessionCatalogHost) {
  /** The scope a session's rows are derived in, their usages placed among the book's headings. */
  async function scopeOf(session: Session, currentBook: string): Promise<CatalogScope> {
    const book = await getOpenVerseBook(session.scope.sourceProjectId, currentBook);
    return {
      analysisLanguage: session.analysisLanguage,
      currentBook,
      headingPlacements: placeHeadings(book?.segments ?? []),
    };
  }

  /**
   * Serves one page of a session's catalog, its usages placed among the current book's headings.
   *
   * @returns A JSON string of the `CatalogPage`, each row's books listed.
   * @throws If the session is not open, or its analysis or the current book cannot be read. The
   *   error is logged before rethrowing.
   */
  async function getCatalogRows({
    sessionId,
    request,
  }: ArgsOf<'interlinearizer.getCatalogRows'>): Promise<string> {
    try {
      return await sessions.run(sessionId, async (session) => {
        const { sourceProjectId } = session.scope;
        const { analysis } = await session.repository.getWholeDraft();
        const page = getCatalogPage(
          analysis,
          await scopeOf(session, request.currentBook),
          { ...request, filters: restoreUntagged(request.filters) },
          (form) => isFormInText(sourceProjectId, form),
        );
        return JSON.stringify({ ...page, rows: page.rows.map(wireRow) });
      });
    } catch (e) {
      logger.error(`Interlinearizer: failed to serve the catalog of session ${sessionId}`, e);
      throw e;
    }
  }

  /**
   * Counts the distinct tokens in a session's draft that approve any of the analyses.
   *
   * @throws If the session is not open or its analysis cannot be read. The error is logged before
   *   rethrowing.
   */
  async function countUsages({
    sessionId,
    analysisIds,
  }: ArgsOf<'interlinearizer.countUsages'>): Promise<number> {
    try {
      return await sessions.run(sessionId, async (session) =>
        countAnalysisUsages((await session.repository.getWholeDraft()).analysis, analysisIds),
      );
    } catch (e) {
      logger.error(`Interlinearizer: failed to count usages in session ${sessionId}`, e);
      throw e;
    }
  }

  /**
   * Serves the rows of the analyses in a session's draft that `analysisIds` names, in that order,
   * leaving out any id unstored.
   *
   * @returns A JSON string of the rows, each row's books listed.
   * @throws If the session is not open, or its analysis or the current book cannot be read. The
   *   error is logged before rethrowing.
   */
  async function getCatalogRowsByIds({
    sessionId,
    currentBook,
    analysisIds,
  }: ArgsOf<'interlinearizer.getCatalogRowsByIds'>): Promise<string> {
    try {
      return await sessions.run(sessionId, async (session) => {
        const { analysis } = await session.repository.getWholeDraft();
        const rows = getRowsByIds(analysis, await scopeOf(session, currentBook), analysisIds);
        return JSON.stringify(rows.map(wireRow));
      });
    } catch (e) {
      logger.error(`Interlinearizer: failed to serve catalog rows of session ${sessionId}`, e);
      throw e;
    }
  }

  /**
   * Serves the rows in a session's draft sharing the analysis's normalized surface form, the
   * analysis's own among them, most used first.
   *
   * @returns A JSON string of the rows, each row's books listed; `"[]"` when no analysis carries
   *   the id.
   * @throws If the session is not open, or its analysis or the current book cannot be read. The
   *   error is logged before rethrowing.
   */
  async function getHomographRows({
    sessionId,
    currentBook,
    analysisId,
  }: ArgsOf<'interlinearizer.getHomographRows'>): Promise<string> {
    try {
      return await sessions.run(sessionId, async (session) => {
        const { analysis } = await session.repository.getWholeDraft();
        const rows = homographRowsOf(analysis, await scopeOf(session, currentBook), analysisId);
        return JSON.stringify(rows.map(wireRow));
      });
    } catch (e) {
      logger.error(`Interlinearizer: failed to serve homographs in session ${sessionId}`, e);
      throw e;
    }
  }

  /**
   * Summarizes the selected analyses of a session's draft for a bulk action over them.
   *
   * @returns A JSON string of the `SelectionSummary`.
   * @throws If the session is not open or its analysis cannot be read. The error is logged before
   *   rethrowing.
   */
  async function getSelectionSummary({
    sessionId,
    analysisIds,
  }: ArgsOf<'interlinearizer.getSelectionSummary'>): Promise<string> {
    try {
      return await sessions.run(sessionId, async (session) => {
        const { analysis } = await session.repository.getWholeDraft();
        const scope = { analysisLanguage: session.analysisLanguage, currentBook: '' };
        return JSON.stringify(summarizeSelection(analysis, scope, analysisIds));
      });
    } catch (e) {
      logger.error(`Interlinearizer: failed to summarize a selection in session ${sessionId}`, e);
      throw e;
    }
  }

  /**
   * Reports what deleting a token analysis in a session's draft would do to the tokens that approve
   * it, whichever book they sit in.
   *
   * @returns A JSON string of the `AnalysisDeletionOutcome`; `"null"` when no analysis carries the
   *   id.
   * @throws If the session is not open, or its analysis or the text of a book it reaches cannot be
   *   read. The error is logged before rethrowing.
   */
  async function previewDeletion({
    sessionId,
    analysisId,
  }: ArgsOf<'interlinearizer.previewDeletion'>): Promise<string> {
    try {
      return await sessions.run(sessionId, async (session) => {
        const { analysis } = await session.repository.getWholeDraft();
        const bookIds = new Set(
          analysis.tokenAnalysisLinks
            .filter((link) => link.analysisId === analysisId && link.status === 'approved')
            .map((link) => bookOfRef(link.token.tokenRef)),
        );
        const liveText = new Map<string, string>();
        await Promise.all(
          [...bookIds].map(async (bookId) => {
            const book = await getVerseBook(session.scope.sourceProjectId, bookId);
            book?.segments.forEach((segment) =>
              segment.tokens.forEach((token) => liveText.set(token.ref, token.surfaceText)),
            );
          }),
        );
        const outcome = selectAnalysisDeletionOutcome(
          { analysis, analysisLanguage: session.analysisLanguage },
          analysisId,
          (tokenRef) => liveText.get(tokenRef),
        );
        return outcome ? JSON.stringify(outcome) : 'null';
      });
    } catch (e) {
      logger.error(`Interlinearizer: failed to preview a deletion in session ${sessionId}`, e);
      throw e;
    }
  }

  return {
    'interlinearizer.getCatalogRows': getCatalogRows,
    'interlinearizer.previewDeletion': previewDeletion,
    'interlinearizer.getSelectionSummary': getSelectionSummary,
    'interlinearizer.countUsages': countUsages,
    'interlinearizer.getCatalogRowsByIds': getCatalogRowsByIds,
    'interlinearizer.getHomographRows': getHomographRows,
  } satisfies Partial<CommandHandlers>;
}
