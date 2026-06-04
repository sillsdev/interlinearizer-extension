/** @file Dropdown menu for view-mode toggles in the toolbar. */
import { useLocalizedStrings } from '@papi/frontend/react';
import { Button, Label, Switch } from 'platform-bible-react';
import { Settings } from 'lucide-react';
import { useId, useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';

const STRING_KEYS = [
  '%interlinearizer_viewOption_continuousScroll%',
  '%interlinearizer_viewOption_hideInactiveLinkButtons%',
  '%interlinearizer_viewOption_simplifyPhrases%',
] as const satisfies `%${string}%`[];

/**
 * A labeled on/off switch row used inside the view options dropdown.
 *
 * @param props - Component props
 * @param props.checked - Current toggle value.
 * @param props.label - Visible label text for the toggle.
 * @param props.onCheckedChange - Called when the user flips the switch.
 * @returns A flex row containing a switch and its label.
 */
function ViewToggle({
  checked,
  label,
  onCheckedChange,
}: Readonly<{
  checked: boolean;
  label: string;
  onCheckedChange: (checked: boolean) => void;
}>) {
  const switchId = useId();
  return (
    <div className="tw:flex tw:items-center tw:justify-between tw:gap-4">
      <Label className="tw:cursor-pointer tw:text-sm" htmlFor={switchId}>
        {label}
      </Label>
      <Switch checked={checked} id={switchId} onCheckedChange={onCheckedChange} />
    </div>
  );
}

/** Props for {@link ViewOptionsDropdown}. */
type ViewOptionsDropdownProps = Readonly<{
  /** Current value of the continuous-scroll toggle. */
  continuousScroll: boolean;
  /** Whether the continuous-scroll toggle should be disabled (setting is loading). */
  continuousScrollDisabled?: boolean;
  /**
   * Called when the user flips the continuous-scroll switch. The caller is responsible for
   * persisting the new value; the component forwards the value directly.
   */
  onContinuousScrollChange: (checked: boolean) => void;
  /** Current value of the hide-inactive-link-buttons toggle. */
  hideInactiveLinkButtons: boolean;
  /** Called when the hide-inactive-link-buttons toggle changes. */
  onHideInactiveLinkButtonsChange: (checked: boolean) => void;
  /** Current value of the dim-inactive-segments toggle. */
  simplifyPhrases: boolean;
  /** Called when the dim-inactive-segments toggle changes. */
  onSimplifyPhrasesChange: (checked: boolean) => void;
}>;

/**
 * Toolbar dropdown that groups the continuous-scroll toggle and two view-mode toggles (hide
 * inactive link buttons, dim inactive segments). Opens and closes via a gear icon button.
 *
 * @param props - Component props
 * @param props.continuousScroll - Current continuous-scroll value.
 * @param props.continuousScrollDisabled - Whether the continuous-scroll toggle is disabled.
 * @param props.onContinuousScrollChange - Continuous-scroll change callback.
 * @param props.hideInactiveLinkButtons - Current hide-inactive-link-buttons value.
 * @param props.onHideInactiveLinkButtonsChange - Hide-inactive-link-buttons change callback.
 * @param props.simplifyPhrases - Current dim-inactive-segments value.
 * @param props.onSimplifyPhrasesChange - Dim-inactive-segments change callback.
 * @returns A gear button that opens a dropdown panel of view toggles.
 */
export default function ViewOptionsDropdown({
  continuousScroll,
  continuousScrollDisabled = false,
  onContinuousScrollChange,
  hideInactiveLinkButtons,
  onHideInactiveLinkButtonsChange,
  simplifyPhrases,
  onSimplifyPhrasesChange,
}: ViewOptionsDropdownProps) {
  const [localizedStrings] = useLocalizedStrings(STRING_KEYS);
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | undefined>(undefined);
  const [panelStyle, setPanelStyle] = useState<{ top: number; right: number }>({
    top: 0,
    right: 0,
  });

  /**
   * Ref callback that stores the toggle button element for future focus restoration.
   *
   * @param el - The mounted button, or `null` on unmount.
   */
  const setButtonRef = (el: HTMLButtonElement | null) => {
    buttonRef.current = el ?? undefined;
  };

  /**
   * Closes the dropdown and returns focus to the toggle button so keyboard users don't lose their
   * position.
   */
  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  // Recompute panel position whenever the dropdown opens so it tracks the button even after layout
  // changes (e.g. window resize).
  useEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setPanelStyle({
      top: rect.bottom + 4,
      right: window.innerWidth - rect.right,
    });
  }, [open]);

  return (
    <div className="tw:mt-1 tw:mr-1">
      <Button
        ref={setButtonRef}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="View options"
        className="tw:h-7 tw:w-7 tw:p-0"
        data-testid="view-options-button"
        size="icon"
        variant="ghost"
        onClick={() => setOpen((v) => !v)}
      >
        <Settings className="tw:h-4 tw:w-4" />
      </Button>

      {open &&
        createPortal(
          /* Clicking outside the panel closes it. */
          <>
            <div
              aria-hidden="true"
              className="tw:fixed tw:inset-0 tw:z-20"
              onClick={close}
              onKeyDown={undefined}
              role="presentation"
            />
            <div
              aria-label="View options"
              className="tw:fixed tw:z-30 tw:min-w-56 tw:rounded-md tw:border tw:border-border tw:bg-popover tw:p-3 tw:shadow-md tw:flex tw:flex-col tw:gap-3"
              data-testid="view-options-panel"
              role="dialog"
              style={{ top: panelStyle.top, right: panelStyle.right }}
            >
              <ViewToggle
                checked={continuousScroll}
                label={localizedStrings['%interlinearizer_viewOption_continuousScroll%']}
                onCheckedChange={(v) => {
                  if (!continuousScrollDisabled) onContinuousScrollChange(v);
                }}
              />
              <ViewToggle
                checked={hideInactiveLinkButtons}
                label={localizedStrings['%interlinearizer_viewOption_hideInactiveLinkButtons%']}
                onCheckedChange={onHideInactiveLinkButtonsChange}
              />
              <ViewToggle
                checked={simplifyPhrases}
                label={localizedStrings['%interlinearizer_viewOption_simplifyPhrases%']}
                onCheckedChange={onSimplifyPhrasesChange}
              />
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}
