import type { MorphemeAnalysis, Token } from 'interlinearizer';
import { PopoverAnchor } from 'platform-bible-react';
import { formatReplacementString } from 'platform-bible-utils';
import {
  cloneElement,
  isValidElement,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
  useEffect,
  useState,
} from 'react';
import {
  useAnalysisReadOnly,
  useMorphemeGlossDispatch,
  useReportGlossEditing,
} from './AnalysisStore';
import { TOKEN_CHIP_LABEL_KEYS, type TokenChipLabels } from './PhraseStripContext';

/** The narrowest a morpheme column goes, below which its form and gloss stop being legible. */
const MIN_MORPHEME_COLUMN = '4ch';

/**
 * Inline _display_ of an analyzed token's morpheme breakdown. The popover where forms are actually
 * entered lives separately.
 *
 * The breakdown renders as a boxed grid: each grid column is one morpheme, with its form on the top
 * row directly above its gloss field on the bottom row, so a morpheme and its gloss always share a
 * column (a future lexicon link slots into a third row with the same column alignment). The box
 * appears only for tokens that have a breakdown; an unanalyzed token's "define breakdown"
 * affordance lives in {@link TokenChip} instead.
 *
 * The whole forms row is a single accessible "edit breakdown" control rather than one labeled
 * button per morpheme: every form cell opens the same whole-breakdown editor, so per-cell labels
 * would be redundant for assistive tech. Hovering anywhere in the box tints the whole forms row
 * (the action is breakdown-wide, not per-morpheme), tracked with local hover state. While the
 * editor popover is open the box takes an accent ring so it reads as the one being edited.
 *
 * Renders the {@link PopoverAnchor} the editor popover is positioned from; the caller owns the
 * `Popover` root and the popover content.
 */
function MorphemeBoxInner({
  token,
  surfaceText,
  morphemes,
  analysisLanguage,
  disabled,
  popoverOpen,
  onEditBreakdown,
  onGlossFocus,
  renderGloss,
  rowLabels,
  readOnly,
  morphemeTestId,
  glossTestId,
  noGlossLabel,
  noBreakdownLabel,
  labels = TOKEN_CHIP_LABEL_KEYS,
}: Readonly<{
  /**
   * The analyzed word token whose breakdown is shown, and whose ref each gloss commits against.
   * Omitted where the breakdown belongs to an analysis rather than to one token, which supplies
   * `surfaceText` and its own `renderGloss` instead.
   */
  token?: Token & { type: 'word' };
  /** The word the breakdown splits, naming it in the edit control. Defaults to the token's. */
  surfaceText?: string;
  /** The ordered morpheme breakdown; one grid column per entry. */
  morphemes: readonly MorphemeAnalysis[];
  /** BCP 47 tag for reading and writing each morpheme gloss. */
  analysisLanguage: string;
  /** When true, the box is non-interactive and form-cell clicks do not open the editor. */
  disabled: boolean;
  /** When true, the editor popover is open; the box renders its active look. */
  popoverOpen: boolean;
  /**
   * Called when a form cell is clicked (while enabled) to open the whole-breakdown editor. A
   * read-only box renders no such control, so it needs none.
   */
  onEditBreakdown?: () => void;
  /**
   * Called when any morpheme gloss input receives focus, so the chip can report the token as
   * focused; these fields are gloss fields of the same token as the chip's own gloss input, so
   * focusing one must move the view's focus just as focusing that input does.
   */
  onGlossFocus?: () => void;
  /**
   * Renders the gloss cell for one morpheme. Omitted, each gloss is a token-keyed input committing
   * through the analysis store; supplying one commits against the analysis instead.
   */
  renderGloss?: (morpheme: MorphemeAnalysis, index: number) => ReactNode;
  /** Names the two rows. Omitted, neither is labeled. */
  rowLabels?: Readonly<{ forms: string; glosses: string }>;
  /** Whether the breakdown is shown without the affordances that edit it. */
  readOnly: boolean;
  /** `data-testid` marking each morpheme's form cell. */
  morphemeTestId?: string;
  /** `data-testid` marking each column's gloss cell. */
  glossTestId?: string;
  /**
   * Stands in for a morpheme carrying no gloss, where the breakdown is read-only. An editable one
   * shows a field there, which reads as waiting to be filled rather than as a gap.
   */
  noGlossLabel?: string;
  /** Shown where the analysis segments nothing. Omitted, nothing renders in that case. */
  noBreakdownLabel?: string;
  /**
   * Accessible labels for this box and its gloss inputs, resolved once per strip. Defaults to the
   * unresolved keys, which is what they show until the strip's lookup lands.
   */
  labels?: TokenChipLabels;
}>) {
  // Hovering anywhere in the box tints the whole forms row: clicking any cell opens the same
  // whole-breakdown editor, so the affordance is breakdown-wide, not per-morpheme. Tracking hover
  // on the container (rather than per cell) avoids a one-frame un-tint as the pointer crosses the
  // gap between adjacent form cells.
  const [isFormsHovered, setIsFormsHovered] = useState(false);
  const inert = disabled || readOnly;

  /* v8 ignore next -- a token or a surface text is always supplied */
  const word = surfaceText ?? token?.surfaceText ?? '';
  const editLabel = formatReplacementString(labels.editMorphemes, { token: word });

  const formTestId = morphemeTestId ?? (readOnly ? 'readonly-morpheme-form' : 'morpheme-form');
  const cellGlossTestId = glossTestId ?? (readOnly ? 'readonly-morpheme-gloss' : 'morpheme-gloss');

  if (morphemes.length === 0)
    return noBreakdownLabel ? (
      <span
        className="tw:text-sm tw:italic tw:text-muted-foreground"
        data-testid={`${formTestId}-none`}
      >
        {noBreakdownLabel}
      </span>
    ) : undefined;

  // Labels are the grid's first column, each sharing a row track with the cells it names so the two
  // line up by construction. The token strip passes none and gets the bare box.
  const labelTrack = rowLabels ? 'auto ' : '';
  const firstCell = rowLabels ? 2 : 1;

  /** One morpheme's form cell, which read-only renders as static text. */
  const formCell = (m: MorphemeAnalysis, i: number) => {
    const placement = { gridColumn: firstCell + i, gridRow: 1 };
    if (readOnly)
      return (
        <span
          className="tw:flex tw:items-center tw:justify-center tw:truncate tw:whitespace-nowrap tw:px-0.5 tw:font-mono tw:text-xs tw:text-muted-foreground"
          data-testid={formTestId}
          key={m.id}
          style={placement}
        >
          {m.form}
        </span>
      );

    const formClassName = `tw:flex tw:items-center tw:justify-center tw:whitespace-nowrap tw:rounded tw:px-0.5 tw:font-mono tw:text-xs tw:text-muted-foreground tw:transition-colors${inert ? '' : ' tw:cursor-pointer'}${isFormsHovered && !inert ? ' tw:bg-accent' : ''}`;
    // preventDefault stops the ancestor label from forwarding the click to the gloss input, where
    // the focus would dismiss the editor this same click opens.
    const handleClick = (e: MouseEvent) => {
      e.preventDefault();
      if (!inert) onEditBreakdown?.();
    };

    // The first cell is the single accessible "edit breakdown" control (a real button); the rest
    // share its click and hover behavior but carry no button semantics, so assistive tech sees one
    // control for the whole breakdown.
    if (i === 0)
      return (
        <button
          aria-label={editLabel}
          className={formClassName}
          data-testid={formTestId}
          key={m.id}
          style={placement}
          tabIndex={-1}
          type="button"
          onClick={handleClick}
        >
          {m.form}
        </button>
      );

    return (
      <span
        aria-hidden="true"
        className={formClassName}
        data-testid={formTestId}
        key={m.id}
        onClick={handleClick}
        // A span, unlike the first cell's button, is subject to two mouse-down focus moves that
        // would land outside the just-opened editor and dismiss it: the browser's label-to-control
        // forwarding, and the ancestor label's own handler.
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        style={placement}
      >
        {m.form}
      </span>
    );
  };

  /**
   * One morpheme's gloss cell: the caller's own where it owns the commit path, otherwise the
   * token-keyed input that writes through the analysis store, or static text when read-only.
   */
  const glossCell = (m: MorphemeAnalysis, i: number) => {
    const placement = { gridColumn: firstCell + i, gridRow: 2 };
    if (renderGloss) {
      const cell = renderGloss(m, i);
      /* v8 ignore next -- every caller returns an element; the guard satisfies cloneElement's type */
      if (!isValidElement<{ style?: CSSProperties }>(cell)) return cell;
      // Placed on the caller's own element rather than a wrapper: a wrapper between a cell and the
      // grid takes the click first, reintroducing the label forwarding the form cells cancel.
      return cloneElement(cell, { key: m.id, style: { ...cell.props.style, ...placement } });
    }

    if (readOnly) {
      const gloss = m.gloss?.[analysisLanguage];
      return (
        <span
          className={`tw:truncate tw:px-1 tw:text-center tw:text-xs tw:text-foreground${gloss ? '' : ' tw:italic tw:text-muted-foreground'}`}
          data-testid={cellGlossTestId}
          key={m.id}
          style={{ ...placement, minWidth: '2ch' }}
        >
          {gloss || noGlossLabel || ''}
        </span>
      );
    }

    return (
      <MorphemeGlossInput
        analysisLanguage={analysisLanguage}
        column={firstCell + i}
        disabled={disabled}
        glossLabelTemplate={labels.morphemeGloss}
        key={m.id}
        morpheme={m}
        /* v8 ignore next 2 -- both are supplied wherever this input renders */
        onFocus={onGlossFocus ?? (() => {})}
        tokenRef={token?.ref ?? ''}
      />
    );
  };

  return (
    <PopoverAnchor asChild>
      <div
        className={`tw:morphology-slot tw:border-border tw:bg-background${popoverOpen ? ' tw:ring-1 tw:ring-ring' : ''}`}
        onMouseEnter={readOnly ? undefined : () => setIsFormsHovered(true)}
        onMouseLeave={readOnly ? undefined : () => setIsFormsHovered(false)}
        style={{
          // The label column will not shrink, so without a floor the morpheme columns absorb the
          // whole of a narrow container's shortfall.
          gridTemplateColumns: `${labelTrack}repeat(${morphemes.length}, minmax(${MIN_MORPHEME_COLUMN}, auto))`,
        }}
      >
        {rowLabels && (
          <>
            <span
              className="tw:whitespace-nowrap tw:pe-1 tw:text-xs tw:text-muted-foreground"
              data-testid={`${formTestId}-row-label`}
              style={{ gridColumn: 1, gridRow: 1 }}
            >
              {rowLabels.forms}
            </span>
            <span
              className="tw:whitespace-nowrap tw:pe-1 tw:text-xs tw:text-muted-foreground"
              data-testid={`${cellGlossTestId}-row-label`}
              style={{ gridColumn: 1, gridRow: 2 }}
            >
              {rowLabels.glosses}
            </span>
          </>
        )}
        {morphemes.map(formCell)}
        {morphemes.map(glossCell)}
      </div>
    </PopoverAnchor>
  );
}

/** Props {@link MorphemeBox} takes, with the read-only state it may instead read from the store. */
type MorphemeBoxProps = Omit<Parameters<typeof MorphemeBoxInner>[0], 'readOnly'> &
  Readonly<{ readOnly?: boolean }>;

/** The box with its read-only state taken from the analysis store. */
function StoreMorphemeBox(props: Omit<MorphemeBoxProps, 'readOnly'>) {
  return <MorphemeBoxInner {...props} readOnly={useAnalysisReadOnly()} />;
}

/**
 * The breakdown box. Reads its read-only state from the analysis store unless the caller says, so
 * it renders outside that store too.
 */
export function MorphemeBox({ readOnly, ...props }: MorphemeBoxProps) {
  if (readOnly === undefined) return <StoreMorphemeBox {...props} />;
  return <MorphemeBoxInner {...props} readOnly={readOnly} />;
}

/**
 * Renders a single morpheme's gloss as an editable input filling its grid column, directly under
 * the morpheme's form. Writes to the store on blur when the draft differs from the committed value.
 * The input carries a `data-morpheme-gloss` attribute so container-level "focus the first gloss
 * input" handlers can exclude morpheme glosses, which precede the token gloss input in DOM order.
 */
export function MorphemeGlossInput({
  morpheme,
  tokenRef,
  analysisLanguage,
  disabled,
  column,
  onFocus,
  glossLabelTemplate = TOKEN_CHIP_LABEL_KEYS.morphemeGloss,
}: Readonly<{
  morpheme: MorphemeAnalysis;
  /** The token ref gloss writes are dispatched against. */
  tokenRef: string;
  /** BCP 47 tag for reading and writing the gloss. */
  analysisLanguage: string;
  disabled: boolean;
  /** 1-based grid column the input occupies (shared with the morpheme's form). */
  column: number;
  /** Called when the input receives focus, so the containing chip can report its token as focused. */
  onFocus: () => void;
  /**
   * Accessible label for this input, with `{form}` still to be substituted for the morpheme's form.
   * Resolved once per strip. Defaults to the unresolved key, which is what the input shows until
   * the strip's lookup lands.
   */
  glossLabelTemplate?: string;
}>) {
  const committed = morpheme.gloss?.[analysisLanguage] ?? '';
  const dispatchMorphemeGloss = useMorphemeGlossDispatch();
  const [draft, setDraft] = useState(committed);

  useEffect(() => {
    setDraft(committed);
  }, [committed]);

  // Surface uncommitted typing to the unsaved indicator before the gloss commits on blur.
  useReportGlossEditing(!disabled && draft !== committed);

  return (
    <input
      aria-label={formatReplacementString(glossLabelTemplate, { form: morpheme.form })}
      className="tw:gloss-input tw:text-xs"
      data-morpheme-gloss="true"
      disabled={disabled}
      placeholder="—"
      // `field-sizing: content` sizes the input to its current value and grows it as the user types,
      // so the `auto` grid track tracks the rendered gloss with no slack — matching the token gloss
      // input in TokenChip. `min-width` keeps a small floor so an empty field stays clickable.
      style={{ gridColumn: column, gridRow: 2, fieldSizing: 'content', minWidth: '2ch' }}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={onFocus}
      onBlur={() => {
        if (!disabled && draft !== committed) dispatchMorphemeGloss(tokenRef, morpheme.id, draft);
      }}
      type="text"
    />
  );
}
