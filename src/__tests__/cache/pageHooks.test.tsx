/// <reference types="jest" />

import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { TextAnalysis } from 'interlinearizer';
import { PageClient } from '../../cache/pageClient';
import { WholeAnalysis } from '../../cache/wholeAnalysis';
import { PageClientProvider, usePageSelector } from '../../cache/pageHooks';
import { selectApprovedGlossSenseRef, selectPhraseSenseRef } from '../../store/analysisSlice';
import { FIXTURE_STAMPS, makePhraseLink, makeTokenLink } from '../test-helpers';
import { glossing, ref, sessionOver } from './session-source';

const SENSE = { authority: 'fwlite', senseId: 's-god' };

/** "God" approved with a payload whose gloss resolves through {@link SENSE}. */
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

/**
 * A session with a client over its pages, one segment to a page and every page loaded. The returned
 * `wrapper` provides the client and the session's whole draft.
 */
async function loadedClientOver(analysis: Partial<TextAnalysis>) {
  const made = await sessionOver(analysis);
  const client = new PageClient(
    { getOutline: () => made.fetchOutline(), getSegments: made.fetchPage },
    { pageSize: 1, retryDelaysMs: [0], wait: async () => {} },
  );
  made.onChange((change) => client.hear(change));
  await client.open();
  client.load(0, 3, 'list');
  await client.settled();
  const whole = new WholeAnalysis(() =>
    made.sessions.run(made.sessionId, (session) => session.repository.getWholeDraft()),
  );
  await whole.refresh();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <PageClientProvider
      client={client}
      whole={whole}
      sessionId={made.sessionId}
      analysisLanguage="en"
    >
      {children}
    </PageClientProvider>
  );
  return { ...made, client, whole, wrapper };
}

describe('usePageSelector', () => {
  it("reads the sense ref on a held token's approved payload", async () => {
    const { wrapper } = await loadedClientOver(GOD_WITH_SENSE);

    const { result } = renderHook(
      () => usePageSelector((state) => selectApprovedGlossSenseRef(state, ref('God'))),
      { wrapper },
    );

    expect(result.current).toStrictEqual(SENSE);
  });

  it('reads no sense ref for a token with no approved payload', async () => {
    const { wrapper } = await loadedClientOver(GOD_WITH_SENSE);

    const { result } = renderHook(
      () => usePageSelector((state) => selectApprovedGlossSenseRef(state, ref('earth'))),
      { wrapper },
    );

    expect(result.current).toBeUndefined();
  });

  it('reads the sense ref a command reply clears', async () => {
    const { wrapper, client, edit } = await loadedClientOver(GOD_WITH_SENSE);
    const { result } = renderHook(
      () => usePageSelector((state) => selectApprovedGlossSenseRef(state, ref('God'))),
      { wrapper },
    );

    await act(() =>
      client.send((changeId) =>
        edit(
          'clearSense',
          async (buffer) => {
            const [payload] = await buffer.getTokenAnalyses(['ta-god']);
            delete payload.glossSenseRef;
            buffer.put('tokenAnalyses', payload);
          },
          changeId,
        ),
      ),
    );

    expect(result.current).toBeUndefined();
  });
});

/** "the beginning" as one phrase, whose payload resolves through {@link SENSE}. */
const PHRASE_WITH_SENSE: Partial<TextAnalysis> = {
  phraseAnalyses: [
    { id: 'pa-beginning', ...FIXTURE_STAMPS, surfaceText: 'the beginning', senseRef: SENSE },
  ],
  phraseAnalysisLinks: [
    {
      ...makePhraseLink('pl-beginning', [ref('the'), ref('beginning')], ['the', 'beginning']),
      analysisId: 'pa-beginning',
    },
  ],
};

describe('usePageSelector over phrases', () => {
  it("reads the sense ref on a held phrase's payload", async () => {
    const { wrapper } = await loadedClientOver(PHRASE_WITH_SENSE);

    const { result } = renderHook(
      () => usePageSelector((state) => selectPhraseSenseRef(state, 'pl-beginning')),
      { wrapper },
    );

    expect(result.current).toStrictEqual(SENSE);
  });

  it('reads no sense ref for a phrase not held', async () => {
    const { wrapper } = await loadedClientOver(PHRASE_WITH_SENSE);

    const { result } = renderHook(
      () => usePageSelector((state) => selectPhraseSenseRef(state, 'pl-missing')),
      { wrapper },
    );

    expect(result.current).toBeUndefined();
  });
});

describe('usePageSelector re-rendering', () => {
  it('keeps its answer, unrendered, through a change that leaves it equal', async () => {
    const { wrapper, client, edit } = await loadedClientOver(GOD_WITH_SENSE);
    let renders = 0;
    const { result } = renderHook(
      () => {
        renders += 1;
        return usePageSelector(
          (state) => selectApprovedGlossSenseRef(state, ref('God')),
          (a, b) => a?.senseId === b?.senseId,
        );
      },
      { wrapper },
    );
    const before = result.current;
    const rendersBefore = renders;

    await act(() =>
      client.send((changeId) => edit('writeGloss', glossing('earth', 'land'), changeId)),
    );

    expect(result.current).toBe(before);
    expect(renders).toBe(rendersBefore);
  });

  it('throws outside a PageClientProvider', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => renderHook(() => usePageSelector(() => 1))).toThrow(
      'page hooks need a PageClientProvider',
    );
  });
});
