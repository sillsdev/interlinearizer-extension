import type { MorphemeAnalysis, SenseRef } from 'interlinearizer';
import { Button, Input, Label, Popover, PopoverAnchor } from 'platform-bible-react';
import { formatReplacementString, type LanguageStrings } from 'platform-bible-utils';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useDeletionPreview } from '../cache/catalogHooks';
import { morphemeCarriesAnnotation } from '../utils/analysis-identity';
import type { CatalogRow } from '../utils/analysis-query';
import { DELETION_PREVIEW_STRING_KEYS, deletionPreview } from '../utils/deletion-announcement';
import { multiStringText } from '../utils/multi-string';
import { resolvedOrEmpty } from '../utils/localized-strings';
import type { Settles } from '../utils/settles';
import { useAnalysisReadOnly, useReportGlossEditing } from './AnalysisStore';
import useLatestRef from '../hooks/useLatestRef';
import { useDisplayedGloss } from './LexiconSenses';
import { ModalShell } from './modals/ModalShell';
import { BoxAlignedField, MorphemeBox, ROW_LABEL_CLASS } from './MorphemeBox';
import { MorphemeBreakdownPopover, type MorphemeEditorLabels } from './MorphemeEditor';

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
  '%interlinearizer_analysisCatalog_deleteConfirmLoading%',
  '%interlinearizer_analysisCatalog_deleteConfirmFailed%',
  '%interlinearizer_analysisCatalog_deleteConfirmRetry%',
  '%interlinearizer_analysisCatalog_deleteConfirmMissing%',
  ...DELETION_PREVIEW_STRING_KEYS,
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
  /**
   * Writes the analysis's gloss for every token linked to it. A result that rejects leaves the edit
   * unsent, for the field to send again.
   */
  onGlossCommit: (value: string) => Settles<unknown>;
  /** Replaces the analysis's morpheme breakdown for every token linked to it. */
  onMorphemesCommit: (forms: readonly string[]) => void;
  /** Keeps the analysis's stale breakdown as it stands, for every token linked to it. */
  onMorphemesConfirm: () => void;
  /**
   * Writes one morpheme's gloss for every token linked to the analysis. A result that rejects
   * leaves the edit unsent, for the field to send again.
   */
  onMorphemeGlossCommit: (morphemeId: string, value: string) => Settles<unknown>;
  /**
   * The breakdown draft, or `undefined` while the breakdown editor is closed. Held by the caller,
   * which outlives this editor's own mounting.
   */
  breakdownDraft: string | undefined;
  /** Records the breakdown draft, `undefined` closing the breakdown editor. */
  onBreakdownDraftChange: (draft: string | undefined) => void;
  /** Keeps the gloss drafts no field is showing, and tracks the fields showing a failed one. */
  glossRetry: GlossRetry;
  /** Resolved localizations covering at least {@link ROW_EDITOR_STRING_KEYS}. */
  localizedStrings: LanguageStrings;
}>;

/**
 * A gloss field of the catalog: an analysis's own gloss, or one morpheme's gloss when `morphemeId`
 * is set, in the analysis language `language`.
 */
export type GlossField = Readonly<{ language: string; analysisId: string; morphemeId?: string }>;

/** A gloss draft no field is showing, with the committed value it was typed over. */
type RejectedGloss = Readonly<{ draft: string; typedOver: string }>;

/**
 * Keeps the gloss drafts that no field is showing, for each field to show again when it next
 * mounts. Also tracks the mounted fields showing a draft whose commit failed.
 *
 * A field unmounts when its row is collapsed or no longer listed, or when the analysis language
 * changes. An unmounted field cannot send its draft itself.
 */
export type GlossRetry = Readonly<{
  /**
   * The draft to show in `field`, or `undefined` when none is kept. Returns `undefined` for a draft
   * typed over a different committed value, which an edit since replaced.
   */
  draftFor: (field: GlossField, committedValue: string) => string | undefined;
  /**
   * Keeps a draft for `field`, which unmounted holding it unsent or whose commit failed after it
   * unmounted.
   */
  reject: (field: GlossField, gloss: RejectedGloss) => void;
  /**
   * Drops the draft kept for `field`, once that field has mounted: it either shows the draft again
   * or found it typed over a gloss that has changed since.
   */
  restored: (field: GlossField) => void;
  /**
   * Drops each kept draft that no field can show again: one whose analysis or morpheme is not among
   * `rows`, or whose gloss there differs from the value the draft was typed over. Only drafts for
   * analyses in `askedIds` can be dropped; the rest are kept.
   */
  prune: (rows: readonly CatalogRow[], askedIds: ReadonlySet<string>) => void;
  /** The analyses a draft is kept for, each named once. */
  keptAnalysisIds: () => string[];
  /** Records whether the mounted `field` shows a draft whose commit failed. */
  holding: (field: GlossField, held: boolean) => void;
  /** Tracks a commit in flight, until it settles. */
  track: (commit: Promise<unknown>) => Promise<void>;
  /**
   * Calls `then` once no commit is in flight, at once when none is. By then each failed commit's
   * draft is held.
   */
  afterCommits: (then: () => void) => Promise<void>;
  /** Whether any draft is kept or any mounted field shows one whose commit failed. */
  isHolding: () => boolean;
}>;

/** The gloss that `field` holds in `rows`, or `undefined` when its analysis or morpheme is gone. */
function committedGloss(rows: readonly CatalogRow[], field: GlossField): string | undefined {
  const row = rows.find((r) => r.analysisId === field.analysisId);
  if (row === undefined) return undefined;
  if (field.morphemeId === undefined) return multiStringText(row.glosses, field.language);
  const morpheme = row.morphemes.find((m) => m.id === field.morphemeId);
  return morpheme && (morpheme.gloss?.[field.language] ?? '');
}

/**
 * Creates an empty {@link GlossRetry} that tells `onHeldChange` whether any draft is held, each time
 * that changes.
 */
export function createGlossRetry(onHeldChange: (held: boolean) => void): GlossRetry {
  const rejected = new Map<string, Readonly<{ field: GlossField; gloss: RejectedGloss }>>();
  const failedKeys = new Set<string>();
  const inFlight = new Set<Promise<unknown>>();
  let held = false;
  const keyOf = (field: GlossField) =>
    JSON.stringify([field.language, field.analysisId, field.morphemeId]);
  const isHolding = () => rejected.size > 0 || failedKeys.size > 0;
  const report = () => {
    if (isHolding() === held) return;
    held = !held;
    onHeldChange(held);
  };
  const afterCommits = async (then: () => void) => {
    // Runs `then` without awaiting when nothing is in flight, so an idle close is immediate.
    if (inFlight.size === 0) {
      then();
      return;
    }
    await Promise.allSettled([...inFlight]);
    await afterCommits(then);
  };
  return {
    draftFor: (field, committedValue) => {
      const gloss = rejected.get(keyOf(field))?.gloss;
      return gloss?.typedOver === committedValue ? gloss.draft : undefined;
    },
    reject: (field, gloss) => {
      rejected.set(keyOf(field), { field, gloss });
      report();
    },
    restored: (field) => {
      rejected.delete(keyOf(field));
      report();
    },
    prune: (rows, askedIds) => {
      [...rejected]
        .filter(
          ([, { field, gloss }]) =>
            askedIds.has(field.analysisId) && committedGloss(rows, field) !== gloss.typedOver,
        )
        .forEach(([key]) => rejected.delete(key));
      report();
    },
    keptAnalysisIds: () => [
      ...new Set([...rejected.values()].map(({ field }) => field.analysisId)),
    ],
    holding: (field, isHeld) => {
      if (isHeld) failedKeys.add(keyOf(field));
      else failedKeys.delete(keyOf(field));
      report();
    },
    track: (commit) => {
      inFlight.add(commit);
      const settle = () => {
        inFlight.delete(commit);
      };
      return commit.then(settle, settle);
    },
    afterCommits,
    isHolding,
  };
}

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
  retry,
  retryField,
  testId,
}: Readonly<{
  ariaLabel?: string;
  committedValue: string;
  id?: string;
  onCommit: (value: string) => Settles<unknown>;
  retry: GlossRetry;
  /** The gloss this input edits, under which `retry` keeps its draft. */
  retryField: GlossField;
  testId: string;
}>) {
  const { language, analysisId, morphemeId } = retryField;
  const field = useMemo(
    () => ({ language, analysisId, morphemeId }),
    [language, analysisId, morphemeId],
  );
  const [restoredDraft] = useState(() => retry.draftFor(field, committedValue));
  const [draft, setDraft] = useState(restoredDraft ?? committedValue);
  // Whether the field shows a draft whose commit failed, which leaving the panel must not drop
  // unasked. Typing alone does not count: whatever moves focus to ask would commit the typing.
  const [failed, setFailed] = useState(restoredDraft !== undefined);
  const [draftOf, setDraftOf] = useState(committedValue);
  const isMounted = useRef(false);
  useEffect(() => {
    isMounted.current = true;
    retry.restored(field);
    return () => {
      isMounted.current = false;
    };
  }, [retry, field]);
  // The draft last sent to onCommit, kept until the committed value changes or the commit fails. The
  // host may answer a commit only later, leaving the committed value behind the draft until it does.
  const [sent, setSent] = useState<string | undefined>(undefined);
  const latestDraft = useLatestRef(draft);

  // Adjusted during render rather than in an effect, so the field never paints one frame holding
  // the previous value.
  if (committedValue !== draftOf) {
    setDraftOf(committedValue);
    setDraft(committedValue);
    setSent(undefined);
    setFailed(false);
  }

  const unsent = draft !== committedValue && draft !== sent;
  const holding = unsent && failed;
  useEffect(() => {
    retry.holding(field, holding);
    return () => retry.holding(field, false);
  }, [retry, field, holding]);

  const commit = () => {
    if (!unsent) return;
    setSent(draft);
    retry.holding(field, false);
    const settled = onCommit(draft);
    if (settled instanceof Promise)
      retry.track(
        settled.catch(() => {
          if (!isMounted.current) {
            retry.reject(field, { draft, typedOver: committedValue });
            return;
          }
          setSent((current) => (current === draft ? undefined : current));
          setFailed(true);
          // Marked at once rather than by the effect after the next render, so that a close waiting
          // on this commit already sees the draft as held.
          if (latestDraft.current === draft) retry.holding(field, true);
        }),
      );
  };

  // Surface uncommitted typing to the unsaved indicator before the edit commits on blur. A field
  // that unmounts holding an unsent draft keeps it for its next mounting rather than sending it:
  // the unmount may come from switching the analysis language, and the host would write the draft
  // in the new one.
  useReportGlossEditing(unsent, () => retry.reject(field, { draft, typedOver: committedValue }));

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
  glossRetry,
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
          key={`${analysisLanguage}/${analysisId}-gloss`}
          onCommit={onGlossCommit}
          retry={glossRetry}
          retryField={{ language: analysisLanguage, analysisId }}
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
                    key={`${analysisLanguage}/${analysisId}-${morpheme.id}`}
                    onCommit={(value) => onMorphemeGlossCommit(morpheme.id, value)}
                    retry={glossRetry}
                    retryField={{ language: analysisLanguage, analysisId, morphemeId: morpheme.id }}
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
 * Asks the reader to confirm deleting the analysis `analysisId` names, stating what the deletion
 * would do. Delete waits until the host states the outcome or fails to. It stays withheld for an
 * analysis already deleted.
 */
function DeleteConfirmation({
  analysisId,
  surfaceText,
  onCancel,
  onConfirm,
  localizedStrings,
}: Readonly<{
  analysisId: string;
  surfaceText: string;
  onCancel: () => void;
  onConfirm: () => void;
  localizedStrings: LanguageStrings;
}>) {
  const preview = useDeletionPreview(analysisId);
  return (
    <ModalShell
      onClose={onCancel}
      title={localizedStrings['%interlinearizer_analysisCatalog_deleteConfirmTitle%']}
      titleTestId="catalog-delete-confirm-title"
      width="tw:w-96"
    >
      <p className="tw:mb-4 tw:text-sm" data-testid="catalog-delete-confirm-prompt">
        {formatReplacementString(
          localizedStrings['%interlinearizer_analysisCatalog_deleteConfirmPrompt%'],
          { form: surfaceText },
        )}
      </p>
      <p className="tw:mb-4 tw:text-sm" data-testid="catalog-delete-confirm-outcome">
        {preview.status === 'ready' && deletionPreview(preview.outcome, localizedStrings)}
        {preview.status === 'loading' &&
          localizedStrings['%interlinearizer_analysisCatalog_deleteConfirmLoading%']}
        {preview.status === 'failed' &&
          localizedStrings['%interlinearizer_analysisCatalog_deleteConfirmFailed%']}
        {preview.status === 'missing' &&
          localizedStrings['%interlinearizer_analysisCatalog_deleteConfirmMissing%']}
      </p>
      <div className="tw:modal-actions">
        {preview.status === 'failed' && (
          <Button
            data-testid="catalog-delete-confirm-retry"
            onClick={preview.retry}
            variant="secondary"
          >
            {localizedStrings['%interlinearizer_analysisCatalog_deleteConfirmRetry%']}
          </Button>
        )}
        <Button data-testid="catalog-delete-confirm-cancel" onClick={onCancel} variant="secondary">
          {localizedStrings['%interlinearizer_analysisCatalog_deleteConfirmCancel%']}
        </Button>
        <Button
          data-testid="catalog-delete-confirm"
          disabled={preview.status === 'loading' || preview.status === 'missing'}
          onClick={onConfirm}
          variant="destructive"
        >
          {localizedStrings['%interlinearizer_analysisCatalog_delete%']}
        </Button>
      </div>
    </ModalShell>
  );
}

/**
 * The controls that act on a whole analysis rather than on one of its fields.
 *
 * Renders nothing for a read-only analysis, which neither control applies to.
 */
export function CatalogRowActions({
  analysisId,
  surfaceText,
  onMergeRequest,
  onDeleteRequest,
  localizedStrings,
}: Readonly<{
  /** Id of the analysis the controls act on. */
  analysisId: string;
  /** Surface form the delete confirmation names the analysis by. */
  surfaceText: string;
  /** Opens the merge picker. Absent when the analysis shares its form with no other record. */
  onMergeRequest?: () => void;
  /** Deletes the analysis. Called only after the reader confirms the deletion. */
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
        <DeleteConfirmation
          analysisId={analysisId}
          localizedStrings={localizedStrings}
          onCancel={cancelDelete}
          onConfirm={() => {
            setConfirmingDelete(false);
            onDeleteRequest();
          }}
          surfaceText={surfaceText}
        />
      )}
    </div>
  );
}
