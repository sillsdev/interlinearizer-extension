import type { TextAnalysis, TokenAnalysis, TokenAnalysisLink } from 'interlinearizer';
import type { CommandHandlers } from 'papi-shared-types';
import type { AnalysisSessions, Session } from './analysisSessions';
import type * as bookService from './bookService';
import {
  getCatalogPage,
  getHomographRows as homographRowsOf,
  getRowsByIds,
  restoreUntagged,
  summarizeSelection,
  type CatalogPageRequest,
} from './catalogPages';
import { placeHeadings, type CatalogRow, type CatalogScope } from '../utils/analysis-query';
import { bookOfRef } from '../utils/analysis-book';
import { normalizeSurfaceForm } from '../utils/analysis-identity';
import type { AnalysisRepository } from '../types/analysis-repository';
import { emptyAnalysis } from '../types/empty-factories';
import { selectAnalysisDeletionOutcome } from '../utils/analysis-selectors';
import { perfTime, perfTimeAsync } from '../utils/perf-marks';

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

/**
 * The token analyses that `analysisIds` names, with every token link to them and none of the
 * draft's other records.
 */
async function analysesWithLinks(
  repository: AnalysisRepository,
  analysisIds: readonly string[],
): Promise<Pick<TextAnalysis, 'tokenAnalyses' | 'tokenAnalysisLinks'>> {
  const tokenAnalyses = await repository.getTokenAnalyses([...analysisIds]);
  const { tokenAnalysisLinks } = await repository.findLinksToAnalyses([...analysisIds]);
  return { tokenAnalyses, tokenAnalysisLinks };
}

/**
 * The records that deleting `target` reaches, from which the deletion outcome matches the one the
 * whole draft gives.
 *
 * They are `targetLinks`, every link on the tokens that approve `target`, and the payloads those
 * links name. They also include the pool candidates for those tokens' live text, with every
 * approval of the candidates.
 */
async function deletionReach(
  repository: AnalysisRepository,
  target: TokenAnalysis,
  targetLinks: readonly TokenAnalysisLink[],
  affectedRefs: string[],
  liveSurfaceText: (tokenRef: string) => string | undefined,
): Promise<Pick<TextAnalysis, 'tokenAnalyses' | 'tokenAnalysisLinks'>> {
  const forms = new Set<string>();
  affectedRefs.forEach((tokenRef) => {
    const live = liveSurfaceText(tokenRef);
    if (live !== undefined) forms.add(normalizeSurfaceForm(live));
  });
  const { tokenAnalysisLinks: tokenLinks } = await repository.findLinksByToken(affectedRefs);
  const candidates = await repository.findTokenAnalysesByForm([...forms]);
  const { tokenAnalysisLinks: candidateLinks } = await repository.findLinksToAnalyses(
    candidates.map(({ id }) => id),
  );
  const tokenPayloads = await repository.getTokenAnalyses([
    ...new Set(tokenLinks.map(({ analysisId }) => analysisId)),
  ]);
  const links = new Map(
    [...targetLinks, ...tokenLinks, ...candidateLinks.filter((l) => l.status === 'approved')].map(
      (link) => [link.id, link],
    ),
  );
  const payloads = new Map(
    [target, ...tokenPayloads, ...candidates].map((payload) => [payload.id, payload]),
  );
  return { tokenAnalyses: [...payloads.values()], tokenAnalysisLinks: [...links.values()] };
}

/** The handlers of the commands that read a session's analysis catalog, keyed by command name. */
export function sessionCatalogHandlers({
  sessions,
  logger,
  getOpenVerseBook,
  getVerseBook,
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
   * Runs `read` on the session. An error is logged as a failure to `what` before it is rethrown.
   *
   * @throws If the session is not open, or `read` throws.
   */
  async function readSession<T>(
    sessionId: string,
    what: string,
    read: (session: Session) => Promise<T>,
  ): Promise<T> {
    try {
      return await sessions.run(sessionId, read);
    } catch (e) {
      logger.error(`Interlinearizer: failed to ${what} in session ${sessionId}`, e);
      throw e;
    }
  }

  async function getCatalogRows({
    sessionId,
    request,
  }: ArgsOf<'interlinearizer.getCatalogRows'>): Promise<string> {
    return perfTimeAsync('getCatalogRows', () =>
      readSession(sessionId, 'serve the catalog', async (session) => {
        const { sourceProjectId } = session.scope;
        const { analysis } = await session.repository.getWholeDraft();
        const scope = await scopeOf(session, request.currentBook);
        const page = perfTime('getCatalogRows:query', () =>
          getCatalogPage(
            analysis,
            scope,
            { ...request, filters: restoreUntagged(request.filters) },
            (form) => isFormInText(sourceProjectId, form),
          ),
        );
        return perfTime('getCatalogRows:serialize', () =>
          JSON.stringify({ ...page, rows: page.rows.map(wireRow) }),
        );
      }),
    );
  }

  async function countUsages({
    sessionId,
    analysisIds,
  }: ArgsOf<'interlinearizer.countUsages'>): Promise<number> {
    // A token approves one analysis at most, so summing the analyses' counts counts no token twice.
    return readSession(sessionId, 'count usages', async ({ repository }) =>
      Object.values(await repository.countApprovals([...analysisIds])).reduce((a, b) => a + b, 0),
    );
  }

  async function getCatalogRowsByIds({
    sessionId,
    currentBook,
    analysisIds,
  }: ArgsOf<'interlinearizer.getCatalogRowsByIds'>): Promise<string> {
    return readSession(sessionId, 'serve catalog rows', async (session) => {
      const rows = getRowsByIds(
        await analysesWithLinks(session.repository, analysisIds),
        await scopeOf(session, currentBook),
        analysisIds,
      );
      return JSON.stringify(rows.map(wireRow));
    });
  }

  async function getHomographRows({
    sessionId,
    currentBook,
    analysisId,
  }: ArgsOf<'interlinearizer.getHomographRows'>): Promise<string> {
    return readSession(sessionId, 'serve homographs', async (session) => {
      const { repository } = session;
      const forms = (await repository.getTokenAnalyses([analysisId])).map(({ surfaceText }) =>
        normalizeSurfaceForm(surfaceText),
      );
      const homographIds = (await repository.findTokenAnalysesByForm(forms)).map(({ id }) => id);
      const rows = homographRowsOf(
        await analysesWithLinks(repository, homographIds),
        await scopeOf(session, currentBook),
        analysisId,
      );
      return JSON.stringify(rows.map(wireRow));
    });
  }

  async function getSelectionSummary({
    sessionId,
    analysisIds,
  }: ArgsOf<'interlinearizer.getSelectionSummary'>): Promise<string> {
    return readSession(sessionId, 'summarize a selection', async (session) => {
      const scope = { analysisLanguage: session.analysisLanguage, currentBook: '' };
      const analysis = await analysesWithLinks(session.repository, analysisIds);
      return JSON.stringify(summarizeSelection(analysis, scope, analysisIds));
    });
  }

  async function previewDeletion({
    sessionId,
    analysisId,
  }: ArgsOf<'interlinearizer.previewDeletion'>): Promise<string> {
    try {
      return await sessions.run(sessionId, async (session) => {
        const { repository } = session;
        const [target] = await repository.getTokenAnalyses([analysisId]);
        if (!target) return 'null';
        const { tokenAnalysisLinks: targetLinks } = await repository.findLinksToAnalyses([
          analysisId,
        ]);
        const affectedRefs = [
          ...new Set(
            targetLinks
              .filter((link) => link.status === 'approved')
              .map((link) => link.token.tokenRef),
          ),
        ];
        const bookIds = new Set(affectedRefs.map(bookOfRef));
        const liveText = new Map<string, string>();
        const readBooks = new Set<string>();
        await Promise.all(
          [...bookIds].map(async (bookId) => {
            const book = await getVerseBook(session.scope.sourceProjectId, bookId).catch((e) => {
              logger.error(`Interlinearizer: could not read ${bookId} to preview a deletion`, e);
              return undefined;
            });
            if (!book) return;
            readBooks.add(bookId);
            book.segments.forEach((segment) =>
              segment.tokens.forEach((token) => liveText.set(token.ref, token.surfaceText)),
            );
          }),
        );
        const analysis = await deletionReach(
          repository,
          target,
          targetLinks,
          affectedRefs,
          (tokenRef) => liveText.get(tokenRef),
        );
        const outcome = selectAnalysisDeletionOutcome(
          {
            analysis: { ...emptyAnalysis(), ...analysis },
            analysisLanguage: session.analysisLanguage,
          },
          analysisId,
          (tokenRef) => liveText.get(tokenRef),
          (tokenRef) => readBooks.has(bookOfRef(tokenRef)),
        );
        /* v8 ignore next -- the payload was read above, so the outcome is always derived */
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
