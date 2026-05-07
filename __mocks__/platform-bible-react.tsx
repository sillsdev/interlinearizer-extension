/**
 * @file Jest mock for platform-bible-react. The real package ships ESM which Jest cannot parse
 * without extra transform configuration. This stub provides the subset used by the extension.
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
export const MOCK_CREATE_PROJECT_MENU_ITEM: MenuItemContainingCommand = {
  label: '%interlinearizer_menu_select_project%',
  command: 'interlinearizer.createProject',
  group: 'interlinearizer.project.actions',
  order: 1,
  localizeNotes: '',
};

/** Sentinel menu item passed by the mock toolbar when the new-project button is clicked. */
export const MOCK_NEW_PROJECT_MENU_ITEM: MenuItemContainingCommand = {
  label: '%interlinearizer_menu_new_project%',
  command: 'interlinearizer.newProject',
  group: 'interlinearizer.project.actions',
  order: 2,
  localizeNotes: '',
};

/** Sentinel menu item passed by the mock toolbar when the view-project-info button is clicked. */
export const MOCK_VIEW_PROJECT_INFO_MENU_ITEM: MenuItemContainingCommand = {
  label: '%interlinearizer_menu_view_project_info%',
  command: 'interlinearizer.viewProjectInfo',
  group: 'interlinearizer.project.actions',
  order: 3,
  localizeNotes: '',
};


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
  onSelectProjectMenuItem: SelectMenuItemHandler;
  onSelectViewInfoMenuItem: SelectMenuItemHandler;
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
          onClick={() => onSelectProjectMenuItem(MOCK_CREATE_PROJECT_MENU_ITEM)}
        >
          Project menu
        </button>
      )}
      {onSelectProjectMenuItem && (
        <button
          type="button"
          data-testid="tab-toolbar-new-project"
          onClick={() => onSelectProjectMenuItem(MOCK_NEW_PROJECT_MENU_ITEM)}
        >
          New project
        </button>
      )}
      {onSelectProjectMenuItem && (
        <button
          type="button"
          data-testid="tab-toolbar-view-project-info"
          onClick={() => onSelectProjectMenuItem(MOCK_VIEW_PROJECT_INFO_MENU_ITEM)}
        >
          View project info
        </button>
      )}
      {onSelectViewInfoMenuItem && (
        <button
          type="button"
          data-testid="tab-toolbar-view-info-menu"
          onClick={() =>
            onSelectViewInfoMenuItem({
              label: '%mock.viewInfo%',
              command: 'mock.viewInfo',
              group: 'mock.group',
              order: 0,
              localizeNotes: '',
            })
          }
        >
          View info menu
        </button>
      )}
    </div>
  );
}

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
