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
 * Context carrying the {@link Dialog}'s open-state change handler and generated title id down to
 * {@link DialogContent} and {@link DialogTitle}, mirroring how the real Radix-based component
 * reaches its parts from the root.
 */
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
 */
export function PopoverTrigger({
  children,
}: Readonly<{ children?: ReactNode; asChild?: boolean }>): ReactNode {
  const { onOpenChange, open = false } = useContext(PopoverContext);
  if (!isValidElement(children)) return <>{children}</>;
  return cloneElement(children, {
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
 */
export function Tooltip({ children }: Readonly<{ children?: ReactNode }>): ReactNode {
  let tooltipText: ReactNode;
  let triggerChild: ReactNode;
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    if (child.type === TooltipContent) tooltipText = child.props.children;
    if (child.type === TooltipTrigger) triggerChild = child.props.children;
  });
  if (!isValidElement(triggerChild)) return <>{children}</>;
  const text = tooltipContentText(tooltipText);
  return cloneElement(triggerChild, { title: text === '' ? undefined : text });
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

/** Stub empty-state message, carrying the `role="status"` the real component announces through. */
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
 * Stub tooltip provider that shares hover-delay config across nested tooltips. The stub renders its
 * children unchanged; the delay has no effect in tests.
 */
export function TooltipProvider({
  children,
}: Readonly<{ children?: ReactNode; delayDuration?: number }>): ReactElement {
  return <>{children}</>;
}

/** The layout the enclosing {@link ResizablePanelGroup} was given, empty outside any group. */
const PanelLayoutContext = createContext<Readonly<Record<string, number>>>({});

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
 * Stub resizable group, rendering its panels in order under the layout it was given. Real layout
 * needs measurement jsdom does not do, so the layout is published rather than applied.
 *
 * The layout is normalized and reported back through `onLayoutChanged`, as the real group does, so
 * a caller storing what it is handed stores it in the unit the app would give it.
 */
export function ResizablePanelGroup({
  children,
  className,
  defaultLayout,
  onLayoutChanged,
}: Readonly<{
  children?: ReactNode;
  className?: string;
  defaultLayout?: Readonly<Record<string, number>>;
  onLayoutChanged?: (layout: Readonly<Record<string, number>>) => void;
  orientation?: 'horizontal' | 'vertical';
}>): ReactElement {
  const layout = normalizeLayout(defaultLayout ?? {});
  useEffect(() => {
    onLayoutChanged?.(layout);
    // Keyed on the layout's contents, a fresh object each render otherwise reporting every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(layout)]);
  return (
    <PanelLayoutContext.Provider value={layout}>
      <div className={className} data-testid="resizable-panel-group">
        {children}
      </div>
    </PanelLayoutContext.Provider>
  );
}

/** Stub resizable panel, publishing the share of the group it holds as `data-panel-layout`. */
export function ResizablePanel({
  children,
  id,
  minSize,
  maxSize,
}: Readonly<{
  children?: ReactNode;
  id?: string;
  minSize?: string | number;
  maxSize?: string | number;
}>): ReactElement {
  const layout = useContext(PanelLayoutContext);
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
 * Stub resize handle, focusable and keyboard-driven as the real one is. Dragging it needs pointer
 * behavior jsdom does not have, so only its keyboard half stands.
 */
export function ResizableHandle({
  onKeyDown,
  ...props
}: Readonly<{
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  'aria-label'?: string;
  'data-testid'?: string;
  withHandle?: boolean;
}>): ReactElement {
  return (
    <div
      aria-label={props['aria-label']}
      data-testid={props['data-testid']}
      onKeyDown={onKeyDown}
      role="separator"
      tabIndex={0}
    />
  );
}
