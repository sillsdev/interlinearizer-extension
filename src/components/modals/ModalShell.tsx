import { Dialog, DialogContent, DialogTitle } from 'platform-bible-react';
import type { ReactNode } from 'react';

/**
 * Shared chrome for the project modals: the platform dialog surface, its accessibility wiring, and
 * the title heading. Centralizes the markup every modal repeated so a change to the dialog
 * structure (or its a11y wiring) lives in one place.
 *
 * The platform dialog supplies a focus trap, scroll lock, and focus restore on close, so a modal
 * genuinely blocks the view behind it rather than merely covering it.
 *
 * @param props - Component props
 * @param props.titleTestId - `data-testid` on the title heading, which is how end-to-end tests
 *   locate each modal. The heading's `id` is deliberately left to the platform dialog: it generates
 *   one and points its own `aria-labelledby` at it, and overriding that id makes the dialog report
 *   its title as missing.
 * @param props.title - Localized title text rendered in the heading.
 * @param props.width - Tailwind width utility for the dialog (e.g. `'tw:w-96'`, `'tw:w-lg'`).
 * @param props.onClose - Called when the user dismisses the modal, by pressing Escape or by
 *   clicking outside it; a caller with an inline confirmation of its own may instead back out of
 *   that first. Omit to make the modal undismissable, which callers do while a submission is in
 *   flight so neither route can abandon work the user has already committed to.
 * @param props.children - Modal body content rendered below the title. Omitted while a modal is
 *   still resolving its localized content, so the blocking dialog can show before the body exists.
 * @returns The dialog wrapper around the title and children.
 */
export function ModalShell({
  titleTestId,
  title,
  width,
  onClose,
  children,
}: Readonly<{
  titleTestId: string;
  title: string;
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
        <DialogTitle className="tw:mb-4" data-testid={titleTestId}>
          {title}
        </DialogTitle>
        {children}
      </DialogContent>
    </Dialog>
  );
}
