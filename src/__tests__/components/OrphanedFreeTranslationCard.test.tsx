/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import OrphanedFreeTranslationCard from '../../components/OrphanedFreeTranslationCard';
import type { StaleFreeTranslation } from '../../utils/stale-free-translations';

const mockDiscard = jest.fn();

jest.mock('../../components/AnalysisStore', () => ({
  __esModule: true,
  useStaleFreeTranslationDispatch: () => ({ keep: jest.fn(), discard: mockDiscard }),
}));

jest.mock('../../utils/stale-free-translations', () => ({
  __esModule: true,
  verseLabelOf: (segmentId: string) => `verse of ${segmentId}`,
}));

const STRINGS = {
  '%interlinearizer_freeTranslationInput_orphaned%': 'Gone: {verse}',
  '%interlinearizer_freeTranslationInput_staleDiscard%': 'Discard',
  '%interlinearizer_freeTranslationInput_staleNoText%': '(none)',
};

/** Renders the card for a translation of a piece of GEN 1:5 split off mid-verse, reading `text`. */
function renderCard(text = 'Au début') {
  const translation: StaleFreeTranslation = { analysisId: 'sa-1', segmentId: 'GEN 1:5:12', text };
  return render(
    <OrphanedFreeTranslationCard translation={translation} localizedStrings={STRINGS} />,
  );
}

describe('OrphanedFreeTranslationCard', () => {
  it('names the verse the translation was written for', () => {
    renderCard();

    expect(screen.getByTestId('orphaned-free-translation')).toHaveTextContent(
      'Gone: verse of GEN 1:5:12',
    );
  });

  it("shows the translation's text", () => {
    renderCard();

    expect(screen.getByTestId('orphaned-free-translation')).toHaveTextContent('Au début');
  });

  it('shows the placeholder for a translation with no text in the language', () => {
    renderCard('');

    expect(screen.getByTestId('orphaned-free-translation')).toHaveTextContent('(none)');
  });

  it('discards the translation', async () => {
    renderCard();

    await userEvent.click(screen.getByTestId('orphaned-free-translation-discard'));

    expect(mockDiscard).toHaveBeenCalledWith('sa-1');
  });

  it('offers nothing to do with the translation but discard it', () => {
    renderCard();

    expect(screen.getAllByRole('button')).toHaveLength(1);
  });
});
