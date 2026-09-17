import { ExternalLink, PanelRight, X } from 'lucide-react';
import { Button } from 'platform-bible-react';
import { Fragment, useEffect, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

/** Where the morpheme type help sits: docked beside the interlinear view, or floating over it. */
export type MorphemeTypeHelpPresentation = 'drawer' | 'dialog';

/** Stand-in form the break-character patterns decorate. */
const EXAMPLE_FORM = 'am';

/** Width of the floating panel, needed in px to keep a drag inside the viewport. */
const DIALOG_WIDTH = 256;

/** How much of the floating panel a drag must leave on screen, so it can always be grabbed again. */
const DIALOG_KEEP_VISIBLE = 48;

/**
 * The break characters a morpheme form may carry, and the morph type each marks. FLEx's notation:
 * `lead` and `trail` wrap {@link EXAMPLE_FORM} to give the pattern the user types.
 *
 * Only the nine decorated patterns are listed. Clitic, circumfix, particle, phrase and
 * discontiguous phrase carry no indicator at all, and each interfix shares the pattern of the affix
 * it is shaped like, so neither adds a row a reader could act on.
 */
const MORPH_TYPE_ROWS = [
  { lead: '', trail: '', name: 'root, stem' },
  { lead: '*', trail: '', name: 'bound root, bound stem' },
  { lead: '', trail: '-', name: 'prefix' },
  { lead: '-', trail: '', name: 'suffix' },
  { lead: '-', trail: '-', name: 'infix' },
  { lead: '', trail: '=', name: 'proclitic' },
  { lead: '=', trail: '', name: 'enclitic' },
  { lead: '=', trail: '=', name: 'simulfix' },
  { lead: '~', trail: '~', name: 'suprafix' },
] as const;

// Not localized yet: this panel is a first cut at the help #130 asks for, and the wording is still
// being settled with the Paratext team.
const STRINGS = {
  title: 'Morpheme types',
  hint: 'Separate morphemes with a space. Add a break character to mark the type.',
  footnote:
    'Clitic, circumfix, particle and phrase take no indicator — they are told apart in the dictionary, not here. An interfix uses the same marks as the affix it is shaped like.',
  close: 'Close morpheme types',
  undock: 'Show in a movable window',
  dock: 'Dock to the side',
  examples: ['blackbird → black bird', 'unbelievable → un- believe -able'],
};

/** The help itself: the break-character patterns, worked examples, and what they leave out. */
function MorphemeTypeLegend() {
  return (
    <div className="tw:flex tw:flex-col tw:gap-3 tw:overflow-auto tw:px-3 tw:py-2">
      <p className="tw:text-xs tw:text-muted-foreground">{STRINGS.hint}</p>
      <div className="tw:grid tw:grid-cols-[auto_1fr] tw:items-baseline tw:gap-x-3 tw:gap-y-1">
        {MORPH_TYPE_ROWS.map(({ lead, trail, name }) => (
          <Fragment key={name}>
            <span className="tw:text-end tw:font-mono tw:text-xs tw:whitespace-nowrap">
              <span className="tw:font-bold tw:text-blue-600 tw:dark:text-blue-400">{lead}</span>
              {EXAMPLE_FORM}
              <span className="tw:font-bold tw:text-blue-600 tw:dark:text-blue-400">{trail}</span>
            </span>
            <span className="tw:text-xs tw:text-muted-foreground">{name}</span>
          </Fragment>
        ))}
      </div>
      <div className="tw:flex tw:flex-col tw:rounded tw:bg-muted tw:px-2 tw:py-1.5 tw:font-mono tw:text-xs tw:text-muted-foreground">
        {STRINGS.examples.map((example) => (
          <span key={example}>{example}</span>
        ))}
      </div>
      <p className="tw:text-xs tw:text-muted-foreground">{STRINGS.footnote}</p>
    </div>
  );
}

/** Props shared by the panel's two shells. */
type HelpShellProps = Readonly<{
  /** Switches the panel between docked and floating. */
  onPresentationChange: (presentation: MorphemeTypeHelpPresentation) => void;
  /** Dismisses the panel. */
  onClose: () => void;
}>;

/**
 * The panel's title bar, carrying the presentation switch and the close button.
 *
 * `onPointerDown` reaches the bar itself but not its buttons: the title is made click-through so
 * that a press anywhere except a button starts the floating panel's drag.
 */
function HelpHeader({
  onPresentationChange,
  onClose,
  presentation,
  onPointerDown,
}: HelpShellProps &
  Readonly<{
    presentation: MorphemeTypeHelpPresentation;
    onPointerDown?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  }>) {
  const docked = presentation === 'drawer';
  return (
    <div
      className={`tw:flex tw:items-center tw:justify-between tw:gap-1 tw:border-b tw:border-border tw:px-3 tw:py-2${docked ? '' : ' tw:cursor-grab tw:select-none'}`}
      onPointerDown={onPointerDown}
    >
      <h2 className="tw:pointer-events-none tw:text-sm tw:font-semibold">{STRINGS.title}</h2>
      <div className="tw:flex tw:items-center">
        <Button
          aria-label={docked ? STRINGS.undock : STRINGS.dock}
          data-testid="morpheme-type-help-presentation"
          onClick={() => onPresentationChange(docked ? 'dialog' : 'drawer')}
          size="icon"
          variant="ghost"
        >
          {docked ? <ExternalLink className="tw:size-4" /> : <PanelRight className="tw:size-4" />}
        </Button>
        <Button
          aria-label={STRINGS.close}
          data-testid="morpheme-type-help-close"
          onClick={onClose}
          size="icon"
          variant="ghost"
        >
          <X className="tw:size-4" />
        </Button>
      </div>
    </div>
  );
}

/** The docked shell: a fixed-width column beside the interlinear view. */
function HelpDrawer(props: HelpShellProps) {
  return (
    <aside
      className="tw:flex tw:w-64 tw:flex-none tw:flex-col tw:border-s tw:border-border tw:bg-background"
      data-testid="morpheme-type-help-drawer"
    >
      <HelpHeader {...props} presentation="drawer" />
      <MorphemeTypeLegend />
    </aside>
  );
}

/**
 * The floating shell: a panel the user drags around by its title bar, over the view rather than
 * beside it.
 *
 * Deliberately not the platform `Dialog` the extension's modals go through: that is modal, and the
 * whole point of this shell is that the view underneath stays live while the user consults the list
 * and keeps glossing.
 */
function HelpDialog(props: HelpShellProps) {
  const [position, setPosition] = useState(() => ({
    x: Math.max(0, window.innerWidth - DIALOG_WIDTH - 24),
    y: 72,
  }));
  // Pointer offset within the panel while a drag is in progress; absent when there is no drag.
  const [grab, setGrab] = useState<{ dx: number; dy: number } | undefined>(undefined);

  // Tracked on the window rather than the panel so a fast drag that outruns the pointer keeps
  // moving the panel, and so a release outside the panel still ends the drag.
  useEffect(() => {
    if (!grab) return undefined;
    const handleMove = (event: PointerEvent) => {
      setPosition({
        x: Math.max(0, Math.min(event.clientX - grab.dx, window.innerWidth - DIALOG_WIDTH)),
        y: Math.max(0, Math.min(event.clientY - grab.dy, window.innerHeight - DIALOG_KEEP_VISIBLE)),
      });
    };
    const handleRelease = () => setGrab(undefined);
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleRelease);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleRelease);
    };
  }, [grab]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // A press that landed on a header button is that button's, not a drag.
    if (event.target !== event.currentTarget) return;
    setGrab({ dx: event.clientX - position.x, dy: event.clientY - position.y });
  };

  return (
    <div
      aria-label={STRINGS.title}
      className="tw:fixed tw:z-20 tw:flex tw:max-h-[80vh] tw:w-64 tw:flex-col tw:rounded-lg tw:border tw:border-border tw:bg-popover tw:shadow-md"
      data-testid="morpheme-type-help-dialog"
      role="dialog"
      style={{ left: position.x, top: position.y }}
    >
      <HelpHeader {...props} presentation="dialog" onPointerDown={handlePointerDown} />
      <MorphemeTypeLegend />
    </div>
  );
}

/**
 * What the break characters in a morpheme breakdown mean, shown either docked beside the
 * interlinear view or floating over it. Read-only throughout.
 *
 * Render it only while the help is open; the floating shell's position resets on each mount, which
 * is what puts a panel dragged off-screen back within reach.
 */
export default function MorphemeTypeHelp({
  presentation,
  onPresentationChange,
  onClose,
}: HelpShellProps & Readonly<{ presentation: MorphemeTypeHelpPresentation }>) {
  if (presentation === 'dialog')
    return <HelpDialog onPresentationChange={onPresentationChange} onClose={onClose} />;
  return <HelpDrawer onPresentationChange={onPresentationChange} onClose={onClose} />;
}
