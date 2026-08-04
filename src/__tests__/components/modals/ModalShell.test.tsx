/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ModalShell } from '../../../components/modals/ModalShell';

const defaultProps = {
  titleTestId: 'test-modal-title',
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

    // The platform dialog generates the heading's id and aims its own `aria-labelledby` at it, so
    // the shell must leave both alone; overriding the id makes the dialog report a missing title.
    const heading = screen.getByRole('heading', { name: 'Test modal' });
    expect(heading.id).toBeTruthy();
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-labelledby', heading.id);
  });

  it('tags the title with the test id end-to-end tests locate the modal by', () => {
    render(<ModalShell {...defaultProps} />);

    expect(screen.getByTestId('test-modal-title')).toHaveTextContent('Test modal');
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

  it('dismisses only the topmost modal on Escape when one overlays another', async () => {
    const onCloseUnder = jest.fn();
    const onCloseOver = jest.fn();
    render(
      <>
        <ModalShell {...defaultProps} onClose={onCloseUnder} />
        <ModalShell
          {...defaultProps}
          titleTestId="overlay-modal-title"
          title="Overlay"
          onClose={onCloseOver}
        />
      </>,
    );

    await userEvent.keyboard('{Escape}');

    expect(onCloseOver).toHaveBeenCalledTimes(1);
    expect(onCloseUnder).not.toHaveBeenCalled();
  });
});
