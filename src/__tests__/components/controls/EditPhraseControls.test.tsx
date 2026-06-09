/** @file Unit tests for components/EditPhraseControls.tsx. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import type { PhraseAnalysisLink } from 'interlinearizer';
import EditPhraseControls from '../../../components/controls/EditPhraseControls';
import type { PhraseMode } from '../../../types/phrase-mode';
import { makePhraseLink } from '../../test-helpers';

const mockUsePhraseLinkByIdMap = jest.fn<Map<string, PhraseAnalysisLink>, []>();

// AnalysisStore is exercised by its own dedicated suite. EditPhraseControls only reads the live
// phrase's token count via usePhraseLinkByIdMap, so we stub that single hook rather than driving
// the real provider (which would pull AnalysisStore into this suite's coverage).
jest.mock('../../../components/AnalysisStore', () => ({
  __esModule: true,
  usePhraseLinkByIdMap: () => mockUsePhraseLinkByIdMap(),
}));

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
   * Builds the phrase-link map the component reads via `usePhraseLinkByIdMap`, seeded with a phrase
   * link for `phrase-1` containing `tokenCount` tokens so the live phrase has a known size. A
   * `tokenCount` of `0` returns an empty map, so the component sees the phrase as absent.
   *
   * @param tokenCount - Number of tokens to place in the seeded phrase link; `0` omits the link.
   * @returns A map from phrase id to its `PhraseAnalysisLink`, empty when `tokenCount` is `0`.
   */
  function makePhraseLinkByIdMap(tokenCount: number): Map<string, PhraseAnalysisLink> {
    if (tokenCount === 0) return new Map();
    const tokenRefs = Array.from({ length: tokenCount }, (_, i) => `tok-${i + 1}`);
    return new Map([['phrase-1', makePhraseLink('phrase-1', tokenRefs)]]);
  }

  /**
   * Renders `EditPhraseControls` with the phrase-link map stubbed to a phrase of the given size.
   *
   * @param tokenCount - Number of tokens in the seeded phrase.
   * @param setPhraseMode - Setter spy passed to the component.
   * @returns The rendered element tree.
   */
  function renderWithPhraseSize(tokenCount: number, setPhraseMode: jest.Mock): ReactElement {
    mockUsePhraseLinkByIdMap.mockReturnValue(makePhraseLinkByIdMap(tokenCount));
    return <EditPhraseControls phraseMode={PHRASE_MODE} setPhraseMode={setPhraseMode} />;
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
