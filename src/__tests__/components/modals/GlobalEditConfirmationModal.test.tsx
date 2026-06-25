/** @file Unit tests for GlobalEditConfirmationModal. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocalizedStrings } from '@papi/frontend/react';
import { GlobalEditConfirmationModal } from '../../../components/modals/GlobalEditConfirmationModal';

const LOCALIZED: Record<string, string> = {
  '%interlinearizer_globalEdit_title%': 'Update analysis used by {count} tokens?',
  '%interlinearizer_globalEdit_body%': 'This analysis is shared by {count} tokens.',
  '%interlinearizer_globalEdit_updateAll%': 'Update all {count}',
  '%interlinearizer_globalEdit_fork%': 'Make a separate analysis for just this one',
  '%interlinearizer_globalEdit_cancel%': 'Cancel',
};

const defaultProps = {
  count: 3,
  onUpdateAll: jest.fn(),
  onForkInstead: jest.fn(),
  onCancel: jest.fn(),
};

describe('GlobalEditConfirmationModal', () => {
  beforeEach(() => {
    jest.mocked(useLocalizedStrings).mockReturnValue([LOCALIZED, false]);
  });

  it('renders the title, body, and update-all button with the token count substituted', () => {
    render(<GlobalEditConfirmationModal {...defaultProps} count={4} />);

    expect(
      screen.getByRole('heading', { name: 'Update analysis used by 4 tokens?' }),
    ).toBeInTheDocument();
    expect(screen.getByText('This analysis is shared by 4 tokens.')).toBeInTheDocument();
    expect(screen.getByTestId('global-edit-update-all')).toHaveTextContent('Update all 4');
  });

  it('calls onUpdateAll when the update-all button is clicked', async () => {
    const onUpdateAll = jest.fn();
    render(<GlobalEditConfirmationModal {...defaultProps} onUpdateAll={onUpdateAll} />);

    await userEvent.click(screen.getByTestId('global-edit-update-all'));

    expect(onUpdateAll).toHaveBeenCalledTimes(1);
  });

  it('calls onForkInstead when the make-separate button is clicked', async () => {
    const onForkInstead = jest.fn();
    render(<GlobalEditConfirmationModal {...defaultProps} onForkInstead={onForkInstead} />);

    await userEvent.click(screen.getByTestId('global-edit-fork'));

    expect(onForkInstead).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when the cancel button is clicked', async () => {
    const onCancel = jest.fn();
    render(<GlobalEditConfirmationModal {...defaultProps} onCancel={onCancel} />);

    await userEvent.click(screen.getByTestId('global-edit-cancel'));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
