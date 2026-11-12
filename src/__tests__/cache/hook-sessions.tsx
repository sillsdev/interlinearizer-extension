/// <reference types="jest" />

import papi from '@papi/frontend';
import type { TextAnalysis } from 'interlinearizer';
import type { ReactNode } from 'react';
import { emptyAnalysis } from '../../types/empty-factories';
import { prepareAnalysis } from '../components/analysis-provider';
import { FIXTURE_STAMPS, makeTokenLink } from '../test-helpers';
import { BOOK, ref } from './session-source';
import { readText } from './fake-host';

/** A draft whose one analysis glosses "God". */
export const ANALYSIS: TextAnalysis = {
  ...emptyAnalysis(),
  tokenAnalyses: [{ id: 'ta-god', ...FIXTURE_STAMPS, surfaceText: 'God', gloss: { en: 'God' } }],
  tokenAnalysisLinks: [makeTokenLink('ta-god', ref('God'), { surfaceText: 'God', id: 'tl-god' })],
};

/** A wrapper giving the hooks a session over `analysis` that a fake host serves. */
export async function wrapperOver(text = readText([]), analysis: TextAnalysis = ANALYSIS) {
  const Provider = await prepareAnalysis(analysis, BOOK, text);
  return function Wrapper({ children }: Readonly<{ children: ReactNode }>) {
    return <Provider>{children}</Provider>;
  };
}

/** Sets the language of the session that the view last sent `command` under, as the view does. */
export async function setLanguage(command: string, analysisLanguage: string): Promise<void> {
  await papi.commands.sendCommand('interlinearizer.setAnalysisLanguage', {
    sessionId: sessionIdOf(command),
    analysisLanguage,
  });
}

/** How many times the view has sent `command`. */
export function timesSent(command: string): number {
  return jest.mocked(papi.commands.sendCommand).mock.calls.filter(([sent]) => sent === command)
    .length;
}

/** The session id the view last sent `command` under. */
export function sessionIdOf(command: string): string {
  const args = jest
    .mocked(papi.commands.sendCommand)
    .mock.calls.findLast(([sent]) => sent === command)?.[1];
  const sessionId = typeof args === 'object' && args ? Reflect.get(args, 'sessionId') : undefined;
  if (typeof sessionId !== 'string') throw new Error(`${command} named no session`);
  return sessionId;
}

/** A change to the session that names `queries`, and touched nothing else. */
export function changeNaming(sessionId: string, queries: string[]) {
  return { sessionId, changeId: 'c', books: [], analysisIds: [], forms: [], queries };
}

/** Makes the host fail `command` from now on, answering the rest as before. */
export function failing(command: string): void {
  const serve = jest.mocked(papi.commands.sendCommand).getMockImplementation();
  jest.mocked(papi.commands.sendCommand).mockImplementation(async (...call) => {
    if (call[0] === command) throw new Error('offline');
    return serve?.(...call);
  });
}
