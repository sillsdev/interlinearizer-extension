/// <reference types="jest" />

import papi from '@papi/frontend';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { TextAnalysis } from 'interlinearizer';
import type { ReactNode } from 'react';
import { PageClient } from '../../cache/pageClient';
import { WholeAnalysis } from '../../cache/wholeAnalysis';
import * as perfMarks from '../../utils/perf-marks';
import {
  SessionAnalysisProvider,
  useAnalysisDeletionOutcome,
  useGlossClearReclaims,
  usePhraseLinkByIdGetter,
  useStaleLocationReclaims,
  useApproveAnalysisDispatch,
  useConfirmMorphemesDispatch,
  useGloss,
  useGlossDispatch,
  useGlossSenseRef,
  useMorphemeBreakdownDispatch,
  useResolvedTokenAnalysis,
  useSuggestionAfterClearing,
  useMorphemeDeleteDispatch,
  useMorphemeGlossDispatch,
  useMorphemePayloadIsSolelyOwned,
  useMorphemeResetLosesAnnotation,
  usePhraseDispatch,
  usePhraseGlossDispatch,
  useSegmentFreeTranslationDispatch,
  useStaleFreeTranslationDispatch,
  useStaleLocationDispatch,
} from '../../components/AnalysisStore';
import * as tokenCommands from '../../services/commands/tokenCommands';
import { FIXTURE_STAMPS, makePhraseLink, makeTokenLink, tokenRefOf } from '../test-helpers';
import { BOOK, NOW, ref, sessionOver } from '../cache/session-source';

jest.mock('../../utils/host-path', () => ({ hostPathEnabled: () => true }));

const SENSE = { authority: 'fwlite', senseId: 's-god' };

const GOD_WITH_SENSE: Partial<TextAnalysis> = {
  tokenAnalyses: [
    {
      id: 'ta-god',
      ...FIXTURE_STAMPS,
      surfaceText: 'God',
      gloss: { en: 'God' },
      glossSenseRef: SENSE,
    },
  ],
  tokenAnalysisLinks: [makeTokenLink('ta-god', ref('God'), { surfaceText: 'God', id: 'tl-god' })],
};

/** Whether `args` carry the fields that the WebView sends with `interlinearizer.writeGloss`. */
function isGlossArgs(
  args: unknown,
): args is { changeId: string; tokenRef: string; surfaceText: string; value: string } {
  if (typeof args !== 'object' || !args) return false;
  return ['changeId', 'tokenRef', 'surfaceText', 'value'].every(
    (key) => typeof Reflect.get(args, key) === 'string',
  );
}

/**
 * A session over `analysis` and a provider over it, with the segments in `held` loaded, every one
 * by default. The stubbed host runs `interlinearizer.writeGloss` against the session and throws on
 * any other command.
 */
async function sessionProviderOver(
  analysis: Partial<TextAnalysis>,
  held: { start: number; end: number } = { start: 0, end: 3 },
) {
  const made = await sessionOver(analysis);
  const client = new PageClient(
    { getOutline: () => made.fetchOutline(), getSegments: made.fetchPage },
    { pageSize: 1, retryDelaysMs: [0], wait: async () => {} },
  );
  made.onChange((change) => client.hear(change));
  await client.open();
  client.load(held.start, held.end, 'list');
  await client.settled();
  const whole = new WholeAnalysis(() =>
    made.sessions.run(made.sessionId, (session) => session.repository.getWholeDraft()),
  );
  await whole.refresh();
  jest.mocked(papi.commands.sendCommand).mockImplementation(async (...call: unknown[]) => {
    const [command, args] = call;
    if (command !== 'interlinearizer.writeGloss' || !isGlossArgs(args))
      throw new Error(`unexpected ${String(command)}`);
    return JSON.stringify(
      await made.edit(
        'writeGloss',
        (buffer) =>
          tokenCommands.writeGloss(buffer, {
            ...args,
            analysisLanguage: 'en',
            analysisId: 'ta-new',
            linkId: 'tl-new',
            now: NOW,
          }),
        args.changeId,
      ),
    );
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SessionAnalysisProvider
      client={client}
      whole={whole}
      sessionId={made.sessionId}
      analysisLanguage="en"
    >
      {children}
    </SessionAnalysisProvider>
  );
  return { ...made, client, whole, wrapper };
}

describe('AnalysisStore on the host path', () => {
  it("reads a held token's gloss from the session's pages", async () => {
    const { wrapper } = await sessionProviderOver(GOD_WITH_SENSE);

    const { result } = renderHook(() => useGloss(ref('God')), { wrapper });

    expect(result.current).toBe('God');
  });

  it("reads the sense ref on a held token's approved payload", async () => {
    const { wrapper } = await sessionProviderOver(GOD_WITH_SENSE);

    const { result } = renderHook(() => useGlossSenseRef(ref('God')), { wrapper });

    expect(result.current).toStrictEqual(SENSE);
  });

  it('marks a gloss commit, timing it to the commit rendering its reply', async () => {
    const { wrapper, client } = await sessionProviderOver(GOD_WITH_SENSE);
    jest.spyOn(perfMarks, 'perfMarksEnabled').mockReturnValue(true);
    const perfMark = jest.spyOn(perfMarks, 'perfMark').mockImplementation(() => {});
    const perfMeasureFromFirst = jest
      .spyOn(perfMarks, 'perfMeasureFromFirst')
      .mockImplementation(() => {});
    const { result } = renderHook(() => useGlossDispatch(), { wrapper });

    act(() => result.current(ref('earth'), 'earth', 'land'));
    expect(perfMark).toHaveBeenCalledWith('gloss-commit');
    expect(perfMeasureFromFirst).not.toHaveBeenCalled();
    await act(async () => {
      await client.settled();
    });

    await waitFor(() =>
      expect(perfMeasureFromFirst).toHaveBeenCalledWith('gloss-render', 'gloss-commit'),
    );
  });

  it('writes a gloss through the session, reading it back from the reply', async () => {
    const { wrapper, client, sessionId } = await sessionProviderOver(GOD_WITH_SENSE);
    const { result } = renderHook(
      () => ({ gloss: useGloss(ref('earth')), write: useGlossDispatch() }),
      { wrapper },
    );

    await act(async () => {
      result.current.write(ref('earth'), 'earth', 'land');
      await client.settled();
    });

    expect(papi.commands.sendCommand).toHaveBeenCalledWith('interlinearizer.writeGloss', {
      sessionId,
      changeId: expect.any(String),
      tokenRef: ref('earth'),
      surfaceText: 'earth',
      value: 'land',
    });
    expect(result.current.gloss).toBe('land');
  });
});

/** Each dispatch hook, an edit it makes, and the command that the edit sends. */
const DISPATCHES: [string, () => () => void, string][] = [
  [
    'useApproveAnalysisDispatch',
    () => {
      const approve = useApproveAnalysisDispatch();
      return () => approve(ref('God'), 'God', 'ta-god');
    },
    'interlinearizer.approveAnalysisForToken',
  ],
  [
    'useConfirmMorphemesDispatch',
    () => {
      const confirm = useConfirmMorphemesDispatch();
      return () => confirm('ta-god');
    },
    'interlinearizer.confirmAnalysisMorphemes',
  ],
  [
    'useMorphemeBreakdownDispatch',
    () => {
      const write = useMorphemeBreakdownDispatch();
      return () => write(ref('God'), 'God', ['G', 'od'], 'en');
    },
    'interlinearizer.writeMorphemes',
  ],
  [
    'useMorphemeDeleteDispatch',
    () => {
      const remove = useMorphemeDeleteDispatch();
      return () => remove(ref('God'));
    },
    'interlinearizer.deleteMorphemes',
  ],
  [
    'useMorphemeGlossDispatch',
    () => {
      const write = useMorphemeGlossDispatch();
      return () => write(ref('God'), 'm-1', 'god');
    },
    'interlinearizer.writeMorphemeGloss',
  ],
  [
    'usePhraseGlossDispatch',
    () => {
      const write = usePhraseGlossDispatch();
      return () => write('pl-1', 'in the');
    },
    'interlinearizer.writePhraseGloss',
  ],
  [
    'usePhraseDispatch',
    () => {
      const { deletePhrase } = usePhraseDispatch();
      return () => deletePhrase('pl-1');
    },
    'interlinearizer.deletePhrase',
  ],
  [
    'usePhraseDispatch splitting',
    () => {
      const { splitPhrase } = usePhraseDispatch();
      return () =>
        splitPhrase(makePhraseLink('pl-1', [ref('In'), ref('the')]), ref('In'), new Map());
    },
    'interlinearizer.splitPhrase',
  ],
  [
    'useSegmentFreeTranslationDispatch',
    () => {
      const write = useSegmentFreeTranslationDispatch();
      return () => write('GEN 1:1', 'In the beginning God', 'At first');
    },
    'interlinearizer.writeSegmentFreeTranslation',
  ],
  [
    'useStaleFreeTranslationDispatch',
    () => {
      const { discard } = useStaleFreeTranslationDispatch();
      return () => discard('sa-old');
    },
    'interlinearizer.discardStaleFreeTranslation',
  ],
  [
    'useStaleLocationDispatch',
    () => {
      const { discard } = useStaleLocationDispatch();
      return () => discard('ta-god', ref('God'));
    },
    'interlinearizer.discardStaleAnalysis',
  ],
];

/** The ref of the second "God", in GEN 1:3. */
const secondGod = () => tokenRefOf({ ...BOOK, segments: [BOOK.segments[2]] }, 'God');

describe('AnalysisStore suggestions on the host path', () => {
  it('suggests from the pool buckets of the pages held, though the approval is elsewhere', async () => {
    const { wrapper } = await sessionProviderOver(GOD_WITH_SENSE, { start: 2, end: 3 });

    const { result } = renderHook(() => useResolvedTokenAnalysis(secondGod(), 'God'), {
      wrapper,
    });

    expect(result.current).toMatchObject({ status: 'suggested', suggested: { id: 'ta-god' } });
  });

  it('previews what a cleared approval would leave, counting approvals on pages not held', async () => {
    const bothApproved: Partial<TextAnalysis> = {
      ...GOD_WITH_SENSE,
      tokenAnalysisLinks: [
        ...(GOD_WITH_SENSE.tokenAnalysisLinks ?? []),
        makeTokenLink('ta-god', secondGod(), { surfaceText: 'God', id: 'tl-god-2' }),
      ],
    };
    const { wrapper } = await sessionProviderOver(bothApproved, { start: 0, end: 1 });

    const { result } = renderHook(() => useSuggestionAfterClearing(ref('God'), 'God', true), {
      wrapper,
    });

    expect(result.current).toMatchObject({ status: 'suggested', suggested: { id: 'ta-god' } });
  });
});

describe('AnalysisStore suggestions not asked for on the host path', () => {
  it('resolves nothing for a token not showing suggestions', async () => {
    const { wrapper } = await sessionProviderOver(GOD_WITH_SENSE);

    const { result } = renderHook(() => useResolvedTokenAnalysis(ref('God'), 'God', false), {
      wrapper,
    });

    expect(result.current).toBeUndefined();
  });

  it('previews nothing for a token whose gloss is not being cleared', async () => {
    const { wrapper } = await sessionProviderOver(GOD_WITH_SENSE);

    const { result } = renderHook(() => useSuggestionAfterClearing(ref('God'), 'God', false), {
      wrapper,
    });

    expect(result.current).toBeUndefined();
  });
});

describe('AnalysisStore payload sharing on the host path', () => {
  /** "God" approved twice with one payload, whose breakdown carries a gloss. */
  const sharedBreakdown: Partial<TextAnalysis> = {
    tokenAnalyses: [
      {
        id: 'ta-god',
        ...FIXTURE_STAMPS,
        surfaceText: 'God',
        morphemes: [{ id: 'm-god', form: 'God', writingSystem: 'en', gloss: { en: 'god' } }],
      },
    ],
    tokenAnalysisLinks: [
      makeTokenLink('ta-god', ref('God'), { surfaceText: 'God', id: 'tl-god' }),
      makeTokenLink('ta-god', secondGod(), { surfaceText: 'God', id: 'tl-god-2' }),
    ],
  };

  it('counts a token on a page not held as sharing the payload', async () => {
    const { wrapper } = await sessionProviderOver(sharedBreakdown, { start: 0, end: 1 });

    const { result } = renderHook(() => useMorphemePayloadIsSolelyOwned(ref('God')), { wrapper });

    expect(result.current).toBe(false);
  });

  it('loses no annotation resetting a breakdown that a token on a page not held shares', async () => {
    const { wrapper } = await sessionProviderOver(sharedBreakdown, { start: 0, end: 1 });

    const { result } = renderHook(() => useMorphemeResetLosesAnnotation(ref('God')), { wrapper });

    expect(result.current).toBe(false);
  });
});

describe('AnalysisStore dispatches on the host path', () => {
  it.each(DISPATCHES)('%s sends its edit to the session', async (_name, useEdit, command) => {
    const { wrapper, client } = await sessionProviderOver(GOD_WITH_SENSE);
    jest.mocked(papi.commands.sendCommand).mockResolvedValue(undefined);
    const { result } = renderHook(useEdit, { wrapper });

    await act(async () => {
      result.current();
      await client.settled();
    });

    expect(papi.commands.sendCommand).toHaveBeenCalledWith(command, expect.anything());
  });
});

describe('AnalysisStore reads as they stand on the host path', () => {
  it("reads a deletion's outcome from the session's whole analysis", async () => {
    const { wrapper } = await sessionProviderOver(GOD_WITH_SENSE, { start: 2, end: 3 });
    const { result } = renderHook(() => useAnalysisDeletionOutcome(), { wrapper });

    expect(result.current('ta-god', () => 'God')).toMatchObject({ usageCount: 1 });
  });

  it('reads the phrase links of the held pages when asked', async () => {
    const { wrapper } = await sessionProviderOver({
      phraseAnalyses: [{ id: 'pa-1', ...FIXTURE_STAMPS, surfaceText: 'the beginning' }],
      phraseAnalysisLinks: [
        { ...makePhraseLink('pl-1', [ref('the'), ref('beginning')]), analysisId: 'pa-1' },
      ],
    });
    const { result } = renderHook(() => usePhraseLinkByIdGetter(), { wrapper });

    expect([...result.current().keys()]).toStrictEqual(['pl-1']);
  });
});

describe('AnalysisStore removal previews on the host path', () => {
  /** A provider whose host answers each removal preview with `ta-god`. */
  async function previewing() {
    const made = await sessionProviderOver(GOD_WITH_SENSE);
    jest.mocked(papi.commands.sendCommand).mockResolvedValue('["ta-god"]');
    return made;
  }

  it('asks the session what a gloss clear would reclaim', async () => {
    const { wrapper } = await previewing();
    const { result } = renderHook(() => useGlossClearReclaims(), { wrapper });

    await expect(result.current(['ta-god'])).resolves.toStrictEqual(['ta-god']);
  });

  it('asks the session what a stale discard and a reapply would reclaim', async () => {
    const { wrapper } = await previewing();
    const { result } = renderHook(() => useStaleLocationReclaims(), { wrapper });

    await expect(result.current.discard('ta-god', ref('God'))).resolves.toStrictEqual(['ta-god']);
    await expect(
      result.current.reapply('ta-god', ref('God'), ref('earth'), 'earth'),
    ).resolves.toStrictEqual(['ta-god']);
  });
});
