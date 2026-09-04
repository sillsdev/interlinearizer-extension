import type { MorphemeAnalysis } from 'interlinearizer';
import { Button, Input, Label, Popover, PopoverAnchor } from 'platform-bible-react';
import { formatReplacementString, type LanguageStrings } from 'platform-bible-utils';
import { useId, useState } from 'react';
import { MorphemeBreakdownPopover, type MorphemeEditorLabels } from './MorphemeEditor';
import { resolvedOrEmpty } from '../utils/localized-strings';
import { useAnalysisReadOnly, useReportGlossEditing } from './AnalysisStore';

/** Localized string keys the row editor renders. */
export const ROW_EDITOR_STRING_KEYS = [
  '%interlinearizer_analysisCatalog_editGloss%',
  '%interlinearizer_analysisCatalog_editMorphemes%',
  '%interlinearizer_analysisCatalog_editMorphemesHint%',
  '%interlinearizer_analysisCatalog_editMorphemesSave%',
  '%interlinearizer_analysisCatalog_editMorphemesCancel%',
  '%interlinearizer_analysisCatalog_editMorphemesReset%',
  '%interlinearizer_analysisCatalog_editMorphemesOpen%',
  '%interlinearizer_analysisCatalog_confirmResetPrompt%',
  '%interlinearizer_analysisCatalog_confirmResetAction%',
  '%interlinearizer_analysisCatalog_confirmResplitPrompt%',
  '%interlinearizer_analysisCatalog_confirmResplitAction%',
  '%interlinearizer_analysisCatalog_morphemeGloss%',
  '%interlinearizer_analysisCatalog_morphemeNoGloss%',
  '%interlinearizer_analysisCatalog_appliesToAll%',
  '%interlinearizer_analysisCatalog_merge%',
  '%interlinearizer_analysisCatalog_delete%',
] as const satisfies `%${string}%`[];

/** Props for {@link CatalogRowEditor}. */
type CatalogRowEditorProps = Readonly<{
  analysisId: string;
  /** Surface form of the analysis, which the breakdown editor pre-fills from when there is none. */
  surfaceText: string;
  /** The analysis's gloss in the active language, `''` when it has none. */
  gloss: string;
  /** How many tokens this analysis is applied to, which every edit here rewrites at once. */
  usageCount: number;
  morphemes: readonly MorphemeAnalysis[];
  /** BCP 47 tag the morpheme glosses are read and written under. */
  analysisLanguage: string;
  /** Writes the analysis's gloss for every token linked to it. */
  onGlossCommit: (value: string) => void;
  /** Replaces the analysis's morpheme breakdown for every token linked to it. */
  onMorphemesCommit: (forms: readonly string[]) => void;
  /** Writes one morpheme's gloss for every token linked to the analysis. */
  onMorphemeGlossCommit: (morphemeId: string, value: string) => void;
  /**
   * The breakdown draft, or `undefined` while the breakdown editor is closed. Held by the caller,
   * which outlives this editor's own mounting.
   */
  breakdownDraft: string | undefined;
  /** Records the breakdown draft, `undefined` closing the breakdown editor. */
  onBreakdownDraftChange: (draft: string | undefined) => void;
  /** Resolved localizations covering at least {@link ROW_EDITOR_STRING_KEYS}. */
  localizedStrings: LanguageStrings;
}>;

/** Collapses leading, trailing, and repeated internal whitespace to single spaces. */
function normalize(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/**
 * The forms a breakdown draft reads as, against the surface form it segments. An empty draft has no
 * reading as a breakdown, and a lone form equal to the whole word records no segmentation — both
 * are a request for the unsegmented state, which is an empty form list.
 */
export function breakdownDraftForms(draft: string, surfaceText: string): string[] {
  const normalized = normalize(draft);
  return normalized === '' || normalized === normalize(surfaceText) ? [] : normalized.split(' ');
}

/**
 * The note above the fields, naming how many tokens an edit here rewrites — the count being the one
 * thing a row gives no other clue about. Absent below two uses, which an edit reaches no further
 * than the row it is made on.
 */
function appliesToAllMessage(
  usageCount: number,
  localizedStrings: LanguageStrings,
): string | undefined {
  if (usageCount < 2) return undefined;
  return formatReplacementString(
    localizedStrings['%interlinearizer_analysisCatalog_appliesToAll%'],
    { count: usageCount },
  );
}

/**
 * A text field whose edit commits on blur and on Enter, and reverts on Escape, holding its draft
 * locally until then.
 *
 * Committing on blur rather than per keystroke is what the gloss inputs in the interlinear view do,
 * and it matters more here: every keystroke would be a write across every token the analysis holds,
 * and an edit passing through a state identical to a sibling would collapse the row mid-word.
 *
 * The draft is keyed on the committed value, so a row re-rendered under a different analysis — the
 * listing reorders under an edit — refills rather than showing the previous row's text.
 */
function CommitOnBlurInput({
  ariaLabel,
  committedValue,
  id,
  onCommit,
  testId,
}: Readonly<{
  ariaLabel?: string;
  committedValue: string;
  id?: string;
  onCommit: (value: string) => void;
  testId: string;
}>) {
  const [draft, setDraft] = useState(committedValue);
  const [draftOf, setDraftOf] = useState(committedValue);

  // Adjusted during render rather than in an effect, so the field never paints one frame holding
  // the previous value.
  if (committedValue !== draftOf) {
    setDraftOf(committedValue);
    setDraft(committedValue);
  }

  // Surface uncommitted typing to the unsaved indicator before the edit commits on blur.
  useReportGlossEditing(draft !== committedValue);

  const commit = () => {
    if (draft !== committedValue) onCommit(draft);
  };

  return (
    <Input
      aria-label={ariaLabel}
      // Overrides the platform input's intrinsic minimum width, which a long gloss would otherwise
      // push past its column and over the neighboring field.
      className="tw:h-7 tw:w-full tw:min-w-0 tw:text-sm"
      data-testid={testId}
      id={id}
      onBlur={commit}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setDraft(committedValue);
        }
      }}
      type="text"
      value={draft}
    />
  );
}

/**
 * The editable half of an expanded catalog row: the analysis's gloss, its morpheme breakdown and
 * each morpheme's gloss. The controls acting on the analysis as a whole are
 * {@link CatalogRowActions}.
 *
 * Every write here is keyed by the analysis rather than by a token, so it changes what the record
 * says everywhere it is used — which the note above the fields says outright once more than one
 * token is holding it.
 *
 * The breakdown is edited as a line of space-separated forms, as the interlinear view's morpheme
 * editor does, so the same input reads the same in both places. It is behind its own toggle because
 * committing it discards the old morphemes' glosses, which is not an edit to make by tabbing past.
 *
 * A read-only analysis renders the same fields as static text, matching what the interlinear view
 * does with the same store.
 */
export default function CatalogRowEditor({
  analysisId,
  surfaceText,
  gloss,
  usageCount,
  morphemes,
  analysisLanguage,
  onGlossCommit,
  onMorphemesCommit,
  onMorphemeGlossCommit,
  breakdownDraft,
  onBreakdownDraftChange,
  localizedStrings,
}: CatalogRowEditorProps) {
  const glossFieldId = useId();
  const readOnly = useAnalysisReadOnly();

  const morphemeForms = morphemes.map((m) => m.form).join(' ');

  const draftForms = (value: string): string[] => breakdownDraftForms(value, surfaceText);

  const appliesToAll = appliesToAllMessage(usageCount, localizedStrings);

  // Wording for the shared breakdown editor: every prompt here speaks of the analysis and its
  // uses, where the token chip's speaks of the one word in hand.
  const breakdownLabels: MorphemeEditorLabels = {
    splitLabel: localizedStrings['%interlinearizer_analysisCatalog_editMorphemes%'],
    reset: localizedStrings['%interlinearizer_analysisCatalog_editMorphemesReset%'],
    cancel: localizedStrings['%interlinearizer_analysisCatalog_editMorphemesCancel%'],
    done: localizedStrings['%interlinearizer_analysisCatalog_editMorphemesSave%'],
    emptyHint: localizedStrings['%interlinearizer_analysisCatalog_editMorphemesHint%'],
    confirmResetPrompt: formatReplacementString(
      localizedStrings['%interlinearizer_analysisCatalog_confirmResetPrompt%'],
      { form: surfaceText },
    ),
    confirmResetAction: localizedStrings['%interlinearizer_analysisCatalog_confirmResetAction%'],
    confirmResplitPrompt:
      localizedStrings['%interlinearizer_analysisCatalog_confirmResplitPrompt%'],
    confirmResplitAction:
      localizedStrings['%interlinearizer_analysisCatalog_confirmResplitAction%'],
  };

  // A read-only analysis shows what the record says and nothing that would rewrite it, the note
  // about an edit reaching every use included.
  if (readOnly)
    return (
      <div className="tw:flex tw:flex-col tw:gap-3 tw:pt-1" data-testid="catalog-row-editor">
        <div className="tw:flex tw:items-center tw:gap-2">
          <span className="tw:text-xs tw:text-muted-foreground">
            {localizedStrings['%interlinearizer_analysisCatalog_editGloss%']}
          </span>
          <span className="tw:flex-1 tw:min-w-0 tw:text-sm" data-testid="readonly-catalog-gloss">
            {gloss}
          </span>
        </div>

        {/* Boxed as the editable row is, so switching between a read-only and an editable analysis
            does not rearrange the breakdown. An analysis that segments nothing has no box, its
            heading naming a split the reader cannot make. */}
        {morphemes.length > 0 && (
          <div className="tw:flex tw:max-w-fit tw:flex-col tw:gap-1.5 tw:rounded tw:border tw:border-border tw:bg-background tw:p-2">
            <div className="tw:flex tw:items-center tw:gap-2">
              <span className="tw:text-xs tw:text-muted-foreground">
                {localizedStrings['%interlinearizer_analysisCatalog_editMorphemes%']}
              </span>
              <span className="tw:font-mono tw:text-sm" data-testid="readonly-catalog-breakdown">
                {morphemeForms}
              </span>
            </div>

            <div className="tw:flex tw:flex-wrap tw:gap-x-3 tw:gap-y-1">
              {morphemes.map((morpheme) => {
                const morphemeGloss = morpheme.gloss?.[analysisLanguage];
                return (
                  <div
                    className="tw:flex tw:w-20 tw:shrink-0 tw:flex-col"
                    data-testid="catalog-row-morpheme"
                    key={morpheme.id}
                  >
                    <span className="tw:truncate tw:text-sm">{morpheme.form}</span>
                    {/* A blank cell reads as a rendering gap in a view offering no field to fill. */}
                    <span
                      className={`tw:text-sm tw:text-muted-foreground${morphemeGloss ? '' : ' tw:italic'}`}
                      data-testid="readonly-catalog-morpheme-gloss"
                    >
                      {morphemeGloss ||
                        localizedStrings['%interlinearizer_analysisCatalog_morphemeNoGloss%']}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );

  return (
    <div className="tw:flex tw:flex-col tw:gap-3 tw:pt-1" data-testid="catalog-row-editor">
      {appliesToAll && (
        <p className="tw:text-xs tw:text-muted-foreground" data-testid="catalog-row-applies-to-all">
          {appliesToAll}
        </p>
      )}

      <div className="tw:flex tw:items-center tw:gap-2">
        <Label className="tw:text-xs tw:text-muted-foreground" htmlFor={glossFieldId}>
          {localizedStrings['%interlinearizer_analysisCatalog_editGloss%']}
        </Label>
        <div className="tw:flex-1 tw:min-w-0">
          <CommitOnBlurInput
            committedValue={gloss}
            id={glossFieldId}
            key={`${analysisId}-gloss`}
            onCommit={onGlossCommit}
            testId="catalog-row-gloss-input"
          />
        </div>
      </div>

      {/* Boxed as the token chip's breakdown is, so the forms and their glosses read as one unit
          belonging to the word above them — which is what tells an imported single-morpheme
          breakdown apart from the surface form it repeats. */}
      <div className="tw:flex tw:max-w-fit tw:flex-col tw:gap-1.5 tw:rounded tw:border tw:border-border tw:bg-background tw:p-2">
        <div className="tw:flex tw:items-center tw:gap-2">
          <span className="tw:text-xs tw:text-muted-foreground">
            {localizedStrings['%interlinearizer_analysisCatalog_editMorphemes%']}
          </span>
          <Popover open={breakdownDraft !== undefined}>
            <PopoverAnchor asChild>
              <Button
                aria-label={formatReplacementString(
                  localizedStrings['%interlinearizer_analysisCatalog_editMorphemesOpen%'],
                  { form: surfaceText },
                )}
                className="tw:h-auto tw:px-1 tw:py-0 tw:font-mono tw:text-xs"
                data-testid="catalog-row-breakdown-open"
                onClick={() => onBreakdownDraftChange(morphemeForms || surfaceText)}
                size="sm"
                type="button"
                variant="link"
              >
                {morphemeForms || surfaceText}
              </Button>
            </PopoverAnchor>
            {breakdownDraft !== undefined && (
              <MorphemeBreakdownPopover
                draft={breakdownDraft}
                initialValue={morphemeForms || surfaceText}
                labels={breakdownLabels}
                // Never withheld, unlike the token chip's: the record is rewritten in place for
                // every token holding it, so a form this drops has no copy left to survive on.
                morphemes={morphemes}
                needsResetConfirm={morphemes.some((m) => m.gloss !== undefined)}
                onClose={() => onBreakdownDraftChange(undefined)}
                onDraftChange={(draft) => onBreakdownDraftChange(draft)}
                onReset={morphemes.length > 0 ? () => onMorphemesCommit([]) : undefined}
                onSave={(value) => onMorphemesCommit(draftForms(value))}
                surfaceText={surfaceText}
              />
            )}
          </Popover>
        </div>

        {morphemes.length > 0 && (
          <div className="tw:flex tw:flex-wrap tw:gap-x-3 tw:gap-y-1">
            {morphemes.map((morpheme) => (
              // Form above gloss, as the interlinear view arranges them, so a breakdown reads the
              // same in both places. Each column sizes to its own form, above a floor that keeps a
              // short one's gloss field usable.
              <div
                className="tw:flex tw:min-w-20 tw:max-w-full tw:flex-col"
                data-testid="catalog-row-morpheme"
                key={morpheme.id}
              >
                <span className="tw:truncate tw:text-sm">{morpheme.form}</span>
                <CommitOnBlurInput
                  ariaLabel={
                    resolvedOrEmpty(
                      formatReplacementString(
                        localizedStrings['%interlinearizer_analysisCatalog_morphemeGloss%'],
                        { form: morpheme.form },
                      ),
                    ) || undefined
                  }
                  committedValue={morpheme.gloss?.[analysisLanguage] ?? ''}
                  key={`${analysisId}-${morpheme.id}`}
                  onCommit={(value) => onMorphemeGlossCommit(morpheme.id, value)}
                  testId="catalog-row-morpheme-gloss-input"
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The controls that act on a whole analysis rather than on one of its fields.
 *
 * Renders nothing for a read-only analysis, which neither control applies to.
 */
export function CatalogRowActions({
  onMergeRequest,
  onDeleteRequest,
  localizedStrings,
}: Readonly<{
  /** Opens the merge picker. Absent when the analysis shares its form with no other record. */
  onMergeRequest?: () => void;
  /** Opens the delete confirmation. */
  onDeleteRequest: () => void;
  /** Resolved localizations covering at least {@link ROW_EDITOR_STRING_KEYS}. */
  localizedStrings: LanguageStrings;
}>) {
  const readOnly = useAnalysisReadOnly();
  if (readOnly) return undefined;

  return (
    <div className="tw:flex tw:gap-1.5">
      {/*
        Offered only when the analysis has homographs: with none there is nothing a merge could
        reassign its tokens to, and a control that opens an empty picker is worse than no control.
      */}
      {onMergeRequest && (
        <Button
          data-testid="catalog-row-merge"
          onClick={onMergeRequest}
          size="sm"
          type="button"
          variant="outline"
        >
          {localizedStrings['%interlinearizer_analysisCatalog_merge%']}
        </Button>
      )}
      <Button
        className="tw:ms-auto tw:text-destructive"
        data-testid="catalog-row-delete"
        onClick={onDeleteRequest}
        size="sm"
        type="button"
        variant="outline"
      >
        {localizedStrings['%interlinearizer_analysisCatalog_delete%']}
      </Button>
    </div>
  );
}
