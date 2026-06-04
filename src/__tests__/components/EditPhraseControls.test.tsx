/** @file Unit tests for components/EditPhraseControls.tsx. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import type { TextAnalysis } from 'interlinearizer';
import EditPhraseControls from '../../components/controls/EditPhraseControls';
import { AnalysisStoreProvider } from '../../components/AnalysisStore';
import { defaultAnalysis } from '../../store/analysisSlice';
import type { PhraseMode } from '../../types/phrase-mode';
import { makePhraseLink } from '../test-helpers';

describe('EditPhraseControls', () => {
  const PHRASE_MODE: Extract<PhraseMode, { kind: 'edit' }> = {
    kind: 'edit',
    phraseId: 'phrase-1',
    originalTokens: [
      { tokenRef: 'tok-1', surfaceText: 'Hello' },
      { tokenRef: 'tok-2', surfaceText: 'World' },
    ],
  };

  /**
   * Builds a `TextAnalysis` seeded with an approved phrase link for `phrase-1` containing
   * `tokenCount` tokens, so the live phrase the component reads has a known size. A `tokenCount` of
   * `0` seeds no link at all, so the component sees the phrase as absent from the store.
   *
   * @param tokenCount - Number of tokens to place in the seeded phrase link; `0` omits the link.
   * @returns A `TextAnalysis` with one approved phrase link of the requested size, or no link.
   */
  function makeAnalysisWithPhraseSize(tokenCount: number): TextAnalysis {
    if (tokenCount === 0) return defaultAnalysis;
    const tokenRefs = Array.from({ length: tokenCount }, (_, i) => `tok-${i + 1}`);
    return {
      ...defaultAnalysis,
      phraseAnalyses: [{ id: 'phrase-1', surfaceText: 'phrase' }],
      phraseAnalysisLinks: [makePhraseLink('phrase-1', tokenRefs)],
    };
  }

  /**
   * Renders `EditPhraseControls` inside an `AnalysisStoreProvider` seeded with a phrase of the
   * given size.
   *
   * @param tokenCount - Number of tokens in the seeded phrase.
   * @param setPhraseMode - Setter spy passed to the component.
   * @returns The rendered element tree.
   */
  function renderWithPhraseSize(tokenCount: number, setPhraseMode: jest.Mock): ReactElement {
    return (
      <AnalysisStoreProvider
        analysisLanguage="und"
        initialAnalysis={makeAnalysisWithPhraseSize(tokenCount)}
      >
        <EditPhraseControls phraseMode={PHRASE_MODE} setPhraseMode={setPhraseMode} />
      </AnalysisStoreProvider>
    );
  }

  it('renders Done and Cancel buttons', () => {
    render(renderWithPhraseSize(2, jest.fn()));
    expect(screen.getByTestId('done-edit-btn')).toBeInTheDocument();
    expect(screen.getByTestId('cancel-phrase-btn')).toBeInTheDocument();
  });

  it('Done is enabled and commits view mode for a 2+-token phrase', async () => {
    const setPhraseMode = jest.fn();
    render(renderWithPhraseSize(2, setPhraseMode));

    expect(screen.getByTestId('done-edit-btn')).toBeEnabled();
    await userEvent.click(screen.getByTestId('done-edit-btn'));

    expect(setPhraseMode).toHaveBeenCalledWith({ kind: 'view' });
  });

  it('Done is disabled for a 1-token phrase', () => {
    render(renderWithPhraseSize(1, jest.fn()));

    expect(screen.getByTestId('done-edit-btn')).toBeDisabled();
  });

  it('Done is disabled when the phrase is absent from the store', () => {
    render(renderWithPhraseSize(0, jest.fn()));

    expect(screen.getByTestId('done-edit-btn')).toBeDisabled();
  });

  it('clicking Cancel calls setPhraseMode with revert: true', async () => {
    const setPhraseMode = jest.fn();
    render(renderWithPhraseSize(2, setPhraseMode));

    await userEvent.click(screen.getByTestId('cancel-phrase-btn'));

    expect(setPhraseMode).toHaveBeenCalledWith({ ...PHRASE_MODE, revert: true });
  });
});
