/**
 * @file Jest mock for platform-bible-react. The real package ships ESM which Jest cannot parse
 * without extra transform configuration. This stub provides the subset used by the extension.
 */

import { Children, cloneElement, forwardRef, isValidElement, useEffect, useRef } from 'react';
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
 * Stub button that passes the attributes the extension relies on through to a native `<button>`
 * element; `variant` and `size` are accepted but ignored (jsdom does not apply styling, so tests
 * assert on behavior/testid/role, not the visual variant). The mouse/keyboard handlers and
 * `tabIndex`/`style` are forwarded so migrated icon buttons keep their hover-preview and
 * focus-skipping behavior under test.
 *
 * @param props - Component props.
 * @param props.children - Button content.
 * @param props.onClick - Click handler.
 * @param props.onMouseEnter - Pointer-enter handler (icon buttons use it to preview hover state).
 * @param props.onMouseLeave - Pointer-leave handler (clears the previewed hover state).
 * @param props.onMouseDown - Pointer-down handler (e.g. to preventDefault and keep input focus).
 * @param props.type - HTML button type attribute.
 * @param props.className - CSS class names.
 * @param props.style - Inline styles (icon buttons use it for absolute positioning).
 * @param props.title - Native tooltip text; the {@link Tooltip} stub clones its trigger child with
 *   this prop, so a `Button` used as a `TooltipTrigger asChild` child must forward it.
 * @param props.disabled - Whether the button is disabled.
 * @param props.tabIndex - Tab order; icon buttons set `-1` to skip them in keyboard navigation.
 * @param props.variant - Ignored styling variant.
 * @param props.size - Ignored size variant.
 * @param props['aria-label'] - Accessible label.
 * @param props['aria-expanded'] - Expanded state for popup triggers.
 * @param props['aria-haspopup'] - Haspopup attribute.
 * @param props['aria-controls'] - ID of the element the button controls (e.g. a listbox popup).
 * @param props['aria-hidden'] - Hides the button from the accessibility tree when it is inert.
 * @param props['data-testid'] - Test identifier.
 * @param ref - Forwarded ref to the underlying button element.
 * @returns A native `<button>` element with standard attributes forwarded.
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
 * @param props - Component props.
 * @param props.id - HTML `id` attribute (labels bind to it via `htmlFor`).
 * @param props.type - Input type; defaults to `text`.
 * @param props.value - Controlled value.
 * @param props.placeholder - Placeholder text.
 * @param props.className - CSS class names.
 * @param props.style - Inline styles.
 * @param props.disabled - Whether the input is disabled.
 * @param props.onChange - Change handler.
 * @param props.onKeyDown - Key-down handler (inline editors commit/cancel on Enter/Escape).
 * @param props['aria-label'] - Accessible label.
 * @param props['data-testid'] - Test identifier.
 * @param ref - Forwarded ref to the underlying input element.
 * @returns A native `<input>` element with the forwarded attributes.
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
 *
 * @param props - Component props.
 * @param props.id - HTML `id` attribute (labels bind to it via `htmlFor`).
 * @param props.value - Controlled value.
 * @param props.placeholder - Placeholder text.
 * @param props.className - CSS class names.
 * @param props.rows - Visible row count.
 * @param props.disabled - Whether the textarea is disabled.
 * @param props.onChange - Change handler.
 * @param props['data-testid'] - Test identifier.
 * @param ref - Forwarded ref to the underlying textarea element.
 * @returns A native `<textarea>` element with the forwarded attributes.
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
 * Stub popover root that renders its children unconditionally. The extension conditionally mounts
 * the content component while open (so its draft state re-initializes per open), so visibility
 * needs no simulation here.
 *
 * @param props - Component props.
 * @param props.children - Anchor and (while open) content elements.
 * @returns The children unchanged.
 */
export function Popover({
  children,
}: Readonly<{ children?: ReactNode; open?: boolean; modal?: boolean }>): ReactElement {
  return <>{children}</>;
}

/**
 * Stub popover anchor that renders its children as-is, matching the real component's `asChild`
 * pass-through behavior.
 *
 * @param props - Component props.
 * @param props.children - The element the popover is anchored to.
 * @returns The children unchanged.
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
 * - `onOpenAutoFocus` is invoked once on mount (mirroring Radix's open auto-focus event).
 * - An Escape keydown anywhere inside the content invokes `onEscapeKeyDown`.
 * - A sentinel `data-testid="popover-outside"` button invokes `onInteractOutside` on click,
 *   simulating a pointer interaction outside the popover.
 * - A sentinel `data-testid="popover-close"` button invokes `onCloseAutoFocus` on click,
 *   simulating Radix's focus-restoration event fired as the popover closes.
 *
 * @param props - Component props.
 * @param props.children - Panel content.
 * @param props.className - CSS class names forwarded to the div.
 * @param props.onEscapeKeyDown - Called with the native `KeyboardEvent` when Escape is pressed
 *   inside the content, matching Radix's signature.
 * @param props.onInteractOutside - Called with a `CustomEvent` carrying the original pointer event
 *   in `detail.originalEvent` when the sentinel outside button is clicked, matching the shape of
 *   Radix's `PointerDownOutsideEvent`.
 * @param props.onOpenAutoFocus - Called once on mount with a plain `Event`.
 * @param props.onCloseAutoFocus - Called with a plain `Event` when the sentinel close button is
 *   clicked, mirroring Radix's close-time focus-restoration event.
 * @param props.onClick - Click handler forwarded to the div.
 * @param props.onMouseDown - Mouse-down handler forwarded to the div.
 * @returns A `<div data-testid="popover-content">` with the panel content and sentinel controls.
 */
export function PopoverContent({
  children,
  className,
  onEscapeKeyDown,
  onInteractOutside,
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
  onInteractOutside?: (event: CustomEvent) => void;
  onOpenAutoFocus?: (event: Event) => void;
  onCloseAutoFocus?: (event: Event) => void;
  onClick?: MouseEventHandler<HTMLDivElement>;
  onMouseDown?: MouseEventHandler<HTMLDivElement>;
}>): ReactElement {
  // Capture the mount-time callback so the simulation fires exactly once, like the real event.
  const openAutoFocusRef = useRef(onOpenAutoFocus);
  useEffect(() => {
    openAutoFocusRef.current?.(new Event('openAutoFocus'));
  }, []);
  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      className={className}
      data-testid="popover-content"
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onEscapeKeyDown?.(e.nativeEvent);
      }}
      onMouseDown={onMouseDown}
    >
      {children}
      {onInteractOutside && (
        <button
          data-testid="popover-outside"
          type="button"
          onClick={(e) =>
            onInteractOutside(
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

/**
 * Marker component identifying the tooltip's hover text within a {@link Tooltip}. The real component
 * renders a portaled popover on hover; this stub carries no markup of its own — {@link Tooltip}
 * reads its text children and projects them onto the trigger (see there) so the tooltip text is
 * assertable on the trigger element without simulating hover.
 *
 * @param props - Component props.
 * @param props.children - The tooltip text.
 * @returns `null`; the text is surfaced by {@link Tooltip}, not rendered here.
 */
export function TooltipContent({ children: _children }: Readonly<{ children?: ReactNode }>): null {
  return null;
}

/**
 * Stub tooltip trigger. With `asChild` (the only mode the extension uses) the real component merges
 * its trigger onto the single child element rather than rendering a wrapper; this stub renders the
 * child unchanged and lets {@link Tooltip} clone it to attach the tooltip text. `asChild` is assumed
 * throughout, so no non-`asChild` fallback is modeled.
 *
 * @param props - Component props.
 * @param props.children - The element the tooltip is anchored to.
 * @returns The child unchanged.
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
 * @param props - Component props.
 * @param props.children - A {@link TooltipTrigger} and a {@link TooltipContent}, in either order.
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
 *
 * @param props - Component props.
 * @param props.children - The subtree whose tooltips share this provider.
 * @returns The children unchanged.
 */
export function TooltipProvider({
  children,
}: Readonly<{ children?: ReactNode; delayDuration?: number }>): ReactElement {
  return <>{children}</>;
}
