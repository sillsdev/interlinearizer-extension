/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { useLocalizedStrings } from '@papi/frontend/react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UnlinkPhraseConfirm from '../../../components/modals/UnlinkPhraseConfirm';
import { localizedStringsFromContributions } from '../../test-helpers';

/** Stable mock fns for AnalysisStore phrase dispatch. */
const mockDeletePhrase = jest.fn();
const mockUsePhraseDispatch = jest.fn().mockReturnValue({
  createPhrase: jest.fn(),
  updatePhrase: jest.fn(),
  deletePhrase: mockDeletePhrase,
});

jest.mock('../../../components/AnalysisStore', () => ({
  __esModule: true,
  usePhraseDispatch: () => mockUsePhraseDispatch(),
}));

describe('UnlinkPhraseConfirm', () => {
  beforeEach(() => {
    jest.mocked(useLocalizedStrings).mockImplementation(localizedStringsFromContributions);
    mockUsePhraseDispatch.mockReturnValue({
      createPhrase: jest.fn(),
      updatePhrase: jest.fn(),
      deletePhrase: mockDeletePhrase,
    });
  });

  it('renders the unlink confirmation container', () => {
    render(<UnlinkPhraseConfirm phraseId="phrase-1" setPhraseMode={jest.fn()} />);

    expect(screen.getByTestId('unlink-confirm')).toBeInTheDocument();
    expect(screen.getByText('Unlink this phrase?')).toBeInTheDocument();
  });

  it('renders Unlink and Cancel buttons', () => {
    render(<UnlinkPhraseConfirm phraseId="phrase-1" setPhraseMode={jest.fn()} />);

    expect(screen.getByTestId('unlink-confirm-yes')).toBeInTheDocument();
    expect(screen.getByTestId('unlink-confirm-cancel')).toBeInTheDocument();
  });

  it('calls deletePhrase and setPhraseMode with view when Unlink is clicked', async () => {
    const setPhraseMode = jest.fn();
    render(<UnlinkPhraseConfirm phraseId="phrase-1" setPhraseMode={setPhraseMode} />);

    await userEvent.click(screen.getByTestId('unlink-confirm-yes'));

    expect(mockDeletePhrase).toHaveBeenCalledWith('phrase-1');
    expect(setPhraseMode).toHaveBeenCalledWith({ kind: 'view' });
  });

  it('calls setPhraseMode with view and does not delete when Cancel is clicked', async () => {
    const setPhraseMode = jest.fn();
    render(<UnlinkPhraseConfirm phraseId="phrase-1" setPhraseMode={setPhraseMode} />);

    await userEvent.click(screen.getByTestId('unlink-confirm-cancel'));

    expect(mockDeletePhrase).not.toHaveBeenCalled();
    expect(setPhraseMode).toHaveBeenCalledWith({ kind: 'view' });
  });
});
