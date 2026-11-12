import type { TextAnalysis } from 'interlinearizer';
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
  isFormInText,
}: SessionCatalogHost) {
  /**
   * The scope a session's rows are derived in, their usages placed among the book's headings, or
   * among none when the book cannot be read.
   */
  async function scopeOf(session: Session, currentBook: string): Promise<CatalogScope> {
    const book = await getOpenVerseBook(session.scope.sourceProjectId, currentBook).catch((e) => {
      logger.error(`Interlinearizer: could not read ${currentBook} to place its headings`, e);
      return undefined;
    });
    return {
      analysisLanguage: session.analysisLanguage,
      currentBook,
      headingPlacements: placeHeadings(book?.segments ?? []),
    };
  }

  /**
   * Runs `read` on the session over its draft's analysis. An error is logged as a failure to `what`
   * before it is rethrown.
   *
   * @throws If the session is not open, its analysis cannot be read, or `read` throws.
   */
  async function readSession<T>(
    sessionId: string,
    what: string,
    read: (session: Session, analysis: TextAnalysis) => Promise<T> | T,
  ): Promise<T> {
    try {
      return await sessions.run(sessionId, async (session) =>
        read(session, (await session.repository.getWholeDraft()).analysis),
      );
    } catch (e) {
      logger.error(`Interlinearizer: failed to ${what} in session ${sessionId}`, e);
      throw e;
    }
  }

  /**
   * Serves one page of a session's catalog, its usages placed among the current book's headings, or
   * among none when that book cannot be read.
   *
   * @returns A JSON string of the `CatalogPage`, each row's books listed.
   * @throws If the session is not open or its analysis cannot be read. The error is logged before
   *   rethrowing.
   */
  async function getCatalogRows({
    sessionId,
    request,
  }: ArgsOf<'interlinearizer.getCatalogRows'>): Promise<string> {
    return readSession(sessionId, 'serve the catalog', async (session, analysis) => {
      const { sourceProjectId } = session.scope;
      const page = getCatalogPage(
        analysis,
        await scopeOf(session, request.currentBook),
        { ...request, filters: restoreUntagged(request.filters) },
        (form) => isFormInText(sourceProjectId, form),
      );
      return JSON.stringify({ ...page, rows: page.rows.map(wireRow) });
    });
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
    return readSession(sessionId, 'count usages', (_session, analysis) =>
      countAnalysisUsages(analysis, analysisIds),
    );
  }

  /**
   * Serves the rows of the analyses in a session's draft that `analysisIds` names, in that order,
   * leaving out unstored ids.
   *
   * @returns A JSON string of the rows, each row's books listed.
   * @throws If the session is not open or its analysis cannot be read. The error is logged before
   *   rethrowing.
   */
  async function getCatalogRowsByIds({
    sessionId,
    currentBook,
    analysisIds,
  }: ArgsOf<'interlinearizer.getCatalogRowsByIds'>): Promise<string> {
    return readSession(sessionId, 'serve catalog rows', async (session, analysis) => {
      const rows = getRowsByIds(analysis, await scopeOf(session, currentBook), analysisIds);
      return JSON.stringify(rows.map(wireRow));
    });
  }

  /**
   * Serves the rows in a session's draft sharing the analysis's normalized surface form, the
   * analysis's own among them, most used first.
   *
   * @returns A JSON string of the rows, each row's books listed; `"[]"` when no analysis carries
   *   the id.
   * @throws If the session is not open or its analysis cannot be read. The error is logged before
   *   rethrowing.
   */
  async function getHomographRows({
    sessionId,
    currentBook,
    analysisId,
  }: ArgsOf<'interlinearizer.getHomographRows'>): Promise<string> {
    return readSession(sessionId, 'serve homographs', async (session, analysis) => {
      const rows = homographRowsOf(analysis, await scopeOf(session, currentBook), analysisId);
      return JSON.stringify(rows.map(wireRow));
    });
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
    return readSession(sessionId, 'summarize a selection', (session, analysis) => {
      const scope = { analysisLanguage: session.analysisLanguage, currentBook: '' };
      return JSON.stringify(summarizeSelection(analysis, scope, analysisIds));
    });
  }

  return {
    'interlinearizer.getCatalogRows': getCatalogRows,
    'interlinearizer.getSelectionSummary': getSelectionSummary,
    'interlinearizer.countUsages': countUsages,
    'interlinearizer.getCatalogRowsByIds': getCatalogRowsByIds,
    'interlinearizer.getHomographRows': getHomographRows,
  } satisfies Partial<CommandHandlers>;
}
