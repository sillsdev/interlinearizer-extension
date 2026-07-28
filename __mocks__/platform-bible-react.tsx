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


/**
 * Stub toolbar that renders project-menu and view-info buttons using sentinel menu items so tests
 * can trigger menu commands without a real toolbar implementation.
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
 *
 * @param props.type - Input type; defaults to `text`.
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
 * Stub popover root that renders its children unconditionally. The extension conditionally mounts
 * the content component while open (so its draft state re-initializes per open), so visibility
 * needs no simulation here.
 */
export function Popover({
  children,
}: Readonly<{ children?: ReactNode; open?: boolean; modal?: boolean }>): ReactElement {
  return <>{children}</>;
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
 * Stub popover content rendered as a plain `<div data-testid="popover-content">`. The real
 * component implements positioning, portaling, and dismissal internally; this stub exposes the
 * dismissal callbacks so tests can simulate them:
 *
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
 *   simulating Radix's focus-restoration event fired as the popover closes.
 */
export function PopoverContent({
  children,
  className,
  onEscapeKeyDown,
  onPointerDownOutside,
  onOpenAutoFocus,
  onCloseAutoFocus,
  onClick,
  onMouseDown,
}: Readonly<{
  children?: ReactNode;
  className?: string;
  align?: 'start' | 'center' | 'end';
  sideOffset?: number;
  onEscapeKeyDown?: (event: KeyboardEvent) => void;
  onPointerDownOutside?: (event: CustomEvent) => void;
  onOpenAutoFocus?: (event: Event) => void;
  onCloseAutoFocus?: (event: Event) => void;
  onClick?: MouseEventHandler<HTMLDivElement>;
  onMouseDown?: MouseEventHandler<HTMLDivElement>;
}>): ReactElement {
  // Radix's portal renders no children until its own layout effect has run, so the panel's content
  // is absent for the first commit. Mirrored here so a consumer that reaches for a child from its
  // mount effect fails the same way it does in the app instead of silently passing.
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
    // The sentinels below are test scaffolding, not panel content, so they are never focus targets.
    const first = Array.from(candidates).find(
      (el) => !el.hasAttribute('disabled') && !el.dataset.testid?.startsWith('popover-'),
    );
    first?.focus();
    if (first instanceof HTMLInputElement) first.select();
  }, [portalMounted]);
  if (!portalMounted) return <div data-testid="popover-content" />;
  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      ref={contentRef}
      className={className}
      data-testid="popover-content"
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onEscapeKeyDown?.(e.nativeEvent);
      }}
      onMouseDown={onMouseDown}
    >
      {children}
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
          onClick={() => onCloseAutoFocus(new Event('closeAutoFocus'))}
        >
          close
        </button>
      )}
    </div>
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
 * Stub tooltip root. The real component shows {@link TooltipContent} in a portaled popover on hover;
 * because native and Radix tooltips are both invisible in jsdom, this stub instead reads the
 * `TooltipContent` text from its children and clones the `TooltipTrigger`'s child element with that
 * text applied as a `title` attribute. This keeps the tooltip text assertable on the trigger
 * element (mirroring where hover text lived before the migration) without simulating hover, while
 * the real component supplies the modifier-key-immune tooltip in production.
 *
 * @returns The trigger's child element cloned with the tooltip text as its `title`.
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
  const title = typeof tooltipText === 'string' ? tooltipText : undefined;
  return cloneElement(triggerChild, { title });
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
