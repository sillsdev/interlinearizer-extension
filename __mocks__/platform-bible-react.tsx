/**
 * @file Jest mock for platform-bible-react. The real package ships ESM which Jest cannot parse
 * without extra transform configuration. This stub provides the subset used by the extension.
 */

import {
  Children,
  cloneElement,
  createContext,
  forwardRef,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  ChangeEventHandler,
  CSSProperties,
  KeyboardEventHandler,
  MouseEventHandler,
  ReactElement,
  ReactNode,
  RefObject,
} from 'react';

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

/** Localization keys required by {@link BookChapterControl}. */
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
  group: 'interlinearizer.projectActions',
  order: 1,
  localizeNotes: '',
};

/** Sentinel menu item passed by the mock toolbar when the new-project button is clicked. */
export const MOCK_NEW_PROJECT_MENU_ITEM: MenuItemContainingCommand = {
  label: '%interlinearizer_menu_new_project%',
  command: 'interlinearizer.openNewProjectModal',
  group: 'interlinearizer.projectActions',
  order: 2,
  localizeNotes: '',
};

/** Sentinel menu item passed by the mock toolbar when the view-project-info button is clicked. */
export const MOCK_VIEW_PROJECT_INFO_MENU_ITEM: MenuItemContainingCommand = {
  label: '%interlinearizer_menu_view_project_info%',
  command: 'interlinearizer.openProjectInfoModal',
  group: 'interlinearizer.projectActions',
  order: 3,
  localizeNotes: '',
};

/** Sentinel menu item passed by the mock toolbar when the save button is clicked. */
export const MOCK_SAVE_MENU_ITEM: MenuItemContainingCommand = {
  label: '%interlinearizer_save%',
  command: 'interlinearizer.save',
  group: 'interlinearizer.fileActions',
  order: 1,
  localizeNotes: '',
};

/** Sentinel menu item passed by the mock toolbar when the save-as button is clicked. */
export const MOCK_SAVE_AS_MENU_ITEM: MenuItemContainingCommand = {
  label: '%interlinearizer_saveAs%',
  command: 'interlinearizer.openSaveAsModal',
  group: 'interlinearizer.fileActions',
  order: 2,
  localizeNotes: '',
};

/** Sentinel menu item passed by the mock toolbar when the wipe button is clicked. */
export const MOCK_WIPE_MENU_ITEM: MenuItemContainingCommand = {
  label: '%interlinearizer_wipe%',
  command: 'interlinearizer.wipe',
  group: 'interlinearizer.draftActions',
  order: 1,
  localizeNotes: '',
};

/** Sentinel menu item passed by the mock toolbar when the analysis-catalog button is clicked. */
export const MOCK_OPEN_ANALYSIS_CATALOG_MENU_ITEM: MenuItemContainingCommand = {
  label: '%interlinearizer_openAnalysisCatalog%',
  command: 'interlinearizer.openAnalysisCatalog',
  group: 'interlinearizer.viewActions',
  order: 1,
  localizeNotes: '',
};

/**
 * Stub toolbar that renders project-menu and view-info buttons using sentinel menu items so tests
 * can trigger menu commands without a real toolbar implementation.
 *
 * @returns A `data-testid="tab-toolbar"` container; its buttons carry `tab-toolbar-`-prefixed ids
 *   naming the command each one sends.
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
          onClick={() => onSelectProjectMenuItem(MOCK_SELECT_PROJECT_MENU_ITEM)}
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
      {onSelectProjectMenuItem && (
        <button
          type="button"
          data-testid="tab-toolbar-save"
          onClick={() => onSelectProjectMenuItem(MOCK_SAVE_MENU_ITEM)}
        >
          Save
        </button>
      )}
      {onSelectProjectMenuItem && (
        <button
          type="button"
          data-testid="tab-toolbar-save-as"
          onClick={() => onSelectProjectMenuItem(MOCK_SAVE_AS_MENU_ITEM)}
        >
          Save as
        </button>
      )}
      {onSelectProjectMenuItem && (
        <button
          type="button"
          data-testid="tab-toolbar-wipe"
          onClick={() => onSelectProjectMenuItem(MOCK_WIPE_MENU_ITEM)}
        >
          Wipe
        </button>
      )}
      {onSelectProjectMenuItem && (
        <button
          type="button"
          data-testid="tab-toolbar-analysis-catalog"
          onClick={() => onSelectProjectMenuItem(MOCK_OPEN_ANALYSIS_CATALOG_MENU_ITEM)}
        >
          Analysis catalog
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

/**
 * Stub scroll-group selector rendered as a native `<select>` so tests can change the scroll group
 * without the real component's styling or animation.
 *
 * @returns A `data-testid="scroll-group-selector"` `<select>`.
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
 * Throws if a `Button`-descendant SVG loses its size to `buttonVariants`: an `h-*` or `w-*`
 * className without `size-`, or a numeric `size` prop without a `size-` className. Production
 * silently overrides all of these (AGENTS.md § Components); jsdom can't reproduce the visual
 * regression, so this fails loudly instead of letting it pass as a green test.
 */
function assertNoOversizedIconClassName(node: ReactNode): void {
  if (Array.isArray(node)) {
    node.forEach(assertNoOversizedIconClassName);
    return;
  }
  if (!isValidElement(node)) return;
  const { className, size, children } = node.props as {
    className?: unknown;
    size?: unknown;
    children?: ReactNode;
  };
  const hasSizeClass = typeof className === 'string' && /\bsize-/.test(className);
  if (
    typeof className === 'string' &&
    (/\btw:h-\S+/.test(className) || /\btw:w-\S+/.test(className)) &&
    !hasSizeClass
  ) {
    throw new Error(
      `Icon className "${className}" uses tw:h-*/tw:w-* instead of tw:size-* inside a Button — ` +
        'the platform Button forces child SVG size unless the class contains "size-" (see AGENTS.md § Components).',
    );
  }
  if (typeof size === 'number' && !hasSizeClass) {
    throw new Error(
      `Icon has a numeric size={${size}} prop instead of a tw:size-* className inside a Button — ` +
        'the platform Button forces child SVG size unless the class contains "size-" (see AGENTS.md § Components).',
    );
  }
  if (children) assertNoOversizedIconClassName(children);
}

/**
 * Whether the host is macOS, decided from the user agent as the real helper does — so a test that
 * needs the macOS answer stubs `navigator.userAgent` rather than this function. jsdom's default
 * agent is not a Mac.
 */
export function isMacOs(): boolean {
  return /Macintosh/i.test(navigator.userAgent);
}

/**
 * Stub button that passes the attributes the extension relies on through to a native `<button>`
 * element; `variant` and `size` are accepted but ignored for rendering (jsdom does not apply
 * styling, so tests assert on behavior/testid/role, not the visual variant). Children still go
 * through {@link assertNoOversizedIconClassName}, which throws on the one sizing regression this
 * stub can catch regardless of variant/size. The mouse/keyboard handlers and `tabIndex`/`style` are
 * forwarded so migrated icon buttons keep their hover-preview and focus-skipping behavior under test.
 */
export const Button = forwardRef<
  HTMLButtonElement,
  Readonly<{
    children?: ReactNode;
    onClick?: MouseEventHandler<HTMLButtonElement>;
    onMouseEnter?: MouseEventHandler<HTMLButtonElement>;
    onMouseLeave?: MouseEventHandler<HTMLButtonElement>;
    onMouseDown?: MouseEventHandler<HTMLButtonElement>;
    type?: 'button' | 'submit' | 'reset';
    className?: string;
    style?: CSSProperties;
    title?: string;
    disabled?: boolean;
    tabIndex?: number;
    variant?: 'default' | 'secondary' | 'destructive' | 'ghost' | 'outline' | 'link';
    size?: 'default' | 'sm' | 'lg' | 'icon' | 'xs' | 'icon-sm' | 'icon-xs' | 'icon-lg';
    'aria-label'?: string;
    'aria-expanded'?: boolean;
    'aria-haspopup'?: boolean | 'true' | 'false' | 'menu' | 'listbox' | 'tree' | 'grid' | 'dialog';
    'aria-controls'?: string;
    'aria-hidden'?: boolean;
    'data-testid'?: string;
    /**
     * Names the token a button acts on, so a list of buttons sharing one test id can be told apart
     * by ref rather than by a visible label that may repeat. The real button spreads every unknown
     * prop onto the element; this stub forwards the ones the extension sets.
     */
    'data-token-ref'?: string;
  }>
>(function ButtonImpl(
  {
    children,
    onClick,
    onMouseEnter,
    onMouseLeave,
    onMouseDown,
    type,
    className,
    style,
    title,
    disabled,
    tabIndex,
    variant: _variant,
    size: _size,
    'aria-label': ariaLabel,
    'aria-expanded': ariaExpanded,
    'aria-haspopup': ariaHaspopup,
    'aria-controls': ariaControls,
    'aria-hidden': ariaHidden,
    'data-testid': testId,
    'data-token-ref': tokenRef,
  },
  ref,
) {
  assertNoOversizedIconClassName(children);
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onMouseDown={onMouseDown}
      className={className}
      style={style}
      title={title}
      tabIndex={tabIndex}
      aria-label={ariaLabel}
      aria-expanded={ariaExpanded}
      aria-haspopup={ariaHaspopup}
      aria-controls={ariaControls}
      aria-hidden={ariaHidden}
      data-testid={testId}
      data-token-ref={tokenRef}
      disabled={disabled}
    >
      {children}
    </button>
  );
});

/**
 * Stub input rendered as a native `<input>`, forwarding the attributes the extension's migrated
 * form fields and inline editors rely on so tests can read and drive them by id, testid, role, or
 * value.
 */
export const Input = forwardRef<
  HTMLInputElement,
  Readonly<{
    id?: string;
    type?: string;
    value?: string;
    placeholder?: string;
    className?: string;
    style?: CSSProperties;
    disabled?: boolean;
    onChange?: ChangeEventHandler<HTMLInputElement>;
    onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
    'aria-label'?: string;
    'data-testid'?: string;
  }>
>(function InputImpl(
  {
    id,
    type,
    value,
    placeholder,
    className,
    style,
    disabled,
    onChange,
    onKeyDown,
    'aria-label': ariaLabel,
    'data-testid': testId,
  },
  ref,
) {
  return (
    <input
      ref={ref}
      id={id}
      type={type ?? 'text'}
      value={value}
      placeholder={placeholder}
      className={className}
      style={style}
      disabled={disabled}
      onChange={onChange}
      onKeyDown={onKeyDown}
      aria-label={ariaLabel}
      data-testid={testId}
    />
  );
});

/**
 * Stub search bar. The real component wraps a platform `Input` in a positioned container with a
 * search icon and, once the query is non-empty, a clear button that reports `''`; this stub keeps
 * the input and that button and drops the icon and positioning, which are visual only.
 *
 * It takes no `aria-label` and puts its `id` on the wrapper rather than the input, exactly as the
 * real component does, so the input's accessible name comes from its placeholder alone — which is
 * how a test has to find it.
 */
export const SearchBar = forwardRef<
  HTMLInputElement,
  Readonly<{
    value: string;
    onSearch: (searchQuery: string) => void;
    placeholder?: string;
    isFullWidth?: boolean;
    className?: string;
    isDisabled?: boolean;
    id?: string;
  }>
>(function SearchBarImpl(
  { value, onSearch, placeholder, isFullWidth: _isFullWidth, className, isDisabled, id },
  ref,
) {
  return (
    <div className={className} id={id}>
      <input
        ref={ref}
        disabled={isDisabled}
        onChange={(e) => onSearch(e.target.value)}
        placeholder={placeholder}
        type="text"
        value={value}
      />
      {value && (
        <button onClick={() => onSearch('')} type="button">
          <span>Clear</span>
        </button>
      )}
    </div>
  );
});

/**
 * Stub empty state rendered as the `<p role="status">` the real component produces, taking its
 * `data-testid` from the `id` prop as that component does.
 */
export function EmptyState({
  message,
  id,
  className,
}: Readonly<{ message: string; id?: string; className?: string }>): ReactElement {
  return (
    <p className={className} data-testid={id} role="status">
      {message}
    </p>
  );
}

/**
 * Stub textarea rendered as a native `<textarea>`, forwarding the attributes the extension's
 * migrated multi-line form fields rely on.
 */
export const Textarea = forwardRef<
  HTMLTextAreaElement,
  Readonly<{
    id?: string;
    value?: string;
    placeholder?: string;
    className?: string;
    rows?: number;
    disabled?: boolean;
    onChange?: ChangeEventHandler<HTMLTextAreaElement>;
    'data-testid'?: string;
  }>
>(function TextareaImpl(
  { id, value, placeholder, className, rows, disabled, onChange, 'data-testid': testId },
  ref,
) {
  return (
    <textarea
      ref={ref}
      id={id}
      value={value}
      placeholder={placeholder}
      className={className}
      rows={rows}
      disabled={disabled}
      onChange={onChange}
      data-testid={testId}
    />
  );
});

/**
 * Stub book/chapter control that displays the current reference as text and exposes a single
 * "Submit reference" button so tests can simulate reference changes without the real picker UI.
 *
 * @returns A `data-testid="book-chapter-control"` container holding the reference and that button.
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
 * Context carrying the {@link RadioGroup}'s selected value and change handler down to each
 * {@link RadioGroupItem}, mirroring how the real Radix-based component coordinates its items.
 */
const RadioGroupContext = createContext<{
  onValueChange?: (value: string) => void;
  value?: string;
}>({});

/**
 * Stub radio group rendered as a `<div role="radiogroup">` that shares its selected value and change
 * handler with its {@link RadioGroupItem} children via context. The real component is built on Radix
 * primitives; this stub reproduces just the controlled selection behavior tests drive.
 */
export function RadioGroup({
  children,
  className,
  onValueChange,
  value,
}: Readonly<{
  children?: ReactNode;
  className?: string;
  onValueChange?: (value: string) => void;
  value?: string;
}>): ReactElement {
  const contextValue = useMemo(() => ({ onValueChange, value }), [onValueChange, value]);
  return (
    <div className={className} role="radiogroup">
      <RadioGroupContext.Provider value={contextValue}>{children}</RadioGroupContext.Provider>
    </div>
  );
}

/**
 * Stub radio item rendered as a native `<input type="radio">` so `toBeChecked`, `toBeDisabled`, and
 * click/`check` interactions work in tests. It reads the enclosing {@link RadioGroup}'s value from
 * context, marking itself checked when they match and reporting its own value on change. (The real
 * component renders a `<button role="radio">`; a native radio is close enough for these tests and
 * plays nicely with jest-dom's checked/disabled matchers.)
 */
export function RadioGroupItem({
  className,
  'data-testid': testId,
  disabled,
  id,
  value,
}: Readonly<{
  className?: string;
  'data-testid'?: string;
  disabled?: boolean;
  id?: string;
  value: string;
}>): ReactElement {
  const { onValueChange, value: groupValue } = useContext(RadioGroupContext);
  return (
    <input
      checked={groupValue === value}
      className={className}
      data-testid={testId}
      disabled={disabled}
      id={id}
      onChange={() => onValueChange?.(value)}
      type="radio"
    />
  );
}

/**
 * Stub multi-select combo box. The real component is a `role="combobox"` button opening a popover
 * that holds a cmdk `Command` palette — a search input over `CommandItem`s, each toggling its entry
 * in or out of the selection. This stub keeps the trigger and the entries as `role="option"` buttons
 * with the same toggle semantics, and drops the popover and the palette's own search: cmdk's
 * filtering is the platform's behavior, not this extension's, and jsdom shows neither.
 *
 * Faithful in three ways the extension depends on. The trigger shows `customSelectedText` when the
 * caller supplies one and the bare `placeholder` otherwise — the real component never lists the
 * selection itself, so a caller that wants the selection named has to name it. An entry is resolved
 * by its label as the command list reports it, which is trimmed, so two entries whose labels agree
 * once trimmed collide, and one whose `value` is empty can never be selected at all. And `id` lands
 * on the root; the stub additionally mirrors it to `data-testid`, since Testing Library has no
 * by-id query and a test needs to scope to one of several controls.
 */
export function MultiSelectComboBox({
  entries,
  selected,
  onChange,
  placeholder,
  customSelectedText,
  isDisabled,
  className,
  id,
}: Readonly<{
  entries: readonly { value: string; label: string; secondaryLabel?: string; starred?: boolean }[];
  selected: readonly string[];
  onChange: (values: string[]) => void;
  placeholder: string;
  hasToggleAllFeature?: boolean;
  selectAllText?: string;
  clearAllText?: string;
  commandEmptyMessage?: string;
  customSelectedText?: string;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  isDisabled?: boolean;
  sortSelected?: boolean;
  icon?: ReactNode;
  className?: string;
  variant?: 'default' | 'secondary' | 'destructive' | 'ghost' | 'outline' | 'link';
  id?: string;
}>): ReactElement {
  const toggle = (value: string) =>
    onChange(
      selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value],
    );
  return (
    <div className={className} data-testid={id} id={id}>
      <button aria-expanded={false} disabled={isDisabled} role="combobox" type="button">
        {customSelectedText ?? placeholder}
      </button>
      <div role="listbox">
        {entries.map((entry) => (
          <button
            aria-selected={selected.includes(entry.value)}
            // Keyed by value where the real component keys by label, so a caller offering two
            // choices under one label is left to the assertions rather than buried under React's
            // own complaint about it.
            key={entry.value}
            // Resolving the entry by the label the command list reports back, as the real
            // component's own select handler does, so a stub test cannot pass on a collision the
            // real component would drop.
            onClick={() => {
              const reported = entry.label.trim();
              const match = entries.find((candidate) => candidate.label === reported);
              if (match?.value) toggle(match.value);
            }}
            role="option"
            type="button"
          >
            {entry.label}
            {entry.secondaryLabel}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Context carrying the {@link Select}'s value and change handler down to {@link SelectValue} and each
 * {@link SelectItem}, mirroring how the real Radix-based component reaches its parts from the root.
 */
const SelectContext = createContext<{ onValueChange?: (value: string) => void; value?: string }>({});

/**
 * Stub select root, rendering its children unchanged. The real component is Radix's `Select.Root`,
 * which renders no element of its own either.
 */
export function Select({
  children,
  onValueChange,
  value,
}: Readonly<{
  children?: ReactNode;
  onValueChange?: (value: string) => void;
  value?: string;
}>): ReactElement {
  const contextValue = useMemo(() => ({ onValueChange, value }), [onValueChange, value]);
  return <SelectContext.Provider value={contextValue}>{children}</SelectContext.Provider>;
}

/**
 * Stub select trigger rendered as the `<button role="combobox">` the real component produces. The
 * options are rendered unconditionally by {@link SelectContent} rather than on open, so a test picks
 * one by clicking it rather than by opening the trigger first.
 */
export function SelectTrigger({
  'aria-label': ariaLabel,
  children,
  className,
  'data-testid': testId,
  size: _size,
}: Readonly<{
  'aria-label'?: string;
  children?: ReactNode;
  className?: string;
  'data-testid'?: string;
  size?: 'sm' | 'default';
}>): ReactElement {
  return (
    <button
      aria-label={ariaLabel}
      className={className}
      data-testid={testId}
      role="combobox"
      type="button"
    >
      {children}
    </button>
  );
}

/**
 * Stub select value. The real component renders the selected {@link SelectItem}'s own children,
 * which it reads from the root's internal item registry; this stub has no registry, so it renders
 * the selected **value** instead — enough to tell one selection from another, but not the label a
 * reader would see. Assert on an item's `aria-selected` when the label matters.
 */
export function SelectValue({ placeholder }: Readonly<{ placeholder?: string }>): ReactElement {
  const { value } = useContext(SelectContext);
  return <>{value ?? placeholder}</>;
}

/**
 * Stub select content rendered as the `<div role="listbox">` the real component produces, but
 * unconditionally rather than in a portal opened by the trigger — the same simplification the
 * {@link Popover} stub makes, and for the same reason: jsdom shows neither.
 */
export function SelectContent({
  children,
  className,
}: Readonly<{
  children?: ReactNode;
  className?: string;
  position?: 'item-aligned' | 'popper';
}>): ReactElement {
  return (
    <div className={className} role="listbox">
      {children}
    </div>
  );
}

/**
 * Stub select item rendered as the `<button role="option">` the real component produces, reporting
 * its own value on click and marking itself selected when it matches the root's.
 */
export function SelectItem({
  children,
  className,
  'data-testid': testId,
  disabled,
  value,
}: Readonly<{
  children?: ReactNode;
  className?: string;
  'data-testid'?: string;
  disabled?: boolean;
  value: string;
}>): ReactElement {
  const { onValueChange, value: selectedValue } = useContext(SelectContext);
  return (
    <button
      aria-selected={selectedValue === value}
      className={className}
      data-testid={testId}
      disabled={disabled}
      onClick={() => onValueChange?.(value)}
      role="option"
      type="button"
    >
      {children}
    </button>
  );
}

/**
 * Context carrying the {@link Dialog}'s open-state change handler and generated title id down to
 * {@link DialogContent} and {@link DialogTitle}, mirroring how the real Radix-based component
 * reaches its parts from the root.
 */
/** Stub spinner: a marker element standing in for the platform's indeterminate spinner. */
export function Spinner({ className }: { className?: string }) {
  return <span className={className} data-testid="spinner" />;
}

const DialogContext = createContext<{ onOpenChange?: (open: boolean) => void; titleId?: string }>(
  {},
);

/**
 * Stub dialog root that renders its children unconditionally. The extension mounts a modal only
 * while it should be showing and holds `open` at `true`, so visibility needs no simulation here.
 *
 * Generates the title id the way the real component does, so the automatic `aria-labelledby`
 * wiring between the surface and its heading is exercised rather than assumed.
 */
export function Dialog({
  children,
  onOpenChange,
}: Readonly<{
  children?: ReactNode;
  onOpenChange?: (open: boolean) => void;
}>): ReactElement {
  const titleId = useId();
  const contextValue = useMemo(() => ({ onOpenChange, titleId }), [onOpenChange, titleId]);
  return <DialogContext.Provider value={contextValue}>{children}</DialogContext.Provider>;
}

/**
 * Mounted {@link DialogContent} surfaces in mount order, so an Escape can be routed to the topmost
 * one alone. The real component stacks dismissal layers this way; without the stack, a dialog
 * overlaying another would dismiss both at once.
 */
const mountedDialogs: { current?: (open: boolean) => void }[] = [];

/**
 * Stub dialog surface rendered as a `<div role="dialog" data-slot="dialog-content">` — the slot
 * being what tells a modal apart from a popover, since both carry the dialog role — that reports
 * Escape back through the root's change handler, which is the one dismissal path the extension's
 * own code implements. The
 * real component additionally traps focus, locks scrolling, and restores focus on close; those are
 * behaviors of the platform package rather than of this extension, so they are left to end-to-end
 * coverage rather than faked here.
 *
 * `onInteractOutside` is accepted and ignored — there is no outside region to click in this stub.
 * A close button is never rendered because the extension always suppresses it.
 */
export function DialogContent({
  children,
  className,
}: Readonly<{
  'aria-describedby'?: undefined;
  children?: ReactNode;
  className?: string;
  onInteractOutside?: (event: { preventDefault: () => void }) => void;
  showCloseButton?: boolean;
}>): ReactElement {
  const { onOpenChange, titleId } = useContext(DialogContext);
  const onOpenChangeRef = useRef(onOpenChange);
  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  });

  // The real component dismisses on Escape from anywhere in the document rather than only when the
  // surface itself holds focus, so listen the same way here — but only the topmost dialog reacts.
  useEffect(() => {
    const entry = onOpenChangeRef;
    mountedDialogs.push(entry);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && mountedDialogs.at(-1) === entry) entry.current?.(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      mountedDialogs.splice(mountedDialogs.indexOf(entry), 1);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  return (
    <div
      aria-labelledby={titleId}
      aria-modal="true"
      className={className}
      data-slot="dialog-content"
      role="dialog"
    >
      {children}
    </div>
  );
}

/**
 * Stub dialog title rendered as the `<h2>` the real component produces, keeping the heading role and
 * taking its `id` from the root so the dialog's `aria-labelledby` resolves to it. Forwards
 * `data-testid` as the real component does, since that is the handle a modal is identified by.
 */
export function DialogTitle({
  children,
  className,
  'data-testid': testId,
}: Readonly<{
  children?: ReactNode;
  className?: string;
  'data-testid'?: string;
}>): ReactElement {
  const { titleId } = useContext(DialogContext);
  return (
    <h2 className={className} data-testid={testId} id={titleId}>
      {children}
    </h2>
  );
}

/**
 * Context carrying the {@link Popover}'s open state and change handler down to
 * {@link PopoverTrigger}, mirroring how the real Radix-based component coordinates the two.
 */
const PopoverContext = createContext<{
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
}>({});

/**
 * Stub popover root that renders its children unconditionally. The extension conditionally mounts
 * the content component while open (so its draft state re-initializes per open), so visibility
 * needs no simulation here.
 */
export function Popover({
  children,
  onOpenChange,
  open,
}: Readonly<{
  children?: ReactNode;
  modal?: boolean;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
}>): ReactElement {
  const contextValue = useMemo(() => ({ onOpenChange, open }), [onOpenChange, open]);
  return <PopoverContext.Provider value={contextValue}>{children}</PopoverContext.Provider>;
}

/**
 * Stub popover trigger. With `asChild` (the only mode the extension uses) the real component merges
 * its trigger behavior onto the single child element rather than rendering a wrapper, so this stub
 * clones the child with the open-state attributes and the toggle handler Radix would supply.
 *
 * Props cloned onto the trigger itself pass through to that same child, so an outer `asChild`
 * trigger — a {@link Tooltip} wrapping a popover-triggering button — reaches the button rather than
 * stopping here.
 */
export function PopoverTrigger({
  children,
  ...forwarded
}: Readonly<{ children?: ReactNode; asChild?: boolean }> & Record<string, unknown>): ReactNode {
  const { onOpenChange, open = false } = useContext(PopoverContext);
  if (!isValidElement(children)) return <>{children}</>;
  return cloneElement(children, {
    ...forwarded,
    'aria-expanded': open,
    'aria-haspopup': 'dialog',
    onClick: () => onOpenChange?.(!open),
  });
}

/**
 * Stub popover anchor that renders its children as-is, matching the real component's `asChild`
 * pass-through behavior.
 */
export function PopoverAnchor({
  children,
}: Readonly<{ children?: ReactNode; asChild?: boolean }>): ReactElement {
  return <>{children}</>;
}

/**
 * Stub popover content rendered as a `<div role="dialog" data-testid="popover-content">` — the role
 * matching the real component, which is what makes its `aria-label` meaningful, and which is why a
 * test that must reach a modal instead selects on `[data-slot="dialog-content"]`. The real component
 * implements positioning, portaling, and dismissal internally; this stub exposes the dismissal
 * callbacks so tests can simulate them:
 *
 * - `role`, `id`, and `style` land on the panel element, as they do in the real component, which
 *   spreads caller props after its own — so a caller can override the panel's dialog role and id.
 * - The panel's children render only from the second commit, mirroring Radix's portal (which renders
 *   nothing until its own layout effect flips its `mounted` state). Consumers must therefore not
 *   reach for a child element from their own mount effect — in the real app that element does not
 *   exist yet — and this stub is deliberately faithful about that rather than making such code
 *   appear to work.
 * - Once the children exist, `onOpenAutoFocus` is invoked; unless it is prevented, the panel's first
 *   enabled tabbable child is focused (and selected, if a text input), as Radix's focus scope does.
 * - An Escape keydown anywhere inside the content invokes `onEscapeKeyDown`.
 * - A sentinel `data-testid="popover-outside"` button invokes `onPointerDownOutside` on click,
 *   simulating a pointer press outside the popover.
 * - A sentinel `data-testid="popover-close"` button invokes `onCloseAutoFocus` on click,
 *   simulating Radix's focus-restoration event fired as the popover closes; unless it is prevented,
 *   the focused element is blurred. Which element Radix restores focus to — its trigger, or the
 *   element focused before the panel opened — is not modeled; only that an unprevented event lets
 *   the panel take focus away.
 * - Both sentinels are siblings of the panel rather than children — scaffolding with no counterpart
 *   in the real component has no business among the children of a panel whose role a caller has
 *   overridden.
 * - The layout props are accepted and ignored: they steer positioning the real component computes
 *   from measurements jsdom does not produce.
 */
export function PopoverContent({
  'aria-label': ariaLabel,
  children,
  className,
  'data-testid': testId = 'popover-content',
  id,
  role = 'dialog',
  style,
  onEscapeKeyDown,
  onPointerDownOutside,
  onOpenAutoFocus,
  onCloseAutoFocus,
  onClick,
  onMouseDown,
}: Readonly<{
  'aria-label'?: string;
  children?: ReactNode;
  className?: string;
  'data-testid'?: string;
  id?: string;
  role?: string;
  style?: CSSProperties;
  align?: 'start' | 'center' | 'end';
  sideOffset?: number;
  hideWhenDetached?: boolean;
  onEscapeKeyDown?: (event: KeyboardEvent) => void;
  onPointerDownOutside?: (event: CustomEvent) => void;
  onOpenAutoFocus?: (event: Event) => void;
  onCloseAutoFocus?: (event: Event) => void;
  onClick?: MouseEventHandler<HTMLDivElement>;
  onMouseDown?: MouseEventHandler<HTMLDivElement>;
}>): ReactElement {
  const [portalMounted, setPortalMounted] = useState(false);
  useLayoutEffect(() => setPortalMounted(true), []);
  // eslint-disable-next-line no-null/no-null
  const contentRef = useRef<HTMLDivElement | null>(null);
  // Capture the mount-time callback so the simulation fires exactly once, like the real event.
  const openAutoFocusRef = useRef(onOpenAutoFocus);
  useEffect(() => {
    if (!portalMounted) return;
    const event = new Event('openAutoFocus', { cancelable: true });
    openAutoFocusRef.current?.(event);
    if (event.defaultPrevented) return;
    const candidates = contentRef.current?.querySelectorAll<HTMLElement>('input, button') ?? [];
    const first = Array.from(candidates).find((el) => !el.hasAttribute('disabled'));
    first?.focus();
    if (first instanceof HTMLInputElement) first.select();
  }, [portalMounted]);
  if (!portalMounted) return <div data-testid={testId} />;
  return (
    <>
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div
        ref={contentRef}
        aria-label={ariaLabel}
        className={className}
        data-testid={testId}
        id={id}
        role={role}
        style={style}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onEscapeKeyDown?.(e.nativeEvent);
        }}
        onMouseDown={onMouseDown}
      >
        {children}
      </div>
      {onPointerDownOutside && (
        <button
          data-testid="popover-outside"
          type="button"
          onClick={(e) =>
            onPointerDownOutside(
              new CustomEvent('dismissableLayer.pointerDownOutside', {
                detail: { originalEvent: e.nativeEvent },
              }),
            )
          }
        >
          outside
        </button>
      )}
      {onCloseAutoFocus && (
        <button
          data-testid="popover-close"
          type="button"
          onClick={() => {
            const event = new Event('closeAutoFocus', { cancelable: true });
            onCloseAutoFocus(event);
            if (event.defaultPrevented) return;
            if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
          }}
        >
          close
        </button>
      )}
    </>
  );
}

/**
 * Stub label rendered as a native `<label>` element.
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

/** Stub keyboard-key display, rendering the same native `<kbd>` element the real component does. */
export function Kbd({
  children,
  className,
}: Readonly<{ children?: ReactNode; className?: string }>): ReactElement {
  return <kbd className={className}>{children}</kbd>;
}

/**
 * Marker component identifying the tooltip's hover text within a {@link Tooltip}. The real component
 * renders a portaled popover on hover; this stub carries no markup of its own — {@link Tooltip}
 * reads its text children and projects them onto the trigger (see there) so the tooltip text is
 * assertable on the trigger element without simulating hover.
 */
export function TooltipContent({ children: _children }: Readonly<{ children?: ReactNode }>): null {
  return null;
}

/**
 * Stub tooltip trigger. With `asChild` (the only mode the extension uses) the real component merges
 * its trigger onto the single child element rather than rendering a wrapper; this stub renders the
 * child unchanged and lets {@link Tooltip} clone it to attach the tooltip text. `asChild` is assumed
 * throughout, so no non-`asChild` fallback is modeled.
 */
export function TooltipTrigger({
  children,
}: Readonly<{ children?: ReactNode; asChild?: boolean }>): ReactElement {
  return <>{children}</>;
}

/**
 * Matches a localize key PAPI has not resolved yet, e.g. `%interlinearizer_boundaryControl_split%`,
 * wherever it sits in the surrounding content.
 */
const UNRESOLVED_LOCALIZE_KEY = /%[a-z][a-zA-Z0-9_]*%/i;

/**
 * Reading text of tooltip content, including text nested inside elements, so a tooltip carrying a
 * {@link Kbd} is still assertable as one string. Content with no text reads as `''`.
 */
function tooltipContentText(node: ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(tooltipContentText).join('');
  if (isValidElement(node)) return tooltipContentText(node.props.children);
  return '';
}

/**
 * Stub tooltip root. The real component shows {@link TooltipContent} in a portaled popover on hover;
 * because native and Radix tooltips are both invisible in jsdom, this stub instead reads the
 * `TooltipContent` text from its children and clones the `TooltipTrigger`'s child element with that
 * text applied as a `title` attribute. This keeps the tooltip text assertable on the trigger
 * element without simulating hover, while the real component supplies the modifier-key-immune
 * tooltip in production.
 *
 * A tooltip whose content contributes no text gets no `title` at all, rather than an empty one.
 *
 * Props cloned onto the tooltip itself pass through to that same trigger child, so an outer
 * `asChild` trigger — a {@link PopoverTrigger} wrapping a tooltipped button — reaches the button
 * rather than stopping here, matching how the real components compose. `open` is the exception: it
 * addresses the real tooltip's own visibility, so it never reaches the trigger element.
 *
 * @throws If rendered outside a {@link TooltipProvider}, as the real component does. A stub that
 *   rendered anywhere would let a tooltip placed outside every provider pass its tests and throw
 *   only once the extension ran.
 * @throws If the content still holds a `%…%` localize key, which would reach a user as hover text.
 *   Every tooltip's text passes through here, so this holds for any tooltip the suite renders.
 */
export function Tooltip({
  children,
  open,
  ...forwarded
}: Readonly<{ children?: ReactNode; open?: boolean }> & Record<string, unknown>): ReactNode {
  if (!useContext(TooltipProviderContext)) {
    throw new Error('`Tooltip` must be used within `TooltipProvider`');
  }

  let tooltipText: ReactNode;
  let triggerChild: ReactNode;
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    if (child.type === TooltipContent) tooltipText = child.props.children;
    if (child.type === TooltipTrigger) triggerChild = child.props.children;
  });
  if (!isValidElement(triggerChild)) return <>{children}</>;
  const text = tooltipContentText(tooltipText);
  if (UNRESOLVED_LOCALIZE_KEY.test(text)) {
    throw new Error(`Tooltip content carries an unresolved localize key: ${text}`);
  }
  return cloneElement(triggerChild, {
    ...forwarded,
    title: text === '' ? undefined : text,
  });
}

/**
 * Drives a tooltip that opens only when its trigger's text is clipped. Clipping needs measurement
 * jsdom does not do, so this one never opens; {@link Tooltip} keeps its text assertable regardless.
 */
export function useTruncationTooltip<T extends HTMLElement>(): {
  ref: RefObject<T | null>;
  open: boolean;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
} {
  // eslint-disable-next-line no-null/no-null
  const ref = useRef<T>(null);
  return { ref, open: false, onPointerEnter: () => {}, onPointerLeave: () => {} };
}

/** Whether a {@link TooltipProvider} encloses the tree. */
const TooltipProviderContext = createContext(false);

/**
 * Stub tooltip provider that shares hover-delay config across nested tooltips. The stub carries only
 * its own presence, the delay being unobservable in jsdom — that presence being the one modeled
 * behavior, since it satisfies the provider requirement {@link Tooltip} enforces.
 */
export function TooltipProvider({
  children,
}: Readonly<{ children?: ReactNode; delayDuration?: number }>): ReactElement {
  return <TooltipProviderContext.Provider value>{children}</TooltipProviderContext.Provider>;
}

/** The layout the enclosing {@link ResizablePanelGroup} currently holds, empty outside any group. */
const PanelLayoutContext = createContext<Readonly<Record<string, number>>>({});

/**
 * Moves the enclosing group's panels by a percentage of it, as the real handle's own key presses
 * do. A positive step widens the last panel, the one the handle is anchored beside.
 */
const PanelStepContext = createContext<(step: number) => void>(() => {});

/** The limits a panel is held within, in the CSS units the real panel takes them in. */
interface PanelConstraints {
  /** Narrowest the panel may be, unlimited when absent. */
  minSize?: string | number;
  /** Widest the panel may be, unlimited when absent. */
  maxSize?: string | number;
}

/**
 * Registers a panel and its limits with the enclosing group for as long as it is mounted, returning
 * its removal. A group reports a layout over the panels mounted at the time and holds them within
 * their limits, so it has to know both.
 */
const PanelRegistryContext = createContext<(id: string, constraints: PanelConstraints) => () => void>(
  () => () => {},
);

/**
 * How wide a group is taken to be when resolving a panel's pixel limits against it. jsdom lays
 * nothing out, so every element measures zero and a real measurement would leave every pixel limit
 * unenforceable; a fixed width gives the limits something to bite on.
 */
const GROUP_WIDTH = 1000;

/**
 * Converts one of a panel's limits to a percentage of the group, the unit a layout is held in.
 *
 * @returns The limit as a percentage, or nothing for a limit that is absent or in a unit jsdom
 *   cannot resolve — either way one to leave unenforced.
 */
function limitAsPercentage(limit: string | number | undefined): number | undefined {
  if (limit === undefined) return undefined;
  if (typeof limit === 'number') return limit;
  const pixels = /^(\d+(?:\.\d+)?)px$/.exec(limit);
  if (!pixels) return undefined;
  return (Number(pixels[1]) / GROUP_WIDTH) * 100;
}

/** A resizable group's handle for reading and moving its panels once it has mounted. */
interface GroupImperativeHandle {
  /** The layout the panels currently hold. */
  getLayout: () => Readonly<Record<string, number>>;
  /** Moves the panels, returning the layout as the group normalized it. */
  setLayout: (layout: Readonly<Record<string, number>>) => Readonly<Record<string, number>>;
}

/** Rescales a layout to sum to 100, as the real group does to whatever it is handed. */
function normalizeLayout(
  layout: Readonly<Record<string, number>>,
): Readonly<Record<string, number>> {
  const total = Object.values(layout).reduce((sum, size) => sum + size, 0);
  if (total === 0 || total === 100) return layout;
  return Object.fromEntries(
    Object.entries(layout).map(([id, size]) => [id, (size / total) * 100]),
  );
}

/**
 * Narrows a layout to the panels currently mounted, the shape the real group reports one in.
 *
 * @returns The mounted panels' shares, normalized so they hold the whole group between them. The
 *   layout as it came when no panel has registered, there being nothing to report it over.
 */
function layoutOverMounted(
  layout: Readonly<Record<string, number>>,
  mountedIds: readonly string[],
): Readonly<Record<string, number>> {
  if (mountedIds.length === 0) return layout;
  return normalizeLayout(Object.fromEntries(mountedIds.map((id) => [id, layout[id] ?? 0])));
}

/**
 * Refuses a layout naming any panel other than those mounted, as the real group does and in the
 * same words. The real group compares counts rather than ids, so a layout of the right size naming
 * the wrong panel passes here too.
 *
 * @throws If the layout names a different number of panels than are mounted.
 */
function assertLayoutOverMounted(
  layout: Readonly<Record<string, number>>,
  mountedIds: readonly string[],
): void {
  const sizes = Object.values(layout);
  if (sizes.length !== mountedIds.length)
    throw new Error(
      `Invalid ${mountedIds.length} panel layout: ${sizes.map((size) => `${size}%`).join(', ')}`,
    );
}

/** Whether two layouts name the same panels at the same sizes. */
function shallowEqualLayout(
  a: Readonly<Record<string, number>>,
  b: Readonly<Record<string, number>>,
): boolean {
  const ids = Object.keys(a);
  if (ids.length !== Object.keys(b).length) return false;
  return ids.every((id) => a[id] === b[id]);
}

/**
 * Holds a layout within its panels' limits, as the real group does to whatever it is handed.
 *
 * @returns A layout no panel exceeds its limits in, still normalized: width taken off a panel at a
 *   limit is passed to one with room for it. Panels whose limits jsdom cannot resolve are left as
 *   they came.
 */
function clampLayout(
  layout: Readonly<Record<string, number>>,
  constraints: ReadonlyMap<string, PanelConstraints>,
): Readonly<Record<string, number>> {
  const clamped = { ...layout };
  let spare = 0;
  Object.keys(clamped).forEach((id) => {
    const limits = constraints.get(id);
    if (!limits) return;
    const min = limitAsPercentage(limits.minSize) ?? 0;
    const max = limitAsPercentage(limits.maxSize) ?? 100;
    const held = Math.min(max, Math.max(min, clamped[id]));
    spare += clamped[id] - held;
    clamped[id] = held;
  });

  // Whatever clamping freed goes to the first panel that can take it, the others having been held
  // at a limit precisely so they would not grow.
  if (spare !== 0) {
    const taker = Object.keys(clamped).find((id) => {
      const limits = constraints.get(id);
      if (!limits) return true;
      const min = limitAsPercentage(limits.minSize) ?? 0;
      const max = limitAsPercentage(limits.maxSize) ?? 100;
      return clamped[id] + spare >= min && clamped[id] + spare <= max;
    });
    if (taker !== undefined) clamped[taker] += spare;
  }

  return clamped;
}

/**
 * Stub resizable group, rendering its panels in order under the layout it holds. Real layout needs
 * measurement jsdom does not do, so the layout is published rather than applied.
 *
 * `defaultLayout` seeds the layout on mount and is ignored thereafter, as the real group's is, so a
 * caller that resizes by writing that prop alone moves nothing here either. Moving the panels after
 * mount goes through the handle on `groupRef`. It is taken only when it names exactly the panels
 * mounted, again as the real group takes it, so a caller whose stored layout names a panel that
 * mounted closed has to apply that layout itself once the panel joins.
 *
 * The layout is normalized, held within its panels' `minSize`/`maxSize`, and reported back through
 * `onLayoutChanged`, as the real group does, so a caller storing what it is handed stores the
 * layout the group settled on rather than the one it asked for. What is reported covers only the
 * panels mounted at the time, as the real group's does, so unmounting one has the rest reported
 * holding the whole group between them.
 *
 * Pixel limits are resolved against {@link GROUP_WIDTH} rather than a measurement.
 */
export function ResizablePanelGroup({
  children,
  className,
  defaultLayout,
  groupRef,
  onLayoutChanged,
}: Readonly<{
  children?: ReactNode;
  className?: string;
  defaultLayout?: Readonly<Record<string, number>>;
  groupRef?: RefObject<GroupImperativeHandle | null>;
  onLayoutChanged?: (layout: Readonly<Record<string, number>>) => void;
  orientation?: 'horizontal' | 'vertical';
}>): ReactElement {
  const [layout, setLayout] = useState<Readonly<Record<string, number>>>({});

  // Held in state rather than a ref so registering or unregistering a panel re-renders the group,
  // that render being what reports the layout afresh.
  const [mountedIds, setMountedIds] = useState<readonly string[]>([]);

  // A ref rather than state because the limits are read while resizing rather than rendered, and a
  // panel registering during commit would otherwise need a further render to be clamped against.
  const constraintsRef = useRef(new Map<string, PanelConstraints>());

  const registerPanel = useCallback((id: string, constraints: PanelConstraints) => {
    constraintsRef.current.set(id, constraints);
    setMountedIds((current) => [...current, id]);
    return () => {
      constraintsRef.current.delete(id);
      setMountedIds((current) => {
        const index = current.indexOf(id);
        if (index < 0) return current;
        return [...current.slice(0, index), ...current.slice(index + 1)];
      });
    };
  }, []);

  // Seeded after the panels have registered rather than from the initial state, there being no
  // count to match against until they have. A layout stored while a panel was closed therefore does
  // not come back by itself on the next mount, leaving the caller to apply it.
  const seededRef = useRef(false);
  useLayoutEffect(() => {
    if (seededRef.current || mountedIds.length === 0) return;
    seededRef.current = true;
    if (defaultLayout === undefined || Object.keys(defaultLayout).length !== mountedIds.length)
      return;
    setLayout(normalizeLayout(defaultLayout));
    // Seeding is a mount-time reading of the prop, so later changes to it are deliberately ignored.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mountedIds]);

  const reportedLayout = useMemo(() => layoutOverMounted(layout, mountedIds), [layout, mountedIds]);

  // Read through refs so the handle can be installed once rather than replaced on every resize.
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const mountedIdsRef = useRef(mountedIds);
  mountedIdsRef.current = mountedIds;

  // The layout last handed to `onLayoutChanged`, so that the same one is not reported twice. Held
  // through a resize and the render it causes, hence a ref rather than state.
  const reportedRef = useRef<Readonly<Record<string, number>> | undefined>(undefined);
  const onLayoutChangedRef = useRef(onLayoutChanged);
  onLayoutChangedRef.current = onLayoutChanged;

  const report = useCallback((next: Readonly<Record<string, number>>) => {
    if (reportedRef.current && shallowEqualLayout(reportedRef.current, next)) return;
    reportedRef.current = next;
    onLayoutChangedRef.current?.(next);
  }, []);

  useLayoutEffect(() => {
    if (!groupRef) return undefined;
    const handle = groupRef;
    handle.current = {
      getLayout: () => layoutRef.current,
      setLayout: (next) => {
        // Refused rather than quietly corrected, because the real group refuses: a caller that
        // resizes before a panel has registered takes the app down, and a stub that accepted it
        // would leave that reachable only in the app.
        assertLayoutOverMounted(next, mountedIdsRef.current);
        const settled = clampLayout(normalizeLayout(next), constraintsRef.current);
        setLayout(settled);
        // Reported within the call rather than from an effect, as the real group reports it, so a
        // caller that writes its own layout after calling this overwrites the settled one rather
        // than being corrected by it afterwards.
        report(layoutOverMounted(settled, mountedIdsRef.current));
        return settled;
      },
    };
    return () => {
      handle.current = null;
    };
  }, [groupRef, report]);

  useEffect(() => {
    report(reportedLayout);
  }, [report, reportedLayout]);

  const step = useCallback((percentage: number) => {
    setLayout((current) => {
      const ids = Object.keys(current);
      if (ids.length < 2) return current;
      const first = ids[0];
      const last = ids[ids.length - 1];
      const moved = Math.min(100, Math.max(0, current[last] + percentage));
      return clampLayout(
        normalizeLayout({ ...current, [first]: 100 - moved, [last]: moved }),
        constraintsRef.current,
      );
    });
  }, []);

  return (
    <PanelLayoutContext.Provider value={layout}>
      <PanelStepContext.Provider value={step}>
        <PanelRegistryContext.Provider value={registerPanel}>
          <div className={className} data-testid="resizable-panel-group">
            {children}
          </div>
        </PanelRegistryContext.Provider>
      </PanelStepContext.Provider>
    </PanelLayoutContext.Provider>
  );
}

/**
 * Stub resizable panel, publishing the share of the group it holds as `data-panel-layout`.
 *
 * `panelRef` is handed a stand-in handle once the panel has registered with the group and `null` as
 * it unregisters, matching when the real panel's handle arrives and goes. That timing is the point
 * of it: a caller waits on the handle to know the group will accept a layout naming this panel.
 */
export function ResizablePanel({
  children,
  id,
  minSize,
  maxSize,
  panelRef,
}: Readonly<{
  children?: ReactNode;
  id?: string;
  minSize?: string | number;
  maxSize?: string | number;
  panelRef?: (handle: object | null) => void;
}>): ReactElement {
  const layout = useContext(PanelLayoutContext);

  // Read through a ref so that a caller passing an inline callback does not re-register the panel,
  // which would hand the caller an unregistration on every render.
  const panelRefCallbackRef = useRef(panelRef);
  panelRefCallbackRef.current = panelRef;

  const registerPanel = useContext(PanelRegistryContext);
  useEffect(() => {
    if (id === undefined) return undefined;
    const unregister = registerPanel(id, { minSize, maxSize });
    panelRefCallbackRef.current?.({});
    return () => {
      // eslint-disable-next-line no-null/no-null -- "null" is what a detaching ref callback receives
      panelRefCallbackRef.current?.(null);
      unregister();
    };
  }, [id, maxSize, minSize, registerPanel]);

  return (
    <div
      data-max-size={maxSize}
      data-min-size={minSize}
      data-panel-id={id}
      data-panel-layout={id === undefined ? undefined : layout[id]}
    >
      {children}
    </div>
  );
}

/**
 * How far each key the real handle acts on moves it, as a percentage of the group. The jump keys
 * are given more of it than any panel may hold, so they land against a limit rather than part way.
 */
const HANDLE_KEY_STEPS: Readonly<Record<string, number>> = {
  ArrowLeft: -5,
  ArrowRight: 5,
  Home: -100,
  End: 100,
};

/**
 * Stub resize handle, focusable and keyboard-driven as the real one is. Dragging it needs pointer
 * behavior jsdom does not have, so only its keyboard half stands.
 *
 * Its keys are answered from a listener on the element rather than a React prop, as the real
 * handle's are, so that a caller binding its own listener meets the same ordering it would in the
 * app — the ordering that decides whether a press it means to claim reaches this one anyway. The
 * steps are signed without reference to the interface direction, mirroring nothing, because the
 * real handle mirrors nothing either.
 */
export function ResizableHandle({
  elementRef,
  ...props
}: Readonly<{
  elementRef?: (element: HTMLElement | null) => void;
  'aria-label'?: string;
  'data-testid'?: string;
  withHandle?: boolean;
}>): ReactElement {
  const onStep = useContext(PanelStepContext);
  const onStepRef = useRef(onStep);
  onStepRef.current = onStep;

  const attach = useCallback(
    (element: HTMLDivElement | null) => {
      elementRef?.(element);
      if (!element) return;
      element.addEventListener('keydown', (event: KeyboardEvent) => {
        // The real handle starts by standing down for a press another listener already claimed.
        if (event.defaultPrevented) return;
        const step = HANDLE_KEY_STEPS[event.key];
        if (step === undefined) return;
        event.preventDefault();
        onStepRef.current(step);
      });
    },
    [elementRef],
  );

  return (
    <div
      aria-label={props['aria-label']}
      data-testid={props['data-testid']}
      ref={attach}
      role="separator"
      tabIndex={0}
    />
  );
}
