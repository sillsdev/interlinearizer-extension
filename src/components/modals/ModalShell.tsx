import { Dialog, DialogContent, DialogTitle } from 'platform-bible-react';
import type { ReactNode } from 'react';

/**
 * Shared chrome for the project modals: the platform dialog surface, its accessibility wiring, and
 * the title heading.
 *
 * The platform dialog supplies a focus trap, scroll lock, and focus restore on close, so a modal
 * genuinely blocks the view behind it rather than merely covering it.
 *
 * @param props.titleTestId - Test id tagged onto the title heading, which is how a modal is
 *   identified from outside. The heading's `id` belongs to the platform dialog, which generates it
 *   and points its own `aria-labelledby` there.
 * @param props.title - Localized title text rendered in the heading.
 * @param props.width - Tailwind width utility for the dialog (e.g. `'tw:w-96'`, `'tw:w-lg'`).
 * @param props.onClose - Called when the user dismisses the modal, by pressing Escape or by
 *   clicking outside it; a caller with an inline confirmation of its own may instead back out of
 *   that first. Omit to make the modal undismissable, which callers do while a submission is in
 *   flight so neither route can abandon work the user has already committed to.
 * @param props.children - Modal body content rendered below the title. Omitted while a modal is
 *   still resolving its localized content, so the blocking overlay can show before the body
 *   exists.
 * @param props.titleAdornment - Rendered inline after the title text, for a control that qualifies
 *   the whole modal rather than any one field in it.
 */
export function ModalShell({
  titleTestId,
  title,
  titleAdornment,
  width,
  onClose,
  children,
}: Readonly<{
  titleTestId: string;
  title: string;
  titleAdornment?: ReactNode;
  width: string;
  onClose?: () => void;
  children?: ReactNode;
}>) {
  return (
    <Dialog
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose?.();
      }}
    >
      <DialogContent
        // The dialog is labeled by its own title, which the platform wires up itself; it has no
        // separate description element, and passing `undefined` explicitly suppresses the
        // platform's missing-description warning.
        aria-describedby={undefined}
        // `gap-0` opts out of the platform's row rhythm because each modal body already spaces its
        // own sections; `sm:max-w-none` clears the platform's default cap so `width` decides.
        className={`tw:gap-0 tw:sm:max-w-none ${width}`}
        // A busy modal withholds `onClose`, and blocking the click then keeps a stray one outside
        // from discarding work already in flight — its Cancel control is disabled for the same
        // reason. An idle modal has nothing to abandon, so the click dismisses it as Escape does.
        /* v8 ignore next -- platform-component wiring; the test double has no outside region */
        onInteractOutside={onClose ? undefined : (event) => event.preventDefault()}
        showCloseButton={false}
      >
        <DialogTitle
          className="tw:mb-4 tw:flex tw:items-center tw:gap-1.5"
          data-testid={titleTestId}
        >
          {title}
          {titleAdornment}
        </DialogTitle>
        {children}
      </DialogContent>
    </Dialog>
  );
}
