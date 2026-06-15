/** @file Unit tests for DiscardDraftConfirm. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocalizedStrings } from '@papi/frontend/react';
import { DiscardDraftConfirm } from '../../../components/modals/DiscardDraftConfirm';

const LOCALIZED: Record<string, string> = {
  '%interlinearizer_confirm_discard_title%': 'Discard unsaved changes?',
  '%interlinearizer_confirm_discard_body%': 'The current draft has unsaved work.',
  '%interlinearizer_confirm_discard_ok%': 'Discard',
  '%interlinearizer_confirm_discard_cancel%': 'Cancel',
};

const defaultProps = {
  onConfirm: jest.fn(),
  onCancel: jest.fn(),
};

describe('DiscardDraftConfirm', () => {
  beforeEach(() => {
    jest.mocked(useLocalizedStrings).mockReturnValue([LOCALIZED, false]);
  });

  it('renders the discard title and body', () => {
    render(<DiscardDraftConfirm {...defaultProps} />);

    expect(screen.getByRole('heading', { name: 'Discard unsaved changes?' })).toBeInTheDocument();
    expect(screen.getByText('The current draft has unsaved work.')).toBeInTheDocument();
  });

  it('calls onConfirm when the discard-draft-confirm button is clicked', async () => {
    const onConfirm = jest.fn();
    render(<DiscardDraftConfirm {...defaultProps} onConfirm={onConfirm} />);

    await userEvent.click(screen.getByTestId('discard-draft-confirm'));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when the Cancel button is clicked', async () => {
    const onCancel = jest.fn();
    render(<DiscardDraftConfirm {...defaultProps} onCancel={onCancel} />);

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
