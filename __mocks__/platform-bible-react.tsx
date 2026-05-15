/**
 * @file Jest mock for platform-bible-react. The real package ships ESM which Jest cannot parse
 * without extra transform configuration. This stub provides the subset used by extension
 * components: `BookChapterControl`, `BOOK_CHAPTER_CONTROL_STRING_KEYS`, `TabToolbar`, and
 * `ScrollGroupSelector`.
 */

import type { ReactElement, ReactNode } from 'react';

interface SerializedVerseRef {
  book: string;
  chapterNum: number;
  verseNum: number;
  verse?: string;
  versificationStr?: string;
}

export const BOOK_CHAPTER_CONTROL_STRING_KEYS: string[] = [];

interface MenuItemContainingCommand {
  command: string;
  label?: string;
}

type SelectMenuItemHandler = (selectedMenuItem: MenuItemContainingCommand) => void;

/**
 * Stub for `TabToolbar`. Renders start and end children, and one `<button>` per project menu item
 * so tests can click individual commands via `data-testid="project-menu-item-{command}"`.
 *
 * @param props - Component props.
 * @param props.startAreaChildren - Children rendered in the toolbar start area.
 * @param props.endAreaChildren - Children rendered in the toolbar end area.
 * @param props.onSelectProjectMenuItem - Handler called when a project menu button is clicked.
 * @param props.projectMenuData - Menu data whose items are rendered as clickable buttons.
 */
export function TabToolbar({
  startAreaChildren,
  endAreaChildren,
  onSelectProjectMenuItem,
  projectMenuData,
}: Readonly<{
  className?: string;
  startAreaChildren?: ReactNode;
  endAreaChildren?: ReactNode;
  onSelectProjectMenuItem?: SelectMenuItemHandler;
  onSelectViewInfoMenuItem?: SelectMenuItemHandler;
  projectMenuData?: { items?: MenuItemContainingCommand[] };
}>): ReactElement {
  return (
    <div data-testid="tab-toolbar">
      <div data-testid="tab-toolbar-start">{startAreaChildren}</div>
      <div data-testid="tab-toolbar-end">{endAreaChildren}</div>
      {projectMenuData?.items?.map(({ command, label }) => (
        <button
          key={command}
          aria-label={label}
          data-testid={`project-menu-item-${command}`}
          onClick={() => onSelectProjectMenuItem?.({ command })}
          type="button"
        />
      ))}
    </div>
  );
}

/**
 * Stub for `ScrollGroupSelector`. Renders a `<select>` element with one option per available scroll
 * group ID so tests can drive scroll-group changes without the real component.
 *
 * @param props - Component props.
 * @param props.availableScrollGroupIds - The set of scroll group IDs to render as options.
 * @param props.scrollGroupId - The currently selected scroll group ID.
 * @param props.onChangeScrollGroupId - Handler called when the selection changes.
 */
export function ScrollGroupSelector({
  availableScrollGroupIds,
  scrollGroupId,
  onChangeScrollGroupId,
}: Readonly<{
  availableScrollGroupIds?: (number | undefined)[];
  scrollGroupId?: number;
  onChangeScrollGroupId?: (id: number | undefined) => void;
}>): ReactElement {
  return (
    <select
      data-testid="scroll-group-selector"
      value={scrollGroupId ?? ''}
      onChange={(e) =>
        onChangeScrollGroupId?.(e.target.value === '' ? undefined : Number(e.target.value))
      }
    >
      <option value="">—</option>
      {availableScrollGroupIds?.map((id) => (
        <option key={id ?? 'undefined'} value={id ?? ''}>
          {id ?? '—'}
        </option>
      ))}
    </select>
  );
}

/**
 * Stub for `BookChapterControl`. Renders the current reference as text and a submit button so tests
 * can trigger reference changes without the real component.
 *
 * @param props - Component props.
 * @param props.scrRef - The current scripture reference to display.
 * @param props.handleSubmit - Handler called with the reference when the submit button is clicked.
 * @param props.onAddRecentSearch - Handler called with the reference alongside `handleSubmit`.
 */
export function BookChapterControl({
  scrRef,
  handleSubmit,
  onAddRecentSearch,
}: Readonly<{
  scrRef: SerializedVerseRef;
  handleSubmit: (ref: SerializedVerseRef) => void;
  className?: string;
  localizedStrings?: Record<string, string>;
  recentSearches?: SerializedVerseRef[];
  onAddRecentSearch?: (scrRef: SerializedVerseRef) => void;
  id?: string;
}>): ReactElement {
  return (
    <div data-testid="book-chapter-control">
      {scrRef.book} {scrRef.chapterNum}:{scrRef.verseNum}
      <button
        type="button"
        onClick={() => {
          handleSubmit(scrRef);
          onAddRecentSearch?.(scrRef);
        }}
      >
        Submit reference
      </button>
    </div>
  );
}

/**
 * Stub for `Switch`. Renders a checkbox input so tests can toggle boolean settings without the real
 * component.
 *
 * @param props - Component props.
 * @param props.checked - Whether the switch is on.
 * @param props.disabled - Whether the switch is disabled.
 * @param props.id - HTML id attribute for label association.
 * @param props.onCheckedChange - Handler called with the new boolean value on change.
 */
export function Switch({
  checked,
  disabled,
  id,
  onCheckedChange,
}: Readonly<{
  checked?: boolean;
  disabled?: boolean;
  id?: string;
  onCheckedChange?: (checked: boolean) => void;
}>): ReactElement {
  return (
    <input
      checked={checked ?? false}
      disabled={disabled}
      id={id}
      onChange={(e) => onCheckedChange?.(e.target.checked)}
      type="checkbox"
    />
  );
}

/**
 * Stub for `Label`. Renders a plain `<label>` element so tests can locate labeled controls without
 * the real component's styling.
 *
 * @param props - Component props.
 * @param props.children - Label content.
 * @param props.className - CSS class forwarded to the label element.
 * @param props.htmlFor - The `for` attribute linking this label to a form control.
 */
export function Label({
  children,
  className,
  htmlFor,
}: Readonly<{
  children?: ReactNode;
  className?: string;
  htmlFor?: string;
}>): ReactElement {
  return (
    <label className={className} htmlFor={htmlFor}>
      {children}
    </label>
  );
}
