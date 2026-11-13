/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocalizedStrings } from '@papi/frontend/react';
import { RetagGlossesConfirm } from '../../../components/modals/RetagGlossesConfirm';

const LOCALIZED: Record<string, string> = {
  '%interlinearizer_confirm_retag_title%': 'Move glosses to {to}?',
  '%interlinearizer_confirm_retag_body%': '{from} was removed. Move its glosses to {to}?',
  '%interlinearizer_confirm_retag_noUndo%': "This can't be undone.",
  '%interlinearizer_confirm_retag_ok%': 'Move to {to}',
  '%interlinearizer_confirm_retag_cancel%': 'Keep in {from}',
};

const defaultProps = {
  from: 'en',
  to: 'fr',
  onConfirm: jest.fn(),
  onCancel: jest.fn(),
};

describe('RetagGlossesConfirm', () => {
  beforeEach(() => {
    jest.mocked(useLocalizedStrings).mockReturnValue([LOCALIZED, false]);
  });

  it('names both languages and warns that the move cannot be undone', () => {
    render(<RetagGlossesConfirm {...defaultProps} />);

    expect(screen.getByRole('heading', { name: 'Move glosses to fr?' })).toBeInTheDocument();
    expect(screen.getByText('en was removed. Move its glosses to fr?')).toBeInTheDocument();
    expect(screen.getByTestId('retag-glosses-no-undo')).toHaveTextContent("This can't be undone.");
  });

  it('calls onConfirm when Move is clicked', async () => {
    const onConfirm = jest.fn();
    render(<RetagGlossesConfirm {...defaultProps} onConfirm={onConfirm} />);

    await userEvent.click(screen.getByRole('button', { name: 'Move to fr' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when Keep is clicked', async () => {
    const onCancel = jest.fn();
    render(<RetagGlossesConfirm {...defaultProps} onCancel={onCancel} />);

    await userEvent.click(screen.getByRole('button', { name: 'Keep in en' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('disables both buttons while submitting', () => {
    render(<RetagGlossesConfirm {...defaultProps} isSubmitting />);

    expect(screen.getByRole('button', { name: 'Move to fr' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Keep in en' })).toBeDisabled();
  });
});
