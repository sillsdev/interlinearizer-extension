/** @file Shared confirm/cancel dialog for destructive or discard confirmations. */
import { Button } from 'platform-bible-react';
import { ModalShell } from './ModalShell';

/**
 * A small modal asking the user to confirm or cancel a single action (a destructive wipe, a discard
 * of unsaved work, etc.). Presentational: it renders the shared {@link ModalShell} chrome with a
 * body paragraph and a secondary Cancel / destructive Confirm pair, and delegates the decision to
 * the caller via {@link onConfirm} / {@link onCancel}.
 *
 * @param props - Component props
 * @param props.titleId - DOM id wired to the dialog's `aria-labelledby` and title.
 * @param props.title - Localized title text.
 * @param props.body - Localized body text explaining the consequence.
 * @param props.confirmLabel - Localized label for the destructive confirm button.
 * @param props.cancelLabel - Localized label for the secondary cancel button.
 * @param props.confirmTestId - `data-testid` placed on the confirm button so tests can target it.
 * @param props.isSubmitting - When `true`, both buttons are disabled to prevent interaction while
 *   the caller is processing the confirmed action.
 * @param props.onConfirm - Called when the user confirms the action.
 * @param props.onCancel - Called when the user backs out, leaving state untouched.
 * @returns The confirmation overlay.
 */
export function ConfirmDialog({
  titleId,
  title,
  body,
  confirmLabel,
  cancelLabel,
  confirmTestId,
  isSubmitting = false,
  onConfirm,
  onCancel,
}: Readonly<{
  titleId: string;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  confirmTestId: string;
  isSubmitting?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}>) {
  return (
    <ModalShell titleId={titleId} title={title} width="tw:w-96">
      <p className="tw:text-sm tw:mb-4">{body}</p>
      <div className="tw:modal-actions">
        <Button variant="secondary" onClick={onCancel} disabled={isSubmitting}>
          {cancelLabel}
        </Button>
        <Button
          variant="destructive"
          onClick={onConfirm}
          data-testid={confirmTestId}
          disabled={isSubmitting}
        >
          {confirmLabel}
        </Button>
      </div>
    </ModalShell>
  );
}
