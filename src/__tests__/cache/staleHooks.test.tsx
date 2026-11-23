/// <reference types="jest" />

import { logger } from '@papi/frontend';
import { renderHook, waitFor } from '@testing-library/react';
import type { TextAnalysis } from 'interlinearizer';
import { useStaleSummary } from '../../cache/staleHooks';
import { settle } from '../components/analysis-provider';
import { makeTokenLink } from '../test-helpers';
import { relayChange } from './fake-host';
import { ref } from './session-source';
import {
  ANALYSIS,
  changeNaming,
  failing,
  sessionIdOf,
  timesSent,
  wrapperOver,
} from './hook-sessions';

describe('useStaleSummary', () => {
  const STALE: TextAnalysis = {
    ...ANALYSIS,
    tokenAnalysisLinks: [
      makeTokenLink('ta-beginning', ref('beginning'), {
        surfaceText: 'beginning',
        id: 'tl-beginning',
        status: 'stale',
      }),
    ],
  };

  it("summarizes the book's stale analyses", async () => {
    const wrapper = await wrapperOver(undefined, STALE);

    const { result } = renderHook(() => useStaleSummary('GEN'), { wrapper });

    await waitFor(() =>
      expect(result.current).toStrictEqual({
        glosses: [{ analysisId: 'ta-beginning', tokenRef: ref('beginning') }],
        phrases: [],
        freeTranslations: [],
      }),
    );
  });

  it('fetches again when a change to the session names the stale summary', async () => {
    const wrapper = await wrapperOver(undefined, STALE);
    renderHook(() => useStaleSummary('GEN'), { wrapper });
    await settle();
    const before = timesSent('interlinearizer.getStaleSummary');

    relayChange(changeNaming(sessionIdOf('interlinearizer.getStaleSummary'), ['getStaleSummary']));
    await settle();

    expect(timesSent('interlinearizer.getStaleSummary')).toBe(before + 1);
  });

  it('logs a summary that could not be fetched', async () => {
    const wrapper = await wrapperOver(undefined, STALE);
    failing('interlinearizer.getStaleSummary');

    renderHook(() => useStaleSummary('GEN'), { wrapper });
    await settle();

    expect(logger.warn).toHaveBeenCalledWith(
      'Interlinearizer: could not fetch the stale summary',
      expect.any(Error),
    );
  });
});
