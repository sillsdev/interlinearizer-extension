import type { MorphemeAnalysis } from 'interlinearizer';
import { Button, Input, Label } from 'platform-bible-react';
import { formatReplacementString, type LanguageStrings } from 'platform-bible-utils';
import { useId, useState } from 'react';
import { resolvedOrEmpty } from '../utils/localized-strings';

/** Localized string keys the row editor renders. */
export const ROW_EDITOR_STRING_KEYS = [
  '%interlinearizer_analysisCatalog_editGloss%',
  '%interlinearizer_analysisCatalog_editMorphemes%',
  '%interlinearizer_analysisCatalog_editMorphemesHint%',
  '%interlinearizer_analysisCatalog_editMorphemesSave%',
  '%interlinearizer_analysisCatalog_editMorphemesCancel%',
  '%interlinearizer_analysisCatalog_editMorphemesOpen%',
  '%interlinearizer_analysisCatalog_morphemeGloss%',
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
  morphemes: readonly MorphemeAnalysis[];
  /** BCP 47 tag the morpheme glosses are read and written under. */
  analysisLanguage: string;
  /** Writes the analysis's gloss for every token linked to it. */
  onGlossCommit: (value: string) => void;
  /** Replaces the analysis's morpheme breakdown for every token linked to it. */
  onMorphemesCommit: (forms: readonly string[]) => void;
  /** Writes one morpheme's gloss for every token linked to the analysis. */
  onMorphemeGlossCommit: (morphemeId: string, value: string) => void;
  /** Opens the merge picker. Absent when the analysis has no pool peers to merge into. */
  onMergeRequest?: () => void;
  /** Opens the delete confirmation. */
  onDeleteRequest: () => void;
  /** Resolved localizations covering at least {@link ROW_EDITOR_STRING_KEYS}. */
  localizedStrings: LanguageStrings;
}>;

/** Collapses leading, trailing, and repeated internal whitespace to single spaces. */
function normalize(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
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

  return (
    <Input
      aria-label={ariaLabel}
      className="tw:h-7 tw:text-sm"
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
 * each morpheme's gloss, and the merge and delete controls.
 *
 * Every write here is keyed by the analysis rather than by a token, so it changes what the record
 * says everywhere it is used — which the note above the fields says outright, because a row gives
 * no other clue how many tokens an edit is about to rewrite.
 *
 * The breakdown is edited as a line of space-separated forms, as the interlinear view's morpheme
 * editor does, so the same input reads the same in both places. It is behind its own toggle because
 * committing it discards the old morphemes' glosses, which is not an edit to make by tabbing past.
 */
export default function CatalogRowEditor({
  analysisId,
  surfaceText,
  gloss,
  morphemes,
  analysisLanguage,
  onGlossCommit,
  onMorphemesCommit,
  onMorphemeGlossCommit,
  onMergeRequest,
  onDeleteRequest,
  localizedStrings,
}: CatalogRowEditorProps) {
  const glossFieldId = useId();
  const breakdownFieldId = useId();

  /** The breakdown draft while the editor is open, or `undefined` when it is closed. */
  const [breakdownDraft, setBreakdownDraft] = useState<string | undefined>(undefined);

  const morphemeForms = morphemes.map((m) => m.form).join(' ');

  const commitBreakdown = () => {
    /* v8 ignore next -- only the open editor calls this, and it is open only with a draft held */
    if (breakdownDraft === undefined) return;
    const normalized = normalize(breakdownDraft);
    // An empty draft has no reading as a breakdown, and a lone form equal to the whole word records
    // no segmentation — both are a request for the unsegmented state, which is an empty form list.
    const forms =
      normalized === '' || normalized === normalize(surfaceText) ? [] : normalized.split(' ');
    if (forms.join(' ') !== morphemeForms) onMorphemesCommit(forms);
    setBreakdownDraft(undefined);
  };

  return (
    <div className="tw:flex tw:flex-col tw:gap-2" data-testid="catalog-row-editor">
      <p className="tw:text-xs tw:text-muted-foreground">
        {localizedStrings['%interlinearizer_analysisCatalog_appliesToAll%']}
      </p>

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

      {breakdownDraft === undefined ? (
        <div className="tw:flex tw:items-center tw:gap-2">
          <span className="tw:text-xs tw:text-muted-foreground">
            {localizedStrings['%interlinearizer_analysisCatalog_editMorphemes%']}
          </span>
          <Button
            aria-label={formatReplacementString(
              localizedStrings['%interlinearizer_analysisCatalog_editMorphemesOpen%'],
              { form: surfaceText },
            )}
            className="tw:h-auto tw:px-1 tw:py-0 tw:text-xs"
            data-testid="catalog-row-breakdown-open"
            onClick={() => setBreakdownDraft(morphemeForms || surfaceText)}
            size="sm"
            type="button"
            variant="link"
          >
            {morphemeForms || surfaceText}
          </Button>
        </div>
      ) : (
        <div className="tw:flex tw:flex-col tw:gap-1">
          <Label className="tw:text-xs tw:text-muted-foreground" htmlFor={breakdownFieldId}>
            {localizedStrings['%interlinearizer_analysisCatalog_editMorphemes%']}
          </Label>
          <Input
            className="tw:h-7 tw:font-mono tw:text-sm"
            data-testid="catalog-row-breakdown-input"
            id={breakdownFieldId}
            onChange={(e) => setBreakdownDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitBreakdown();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setBreakdownDraft(undefined);
              }
            }}
            type="text"
            value={breakdownDraft}
          />
          <p className="tw:text-xs tw:text-muted-foreground">
            {localizedStrings['%interlinearizer_analysisCatalog_editMorphemesHint%']}
          </p>
          <div className="tw:flex tw:justify-end tw:gap-1.5">
            <Button
              data-testid="catalog-row-breakdown-cancel"
              onClick={() => setBreakdownDraft(undefined)}
              size="sm"
              type="button"
              variant="outline"
            >
              {localizedStrings['%interlinearizer_analysisCatalog_editMorphemesCancel%']}
            </Button>
            <Button
              data-testid="catalog-row-breakdown-save"
              onClick={commitBreakdown}
              size="sm"
              type="button"
            >
              {localizedStrings['%interlinearizer_analysisCatalog_editMorphemesSave%']}
            </Button>
          </div>
        </div>
      )}

      {morphemes.length > 0 && breakdownDraft === undefined && (
        <div className="tw:flex tw:flex-wrap tw:gap-x-3 tw:gap-y-1">
          {morphemes.map((morpheme) => (
            // Form above gloss, as the interlinear view arranges them, so a breakdown reads the
            // same in both places.
            <div
              className="tw:flex tw:flex-col"
              data-testid="catalog-row-morpheme"
              key={morpheme.id}
            >
              <span className="tw:text-sm">{morpheme.form}</span>
              <div className="tw:w-20">
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
            </div>
          ))}
        </div>
      )}

      <div className="tw:flex tw:gap-1.5">
        {/*
          Offered only when the analysis has pool peers: with none there is nothing a merge could
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
    </div>
  );
}
