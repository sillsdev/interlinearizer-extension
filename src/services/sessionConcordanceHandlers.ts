import type { CommandHandlers } from 'papi-shared-types';
import type { AnalysisSessions } from './analysisSessions';
import type * as bookService from './bookService';
import {
  approvedAnalysisByToken,
  buildConcordanceEntries,
  approvedAnalysisOf,
  deriveConcordanceRows,
  tallyAnalyses,
  type BookConcordance,
  type ConcordanceAnalysisTally,
  type ConcordanceEntry,
  type ConcordanceOccurrence,
  type ConcordanceStatus,
} from '../utils/concordance';
import { collatorForTag } from '../utils/language-tags';

/** A page of a session's concordance rows, counted against one book. */
export type ConcordanceRowsRequest = Readonly<{
  /** Book code each row's per-book occurrence count is taken in. */
  currentBook: string;
  offset: number;
  count: number;
}>;

/** A page of one form's occurrences. */
export type ConcordanceOccurrencesRequest = Readonly<{
  /** The normalized form whose occurrences are paged. */
  form: string;
  offset: number;
  count: number;
}>;

/** What a view asks of a session's concordance. */
export type ConcordanceRequest = ConcordanceRowsRequest | ConcordanceOccurrencesRequest;

/** One word form of the source text as the concordance lists it. */
export type ConcordanceRowSummary = Readonly<{
  /** The normalized form every occurrence matches under, which identifies the row. */
  form: string;
  /** The form's most frequent spelling, ties going to the earliest. */
  displayText: string;
  occurrenceCount: number;
  occurrenceCountInBook: number;
  /** Occurrences whose token carries an approved analysis. */
  analyzedCount: number;
  status: ConcordanceStatus;
}>;

/** A page of a session's concordance rows. */
export type ConcordancePage = Readonly<{
  /** How many rows the whole concordance holds. */
  total: number;
  /**
   * How many books of the text the concordance holds, leaving out those that hold no text and those
   * that failed to read.
   */
  bookCount: number;
  rows: readonly ConcordanceRowSummary[];
}>;

/** An occurrence as the concordance lists it, with the analysis its token is approved to. */
export type ConcordanceListedOccurrence = ConcordanceOccurrence &
  Readonly<{
    /** Absent where the token carries no approved analysis of the form. */
    analysisId?: string;
  }>;

/** A page of one form's occurrences, with the analyses that all of them are approved to. */
export type ConcordanceOccurrencePage = Readonly<{
  /** How many occurrences the form has. */
  total: number;
  /** Every analysis the form's occurrences are approved to, the most used first. */
  tallies: readonly ConcordanceAnalysisTally[];
  occurrences: readonly ConcordanceListedOccurrence[];
}>;

/** What the concordance handlers reach beyond the sessions' analysis. */
export type SessionConcordanceHost = Readonly<{
  sessions: AnalysisSessions;
  logger: Readonly<{ error: (message: string, error: unknown) => void }>;
  getConcordanceBooks: typeof bookService.getConcordanceBooks;
  getWritingSystem: typeof bookService.getWritingSystem;
}>;

type ArgsOf<C extends keyof CommandHandlers> = Parameters<CommandHandlers[C]>[0];

/** The handlers of the commands that read a session's concordance, keyed by command name. */
export function sessionConcordanceHandlers({
  sessions,
  logger,
  getConcordanceBooks,
  getWritingSystem,
}: SessionConcordanceHost) {
  /**
   * The entries merged from each array of books, with the tag they were collated by. A page is
   * asked for each time the list grows, and merging every book again for each would repeat the
   * costliest step. An entry lasts only as long as its array, which lasts as long as its read.
   */
  const built = new WeakMap<
    readonly BookConcordance[],
    Readonly<{ writingSystem: string; entries: readonly ConcordanceEntry[] }>
  >();

  /** The entries of `books`, built afresh unless {@link built} holds them under `writingSystem`. */
  function entriesOf(
    writingSystem: string,
    books: readonly BookConcordance[],
  ): readonly ConcordanceEntry[] {
    const kept = built.get(books);
    if (kept?.writingSystem === writingSystem) return kept.entries;
    const entries = buildConcordanceEntries(books, collatorForTag(writingSystem));
    built.set(books, { writingSystem, entries });
    return entries;
  }

  /**
   * Serves one page of a session's concordance: of the forms of its source's whole text, the most
   * frequent first, or of one form's occurrences, either joined to the draft's approved analyses.
   *
   * @returns A JSON string of the `ConcordancePage`, or of the `ConcordanceOccurrencePage` when the
   *   request names a form; `"null"` until the whole text has been read.
   * @throws If the session is not open, or its analysis or its source's language tag cannot be
   *   read. The error is logged before rethrowing.
   */
  async function getConcordance({
    sessionId,
    request,
  }: ArgsOf<'interlinearizer.getConcordance'>): Promise<string> {
    try {
      return await sessions.run(sessionId, async (session) => {
        const { sourceProjectId } = session.scope;
        const books = getConcordanceBooks(sourceProjectId);
        if (!books) return 'null';
        const writingSystem = await getWritingSystem(sourceProjectId);
        const entries = entriesOf(writingSystem, books);
        const { analysis } = await session.repository.getWholeDraft();
        const analysesById = new Map(analysis.tokenAnalyses.map((ta) => [ta.id, ta]));
        const approved = approvedAnalysisByToken(analysis.tokenAnalysisLinks, analysesById);
        if ('form' in request) {
          const entry = entries.find(({ form }) => form === request.form);
          const occurrences = entry?.occurrences ?? [];
          const page: ConcordanceOccurrencePage = {
            total: occurrences.length,
            tallies: entry
              ? tallyAnalyses(entry, approved, analysesById, session.analysisLanguage)
              : [],
            occurrences: occurrences
              .slice(request.offset, request.offset + request.count)
              .map((occurrence) => {
                const analysisId = entry && approvedAnalysisOf(approved, entry, occurrence);
                return analysisId === undefined ? occurrence : { ...occurrence, analysisId };
              }),
          };
          return JSON.stringify(page);
        }
        const pageEntries = entries.slice(request.offset, request.offset + request.count);
        const rows = deriveConcordanceRows(pageEntries, approved, request.currentBook).map(
          ({ entry, occurrenceCountInBook, analyzedCount, status }): ConcordanceRowSummary => ({
            form: entry.form,
            displayText: entry.displayText,
            occurrenceCount: entry.occurrences.length,
            occurrenceCountInBook,
            analyzedCount,
            status,
          }),
        );
        const page: ConcordancePage = { total: entries.length, bookCount: books.length, rows };
        return JSON.stringify(page);
      });
    } catch (e) {
      logger.error(`Interlinearizer: failed to serve the concordance of session ${sessionId}`, e);
      throw e;
    }
  }

  return {
    'interlinearizer.getConcordance': getConcordance,
  } satisfies Partial<CommandHandlers>;
}
