import type { MorphemeAnalysis, SenseRef } from 'interlinearizer';
import { Button, Input, Label, Popover, PopoverAnchor } from 'platform-bible-react';
import { formatReplacementString, type LanguageStrings } from 'platform-bible-utils';
import { useId, useState } from 'react';
import { useDisplayedGloss } from './LexiconSenses';
import { BoxAlignedField, MorphemeBox, ROW_LABEL_CLASS } from './MorphemeBox';
import { MorphemeBreakdownPopover, type MorphemeEditorLabels } from './MorphemeEditor';
import { morphemeCarriesAnnotation } from '../utils/analysis-identity';
import { resolvedOrEmpty } from '../utils/localized-strings';
import { useAnalysisReadOnly, useReportGlossEditing } from './AnalysisStore';
import { ModalShell } from './modals/ModalShell';

/** Localized string keys the row editor renders. */
export const ROW_EDITOR_STRING_KEYS = [
  '%interlinearizer_analysisCatalog_editGloss%',
  '%interlinearizer_analysisCatalog_editMorphemes%',
  '%interlinearizer_analysisCatalog_editMorphemesHint%',
  '%interlinearizer_analysisCatalog_editMorphemesSave%',
  '%interlinearizer_analysisCatalog_editMorphemesCancel%',
  '%interlinearizer_analysisCatalog_editMorphemesReset%',
  '%interlinearizer_analysisCatalog_editMorphemesOpen%',
  '%interlinearizer_analysisCatalog_editMorphemesStaleHint%',
  '%interlinearizer_analysisCatalog_confirmResetPrompt%',
  '%interlinearizer_analysisCatalog_confirmResetAction%',
  '%interlinearizer_analysisCatalog_confirmResplitPrompt%',
  '%interlinearizer_analysisCatalog_confirmResplitAction%',
  '%interlinearizer_analysisCatalog_morphemeGloss%',
  '%interlinearizer_analysisCatalog_morphemeNoGloss%',
  '%interlinearizer_analysisCatalog_noGloss%',
  '%interlinearizer_analysisCatalog_appliesToAll%',
  '%interlinearizer_analysisCatalog_merge%',
  '%interlinearizer_analysisCatalog_delete%',
  '%interlinearizer_analysisCatalog_deleteConfirmTitle%',
  '%interlinearizer_analysisCatalog_deleteConfirmPrompt%',
  '%interlinearizer_analysisCatalog_deleteConfirmCancel%',
] as const satisfies `%${string}%`[];

/** Props for {@link CatalogRowEditor}. */
type CatalogRowEditorProps = Readonly<{
  analysisId: string;
  /** Surface form of the analysis, which the breakdown editor pre-fills from when there is none. */
  surfaceText: string;
  /** The analysis's gloss in the active language, `''` when it has none. */
  gloss: string;
  /**
   * The sense the analysis links to, whose gloss a read-only row shows where the analysis stores
   * none.
   */
  glossSenseRef?: SenseRef;
  /** How many tokens this analysis is applied to, which every edit here rewrites at once. */
  usageCount: number;
  morphemes: readonly MorphemeAnalysis[];
  /** Whether the breakdown was split from a different spelling than `surfaceText`. */
  morphemesStale?: boolean;
  /** BCP 47 tag the morpheme glosses are read and written under. */
  analysisLanguage: string;
  /** When false, the breakdown is not shown at all, as the view option hides it on the strip. */
  showMorphology: boolean;
  /** Writes the analysis's gloss for every token linked to it. */
  onGlossCommit: (value: string) => void;
  /** Replaces the analysis's morpheme breakdown for every token linked to it. */
  onMorphemesCommit: (forms: readonly string[]) => void;
  /** Keeps the analysis's stale breakdown as it stands, for every token linked to it. */
  onMorphemesConfirm: () => void;
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
 * The forms a breakdown draft reads as, empty for a draft with nothing in it. A lone form equal to
 * the whole word is a one-morpheme analysis, not a request for the unsegmented state, which has its
 * own control.
 */
export function breakdownDraftForms(draft: string): string[] {
  const normalized = normalize(draft);
  return normalized === '' ? [] : normalized.split(' ');
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

  const commit = () => {
    if (draft !== committedValue) onCommit(draft);
  };

  // Surface uncommitted typing to the unsaved indicator before the edit commits on blur, and flush
  // the draft if the field unmounts mid-edit.
  useReportGlossEditing(draft !== committedValue, commit);

  return (
    <Input
      aria-label={ariaLabel}
      data-draft-field={draft === committedValue ? 'committed' : 'pending'}
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
 * committing it discards the old morphemes' annotation, which is not an edit to make by tabbing
 * past.
 *
 * A read-only analysis renders the same fields as static text, matching what the interlinear view
 * does with the same store.
 */
export default function CatalogRowEditor({
  analysisId,
  surfaceText,
  gloss,
  glossSenseRef,
  usageCount,
  morphemes,
  morphemesStale = false,
  analysisLanguage,
  showMorphology,
  onGlossCommit,
  onMorphemesCommit,
  onMorphemesConfirm,
  onMorphemeGlossCommit,
  breakdownDraft,
  onBreakdownDraftChange,
  localizedStrings,
}: CatalogRowEditorProps) {
  const glossFieldId = useId();
  const readOnly = useAnalysisReadOnly();
  // Only the read-only line shows the sense's gloss. The input shows what is typed, because editing
  // it would otherwise leave unclear whether the sense's gloss was adopted.
  const { text: displayedGloss } = useDisplayedGloss(
    gloss,
    readOnly ? glossSenseRef : undefined,
    analysisLanguage,
  );

  const morphemeForms = morphemes.map((m) => m.form).join(' ');

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
    staleHint: localizedStrings['%interlinearizer_analysisCatalog_editMorphemesStaleHint%'],
  };

  // A read-only analysis shows what the record says and nothing that would rewrite it, the note
  // about an edit reaching every use included.
  if (readOnly)
    return (
      <div className="tw:flex tw:flex-col tw:gap-3 tw:pt-1" data-testid="catalog-row-editor">
        <BoxAlignedField
          label={
            <span className={ROW_LABEL_CLASS}>
              {localizedStrings['%interlinearizer_analysisCatalog_editGloss%']}
            </span>
          }
        >
          <span className="tw:min-w-0 tw:text-sm" data-testid="readonly-catalog-gloss">
            {displayedGloss ||
              resolvedOrEmpty(localizedStrings['%interlinearizer_analysisCatalog_noGloss%']) ||
              '—'}
          </span>
        </BoxAlignedField>

        {/* The same labeled box the editable row shows, so switching between a read-only and an
            editable analysis does not rearrange the breakdown. */}
        {showMorphology && morphemes.length > 0 && (
          <div className="tw:flex tw:max-w-fit tw:flex-col tw:gap-1.5 tw:overflow-x-auto">
            <Popover>
              <MorphemeBox
                analysisLanguage={analysisLanguage}
                disabled
                glossTestId="readonly-catalog-morpheme-gloss"
                // The row's "Lexicon senses" list marks each morpheme's link.
                markLexiconGlosses={false}
                morphemeTestId="catalog-row-morpheme"
                morphemes={morphemes}
                noGlossLabel={localizedStrings['%interlinearizer_analysisCatalog_morphemeNoGloss%']}
                popoverOpen={false}
                readOnly
                stale={morphemesStale}
                rowLabels={{
                  forms: localizedStrings['%interlinearizer_analysisCatalog_editMorphemes%'],
                  glosses:
                    localizedStrings['%interlinearizer_analysisCatalog_mergeMorphemeGlosses%'],
                }}
                surfaceText={surfaceText}
              />
            </Popover>
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

      <BoxAlignedField
        label={
          <Label className={ROW_LABEL_CLASS} htmlFor={glossFieldId}>
            {localizedStrings['%interlinearizer_analysisCatalog_editGloss%']}
          </Label>
        }
      >
        <CommitOnBlurInput
          committedValue={gloss}
          id={glossFieldId}
          key={`${analysisId}-gloss`}
          onCommit={onGlossCommit}
          testId="catalog-row-gloss-input"
        />
      </BoxAlignedField>

      {/* The forms row is the control that opens the editor. Labeled, there being no surrounding
          interlinear line here to say what the two rows are. */}
      {showMorphology && (
        <Popover open={breakdownDraft !== undefined}>
          {morphemes.length === 0 ? (
            // Nothing split yet, so there is no forms row to click; the chip's define-breakdown
            // affordance stands in, naming the word it would split.
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
                {surfaceText}
              </Button>
            </PopoverAnchor>
          ) : (
            // The box has a width it will not go below, which a narrow panel cannot always afford.
            <div className="tw:overflow-x-auto">
              <MorphemeBox
                analysisLanguage={analysisLanguage}
                disabled={false}
                glossTestId="catalog-row-morpheme-gloss-input"
                morphemeTestId="catalog-row-morpheme"
                readOnly={false}
                morphemes={morphemes}
                stale={morphemesStale}
                // The box renders only with a breakdown, so the forms are never the empty string the
                // define-breakdown control has to fall back from.
                onEditBreakdown={() => onBreakdownDraftChange(morphemeForms)}
                popoverOpen={breakdownDraft !== undefined}
                renderGloss={(morpheme) => (
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
                )}
                rowLabels={{
                  forms: localizedStrings['%interlinearizer_analysisCatalog_editMorphemes%'],
                  glosses:
                    localizedStrings['%interlinearizer_analysisCatalog_mergeMorphemeGlosses%'],
                }}
                surfaceText={surfaceText}
              />
            </div>
          )}
          {breakdownDraft !== undefined && (
            <MorphemeBreakdownPopover
              draft={breakdownDraft}
              initialValue={morphemeForms || surfaceText}
              labels={breakdownLabels}
              // Never withheld, unlike the token chip's: the record is rewritten in place for every
              // token holding it, so a form this drops has no copy left to survive on.
              morphemes={morphemes}
              needsResetConfirm={morphemes.some(morphemeCarriesAnnotation)}
              onClose={() => onBreakdownDraftChange(undefined)}
              onConfirm={morphemesStale ? onMorphemesConfirm : undefined}
              onDraftChange={(draft) => onBreakdownDraftChange(draft)}
              onReset={morphemes.length > 0 ? () => onMorphemesCommit([]) : undefined}
              onSave={(value) => onMorphemesCommit(breakdownDraftForms(value))}
            />
          )}
        </Popover>
      )}
    </div>
  );
}

/**
 * The controls that act on a whole analysis rather than on one of its fields.
 *
 * Renders nothing for a read-only analysis, which neither control applies to.
 */
export function CatalogRowActions({
  surfaceText,
  onMergeRequest,
  onDeleteRequest,
  localizedStrings,
}: Readonly<{
  /** Surface form of the analysis, naming it in the delete confirmation. */
  surfaceText: string;
  /** Opens the merge picker. Absent when the analysis shares its form with no other record. */
  onMergeRequest?: () => void;
  /** Asks for the analysis to be deleted, once the reader has confirmed it. */
  onDeleteRequest: () => void;
  /** Resolved localizations covering at least {@link ROW_EDITOR_STRING_KEYS}. */
  localizedStrings: LanguageStrings;
}>) {
  const readOnly = useAnalysisReadOnly();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  if (readOnly) return undefined;

  const cancelDelete = () => setConfirmingDelete(false);

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
        onClick={() => setConfirmingDelete(true)}
        size="sm"
        type="button"
        variant="outline"
      >
        {localizedStrings['%interlinearizer_analysisCatalog_delete%']}
      </Button>
      {confirmingDelete && (
        <ModalShell
          onClose={cancelDelete}
          title={localizedStrings['%interlinearizer_analysisCatalog_deleteConfirmTitle%']}
          titleTestId="catalog-delete-confirm-title"
          width="tw:w-96"
        >
          <p className="tw:text-sm" data-testid="catalog-delete-confirm-prompt">
            {formatReplacementString(
              localizedStrings['%interlinearizer_analysisCatalog_deleteConfirmPrompt%'],
              { form: surfaceText },
            )}
          </p>
          <div className="tw:mt-4 tw:flex tw:justify-end tw:gap-2">
            <Button
              data-testid="catalog-delete-confirm-cancel"
              onClick={cancelDelete}
              variant="outline"
            >
              {localizedStrings['%interlinearizer_analysisCatalog_deleteConfirmCancel%']}
            </Button>
            <Button
              className="tw:text-destructive"
              data-testid="catalog-delete-confirm"
              onClick={() => {
                setConfirmingDelete(false);
                onDeleteRequest();
              }}
              variant="outline"
            >
              {localizedStrings['%interlinearizer_analysisCatalog_delete%']}
            </Button>
          </div>
        </ModalShell>
      )}
    </div>
  );
}
