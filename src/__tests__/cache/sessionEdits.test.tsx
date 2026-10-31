/// <reference types="jest" />

import papi, { logger } from '@papi/frontend';
import { act, renderHook } from '@testing-library/react';
import type { TextAnalysis } from 'interlinearizer';
import type { ReactNode } from 'react';
import { PageClient } from '../../cache/pageClient';
import { PageClientProvider } from '../../cache/pageHooks';
import {
  useAnalysisRowCommands,
  useApproveAnalysisCommand,
  useConfirmMorphemesCommand,
  useGlossCommand,
  useMorphemeBreakdownCommand,
  useMorphemeDeleteCommand,
  useMorphemeGlossCommand,
  usePhraseCommands,
  usePhraseGlossCommand,
  useSegmentFreeTranslationCommand,
  useStaleFreeTranslationCommands,
  useRemovalPreviews,
  useStaleLocationCommands,
} from '../../cache/sessionEdits';
import { WholeAnalysis } from '../../cache/wholeAnalysis';
import { emptyAnalysis, emptyDraft } from '../../types/empty-factories';
import { FIXTURE_STAMPS, makePhraseLink, makeTokenLink } from '../test-helpers';
import { sessionOver } from './session-source';

const SNAPSHOTS = [{ tokenRef: 'GEN 1:1:0', surfaceText: 'In' }];

/** A provider over a session whose commands the tests send to a stubbed `sendCommand`. */
async function sessionWrapper() {
  const made = await sessionOver();
  const client = new PageClient({
    getOutline: () => made.fetchOutline(),
    getSegments: made.fetchPage,
  });
  await client.open();
  const whole = new WholeAnalysis(async () => emptyDraft('src'));
  const wrapper = ({ children }: { children: ReactNode }) => (
    <PageClientProvider client={client} whole={whole} sessionId="s-1" analysisLanguage="en">
      {children}
    </PageClientProvider>
  );
  return { client, wrapper };
}

/** Each hook, the edit it makes, and the command and fields that the edit sends. */
const EDITS: [string, () => () => void, string, Record<string, unknown>][] = [
  [
    'useGlossCommand',
    () => {
      const write = useGlossCommand();
      return () => write('GEN 1:1:0', 'In', 'au');
    },
    'interlinearizer.writeGloss',
    { tokenRef: 'GEN 1:1:0', surfaceText: 'In', value: 'au' },
  ],
  [
    'useApproveAnalysisCommand',
    () => {
      const approve = useApproveAnalysisCommand();
      return () => approve('GEN 1:1:0', 'In', 'ta-in');
    },
    'interlinearizer.approveAnalysisForToken',
    { tokenRef: 'GEN 1:1:0', surfaceText: 'In', analysisId: 'ta-in' },
  ],
  [
    'useConfirmMorphemesCommand at a token',
    () => {
      const confirm = useConfirmMorphemesCommand();
      return () => confirm('ta-in', 'GEN 1:1:0');
    },
    'interlinearizer.confirmAnalysisMorphemes',
    { analysisId: 'ta-in', tokenRef: 'GEN 1:1:0' },
  ],
  [
    'useConfirmMorphemesCommand at no token',
    () => {
      const confirm = useConfirmMorphemesCommand();
      return () => confirm('ta-in');
    },
    'interlinearizer.confirmAnalysisMorphemes',
    { analysisId: 'ta-in' },
  ],
  [
    'useMorphemeBreakdownCommand',
    () => {
      const write = useMorphemeBreakdownCommand();
      return () => write('GEN 1:1:0', 'In', ['I', 'n'], 'en');
    },
    'interlinearizer.writeMorphemes',
    { tokenRef: 'GEN 1:1:0', surfaceText: 'In', forms: ['I', 'n'], writingSystem: 'en' },
  ],
  [
    'useMorphemeDeleteCommand',
    () => {
      const remove = useMorphemeDeleteCommand();
      return () => remove('GEN 1:1:0');
    },
    'interlinearizer.deleteMorphemes',
    { tokenRef: 'GEN 1:1:0' },
  ],
  [
    'useMorphemeGlossCommand',
    () => {
      const write = useMorphemeGlossCommand();
      return () => write('GEN 1:1:0', 'm-1', 'in');
    },
    'interlinearizer.writeMorphemeGloss',
    { tokenRef: 'GEN 1:1:0', morphemeId: 'm-1', value: 'in' },
  ],
  [
    'usePhraseGlossCommand',
    () => {
      const write = usePhraseGlossCommand();
      return () => write('pl-1', 'in the');
    },
    'interlinearizer.writePhraseGloss',
    { phraseId: 'pl-1', value: 'in the' },
  ],
  [
    'usePhraseCommands.createPhrase',
    () => {
      const { createPhrase } = usePhraseCommands();
      return () => createPhrase(SNAPSHOTS);
    },
    'interlinearizer.createPhrase',
    { tokens: SNAPSHOTS },
  ],
  [
    'usePhraseCommands.updatePhrase',
    () => {
      const { updatePhrase } = usePhraseCommands();
      return () => updatePhrase('pl-1', SNAPSHOTS);
    },
    'interlinearizer.updatePhrase',
    { phraseId: 'pl-1', tokens: SNAPSHOTS },
  ],
  [
    'usePhraseCommands.deletePhrase',
    () => {
      const { deletePhrase } = usePhraseCommands();
      return () => deletePhrase('pl-1');
    },
    'interlinearizer.deletePhrase',
    { phraseId: 'pl-1' },
  ],
  [
    'usePhraseCommands.mergePhrases absorbing a phrase',
    () => {
      const { mergePhrases } = usePhraseCommands();
      return () => mergePhrases('pl-1', SNAPSHOTS, 'pl-2');
    },
    'interlinearizer.mergePhrases',
    { targetPhraseId: 'pl-1', tokens: SNAPSHOTS, absorbedPhraseId: 'pl-2' },
  ],
  [
    'usePhraseCommands.mergePhrases absorbing a free token',
    () => {
      const { mergePhrases } = usePhraseCommands();
      return () => mergePhrases('pl-1', SNAPSHOTS, undefined);
    },
    'interlinearizer.mergePhrases',
    { targetPhraseId: 'pl-1', tokens: SNAPSHOTS },
  ],
  [
    'usePhraseCommands.splitPhrase',
    () => {
      const { splitPhrase } = usePhraseCommands();
      return () => splitPhrase(makePhraseLink('pl-1', ['GEN 1:1:0', 'GEN 1:1:2']), 'GEN 1:1:0');
    },
    'interlinearizer.splitPhrase',
    { phraseId: 'pl-1', splitAfterTokenRef: 'GEN 1:1:0' },
  ],
  [
    'useSegmentFreeTranslationCommand adopting a stale one',
    () => {
      const write = useSegmentFreeTranslationCommand();
      return () => write('GEN 1:1', 'In the', 'At first', 'sa-old');
    },
    'interlinearizer.writeSegmentFreeTranslation',
    {
      segmentId: 'GEN 1:1',
      surfaceText: 'In the',
      value: 'At first',
      adoptStaleAnalysisId: 'sa-old',
    },
  ],
  [
    'useSegmentFreeTranslationCommand adopting none',
    () => {
      const write = useSegmentFreeTranslationCommand();
      return () => write('GEN 1:1', 'In the', 'At first');
    },
    'interlinearizer.writeSegmentFreeTranslation',
    { segmentId: 'GEN 1:1', surfaceText: 'In the', value: 'At first' },
  ],
  [
    'useStaleFreeTranslationCommands.keep',
    () => {
      const { keep } = useStaleFreeTranslationCommands();
      return () => keep('sa-old', 'GEN 1:1', 'In the');
    },
    'interlinearizer.keepStaleFreeTranslation',
    { analysisId: 'sa-old', segmentId: 'GEN 1:1', surfaceText: 'In the' },
  ],
  [
    'useStaleFreeTranslationCommands.discard',
    () => {
      const { discard } = useStaleFreeTranslationCommands();
      return () => discard('sa-old');
    },
    'interlinearizer.discardStaleFreeTranslation',
    { analysisId: 'sa-old' },
  ],
  [
    'useStaleLocationCommands.discard',
    () => {
      const { discard } = useStaleLocationCommands();
      return () => discard('ta-in', 'GEN 1:1:0');
    },
    'interlinearizer.discardStaleAnalysis',
    { analysisId: 'ta-in', tokenRef: 'GEN 1:1:0' },
  ],
  [
    'useStaleLocationCommands.reapply',
    () => {
      const { reapply } = useStaleLocationCommands();
      return () => reapply('ta-in', 'GEN 1:1:0', 'GEN 1:2:0', 'And');
    },
    'interlinearizer.reapplyStaleAnalysis',
    { analysisId: 'ta-in', staleTokenRef: 'GEN 1:1:0', tokenRef: 'GEN 1:2:0', surfaceText: 'And' },
  ],
];

describe('session edit hooks', () => {
  it.each(EDITS)('%s sends its command to the session', async (_name, useEdit, command, fields) => {
    jest.mocked(papi.commands.sendCommand).mockResolvedValue(undefined);
    const { wrapper, client } = await sessionWrapper();
    const { result } = renderHook(useEdit, { wrapper });

    await act(async () => {
      result.current();
      await client.settled();
    });

    expect(papi.commands.sendCommand).toHaveBeenCalledWith(command, {
      sessionId: 's-1',
      changeId: expect.any(String),
      ...fields,
    });
  });

  it('logs an edit the session refuses', async () => {
    jest.mocked(papi.commands.sendCommand).mockRejectedValue(new Error('read-only'));
    const { wrapper } = await sessionWrapper();
    const { result } = renderHook(() => useMorphemeDeleteCommand(), { wrapper });

    await act(async () => {
      result.current('GEN 1:1:0');
    });

    expect(logger.error).toHaveBeenCalledWith(
      'Interlinearizer: failed to remove the breakdown of GEN 1:1:0',
      expect.any(Error),
    );
  });
});

/** A reply to an edit, recorded as a catalog step leaving `survivingAnalysisId`. */
function catalogReply(survivingAnalysisId: string | undefined, extra: object = {}): string {
  return JSON.stringify({
    changeId: 'c',
    changes: { intent: 'x' },
    poolBuckets: {},
    poolAnalyses: [],
    resegmentedBooks: [],
    staleTranslationBooks: [],
    canUndo: false,
    canRedo: false,
    step: {
      summary: {
        kind: 'catalogEdit',
        form: 'In',
        analysisId: 'ta-in',
        ...(survivingAnalysisId !== undefined && { survivingAnalysisId }),
      },
    },
    ...extra,
  });
}

/** The whole analysis after an edit: "In" glossed "at" under `held`, approved once. */
const wholeHolding = (held: string): TextAnalysis => ({
  ...emptyAnalysis(),
  tokenAnalyses: [{ id: held, ...FIXTURE_STAMPS, surfaceText: 'In', gloss: { en: 'at' } }],
  tokenAnalysisLinks: [makeTokenLink(held, 'GEN 1:1:0')],
});

/** A provider whose whole analysis, once refreshed, is `after`. */
async function catalogWrapper(after: TextAnalysis) {
  const made = await sessionOver();
  const client = new PageClient({
    getOutline: () => made.fetchOutline(),
    getSegments: made.fetchPage,
  });
  await client.open();
  const whole = new WholeAnalysis(async () => ({ ...emptyDraft('src'), analysis: after }));
  const wrapper = ({ children }: { children: ReactNode }) => (
    <PageClientProvider client={client} whole={whole} sessionId="s-1" analysisLanguage="en">
      {children}
    </PageClientProvider>
  );
  return { wrapper };
}

describe('useAnalysisRowCommands', () => {
  it('reads an edit that leaves its record standing as made in place', async () => {
    jest.mocked(papi.commands.sendCommand).mockResolvedValue(catalogReply('ta-in'));
    const { wrapper } = await catalogWrapper(wholeHolding('ta-in'));
    const { result } = renderHook(() => useAnalysisRowCommands(), { wrapper });

    await expect(result.current.writeGloss('ta-in', 'at')).resolves.toStrictEqual({
      kind: 'edited',
    });
    expect(papi.commands.sendCommand).toHaveBeenCalledWith('interlinearizer.writeAnalysisGloss', {
      sessionId: 's-1',
      changeId: expect.any(String),
      analysisId: 'ta-in',
      value: 'at',
    });
  });

  it('reads an edit the session applied nothing for as made in place', async () => {
    jest.mocked(papi.commands.sendCommand).mockResolvedValue(undefined);
    const { wrapper } = await catalogWrapper(wholeHolding('ta-in'));
    const { result } = renderHook(() => useAnalysisRowCommands(), { wrapper });

    await expect(result.current.writeMorphemes('ta-in', ['I', 'n'], 'en')).resolves.toStrictEqual({
      kind: 'edited',
    });
    expect(papi.commands.sendCommand).toHaveBeenCalledWith(
      'interlinearizer.writeAnalysisMorphemes',
      expect.objectContaining({ analysisId: 'ta-in', forms: ['I', 'n'], writingSystem: 'en' }),
    );
  });

  it("reads a collapse into a sibling as a merge, with the survivor's gloss and uses", async () => {
    jest.mocked(papi.commands.sendCommand).mockResolvedValue(catalogReply('ta-other'));
    const { wrapper } = await catalogWrapper(wholeHolding('ta-other'));
    const { result } = renderHook(() => useAnalysisRowCommands(), { wrapper });

    await expect(result.current.writeMorphemeGloss('ta-in', 'm-1', 'at')).resolves.toStrictEqual({
      kind: 'merged',
      survivingAnalysisId: 'ta-other',
      survivingGloss: 'at',
      survivingUsageCount: 1,
    });
    expect(papi.commands.sendCommand).toHaveBeenCalledWith(
      'interlinearizer.writeAnalysisMorphemeGloss',
      expect.objectContaining({ analysisId: 'ta-in', morphemeId: 'm-1', value: 'at' }),
    );
  });

  it('reads an edit that left its record empty as a removal', async () => {
    jest.mocked(papi.commands.sendCommand).mockResolvedValue(catalogReply(undefined));
    const { wrapper } = await catalogWrapper(emptyAnalysis());
    const { result } = renderHook(() => useAnalysisRowCommands(), { wrapper });

    await expect(result.current.writeGloss('ta-in', '')).resolves.toStrictEqual({
      kind: 'removed',
    });
  });

  it('reads where a merge left its survivor', async () => {
    jest.mocked(papi.commands.sendCommand).mockResolvedValue(catalogReply('ta-in'));
    const { wrapper } = await catalogWrapper(wholeHolding('ta-in'));
    const { result } = renderHook(() => useAnalysisRowCommands(), { wrapper });
    const content = { gloss: 'at', morphemes: [] };

    await expect(result.current.mergeAll('ta-in', ['ta-2'], content)).resolves.toStrictEqual({
      kind: 'edited',
    });
    expect(papi.commands.sendCommand).toHaveBeenCalledWith(
      'interlinearizer.mergeAnalysesInto',
      expect.objectContaining({
        survivorAnalysisId: 'ta-in',
        mergedAnalysisIds: ['ta-2'],
        content,
      }),
    );
  });

  it('names the records a gloss clear left empty', async () => {
    jest
      .mocked(papi.commands.sendCommand)
      .mockResolvedValue(catalogReply(undefined, { emptiedAnalysisIds: ['ta-in'] }));
    const { wrapper } = await catalogWrapper(emptyAnalysis());
    const { result } = renderHook(() => useAnalysisRowCommands(), { wrapper });

    await expect(result.current.clearGlosses(['ta-in', 'ta-2'])).resolves.toStrictEqual(['ta-in']);
    expect(papi.commands.sendCommand).toHaveBeenCalledWith(
      'interlinearizer.clearAnalysisGlosses',
      expect.objectContaining({ analysisIds: ['ta-in', 'ta-2'] }),
    );
  });

  it('names no records for a gloss clear the session applied nothing for', async () => {
    jest.mocked(papi.commands.sendCommand).mockResolvedValue(undefined);
    const { wrapper } = await catalogWrapper(emptyAnalysis());
    const { result } = renderHook(() => useAnalysisRowCommands(), { wrapper });

    await expect(result.current.clearGlosses(['ta-in'])).resolves.toStrictEqual([]);
  });

  it('deletes records through the session', async () => {
    jest.mocked(papi.commands.sendCommand).mockResolvedValue(undefined);
    const { wrapper } = await catalogWrapper(emptyAnalysis());
    const { result } = renderHook(() => useAnalysisRowCommands(), { wrapper });

    await result.current.deleteAnalyses(['ta-in']);

    expect(papi.commands.sendCommand).toHaveBeenCalledWith(
      'interlinearizer.deleteAnalyses',
      expect.objectContaining({ analysisIds: ['ta-in'] }),
    );
  });

  it('logs and rejects an edit the session refuses', async () => {
    jest.mocked(papi.commands.sendCommand).mockRejectedValue(new Error('refused'));
    const { wrapper } = await catalogWrapper(emptyAnalysis());
    const { result } = renderHook(() => useAnalysisRowCommands(), { wrapper });

    await expect(result.current.deleteAnalyses(['ta-in'])).rejects.toThrow('refused');
    expect(logger.error).toHaveBeenCalledWith(
      'Interlinearizer: failed to deleteAnalyses',
      expect.any(Error),
    );
  });
});

describe('useRemovalPreviews', () => {
  it.each([
    [
      'a gloss clear',
      (previews: ReturnType<typeof useRemovalPreviews>) => previews.clearGlosses(['ta-in']),
      { intent: 'clearAnalysisGlosses', analysisIds: ['ta-in'] },
    ],
    [
      'a stale discard',
      (previews: ReturnType<typeof useRemovalPreviews>) =>
        previews.discardStale('ta-in', 'GEN 1:1:0'),
      { intent: 'discardStaleAnalysis', analysisId: 'ta-in', tokenRef: 'GEN 1:1:0' },
    ],
    [
      'a stale reapply',
      (previews: ReturnType<typeof useRemovalPreviews>) =>
        previews.reapplyStale('ta-in', 'GEN 1:1:0', 'GEN 1:2:0', 'And'),
      {
        intent: 'reapplyStaleAnalysis',
        analysisId: 'ta-in',
        staleTokenRef: 'GEN 1:1:0',
        tokenRef: 'GEN 1:2:0',
        surfaceText: 'And',
      },
    ],
  ])('asks the session what %s would remove', async (_name, preview, request) => {
    jest.mocked(papi.commands.sendCommand).mockResolvedValue('["ta-in"]');
    const { wrapper } = await catalogWrapper(emptyAnalysis());
    const { result } = renderHook(() => useRemovalPreviews(), { wrapper });

    await expect(preview(result.current)).resolves.toStrictEqual(['ta-in']);
    expect(papi.commands.sendCommand).toHaveBeenCalledWith('interlinearizer.previewRemovals', {
      sessionId: 's-1',
      request,
    });
  });
});
