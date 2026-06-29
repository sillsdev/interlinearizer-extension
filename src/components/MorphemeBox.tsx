/**
 * @file Inline display of an analyzed token's morpheme breakdown, rendered inside {@link TokenChip}
 *   when the morphology toggle is active and the token has a breakdown. {@link MorphemeBox} boxes
 *   the breakdown and lays it out as a grid so each morpheme form aligns vertically with its gloss
 *   field (and, in future, its lexicon link); {@link MorphemeGlossInput} provides a per-morpheme
 *   gloss field that fills its grid column. The breakdown _editor_ (the popover where forms are
 *   entered) lives separately in {@link ./MorphemeEditor}.
 */
import type { MorphemeAnalysis, Token } from 'interlinearizer';
import { useLocalizedStrings } from '@papi/frontend/react';
import { PopoverAnchor } from 'platform-bible-react';
import { useEffect, useState } from 'react';
import { useMorphemeGlossDispatch, useReportGlossEditing } from './AnalysisStore';

const MORPHEME_GLOSS_STRING_KEYS = [
  '%interlinearizer_morphemeGloss_label%',
] as const satisfies `%${string}%`[];

const MORPHEME_BOX_STRING_KEYS = [
  '%interlinearizer_tokenChip_editMorphemes%',
] as const satisfies `%${string}%`[];

/**
 * Renders an analyzed token's morpheme breakdown as a boxed grid: each grid column is one morpheme,
 * with its form on the top row directly above its gloss field on the bottom row, so a morpheme and
 * its gloss always share a column (a future lexicon link slots into a third row with the same
 * column alignment). The box appears only for tokens that have a breakdown; an unanalyzed token's
 * "define breakdown" affordance lives in {@link TokenChip} instead.
 *
 * The whole forms row is a single accessible "edit breakdown" control rather than one labeled
 * button per morpheme: every form cell opens the same whole-breakdown editor, so per-cell labels
 * would be redundant for assistive tech. Hovering any form cell tints the whole forms row (the
 * action is breakdown-wide, not per-morpheme), tracked with local hover state. While the editor
 * popover is open the box takes an accent ring so it reads as the one being edited.
 *
 * Renders the {@link PopoverAnchor} the editor popover is positioned from; the caller owns the
 * `Popover` root and the popover content.
 *
 * @param props - Component props.
 * @param props.token - The analyzed word token whose breakdown is shown; used for the column forms,
 *   the token ref, and the accessible label.
 * @param props.morphemes - The token's ordered morpheme breakdown; one grid column per entry.
 * @param props.analysisLanguage - BCP 47 tag for reading/writing each morpheme gloss.
 * @param props.disabled - When true, the box is non-interactive and form-cell clicks do not open
 *   the editor.
 * @param props.popoverOpen - When true, the editor popover is open; the box renders its active
 *   look.
 * @param props.onEditBreakdown - Called when a form cell is clicked (while enabled) to open the
 *   whole-breakdown editor.
 * @returns A boxed grid of morpheme forms and their gloss fields, wrapped in a popover anchor.
 */
export function MorphemeBox({
  token,
  morphemes,
  analysisLanguage,
  disabled,
  popoverOpen,
  onEditBreakdown,
}: Readonly<{
  token: Token & { type: 'word' };
  morphemes: readonly MorphemeAnalysis[];
  analysisLanguage: string;
  disabled: boolean;
  popoverOpen: boolean;
  onEditBreakdown: () => void;
}>) {
  const [localizedStrings] = useLocalizedStrings(MORPHEME_BOX_STRING_KEYS);
  // Hovering any form cell tints the whole forms row: clicking any cell opens the same
  // whole-breakdown editor, so the affordance is breakdown-wide, not per-morpheme.
  const [isFormsHovered, setIsFormsHovered] = useState(false);

  const editLabel = localizedStrings['%interlinearizer_tokenChip_editMorphemes%'].replace(
    '{token}',
    token.surfaceText,
  );

  return (
    <PopoverAnchor asChild>
      <div
        className={`tw:inline-grid tw:w-fit tw:items-center tw:gap-x-0.5 tw:gap-y-0.5 tw:rounded tw:border tw:border-border tw:bg-background tw:p-0.5${popoverOpen ? ' tw:ring-1 tw:ring-ring' : ''}`}
        style={{ gridTemplateColumns: `repeat(${morphemes.length}, minmax(1ch, auto))` }}
      >
        {/* Forms row. The first cell is the single accessible "edit breakdown" control (a real
            button); the rest are presentational form cells that share its click and hover behavior
            but carry no button semantics, so assistive tech sees one control for the whole
            breakdown. The cells share grid columns with the gloss inputs below so each form sits
            directly above its gloss. */}
        {morphemes.map((m, i) => {
          const formClassName = `tw:flex tw:items-center tw:justify-center tw:whitespace-nowrap tw:rounded tw:px-0.5 tw:font-mono tw:text-xs tw:text-muted-foreground tw:transition-colors${disabled ? '' : ' tw:cursor-pointer'}${isFormsHovered && !disabled ? ' tw:bg-accent' : ''}`;
          const formStyle = { gridColumn: i + 1, gridRow: 1 };
          const handleClick = () => {
            if (!disabled) onEditBreakdown();
          };
          const handleMouseEnter = () => setIsFormsHovered(true);
          const handleMouseLeave = () => setIsFormsHovered(false);

          if (i === 0)
            return (
              <button
                key={m.id}
                aria-label={editLabel}
                className={formClassName}
                style={formStyle}
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  handleClick();
                }}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
              >
                {m.form}
              </button>
            );

          return (
            <span
              key={m.id}
              aria-hidden="true"
              className={formClassName}
              style={formStyle}
              onClick={handleClick}
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
            >
              {m.form}
            </span>
          );
        })}
        {/* Gloss row: each input fills its column and sits directly under its morpheme form. */}
        {morphemes.map((m, i) => (
          <MorphemeGlossInput
            key={m.id}
            analysisLanguage={analysisLanguage}
            column={i + 1}
            disabled={disabled}
            morpheme={m}
            tokenRef={token.ref}
          />
        ))}
      </div>
    </PopoverAnchor>
  );
}

/**
 * Renders a single morpheme's gloss as an editable input filling its grid column, directly under
 * the morpheme's form. Writes to the store on blur when the draft differs from the committed value.
 * The input carries a `data-morpheme-gloss` attribute so container-level "focus the first gloss
 * input" handlers (e.g. {@link PhraseBox}) can exclude morpheme glosses, which precede the token
 * gloss input in DOM order.
 *
 * @param props - Component props.
 * @param props.morpheme - The morpheme whose gloss is being edited.
 * @param props.tokenRef - The token ref for dispatching gloss writes.
 * @param props.analysisLanguage - BCP 47 tag for reading/writing the gloss.
 * @param props.disabled - When true, the input is read-only.
 * @param props.column - 1-based grid column the input occupies (shared with the morpheme's form).
 * @returns A cell-filling text input for the morpheme gloss, placed in the gloss row.
 */
export function MorphemeGlossInput({
  morpheme,
  tokenRef,
  analysisLanguage,
  disabled,
  column,
}: Readonly<{
  morpheme: MorphemeAnalysis;
  tokenRef: string;
  analysisLanguage: string;
  disabled: boolean;
  column: number;
}>) {
  const committed = morpheme.gloss?.[analysisLanguage] ?? '';
  const dispatchMorphemeGloss = useMorphemeGlossDispatch();
  const [draft, setDraft] = useState(committed);
  const [localizedStrings] = useLocalizedStrings(MORPHEME_GLOSS_STRING_KEYS);

  useEffect(() => {
    setDraft(committed);
  }, [committed]);

  // Surface uncommitted typing to the unsaved indicator before the gloss commits on blur.
  useReportGlossEditing(!disabled && draft !== committed);

  return (
    <input
      aria-label={localizedStrings['%interlinearizer_morphemeGloss_label%'].replace(
        '{form}',
        () => morpheme.form,
      )}
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
      onBlur={() => {
        if (!disabled && draft !== committed) dispatchMorphemeGloss(tokenRef, morpheme.id, draft);
      }}
      type="text"
    />
  );
}
