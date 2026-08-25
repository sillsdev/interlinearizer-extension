import { useLocalizedStrings } from '@papi/frontend/react';
import {
  Button,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Switch,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from 'platform-bible-react';
import { Settings } from 'lucide-react';
import { useId, useState } from 'react';
import { resolvedOrEmpty, tooltipContentOrUndefined } from '../../utils/localized-strings';
import { TOOLTIP_DELAY_MS } from '../tooltip-delay';

const STRING_KEYS = [
  '%interlinearizer_viewOption_continuousScroll%',
  '%interlinearizer_viewOption_hideInactiveLinkButtons%',
  '%interlinearizer_viewOption_simplifyPhrases%',
  '%interlinearizer_viewOption_showMorphology%',
  '%interlinearizer_viewOption_showFreeTranslation%',
  '%interlinearizer_viewOption_showVerseGutter%',
  '%interlinearizer_viewOption_freeScrollStrip%',
  '%interlinearizer_viewOption_showSuggestions%',
  '%interlinearizer_viewOptions_label%',
] as const satisfies `%${string}%`[];

/**
 * A labeled on/off switch row used inside the view options dropdown.
 *
 * @param props.checked - Current toggle value.
 * @param props.label - Visible label text for the toggle.
 * @param props.onCheckedChange - Called when the user flips the switch.
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
  /**
   * Called when the user flips the continuous-scroll switch. The caller is responsible for
   * persisting the new value; the component forwards the value directly.
   */
  onContinuousScrollChange: (checked: boolean) => void;
  /** Current value of the hide-inactive-link-buttons toggle. */
  hideInactiveLinkButtons: boolean;
  /** Called when the hide-inactive-link-buttons toggle changes. */
  onHideInactiveLinkButtonsChange: (checked: boolean) => void;
  /**
   * Current value of the simplify-phrases toggle. When on, only the focused phrase exposes
   * interactive controls; every other phrase hides them.
   */
  simplifyPhrases: boolean;
  /** Called when the simplify-phrases toggle changes. */
  onSimplifyPhrasesChange: (checked: boolean) => void;
  /** Current value of the show-morphology toggle. */
  showMorphology: boolean;
  /** Called when the show-morphology toggle changes. */
  onShowMorphologyChange: (checked: boolean) => void;
  /** Current value of the show-free-translation toggle. */
  showFreeTranslation: boolean;
  /** Called when the show-free-translation toggle changes. */
  onShowFreeTranslationChange: (checked: boolean) => void;
  /**
   * Current value of the show-verse-gutter toggle. When on, segments show their verse range in a
   * left gutter column instead of the inline verse superscripts.
   */
  showVerseGutter: boolean;
  /** Called when the show-verse-gutter toggle changes. */
  onShowVerseGutterChange: (checked: boolean) => void;
  /**
   * Current value of the free-scroll-strip toggle. When on, a wheel over the continuous strip
   * scrolls it and leaves the focus alone; when off, each notch steps the focus one phrase.
   */
  freeScrollStrip: boolean;
  /** Called when the free-scroll-strip toggle changes. */
  onFreeScrollStripChange: (checked: boolean) => void;
  /**
   * Current value of the show-suggestions toggle. Removable demo switch: while on, un-approved
   * tokens render the engine's derived suggestion (see `user-questions.md`, "display prominence and
   * candidate review"). Drop this prop and its row once the UX is settled.
   */
  showSuggestions: boolean;
  /** Called when the show-suggestions toggle changes. */
  onShowSuggestionsChange: (checked: boolean) => void;
}>;

/**
 * Toolbar dropdown that groups the continuous-scroll toggle and the view-mode toggles (each a
 * labeled on/off switch). Opens and closes via a gear icon button.
 */
export default function ViewOptionsDropdown({
  continuousScroll,
  onContinuousScrollChange,
  hideInactiveLinkButtons,
  onHideInactiveLinkButtonsChange,
  simplifyPhrases,
  onSimplifyPhrasesChange,
  showMorphology,
  onShowMorphologyChange,
  showFreeTranslation,
  onShowFreeTranslationChange,
  showVerseGutter,
  onShowVerseGutterChange,
  freeScrollStrip,
  onFreeScrollStripChange,
  showSuggestions,
  onShowSuggestionsChange,
}: ViewOptionsDropdownProps) {
  const [localizedStrings] = useLocalizedStrings(STRING_KEYS);
  const [open, setOpen] = useState(false);

  // Suppressed while the panel is open: the panel it opened is already on screen, so a tooltip
  // naming it would only overlap that.
  const triggerTooltip = open
    ? undefined
    : tooltipContentOrUndefined(
        resolvedOrEmpty(localizedStrings['%interlinearizer_viewOptions_label%']),
      );

  // This dropdown mounts in the tab toolbar, a sibling of the interlinear view rather than a
  // descendant, so it is outside that view's provider and supplies its own.
  return (
    <TooltipProvider delayDuration={TOOLTIP_DELAY_MS}>
      <div className="tw:mt-1 tw:mr-1">
        <Popover open={open} onOpenChange={setOpen}>
          {/* Both `asChild` triggers clone onto their own child, so the popover's must be the inner
              one: it has to reach the button element itself to attach the toggle handler, whereas a
              tooltip outside it clones onto the popover trigger and passes through. */}
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button
                  aria-label={localizedStrings['%interlinearizer_viewOptions_label%']}
                  className="tw:h-7 tw:w-7 tw:p-0"
                  data-testid="view-options-button"
                  size="icon"
                  variant="ghost"
                >
                  <Settings className="tw:size-4" />
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            {triggerTooltip !== undefined && <TooltipContent>{triggerTooltip}</TooltipContent>}
          </Tooltip>

          {/* Mounted only while open so each opening starts from a fresh panel. */}
          {open && (
            <PopoverContent
              align="end"
              aria-label={localizedStrings['%interlinearizer_viewOptions_label%']}
              className="tw:w-auto tw:min-w-56 tw:gap-3"
              data-testid="view-options-panel"
            >
              <ViewToggle
                checked={continuousScroll}
                label={localizedStrings['%interlinearizer_viewOption_continuousScroll%']}
                onCheckedChange={onContinuousScrollChange}
              />
              <ViewToggle
                checked={showMorphology}
                label={localizedStrings['%interlinearizer_viewOption_showMorphology%']}
                onCheckedChange={onShowMorphologyChange}
              />
              <ViewToggle
                checked={showFreeTranslation}
                label={localizedStrings['%interlinearizer_viewOption_showFreeTranslation%']}
                onCheckedChange={onShowFreeTranslationChange}
              />
              <ViewToggle
                checked={showVerseGutter}
                label={localizedStrings['%interlinearizer_viewOption_showVerseGutter%']}
                onCheckedChange={onShowVerseGutterChange}
              />
              <ViewToggle
                checked={freeScrollStrip}
                label={localizedStrings['%interlinearizer_viewOption_freeScrollStrip%']}
                onCheckedChange={onFreeScrollStripChange}
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
              {/* Removable demo toggle for the open suggestion-prominence UX question; drop this
                  row (and its prop pair) once the behavior is settled. */}
              <ViewToggle
                checked={showSuggestions}
                label={localizedStrings['%interlinearizer_viewOption_showSuggestions%']}
                onCheckedChange={onShowSuggestionsChange}
              />
            </PopoverContent>
          )}
        </Popover>
      </div>
    </TooltipProvider>
  );
}
