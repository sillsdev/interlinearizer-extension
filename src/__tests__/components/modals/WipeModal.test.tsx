/** @file Unit tests for WipeModal. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocalizedStrings } from '@papi/frontend/react';
import { WipeModal } from '../../../components/modals/WipeModal';

const LOCALIZED: Record<string, string> = {
  '%interlinearizer_wipe_modal_title%': 'Wipe draft analysis',
  '%interlinearizer_wipe_modal_prompt%': 'Choose how much of the draft to remove.',
  '%interlinearizer_wipe_modal_scope_book%': 'Current book',
  '%interlinearizer_wipe_modal_scope_book_description%': 'Removes the current book.',
  '%interlinearizer_wipe_modal_scope_all%': 'Entire draft',
  '%interlinearizer_wipe_modal_scope_all_description%': 'Removes the whole draft.',
  '%interlinearizer_wipe_modal_confirm%': 'Wipe',
  '%interlinearizer_wipe_modal_cancel%': 'Cancel',
};

const defaultProps = {
  hasActiveBook: true,
  onConfirm: jest.fn(),
  onCancel: jest.fn(),
};

describe('WipeModal', () => {
  beforeEach(() => {
    jest.mocked(useLocalizedStrings).mockReturnValue([LOCALIZED, false]);
  });

  it('renders the title, prompt, and both scope options', () => {
    render(<WipeModal {...defaultProps} />);

    expect(screen.getByRole('heading', { name: 'Wipe draft analysis' })).toBeInTheDocument();
    expect(screen.getByText('Choose how much of the draft to remove.')).toBeInTheDocument();
    expect(screen.getByText('Current book')).toBeInTheDocument();
    expect(screen.getByText('Removes the current book.')).toBeInTheDocument();
    expect(screen.getByText('Entire draft')).toBeInTheDocument();
    expect(screen.getByText('Removes the whole draft.')).toBeInTheDocument();
  });

  it('defaults to the current-book scope when a book is loaded and confirms with "book"', async () => {
    const onConfirm = jest.fn();
    render(<WipeModal {...defaultProps} onConfirm={onConfirm} />);

    expect(screen.getByTestId('wipe-scope-book')).toBeChecked();
    expect(screen.getByTestId('wipe-scope-all')).not.toBeChecked();

    await userEvent.click(screen.getByTestId('wipe-confirm'));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith('book');
  });

  it('confirms with "all" when the entire-draft scope is selected', async () => {
    const onConfirm = jest.fn();
    render(<WipeModal {...defaultProps} onConfirm={onConfirm} />);

    await userEvent.click(screen.getByTestId('wipe-scope-all'));
    expect(screen.getByTestId('wipe-scope-all')).toBeChecked();

    await userEvent.click(screen.getByTestId('wipe-confirm'));

    expect(onConfirm).toHaveBeenCalledWith('all');
  });

  it('lets the user switch back to the current-book scope after picking the whole draft', async () => {
    const onConfirm = jest.fn();
    render(<WipeModal {...defaultProps} onConfirm={onConfirm} />);

    await userEvent.click(screen.getByTestId('wipe-scope-all'));
    await userEvent.click(screen.getByTestId('wipe-scope-book'));
    expect(screen.getByTestId('wipe-scope-book')).toBeChecked();

    await userEvent.click(screen.getByTestId('wipe-confirm'));

    expect(onConfirm).toHaveBeenCalledWith('book');
  });

  it('disables the current-book scope and defaults to the whole draft when no book is loaded', async () => {
    const onConfirm = jest.fn();
    render(<WipeModal {...defaultProps} hasActiveBook={false} onConfirm={onConfirm} />);

    expect(screen.getByTestId('wipe-scope-book')).toBeDisabled();
    expect(screen.getByTestId('wipe-scope-all')).toBeChecked();

    await userEvent.click(screen.getByTestId('wipe-confirm'));

    expect(onConfirm).toHaveBeenCalledWith('all');
  });

  it('calls onCancel when the Cancel button is clicked', async () => {
    const onCancel = jest.fn();
    render(<WipeModal {...defaultProps} onCancel={onCancel} />);

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
