import type { MorphemeAnalysis, Token } from 'interlinearizer';
import { PopoverAnchor } from 'platform-bible-react';
import { formatReplacementString } from 'platform-bible-utils';
import { type MouseEvent, useEffect, useState } from 'react';
import {
  useAnalysisReadOnly,
  useMorphemeGlossDispatch,
  useReportGlossEditing,
} from './AnalysisStore';
import { TOKEN_CHIP_LABEL_KEYS, type TokenChipLabels } from './PhraseStripContext';

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
export function MorphemeBox({
  token,
  morphemes,
  analysisLanguage,
  disabled,
  popoverOpen,
  onEditBreakdown,
  onGlossFocus,
  labels = TOKEN_CHIP_LABEL_KEYS,
}: Readonly<{
  /** The analyzed word token whose breakdown is shown. */
  token: Token & { type: 'word' };
  /** The token's ordered morpheme breakdown; one grid column per entry. */
  morphemes: readonly MorphemeAnalysis[];
  /** BCP 47 tag for reading and writing each morpheme gloss. */
  analysisLanguage: string;
  /** When true, the box is non-interactive and form-cell clicks do not open the editor. */
  disabled: boolean;
  /** When true, the editor popover is open; the box renders its active look. */
  popoverOpen: boolean;
  /** Called when a form cell is clicked (while enabled) to open the whole-breakdown editor. */
  onEditBreakdown: () => void;
  /**
   * Called when any morpheme gloss input receives focus, so the chip can report the token as
   * focused; these fields are gloss fields of the same token as the chip's own gloss input, so
   * focusing one must move the view's focus just as focusing that input does.
   */
  onGlossFocus: () => void;
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
  const readOnly = useAnalysisReadOnly();
  // Read-only renders the same grid without the editor affordance: no edit-breakdown control,
  // no hover tint, and static gloss text under each form.
  const inert = disabled || readOnly;

  const editLabel = formatReplacementString(labels.editMorphemes, { token: token.surfaceText });

  return (
    <PopoverAnchor asChild>
      <div
        className={`tw:inline-grid tw:w-fit tw:items-center tw:gap-x-0.5 tw:gap-y-0.5 tw:rounded tw:border tw:border-border tw:bg-background tw:p-0.5${popoverOpen ? ' tw:ring-1 tw:ring-ring' : ''}`}
        style={{ gridTemplateColumns: `repeat(${morphemes.length}, minmax(1ch, auto))` }}
        onMouseEnter={() => setIsFormsHovered(true)}
        onMouseLeave={() => setIsFormsHovered(false)}
      >
        {/* Forms row. The first cell is the single accessible "edit breakdown" control (a real
            button); the rest are presentational form cells that share its click and hover behavior
            but carry no button semantics, so assistive tech sees one control for the whole
            breakdown. The cells share grid columns with the gloss inputs below so each form sits
            directly above its gloss. */}
        {morphemes.map((m, i) => {
          const formClassName = `tw:flex tw:items-center tw:justify-center tw:whitespace-nowrap tw:rounded tw:px-0.5 tw:font-mono tw:text-xs tw:text-muted-foreground tw:transition-colors${inert ? '' : ' tw:cursor-pointer'}${isFormsHovered && !inert ? ' tw:bg-accent' : ''}`;
          const formStyle = { gridColumn: i + 1, gridRow: 1 };
          // preventDefault stops the ancestor <label> (see TokenChip) from forwarding the click to
          // the gloss input; that focus would land outside the just-opened modal editor and dismiss
          // it. The label skips the real first-cell button, but the span cells need it explicit.
          const handleClick = (e: MouseEvent) => {
            e.preventDefault();
            if (!inert) onEditBreakdown();
          };

          // Read-only replaces the edit-breakdown button with a plain first cell: the control
          // does not render at all rather than rendering unclickable.
          if (i === 0 && readOnly)
            return (
              <span key={m.id} className={formClassName} style={formStyle}>
                {m.form}
              </span>
            );

          if (i === 0)
            return (
              <button
                key={m.id}
                aria-label={editLabel}
                className={formClassName}
                style={formStyle}
                tabIndex={-1}
                type="button"
                onClick={handleClick}
              >
                {m.form}
              </button>
            );

          return (
            <span
              key={m.id}
              aria-hidden="true"
              className={formClassName}
              onClick={handleClick}
              // Not a button, so this cell is subject to focus moves the first cell is exempt from,
              // in two ways that both have to be shut off or the editor loses focus the moment it
              // opens: the browser forwards mouse-down on a label to the labeled control (canceled
              // with preventDefault), and TokenChip's own label handler does the same deliberately
              // (kept away by not letting the event reach it).
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              style={formStyle}
            >
              {m.form}
            </span>
          );
        })}
        {/* Gloss row: each input fills its column and sits directly under its morpheme form. A
            read-only analysis shows each gloss as plain text instead of an input. */}
        {morphemes.map((m, i) =>
          readOnly ? (
            <span
              key={m.id}
              className="tw:px-1 tw:text-center tw:text-xs tw:text-foreground"
              data-testid="readonly-morpheme-gloss"
              style={{ gridColumn: i + 1, gridRow: 2, minWidth: '2ch' }}
            >
              {m.gloss?.[analysisLanguage] ?? ''}
            </span>
          ) : (
            <MorphemeGlossInput
              key={m.id}
              analysisLanguage={analysisLanguage}
              column={i + 1}
              disabled={disabled}
              glossLabelTemplate={labels.morphemeGloss}
              morpheme={m}
              onFocus={onGlossFocus}
              tokenRef={token.ref}
            />
          ),
        )}
      </div>
    </PopoverAnchor>
  );
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
