import papi from '@papi/frontend';
import { act } from '@testing-library/react';
import type { Book, DraftProject, TextAnalysis } from 'interlinearizer';
import { useEvent } from 'platform-bible-react';
import { resegmentBook } from '../../parsers/papi/resegmentBook';
import * as tokenCommands from '../../services/commands/tokenCommands';
import { DraftRepository } from '../../services/draftRepository';
import { sessionEditHandlers } from '../../services/sessionEditHandlers';
import { readBookOutline, readSegmentPage } from '../../services/sessionPages';
import { emptyAnalysis } from '../../types/empty-factories';
import { CURRENT_MODEL_VERSION } from '../../types/model-version';
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
  act(() => handlers.forEach((handler) => typeof handler === 'function' && handler(change)));
}

/**
 * A host that answers the WebView's commands from a real {@link sessionOver} session store over
 * `analysis` and `book`, segmenting the book by each session's draft as the host does. The book it
 * pages is the one `textOf` names at each call, `book` by default. Any command that `intercept`
 * answers gets that answer instead. A command that the host does not serve resolves to what
 * `others` returns, `undefined` by default. An edit that `others` leaves unanswered runs through
 * the host's own handlers, except `writeGloss`, whose record ids come from the gloss value it
 * writes. Every change that a session reports is relayed to the views.
 */
export async function fakeHost(
  others: (command: string, args: unknown[]) => Promise<string | undefined> = async () => undefined,
  intercept: (command: string) => Promise<string | undefined> | undefined = () => undefined,
  {
    analysis,
    book = BOOK,
    textOf = () => book,
  }: Readonly<{ analysis?: Partial<TextAnalysis>; book?: Book; textOf?: () => Book }> = {},
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
  jest.mocked(papi.commands.sendCommand).mockImplementation(async (...call: unknown[]) => {
    const [command, first, ...rest] = call;
    const intercepted = intercept(String(command));
    if (intercepted) return intercepted;
    switch (command) {
      case 'interlinearizer.openSession':
        // Opened on the draft alone: these sessions know of no interlinear project to save to.
        return JSON.stringify(await sessions.open(field(first, 'sourceProjectId')));
      case 'interlinearizer.closeSession':
        return sessions.close(field(first, 'sessionId'));
      case 'interlinearizer.getFullAnalysis':
        return JSON.stringify(
          await sessions.run(field(first, 'sessionId'), (session) =>
            session.repository.getWholeDraft(),
          ),
        );
      case 'interlinearizer.getBookOutline': {
        const sessionId = field(first, 'sessionId');
        const segmentedBook = await segmented(sessionId);
        return JSON.stringify(
          await sessions.run(sessionId, (session) =>
            readBookOutline(session.repository, segmentedBook),
          ),
        );
      }
      case 'interlinearizer.getSegments': {
        const sessionId = field(first, 'sessionId');
        const [, start, end] = rest;
        const segmentedBook = await segmented(sessionId);
        return JSON.stringify(
          await sessions.run(sessionId, (session) =>
            readSegmentPage(session.repository, segmentedBook, Number(start), Number(end)),
          ),
        );
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
    const named =
      args && typeof args === 'object' && 'interlinearProjectId' in args
        ? args.interlinearProjectId
        : undefined;
    if (command !== 'interlinearizer.openSession' || named !== missingId) return reply;
    await opened;
    return JSON.stringify({ ...JSON.parse(String(reply)), projectMissing: true });
  });
}
