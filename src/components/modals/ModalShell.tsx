import type { ReactNode } from 'react';

/**
 * Shared chrome for the project modals: the platform dialog surface, its accessibility wiring, and
 * the title heading. Centralizes the markup every modal repeated so a change to the dialog
 * structure (or its a11y wiring) lives in one place.
 *
 * The platform dialog supplies a focus trap, scroll lock, and focus restore on close, so a modal
 * genuinely blocks the view behind it rather than merely covering it.
 *
 * @param props.titleId - DOM id wired to both the dialog's `aria-labelledby` and the title `<h2>`.
 * @param props.title - Localized title text rendered in the heading.
 * @param props.width - Tailwind width utility for the dialog (e.g. `'tw:w-96'`, `'tw:w-lg'`).
 * @param props.onClose - Called when the user presses Escape, normally to dismiss the modal; a
 *   caller with an inline confirmation of its own may instead back out of that first. Omit to make
 *   the modal undismissable, which callers do while a submission is in flight so Escape cannot
 *   abandon work the user has already committed to.
 * @param props.children - Modal body content rendered below the title. Omitted while a modal is
 *   still resolving its localized content, so the blocking overlay can show before the body
 *   exists.
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
        // Every modal's Cancel control is disabled while it is busy, so leaving that as the only
        // pointer-driven dismissal keeps a stray click outside from discarding in-flight work.
        /* v8 ignore next -- platform-component wiring; the test double has no outside region */
        onInteractOutside={(event) => event.preventDefault()}
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
