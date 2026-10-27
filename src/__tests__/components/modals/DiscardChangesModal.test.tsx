/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocalizedStrings } from '@papi/frontend/react';
import { DiscardChangesModal } from '../../../components/modals/DiscardChangesModal';

const LOCALIZED: Record<string, string> = {
  '%interlinearizer_discardChanges_modal_title%': 'Discard unsaved changes',
  '%interlinearizer_discardChanges_modal_prompt%': 'Choose how much to discard.',
  '%interlinearizer_discardChanges_modal_scope_book%': 'Current book',
  '%interlinearizer_discardChanges_modal_scope_book_description%': 'Discards the current book.',
  '%interlinearizer_discardChanges_modal_scope_all%': 'Entire draft',
  '%interlinearizer_discardChanges_modal_scope_all_description%': 'Discards the whole draft.',
  '%interlinearizer_discardChanges_modal_confirm%': 'Discard',
  '%interlinearizer_discardChanges_modal_cancel%': 'Cancel',
};

const defaultProps = {
  hasActiveBook: true,
  onConfirm: jest.fn(),
  onCancel: jest.fn(),
};

describe('DiscardChangesModal', () => {
  beforeEach(() => {
    jest.mocked(useLocalizedStrings).mockReturnValue([LOCALIZED, false]);
  });

  it('renders the title, prompt, and both scope options', () => {
    render(<DiscardChangesModal {...defaultProps} />);

    expect(screen.getByRole('heading', { name: 'Discard unsaved changes' })).toBeInTheDocument();
    expect(screen.getByText('Choose how much to discard.')).toBeInTheDocument();
    expect(screen.getByText('Current book')).toBeInTheDocument();
    expect(screen.getByText('Discards the current book.')).toBeInTheDocument();
    expect(screen.getByText('Entire draft')).toBeInTheDocument();
    expect(screen.getByText('Discards the whole draft.')).toBeInTheDocument();
  });

  it('defaults to the current-book scope when a book is loaded and confirms with "book"', async () => {
    const onConfirm = jest.fn();
    render(<DiscardChangesModal {...defaultProps} onConfirm={onConfirm} />);

    expect(screen.getByTestId('discard-changes-scope-book')).toBeChecked();
    expect(screen.getByTestId('discard-changes-scope-all')).not.toBeChecked();

    await userEvent.click(screen.getByTestId('discard-changes-confirm'));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith('book');
  });

  it('confirms with "all" when the entire-draft scope is selected', async () => {
    const onConfirm = jest.fn();
    render(<DiscardChangesModal {...defaultProps} onConfirm={onConfirm} />);

    await userEvent.click(screen.getByTestId('discard-changes-scope-all'));
    expect(screen.getByTestId('discard-changes-scope-all')).toBeChecked();

    await userEvent.click(screen.getByTestId('discard-changes-confirm'));

    expect(onConfirm).toHaveBeenCalledWith('all');
  });

  it('lets the user switch back to the current-book scope after picking the whole draft', async () => {
    const onConfirm = jest.fn();
    render(<DiscardChangesModal {...defaultProps} onConfirm={onConfirm} />);

    await userEvent.click(screen.getByTestId('discard-changes-scope-all'));
    await userEvent.click(screen.getByTestId('discard-changes-scope-book'));
    expect(screen.getByTestId('discard-changes-scope-book')).toBeChecked();

    await userEvent.click(screen.getByTestId('discard-changes-confirm'));

    expect(onConfirm).toHaveBeenCalledWith('book');
  });

  it('disables the current-book scope and defaults to the whole draft when no book is loaded', async () => {
    const onConfirm = jest.fn();
    render(<DiscardChangesModal {...defaultProps} hasActiveBook={false} onConfirm={onConfirm} />);

    expect(screen.getByTestId('discard-changes-scope-book')).toBeDisabled();
    expect(screen.getByTestId('discard-changes-scope-all')).toBeChecked();

    await userEvent.click(screen.getByTestId('discard-changes-confirm'));

    expect(onConfirm).toHaveBeenCalledWith('all');
  });

  it('disables both buttons while submitting', () => {
    render(<DiscardChangesModal {...defaultProps} isSubmitting />);

    expect(screen.getByTestId('discard-changes-confirm')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });

  it('calls onCancel when Escape is pressed', async () => {
    const onCancel = jest.fn();
    render(<DiscardChangesModal {...defaultProps} onCancel={onCancel} />);

    await userEvent.keyboard('{Escape}');

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('ignores Escape while submitting', async () => {
    const onCancel = jest.fn();
    render(<DiscardChangesModal {...defaultProps} isSubmitting onCancel={onCancel} />);

    await userEvent.keyboard('{Escape}');

    expect(onCancel).not.toHaveBeenCalled();
  });

  it('calls onCancel when the Cancel button is clicked', async () => {
    const onCancel = jest.fn();
    render(<DiscardChangesModal {...defaultProps} onCancel={onCancel} />);

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
