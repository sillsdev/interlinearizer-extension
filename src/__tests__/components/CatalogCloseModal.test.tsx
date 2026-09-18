/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CatalogCloseModal, { CLOSE_STRING_KEYS } from '../../components/CatalogCloseModal';

/** Each key resolving to itself: the text arrives as a prop, so only key placement is assertable. */
const STRINGS = Object.fromEntries(CLOSE_STRING_KEYS.map((k) => [k, k]));

/** The modal with both callbacks stubbed, so a test asserts on which one the click reached. */
function renderModal(overrides: { onConfirm?: jest.Mock; onCancel?: jest.Mock } = {}) {
  const onConfirm = overrides.onConfirm ?? jest.fn();
  const onCancel = overrides.onCancel ?? jest.fn();
  render(
    <CatalogCloseModal localizedStrings={STRINGS} onCancel={onCancel} onConfirm={onConfirm} />,
  );
  return { onConfirm, onCancel };
}

describe('CatalogCloseModal', () => {
  it('names what closing would discard', () => {
    renderModal();

    expect(screen.getByTestId('catalog-close-title')).toHaveTextContent(
      '%interlinearizer_analysisCatalog_closeConfirmTitle%',
    );
    expect(screen.getByTestId('catalog-close-prompt')).toHaveTextContent(
      '%interlinearizer_analysisCatalog_closeConfirmPrompt%',
    );
  });

  it('closes the panel when the discard is confirmed', async () => {
    const { onConfirm, onCancel } = renderModal();

    await userEvent.click(screen.getByTestId('catalog-close-discard'));

    expect(onConfirm).toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('backs out to the panel when the close is declined', async () => {
    const { onConfirm, onCancel } = renderModal();

    await userEvent.click(screen.getByTestId('catalog-close-cancel'));

    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  // Escape resolves to cancel, not discard, so the reflex that dismisses a dialog keeps the draft.
  it('keeps the draft when dismissed by Escape', async () => {
    const { onConfirm, onCancel } = renderModal();

    await userEvent.keyboard('{Escape}');

    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
