import papi from '@papi/frontend';
import { act } from '@testing-library/react';
import type { Book, DraftProject, TextAnalysis } from 'interlinearizer';
import { useEvent } from 'platform-bible-react';
import * as React from 'react';
import { resegmentBook } from '../../parsers/papi/resegmentBook';
import * as tokenCommands from '../../services/commands/tokenCommands';
import { DraftRepository } from '../../services/draftRepository';
import { sessionCatalogHandlers } from '../../services/sessionCatalogHandlers';
import { sessionConcordanceHandlers } from '../../services/sessionConcordanceHandlers';
import { sessionEditHandlers } from '../../services/sessionEditHandlers';
import { envelopeOf } from '../../utils/draft-envelope';
import { readBookOutline, readSegmentPage, readStaleSummary } from '../../services/sessionPages';
import { emptyAnalysis } from '../../types/empty-factories';
import { CURRENT_MODEL_VERSION } from '../../types/model-version';
import type { TextReadStatus } from '../../types/text-read-status';
import { indexBook, type BookConcordance } from '../../utils/concordance';
import { silentLogger } from '../test-helpers';
import { BOOK, NOW, sessionOver } from './session-source';

/** Stands in for the network event that sessions report their changes on. */
export const ANALYSIS_CHANGED_EVENT = () => () => true;

/** Reads field `key` of a command's argument object, throwing unless it is a string. */
function field(args: unknown, key: string): string {
  const value = typeof args === 'object' && args ? Reflect.get(args, key) : undefined;
  if (typeof value !== 'string') throw new Error(`fake host: ${key} is not a string`);
  return value;
}

/** The commands a {@link fakeHost} is still answering. */
const inFlight = new Set<Promise<unknown>>();

/**
 * Settles once the {@link fakeHost} has answered every command sent so far, along with every command
 * sent while it answers them.
 */
export async function hostSettled(): Promise<void> {
  // Lets the views act on what has settled. Acting on it can send the next commands to wait for.
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
  if (inFlight.size === 0) return;
  await Promise.allSettled([...inFlight]);
  await hostSettled();
}

/** The source text as a {@link fakeHost} reads it whole. */
export type FakeText = Readonly<{
  status: () => TextReadStatus;
  /** Whether the text holds a normalized form, `undefined` until it is read. */
  isFormInText: (form: string) => boolean | undefined;
  /** The occurrences of each book of the text, `undefined` until it is read, and by default. */
  concordanceBooks?: () => BookConcordance[] | undefined;
  /** Stands in for reading the failed books again, doing nothing by default. */
  retry?: () => void;
}>;

/** A text of one book whose whole-text read has not yet read it. */
export function unreadText(): FakeText {
  return {
    status: () => ({ booksRead: 0, bookCount: 1, failedBookIds: [] }),
    isFormInText: () => undefined,
  };
}

/**
 * A text of one book, read, holding exactly `forms`, whose concordance indexes `books`, none by
 * default.
 */
export function readText(forms: readonly string[], books: readonly Book[] = []): FakeText {
  return {
    status: () => ({ booksRead: 1, bookCount: 1, failedBookIds: [] }),
    isFormInText: (form) => forms.includes(form),
    concordanceBooks: () => books.map(indexBook),
  };
}

/** The project that {@link fakeHost} starts a draft over from, when Open names its id. */
export const STORED_PROJECT = {
  id: 'proj-de',
  analysisLanguages: ['de'],
  targetProjectId: 'tgt',
  segmentation: { removedVerseStarts: [], addedStarts: [] },
};

/**
 * Builds the draft that starting over from `from` writes: a copy of {@link STORED_PROJECT} when
 * `from` names its id, otherwise an empty draft with `from`'s configuration.
 */
function startedDraft(sourceProjectId: string, from: unknown): DraftProject {
  const started = {
    sourceProjectId,
    modelVersion: CURRENT_MODEL_VERSION,
    analysis: emptyAnalysis(),
    dirty: false,
  };
  if (typeof from !== 'object' || !from) throw new Error('fake host: from is not an object');
  if ('interlinearProjectId' in from) {
    if (from.interlinearProjectId !== STORED_PROJECT.id)
      throw new Error(`fake host: no project ${String(from.interlinearProjectId)}`);
    const { analysisLanguages, targetProjectId, segmentation } = STORED_PROJECT;
    return { ...started, analysisLanguages, targetProjectId, segmentation };
  }
  const analysisLanguages = 'analysisLanguages' in from ? from.analysisLanguages : undefined;
  if (!Array.isArray(analysisLanguages)) throw new Error('fake host: no analysisLanguages');
  return {
    ...started,
    analysisLanguages: analysisLanguages.map(String),
    ...('suggestedDescription' in from && {
      suggestedDescription: String(from.suggestedDescription),
    }),
  };
}

/** React's shared internals, whose `actQueue` is set while an `act` scope is open or flushing. */
const REACT_INTERNALS: object = Reflect.get(
  React,
  '__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE',
);

/**
 * Hands `change` to every listener that the views registered for {@link ANALYSIS_CHANGED_EVENT}, as
 * the platform relays a change to each.
 */
export function relayChange(change: unknown): void {
  const handlers = new Set(
    jest
      .mocked(useEvent)
      .mock.calls.filter(([event]) => event === ANALYSIS_CHANGED_EVENT)
      .map(([, handler]) => handler),
  );
  const deliver = () =>
    handlers.forEach((handler) => typeof handler === 'function' && handler(change));
  // A change can land while an awaited `act` flushes its queued work. A nested `act` there would
  // clear that queue on exit, leaving the flush's later updates outside any `act`.
  if (Reflect.get(REACT_INTERNALS, 'actQueue')) deliver();
  else act(deliver);
}

/**
 * A host that answers the WebView's commands from a real {@link sessionOver} session store over
 * `analysis` and `book`, segmenting the book by each session's draft as the host does. The book it
 * pages is the one `textOf` names at each call, `book` by default; it has no text for any other.
 * Any command that `intercept` answers gets that answer instead. A command that the host does not
 * serve resolves to what `others` returns, `undefined` by default. An edit that `others` leaves
 * unanswered runs through the host's own handlers, except `writeGloss`, whose record ids come from
 * the gloss value it writes. The catalog and concordance queries run through the host's own
 * handlers. `getTextReadStatus` answers from `others` first, then from `text`, which stands for the
 * whole-text read and is unread by default. Every change that a session reports is relayed to the
 * views.
 */
export async function fakeHost(
  others: (command: string, args: unknown[]) => Promise<string | undefined> = async () => undefined,
  intercept: (command: string) => Promise<string | undefined> | undefined = () => undefined,
  {
    analysis,
    book = BOOK,
    textOf = () => book,
    text = unreadText(),
  }: Readonly<{
    analysis?: Partial<TextAnalysis>;
    book?: Book;
    textOf?: () => Book;
    text?: FakeText;
  }> = {},
) {
  const made = await sessionOver(analysis, undefined, book);
  const { sessions, storage } = made;
  made.onChange(relayChange);
  const edits = sessionEditHandlers({
    sessions,
    logger: { error: () => {} },
    getSegmentedBook: async (_sourceProjectId, bookId, segmentationJson) =>
      bookId === textOf().bookRef
        ? resegmentBook(textOf(), segmentationJson ? JSON.parse(segmentationJson) : undefined)
        : undefined,
    getVerseBook: async (_sourceProjectId, bookId) =>
      bookId === textOf().bookRef ? textOf() : undefined,
    getProject: async () => undefined,
  });
  const catalog = sessionCatalogHandlers({
    sessions,
    logger: { error: () => {} },
    getOpenVerseBook: async (_sourceProjectId, bookId) =>
      bookId === textOf().bookRef ? textOf() : undefined,
    getVerseBook: async (_sourceProjectId, bookId) =>
      bookId === textOf().bookRef ? textOf() : undefined,
    isFormInText: (_sourceProjectId, form) => text.isFormInText(form),
  });
  const concordance = sessionConcordanceHandlers({
    sessions,
    logger: { error: () => {} },
    getConcordanceBooks: () => text.concordanceBooks?.(),
    getWritingSystem: async () => 'en',
  });
  const segmented = async (sessionId: string) => {
    const { segmentation } = await sessions.run(sessionId, (session) =>
      session.repository.getScope(),
    );
    return resegmentBook(textOf(), segmentation);
  };
  jest
    .mocked(papi.network.getNetworkEvent)
    .mockImplementation((name: string) =>
      name === 'interlinearizer.onAnalysisChanged' ? ANALYSIS_CHANGED_EVENT : () => () => true,
    );
  const serve = async (...call: unknown[]): Promise<string | number | void> => {
    const [command, first, ...rest] = call;
    const intercepted = intercept(String(command));
    if (intercepted) return intercepted;
    switch (command) {
      case 'interlinearizer.openSession':
        // Opened on the draft alone: these sessions know of no interlinear project to save to.
        return JSON.stringify(await sessions.open(field(first, 'sourceProjectId')));
      case 'interlinearizer.closeSession':
        return sessions.close(field(first, 'sessionId'));
      case 'interlinearizer.getDraftEnvelope':
        return JSON.stringify(
          envelopeOf(
            await sessions.run(field(first, 'sessionId'), (session) =>
              session.repository.getWholeDraft(),
            ),
          ),
        );
      case 'interlinearizer.getBookOutline': {
        if (rest[0] !== textOf().bookRef) return undefined;
        const sessionId = field(first, 'sessionId');
        const segmentedBook = await segmented(sessionId);
        return JSON.stringify(
          await sessions.run(sessionId, (session) =>
            readBookOutline(session.repository, segmentedBook, textOf()),
          ),
        );
      }
      case 'interlinearizer.getStaleSummary': {
        const sessionId = field(first, 'sessionId');
        const segmentedBook = await segmented(sessionId);
        return JSON.stringify(
          await sessions.run(sessionId, (session) =>
            readStaleSummary(session.repository, segmentedBook),
          ),
        );
      }
      case 'interlinearizer.getSegments': {
        if (rest[0] !== textOf().bookRef) return undefined;
        const sessionId = field(first, 'sessionId');
        const [, start, end] = rest;
        const segmentedBook = await segmented(sessionId);
        return JSON.stringify(
          await sessions.run(sessionId, (session) =>
            readSegmentPage(session.repository, segmentedBook, Number(start), Number(end)),
          ),
        );
      }
      case 'interlinearizer.getTextReadStatus':
        return (await others(String(command), [first, ...rest])) ?? JSON.stringify(text.status());
      case 'interlinearizer.retryTextRead':
        text.retry?.();
        return undefined;
      case 'interlinearizer.getCatalogRows':
      case 'interlinearizer.getSelectionSummary':
      case 'interlinearizer.countUsages':
      case 'interlinearizer.getCatalogRowsByIds':
      case 'interlinearizer.getHomographRows':
      case 'interlinearizer.previewDeletion': {
        const handler: (args: unknown) => Promise<string | number> = Reflect.get(
          catalog,
          String(command),
        );
        return handler(first);
      }
      case 'interlinearizer.getConcordance': {
        const handler: (args: unknown) => Promise<string> = Reflect.get(
          concordance,
          String(command),
        );
        return handler(first);
      }
      case 'interlinearizer.undoEdit': {
        const reply = await sessions.undo(field(first, 'sessionId'), field(first, 'changeId'));
        return reply && JSON.stringify(reply);
      }
      case 'interlinearizer.redoEdit': {
        const reply = await sessions.redo(field(first, 'sessionId'), field(first, 'changeId'));
        return reply && JSON.stringify(reply);
      }
      case 'interlinearizer.writeGloss':
        return JSON.stringify(
          await sessions.edit(
            field(first, 'sessionId'),
            'writeGloss',
            (buffer) =>
              tokenCommands.writeGloss(buffer, {
                tokenRef: field(first, 'tokenRef'),
                surfaceText: field(first, 'surfaceText'),
                value: field(first, 'value'),
                analysisLanguage: 'en',
                analysisId: `ta-${field(first, 'value')}`,
                linkId: `tl-${field(first, 'value')}`,
                now: NOW,
              }),
            { changeId: field(first, 'changeId'), step: { location: field(first, 'tokenRef') } },
          ),
        );
      case 'interlinearizer.startDraftOver': {
        const sourceProjectId = field(first, 'sourceProjectId');
        const from: unknown =
          typeof first === 'object' && first ? Reflect.get(first, 'from') : undefined;
        const draft = startedDraft(sourceProjectId, from);
        await sessions.closeAndRun(sourceProjectId, () =>
          new DraftRepository(storage, sourceProjectId, silentLogger()).startOver(draft),
        );
        return undefined;
      }
      case 'interlinearizer.detachFromProject':
        return sessions.detachFromProject(field(first, 'sessionId'));
      case 'interlinearizer.setAnalysisLanguage':
        return sessions.setAnalysisLanguage(
          field(first, 'sessionId'),
          field(first, 'analysisLanguage'),
        );
      default: {
        const edit: ((args: unknown) => Promise<string>) | undefined = Reflect.get(
          edits,
          String(command),
        );
        const answer = await others(String(command), [first, ...rest]);
        return answer === undefined && edit ? edit(first) : answer;
      }
    }
  };
  jest.mocked(papi.commands.sendCommand).mockImplementation((...call: unknown[]) => {
    const answer = serve(...call);
    inFlight.add(answer);
    answer.finally(() => inFlight.delete(answer)).catch(() => {});
    return answer;
  });
  return made;
}

/**
 * Makes the {@link fakeHost} answer an open on the project `missingId` as if the source has no such
 * project, once `opened` resolves.
 */
export function replyProjectMissing(
  missingId: string,
  opened: Promise<void> = Promise.resolve(),
): void {
  const serve = jest.mocked(papi.commands.sendCommand).getMockImplementation();
  jest.mocked(papi.commands.sendCommand).mockImplementation(async (...call) => {
    const [command, args] = call;
    const reply = await serve?.(...call);
    const arg = (name: string) =>
      args && typeof args === 'object' && name in args ? Reflect.get(args, name) : undefined;
    const named = arg('importProjectId') ?? arg('interlinearProjectId');
    if (command !== 'interlinearizer.openSession' || named !== missingId) return reply;
    await opened;
    return JSON.stringify({ ...JSON.parse(String(reply)), projectMissing: true });
  });
}
