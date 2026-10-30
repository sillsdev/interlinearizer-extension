import papi from '@papi/frontend';
import { act } from '@testing-library/react';
import { useEvent } from 'platform-bible-react';
import { resegmentBook } from '../../parsers/papi/resegmentBook';
import * as tokenCommands from '../../services/commands/tokenCommands';
import { DraftRepository } from '../../services/draftRepository';
import { readBookOutline, readSegmentPage } from '../../services/sessionPages';
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
 * A host that answers the WebView's commands from a real {@link sessionOver} session store,
 * segmenting the book by each session's draft as the host does. Any command that `intercept`
 * answers gets that answer instead. A command that the host does not serve resolves to what
 * `others` returns, `undefined` by default. Every change that a session reports is relayed to the
 * views.
 */
export async function fakeHost(
  others: (command: string, args: unknown[]) => Promise<string | undefined> = async () => undefined,
  intercept: (command: string) => Promise<string | undefined> | undefined = () => undefined,
) {
  const made = await sessionOver();
  const { sessions, storage } = made;
  made.onChange(relayChange);
  const segmented = async (sessionId: string) => {
    const { segmentation } = await sessions.run(sessionId, (session) =>
      session.repository.getScope(),
    );
    return resegmentBook(BOOK, segmentation);
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
        const book = await segmented(sessionId);
        return JSON.stringify(
          await sessions.run(sessionId, (session) => readBookOutline(session.repository, book)),
        );
      }
      case 'interlinearizer.getSegments': {
        const sessionId = field(first, 'sessionId');
        const [, start, end] = rest;
        const book = await segmented(sessionId);
        return JSON.stringify(
          await sessions.run(sessionId, (session) =>
            readSegmentPage(session.repository, book, Number(start), Number(end)),
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
      case 'interlinearizer.saveDraft': {
        const [json] = rest;
        await new DraftRepository(storage, String(first), silentLogger()).replaceAll(
          JSON.parse(String(json)),
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
      default:
        return others(String(command), [first, ...rest]);
    }
  });
  return made;
}
