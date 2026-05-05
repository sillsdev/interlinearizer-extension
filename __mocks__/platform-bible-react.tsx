/**
 * @file Jest mock for platform-bible-react. The real package ships ESM which Jest cannot parse
 * without extra transform configuration. This stub provides the subset used by extension
 * components: `BookChapterControl`, `BOOK_CHAPTER_CONTROL_STRING_KEYS`, `TabToolbar`, and
 * `ScrollGroupSelector`.
 */

import type { ReactElement, ReactNode } from 'react';

export interface MenuItemContainingCommand {
  label: `%${string}%`;
  command: `${string}.${string}`;
  group: `${string}.${string}`;
  order: number;
  localizeNotes: string;
  tooltip?: `%${string}%`;
  searchTerms?: `%${string}%`;
  iconPathBefore?: string;
  iconPathAfter?: string;
}

export type SelectMenuItemHandler = (selectedMenuItem: MenuItemContainingCommand) => void;

interface SerializedVerseRef {
  book: string;
  chapterNum: number;
  verseNum: number;
  verse?: string;
  versificationStr?: string;
}

export const BOOK_CHAPTER_CONTROL_STRING_KEYS = [
  '%scripture_section_ot_long%',
  '%scripture_section_nt_long%',
  '%scripture_section_dc_long%',
  '%scripture_section_extra_long%',
  '%history_recent%',
  '%history_recentSearches_ariaLabel%',
] as const;

/** Sentinel menu item passed by the mock toolbar when the select-project menu button is clicked. */
export const MOCK_SELECT_PROJECT_MENU_ITEM: MenuItemContainingCommand = {
  label: '%interlinearizer_menu_select_project%',
  command: 'interlinearizer.openSelectProjectModal',
  group: 'interlinearizer.project.actions',
  order: 1,
  localizeNotes: '',
};

/** Sentinel menu item passed by the mock toolbar when the new-project button is clicked. */
export const MOCK_NEW_PROJECT_MENU_ITEM: MenuItemContainingCommand = {
  label: '%interlinearizer_menu_new_project%',
  command: 'interlinearizer.openNewProjectModal',
  group: 'interlinearizer.project.actions',
  order: 2,
  localizeNotes: '',
};

/** Sentinel menu item passed by the mock toolbar when the view-project-info button is clicked. */
export const MOCK_VIEW_PROJECT_INFO_MENU_ITEM: MenuItemContainingCommand = {
  label: '%interlinearizer_menu_view_project_info%',
  command: 'interlinearizer.openProjectInfoModal',
  group: 'interlinearizer.project.actions',
  order: 3,
  localizeNotes: '',
};


/**
 * Stub toolbar that renders project-menu and view-info buttons using sentinel menu items so tests
 * can trigger menu commands without a real toolbar implementation.
 *
 * @param props - Component props.
 * @param props.startAreaChildren - Content rendered in the start slot.
 * @param props.endAreaChildren - Content rendered in the end slot.
 * @param props.onSelectProjectMenuItem - Called with a sentinel item when a project-menu button is
 *   clicked (select-project, new-project, or view-project-info buttons).
 * @param props.onSelectViewInfoMenuItem - Called with a generic sentinel item when the view-info
 *   button is clicked.
 * @returns A div with `data-testid="tab-toolbar"` containing the rendered buttons.
 */
export function TabToolbar({
  startAreaChildren,
  endAreaChildren,
  onSelectProjectMenuItem,
  onSelectViewInfoMenuItem,
}: Readonly<{
  className?: string;
  startAreaChildren?: ReactNode;
  centerAreaChildren?: ReactNode;
  endAreaChildren?: ReactNode;
  onSelectProjectMenuItem: (selectedMenuItem: unknown) => void;
  onSelectViewInfoMenuItem: (selectedMenuItem: unknown) => void;
  projectMenuData?: unknown;
  tabViewMenuData?: unknown;
  id?: string;
  menuButtonIcon?: ReactNode;
}>): ReactElement {
  return (
    <div data-testid="tab-toolbar">
      <div data-testid="tab-toolbar-start">{startAreaChildren}</div>
      <div data-testid="tab-toolbar-end">{endAreaChildren}</div>
      {onSelectProjectMenuItem && (
        <button
          type="button"
          data-testid="tab-toolbar-project-menu"
          onClick={() => onSelectProjectMenuItem(undefined)}
        >
          Project menu
        </button>
      )}
      {onSelectViewInfoMenuItem && (
        <button
          type="button"
          data-testid="tab-toolbar-view-info-menu"
          onClick={() => onSelectViewInfoMenuItem(undefined)}
        >
          View info menu
        </button>
      )}
    </div>
  );
}

/**
 * Stub scroll-group selector rendered as a native `<select>` so tests can change the scroll group
 * without the real component's styling or animation.
 *
 * @param props - Component props.
 * @param props.availableScrollGroupIds - IDs to populate as `<option>` elements.
 * @param props.scrollGroupId - The currently selected group ID.
 * @param props.onChangeScrollGroupId - Called with the newly selected ID when the selection changes.
 * @returns A `<select data-testid="scroll-group-selector">` element.
 */
export function ScrollGroupSelector({
  availableScrollGroupIds,
  scrollGroupId,
  onChangeScrollGroupId,
}: Readonly<{
  availableScrollGroupIds: (number | undefined)[];
  scrollGroupId: number | undefined;
  onChangeScrollGroupId: (id: number | undefined) => void;
  localizedStrings?: Record<string, string>;
  size?: 'default' | 'sm' | 'lg' | 'icon';
  className?: string;
  id?: string;
}>): ReactElement {
  return (
    <select
      data-testid="scroll-group-selector"
      value={scrollGroupId ?? ''}
      onChange={(e) => onChangeScrollGroupId(e.target.value === '' ? undefined : Number(e.target.value))}
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
 * Stub button that passes through `children`, `onClick`, `type`, `className`, `disabled`,
 * `aria-label`, and forwards them to a native `<button>` element; `variant` and `size` are
 * accepted but ignored.
 *
 * @param props - Component props.
 * @param props.children - Button content.
 * @param props.onClick - Click handler.
 * @param props.type - HTML button type attribute.
 * @param props.className - CSS class names.
 * @param props.disabled - Whether the button is disabled.
 * @param props.variant - Ignored styling variant.
 * @param props.size - Ignored size variant.
 * @returns A native `<button>` element with `aria-label` forwarded.
 */
export function Button({
  children,
  onClick,
  type,
  className,
  disabled,
  variant: _variant,
  size: _size,
  'aria-label': ariaLabel,
}: Readonly<{
  children?: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit' | 'reset';
  className?: string;
  disabled?: boolean;
  variant?: 'default' | 'secondary' | 'destructive' | 'ghost' | 'outline' | 'link';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  'aria-label'?: string;
}>): ReactElement {
  return (
    <button
      type={type ?? 'button'}
      onClick={onClick}
      className={className}
      aria-label={ariaLabel}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

/**
 * Stub book/chapter control that displays the current reference as text and exposes a single
 * "Submit reference" button so tests can simulate reference changes without the real picker UI.
 *
 * @param props - Component props.
 * @param props.scrRef - The currently displayed scripture reference.
 * @param props.handleSubmit - Called with `scrRef` when the submit button is clicked.
 * @param props.onAddRecentSearch - Called with `scrRef` after `handleSubmit` when provided.
 * @returns A `<div data-testid="book-chapter-control">` with a submit button.
 */
export function BookChapterControl({
  scrRef,
  handleSubmit,
  onAddRecentSearch,
}: Readonly<{
  scrRef: SerializedVerseRef;
  handleSubmit: (ref: SerializedVerseRef) => void;
  className?: string;
  getActiveBookIds?: () => string[];
  localizedBookNames?: Map<string, { localizedId: string; localizedName: string }>;
  localizedStrings?: Record<string, string>;
  recentSearches?: SerializedVerseRef[];
  onAddRecentSearch?: (scrRef: SerializedVerseRef) => void;
  id?: string;
}>): ReactElement {
  return (
    <div data-testid="book-chapter-control">
      {scrRef.book} {scrRef.chapterNum}:{scrRef.verseNum}
      <button type="button" onClick={() => { handleSubmit(scrRef); onAddRecentSearch?.(scrRef); }}>
        Submit reference
      </button>
    </div>
  );
}

/**
 * Stub toggle switch rendered as a native checkbox so tests can read and change the checked state
 * without the real Radix UI implementation.
 *
 * @param props - Component props.
 * @param props.checked - Whether the switch is on.
 * @param props.disabled - Whether the switch is disabled.
 * @param props.id - HTML `id` attribute forwarded to the input.
 * @param props.onCheckedChange - Called with the new boolean state on change.
 * @returns A native `<input type="checkbox">` element.
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
 * Stub label rendered as a native `<label>` element.
 *
 * @param props - Component props.
 * @param props.children - Label content.
 * @param props.className - CSS class names.
 * @param props.htmlFor - ID of the associated form control.
 * @returns A native `<label>` element.
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
