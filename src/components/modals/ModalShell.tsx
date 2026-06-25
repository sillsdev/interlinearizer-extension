/** @file Shared overlay + dialog + title chrome for the project modal dialogs. */
import type { ReactNode } from 'react';

/**
 * Shared chrome for the project modals: the full-screen overlay, the `<dialog>` with its
 * accessibility attributes, and the title heading. Centralizes the markup every modal repeated so a
 * change to the overlay/dialog structure (or its a11y wiring) lives in one place. The body of each
 * modal is supplied as `children`.
 *
 * @param props - Component props
 * @param props.titleId - DOM id wired to both the dialog's `aria-labelledby` and the title `<h2>`.
 * @param props.title - Localized title text rendered in the heading.
 * @param props.width - Tailwind width utility for the dialog (e.g. `'tw:w-96'`, `'tw:w-lg'`).
 * @param props.rounded - Tailwind rounding utility; defaults to `'tw:rounded'`. Pass
 *   `'tw:rounded-lg'` for the wider modals.
 * @param props.children - Modal body content rendered below the title.
 * @returns The overlay + dialog wrapper around the title and children.
 */
export function ModalShell({
  titleId,
  title,
  width,
  rounded = 'tw:rounded',
  children,
}: Readonly<{
  titleId: string;
  title: string;
  width: string;
  rounded?: string;
  children: ReactNode;
}>) {
  return (
    <div className="tw:modal-overlay">
      <dialog
        aria-labelledby={titleId}
        aria-modal="true"
        className={`tw:modal-dialog ${rounded} ${width}`}
        open
      >
        <h2 id={titleId} className="tw:modal-title">
          {title}
        </h2>
        {children}
      </dialog>
    </div>
  );
}
