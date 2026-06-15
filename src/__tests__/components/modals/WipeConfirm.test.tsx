/** @file Unit tests for WipeConfirm. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocalizedStrings } from '@papi/frontend/react';
import { WipeConfirm } from '../../../components/modals/WipeConfirm';

const LOCALIZED: Record<string, string> = {
  '%interlinearizer_confirm_wipe_book_title%': 'Wipe this book?',
  '%interlinearizer_confirm_wipe_book_body%': 'This removes the analysis from the current book.',
  '%interlinearizer_confirm_wipe_draft_title%': 'Wipe the entire draft?',
  '%interlinearizer_confirm_wipe_draft_body%': 'This removes the analysis from the whole draft.',
  '%interlinearizer_confirm_wipe_ok%': 'Wipe',
  '%interlinearizer_confirm_wipe_cancel%': 'Cancel',
};

const defaultProps = {
  scope: 'book' as const,
  onConfirm: jest.fn(),
  onCancel: jest.fn(),
};

describe('WipeConfirm', () => {
  beforeEach(() => {
    jest.mocked(useLocalizedStrings).mockReturnValue([LOCALIZED, false]);
  });

  it('renders the book title and body when scope is "book"', () => {
    render(<WipeConfirm {...defaultProps} scope="book" />);

    expect(screen.getByRole('heading', { name: 'Wipe this book?' })).toBeInTheDocument();
    expect(
      screen.getByText('This removes the analysis from the current book.'),
    ).toBeInTheDocument();
  });

  it('renders the draft title and body when scope is "all"', () => {
    render(<WipeConfirm {...defaultProps} scope="all" />);

    expect(screen.getByRole('heading', { name: 'Wipe the entire draft?' })).toBeInTheDocument();
    expect(screen.getByText('This removes the analysis from the whole draft.')).toBeInTheDocument();
  });

  it('calls onConfirm when the wipe-confirm button is clicked', async () => {
    const onConfirm = jest.fn();
    render(<WipeConfirm {...defaultProps} onConfirm={onConfirm} />);

    await userEvent.click(screen.getByTestId('wipe-confirm'));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when the Cancel button is clicked', async () => {
    const onCancel = jest.fn();
    render(<WipeConfirm {...defaultProps} onCancel={onCancel} />);

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
