/// <reference types="jest" />

import papi from '@papi/frontend';
import { act, render, renderHook, waitFor } from '@testing-library/react';
import type { TextAnalysis } from 'interlinearizer';
import type { ComponentProps, ReactNode } from 'react';
import { PageClient } from '../../cache/pageClient';
import { WholeAnalysis } from '../../cache/wholeAnalysis';
import * as perfMarks from '../../utils/perf-marks';
import {
  SessionAnalysisProvider,
  useAnalysis,
  useAnalysisDeletionOutcome,
  useAnalysisLanguage,
  useAnalysisReadOnly,
  useFreeTranslationsBySegment,
  useMorphemes,
  usePhraseGloss,
  usePhraseLinkByIdMap,
  usePhraseLinkForToken,
  usePhraseLinkMap,
  usePhraseSenseRef,
  usePlacedStaleFreeTranslations,
  useReportGlossEditing,
  useSegmentFreeTranslation,
  useSegmentHasApprovedTranslation,
  useSegmentsWithApprovedTranslation,
  useStaleMorphemesAnalysisId,
  useStaleTokenLinks,
  useUnapprovedTokenAnalysis,
  useGlossClearReclaims,
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

const SENSE = { authority: 'fwlite', senseId: 's-god' };

const GLOSSED_NOTHING: Partial<TextAnalysis> = {};

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

/** The provider props that a test may set; the session's own are filled in. */
type ProviderProps = Partial<
  Pick<
    ComponentProps<typeof SessionAnalysisProvider>,
    'analysisLanguage' | 'onPendingEditsChange' | 'readOnly'
  >
>;

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
  function Provider({
    children,
    analysisLanguage = 'en',
    ...props
  }: ProviderProps & { children: ReactNode }) {
    return (
      <SessionAnalysisProvider
        client={client}
        whole={whole}
        sessionId={made.sessionId}
        analysisLanguage={analysisLanguage}
        {...props}
      >
        {children}
      </SessionAnalysisProvider>
    );
  }
  const wrapper = ({ children }: { children: ReactNode }) => <Provider>{children}</Provider>;
  return { ...made, client, whole, Provider, wrapper };
}

describe('AnalysisStore', () => {
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
      return () => splitPhrase(makePhraseLink('pl-1', [ref('In'), ref('the')]), ref('In'));
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
  [
    'usePhraseDispatch creating',
    () => {
      const { createPhrase } = usePhraseDispatch();
      return () => createPhrase([{ tokenRef: ref('In'), surfaceText: 'In' }]);
    },
    'interlinearizer.createPhrase',
  ],
  [
    'usePhraseDispatch updating',
    () => {
      const { updatePhrase } = usePhraseDispatch();
      return () => updatePhrase('pl-1', [{ tokenRef: ref('In'), surfaceText: 'In' }]);
    },
    'interlinearizer.updatePhrase',
  ],
  [
    'usePhraseDispatch merging',
    () => {
      const { mergePhrases } = usePhraseDispatch();
      return () => mergePhrases('pl-1', [{ tokenRef: ref('In'), surfaceText: 'In' }], undefined);
    },
    'interlinearizer.mergePhrases',
  ],
  [
    'useStaleFreeTranslationDispatch keeping',
    () => {
      const { keep } = useStaleFreeTranslationDispatch();
      return () => keep('sa-old', 'GEN 1:1', 'In the beginning God');
    },
    'interlinearizer.keepStaleFreeTranslation',
  ],
  [
    'useStaleLocationDispatch reapplying',
    () => {
      const { reapply } = useStaleLocationDispatch();
      return () => reapply('ta-god', ref('God'), ref('earth'), 'earth');
    },
    'interlinearizer.reapplyStaleAnalysis',
  ],
];

/** The ref of the second "God", in GEN 1:3. */
const secondGod = () => tokenRefOf({ ...BOOK, segments: [BOOK.segments[2]] }, 'God');

describe('AnalysisStore suggestions', () => {
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

describe('AnalysisStore suggestions not asked for', () => {
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

describe('AnalysisStore payload sharing', () => {
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

describe('AnalysisStore dispatches', () => {
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

describe('AnalysisStore reads as they stand', () => {
  it("reads a deletion's outcome from the session's whole analysis", async () => {
    const { wrapper } = await sessionProviderOver(GOD_WITH_SENSE, { start: 2, end: 3 });
    const { result } = renderHook(() => useAnalysisDeletionOutcome(), { wrapper });

    expect(result.current('ta-god', () => 'God')).toMatchObject({ usageCount: 1 });
  });
});

describe('AnalysisStore removal previews', () => {
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

const PHRASE_SENSE = { authority: 'fwlite', senseId: 's-in-the' };

/** A draft holding one record of each kind that the read hooks answer from. */
const READ_FIXTURE: Partial<TextAnalysis> = {
  tokenAnalyses: [
    {
      id: 'ta-god',
      ...FIXTURE_STAMPS,
      surfaceText: 'God',
      gloss: { en: 'God' },
      morphemes: [{ id: 'm-1', form: 'God', writingSystem: 'en' }],
    },
    { id: 'ta-earth', ...FIXTURE_STAMPS, surfaceText: 'earth', gloss: { en: 'land' } },
    {
      id: 'ta-said',
      ...FIXTURE_STAMPS,
      surfaceText: 'said',
      morphemes: [{ id: 'm-2', form: 'sed', writingSystem: 'en' }],
      morphemesStale: true,
    },
  ],
  tokenAnalysisLinks: [
    makeTokenLink('ta-god', ref('God'), { surfaceText: 'God', id: 'tl-god' }),
    makeTokenLink('ta-earth', ref('earth'), {
      surfaceText: 'earth',
      status: 'suggested',
      id: 'tl-earth',
    }),
    makeTokenLink('ta-said', ref('said'), { surfaceText: 'said', id: 'tl-said' }),
    makeTokenLink('ta-god', ref('earth'), { surfaceText: 'God', status: 'stale', id: 'tl-stale' }),
  ],
  phraseAnalyses: [
    {
      id: 'pa-1',
      ...FIXTURE_STAMPS,
      surfaceText: 'In the',
      gloss: { en: 'in the' },
      senseRef: PHRASE_SENSE,
    },
  ],
  phraseAnalysisLinks: [{ ...makePhraseLink('pl-1', [ref('In'), ref('the')]), analysisId: 'pa-1' }],
  segmentAnalyses: [
    {
      id: 'sa-1',
      ...FIXTURE_STAMPS,
      surfaceText: 'In the beginning God',
      freeTranslation: { en: 'At first' },
    },
    {
      id: 'sa-old',
      ...FIXTURE_STAMPS,
      surfaceText: 'And the land',
      freeTranslation: { en: 'old' },
    },
  ],
  segmentAnalysisLinks: [
    { id: 'sl-1', ...FIXTURE_STAMPS, analysisId: 'sa-1', status: 'approved', segmentId: 'GEN 1:1' },
    {
      id: 'sl-old',
      ...FIXTURE_STAMPS,
      analysisId: 'sa-old',
      status: 'stale',
      segmentId: 'GEN 1:2',
    },
  ],
};

/** Each read hook, a read of {@link READ_FIXTURE} through it, and what that read answers. */
const READS: [string, () => unknown, unknown][] = [
  ['useMorphemes', () => useMorphemes(ref('God')).map((m) => m.form), ['God']],
  [
    'useUnapprovedTokenAnalysis',
    () => useUnapprovedTokenAnalysis(ref('earth'), true)?.id,
    'ta-earth',
  ],
  ['useStaleMorphemesAnalysisId', () => useStaleMorphemesAnalysisId(ref('said')), 'ta-said'],
  ['usePhraseLinkMap', () => [...usePhraseLinkMap().keys()], [ref('In'), ref('the')]],
  ['usePhraseLinkByIdMap', () => [...usePhraseLinkByIdMap().keys()], ['pl-1']],
  ['usePhraseLinkForToken', () => usePhraseLinkForToken(ref('the'))?.id, 'pl-1'],
  ['usePhraseGloss', () => usePhraseGloss('pl-1'), 'in the'],
  ['usePhraseSenseRef', () => usePhraseSenseRef('pl-1'), PHRASE_SENSE],
  ['useSegmentFreeTranslation', () => useSegmentFreeTranslation('GEN 1:1'), 'At first'],
  [
    'useFreeTranslationsBySegment',
    () => useFreeTranslationsBySegment(),
    new Map([['GEN 1:1', 'At first']]),
  ],
  ['useSegmentHasApprovedTranslation', () => useSegmentHasApprovedTranslation('GEN 1:1'), true],
  [
    'useSegmentsWithApprovedTranslation',
    () => useSegmentsWithApprovedTranslation(),
    new Set(['GEN 1:1']),
  ],
  [
    'usePlacedStaleFreeTranslations',
    () => usePlacedStaleFreeTranslations(BOOK).bySegment,
    new Map([['GEN 1:2', [{ analysisId: 'sa-old', segmentId: 'GEN 1:2', text: 'old' }]]]),
  ],
  ['useStaleTokenLinks', () => useStaleTokenLinks().map((link) => link.id), ['tl-stale']],
  ['useAnalysis', () => useAnalysis().phraseAnalyses.map((pa) => pa.id), ['pa-1']],
  ['useAnalysisLanguage', () => useAnalysisLanguage(), 'en'],
  ['useAnalysisReadOnly', () => useAnalysisReadOnly(), false],
];

describe('AnalysisStore reads', () => {
  it.each(READS)('%s answers from the session', async (_name, useRead, expected) => {
    const { wrapper } = await sessionProviderOver(READ_FIXTURE);

    const { result } = renderHook(useRead, { wrapper });

    expect(result.current).toStrictEqual(expected);
  });

  it('reads the analysis as read-only when the provider is', async () => {
    const { Provider } = await sessionProviderOver(READ_FIXTURE);

    const { result } = renderHook(() => useAnalysisReadOnly(), {
      wrapper: ({ children }) => <Provider readOnly>{children}</Provider>,
    });

    expect(result.current).toBe(true);
  });

  it('reads glosses in the language the provider switches to', async () => {
    const { Provider } = await sessionProviderOver({
      tokenAnalyses: [
        { id: 'ta-god', ...FIXTURE_STAMPS, surfaceText: 'God', gloss: { en: 'God', de: 'Gott' } },
      ],
      tokenAnalysisLinks: [makeTokenLink('ta-god', ref('God'), { surfaceText: 'God' })],
    });
    let language = 'en';
    const { result, rerender } = renderHook(
      () => ({ language: useAnalysisLanguage(), gloss: useGloss(ref('God')) }),
      {
        wrapper: ({ children }) => <Provider analysisLanguage={language}>{children}</Provider>,
      },
    );

    language = 'de';
    rerender();

    expect(result.current).toStrictEqual({ language: 'de', gloss: 'Gott' });
  });
});

/** Every hook that must run inside a provider, and a call of it. */
const PROVIDER_HOOKS: [string, () => unknown][] = [
  ['useGloss', () => useGloss('t')],
  ['useGlossDispatch', () => useGlossDispatch()],
  ['useMorphemes', () => useMorphemes('t')],
  ['useAnalysis', () => useAnalysis()],
  ['useAnalysisReadOnly', () => useAnalysisReadOnly()],
  ['useReportGlossEditing', () => useReportGlossEditing(false, () => {})],
];

describe('AnalysisStore hooks outside a provider', () => {
  it.each(PROVIDER_HOOKS)('%s throws', (name, useHook) => {
    jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => renderHook(useHook)).toThrow(`${name} must be used inside`);
  });
});

/** Reports `isEditing` through {@link useReportGlossEditing}, rendering nothing. */
function EditingReporter({
  isEditing,
  commit = () => {},
}: Readonly<{ isEditing: boolean; commit?: () => void }>) {
  useReportGlossEditing(isEditing, commit);
  return undefined;
}

describe('useReportGlossEditing', () => {
  it('reports true when the first input starts editing and false when it stops', async () => {
    const { Provider } = await sessionProviderOver(GLOSSED_NOTHING);
    const onPendingEditsChange = jest.fn();
    const renderWith = (isEditing: boolean) => (
      <Provider onPendingEditsChange={onPendingEditsChange}>
        <EditingReporter isEditing={isEditing} />
      </Provider>
    );
    const { rerender } = render(renderWith(false));
    expect(onPendingEditsChange).not.toHaveBeenCalled();

    rerender(renderWith(true));
    expect(onPendingEditsChange).toHaveBeenLastCalledWith(true);

    rerender(renderWith(false));
    expect(onPendingEditsChange).toHaveBeenLastCalledWith(false);
  });

  it('reports only the crossings to and from no input editing', async () => {
    const { Provider } = await sessionProviderOver(GLOSSED_NOTHING);
    const onPendingEditsChange = jest.fn();
    const renderWith = (a: boolean, b: boolean) => (
      <Provider onPendingEditsChange={onPendingEditsChange}>
        <EditingReporter isEditing={a} />
        <EditingReporter isEditing={b} />
      </Provider>
    );
    const { rerender } = render(renderWith(true, false));
    rerender(renderWith(true, true));
    rerender(renderWith(false, true));
    rerender(renderWith(false, false));

    expect(onPendingEditsChange.mock.calls).toStrictEqual([[true], [false]]);
  });

  it('reports false when an editing input unmounts', async () => {
    const { Provider } = await sessionProviderOver(GLOSSED_NOTHING);
    const onPendingEditsChange = jest.fn();
    const { rerender } = render(
      <Provider onPendingEditsChange={onPendingEditsChange}>
        <EditingReporter isEditing />
      </Provider>,
    );

    rerender(
      <Provider onPendingEditsChange={onPendingEditsChange}>
        <span />
      </Provider>,
    );

    expect(onPendingEditsChange).toHaveBeenLastCalledWith(false);
  });

  it('commits the draft when an editing input unmounts', async () => {
    const { Provider } = await sessionProviderOver(GLOSSED_NOTHING);
    const commit = jest.fn();
    const { rerender } = render(
      <Provider>
        <EditingReporter isEditing commit={commit} />
      </Provider>,
    );

    rerender(
      <Provider>
        <span />
      </Provider>,
    );

    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('commits nothing when the input stops editing without unmounting', async () => {
    const { Provider } = await sessionProviderOver(GLOSSED_NOTHING);
    const commit = jest.fn();
    const { rerender } = render(
      <Provider>
        <EditingReporter isEditing commit={commit} />
      </Provider>,
    );

    rerender(
      <Provider>
        <EditingReporter isEditing={false} commit={commit} />
      </Provider>,
    );

    expect(commit).not.toHaveBeenCalled();
  });
});
