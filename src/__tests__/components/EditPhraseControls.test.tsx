/** @file Unit tests for components/EditPhraseControls.tsx. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EditPhraseControls from '../../components/EditPhraseControls';

describe('EditPhraseControls', () => {
  const PHRASE_MODE = {
    kind: 'edit' as const,
    phraseId: 'phrase-1',
    originalTokens: [{ tokenRef: 'tok-1', surfaceText: 'Hello' }],
  };

  it('renders Done and Cancel buttons', () => {
    render(<EditPhraseControls phraseMode={PHRASE_MODE} setPhraseMode={jest.fn()} />);
    expect(screen.getByTestId('done-edit-btn')).toBeInTheDocument();
    expect(screen.getByTestId('cancel-phrase-btn')).toBeInTheDocument();
  });

  it('clicking Done calls setPhraseMode with view mode', async () => {
    const setPhraseMode = jest.fn();
    render(<EditPhraseControls phraseMode={PHRASE_MODE} setPhraseMode={setPhraseMode} />);

    await userEvent.click(screen.getByTestId('done-edit-btn'));

    expect(setPhraseMode).toHaveBeenCalledWith({ kind: 'view' });
  });

  it('clicking Cancel calls setPhraseMode with revert: true', async () => {
    const setPhraseMode = jest.fn();
    render(<EditPhraseControls phraseMode={PHRASE_MODE} setPhraseMode={setPhraseMode} />);

    await userEvent.click(screen.getByTestId('cancel-phrase-btn'));

    expect(setPhraseMode).toHaveBeenCalledWith({ ...PHRASE_MODE, revert: true });
  });
});
