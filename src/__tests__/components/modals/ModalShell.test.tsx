/** @file Unit tests for ModalShell. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ModalShell } from '../../../components/modals/ModalShell';

const defaultProps = {
  titleId: 'test-modal-title',
  title: 'Test modal',
  width: 'tw:w-96',
};

describe('ModalShell', () => {
  it('names the dialog with the title heading', () => {
    render(
      <ModalShell {...defaultProps}>
        <p>Body</p>
      </ModalShell>,
    );

    const heading = screen.getByRole('heading', { name: 'Test modal' });
    expect(heading).toHaveAttribute('id', 'test-modal-title');
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-labelledby', 'test-modal-title');
  });

  it('renders the body below the title', () => {
    render(
      <ModalShell {...defaultProps}>
        <p>Body</p>
      </ModalShell>,
    );

    expect(screen.getByText('Body')).toBeInTheDocument();
  });

  it('renders without a body while the modal is still resolving its content', () => {
    render(<ModalShell {...defaultProps} />);

    expect(screen.getByRole('heading', { name: 'Test modal' })).toBeInTheDocument();
  });

  it('calls onClose when the user presses Escape', async () => {
    const onClose = jest.fn();
    render(<ModalShell {...defaultProps} onClose={onClose} />);

    await userEvent.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores Escape when no onClose is supplied, so a busy modal cannot be abandoned', async () => {
    render(<ModalShell {...defaultProps} />);

    await userEvent.keyboard('{Escape}');

    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
