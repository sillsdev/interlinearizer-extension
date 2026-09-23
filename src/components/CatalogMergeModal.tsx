import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowUpToLine, GripVertical, X } from 'lucide-react';
import {
  Button,
  Checkbox,
  Input,
  Label,
  Popover,
  PopoverAnchor,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from 'platform-bible-react';
import { formatReplacementString, type LanguageStrings } from 'platform-bible-utils';
import { useId, useState, type ReactNode } from 'react';
import type { Confidence } from 'interlinearizer';
import { breakdownDraftForms } from './CatalogRowEditor';
import { morphemeCarriesAnnotation } from '../utils/analysis-identity';
import { MorphemeBox } from './MorphemeBox';
import { MorphemeBreakdownPopover, type MorphemeEditorLabels } from './MorphemeEditor';
import { ModalShell } from './modals/ModalShell';
import type { CatalogRow } from '../utils/analysis-query';
import { resolvedOrEmpty } from '../utils/localized-strings';
import {
  deriveBreakdown,
  deriveMergeContent,
  remapMorphemeGlossEdits,
  reorderForMerge,
  CLEARED,
  type MergedContentDraft,
  type MergeContentEdits,
  type MergeReorder,
} from '../utils/merge-content';

/**
 * The name each confidence level is offered under. Confidence is a closed vocabulary, so it is
 * named rather than shown as the record stores it.
 */
const CONFIDENCE_LABEL_KEYS = {
  high: '%interlinearizer_analysisCatalog_confidence_high%',
  medium: '%interlinearizer_analysisCatalog_confidence_medium%',
  low: '%interlinearizer_analysisCatalog_confidence_low%',
  guess: '%interlinearizer_analysisCatalog_confidence_guess%',
} as const satisfies Record<Confidence, `%${string}%`>;

/** The levels the select offers, ordered as confidence descends. */
const CONFIDENCE_LEVELS: readonly Confidence[] = ['high', 'medium', 'low', 'guess'];

/**
 * One width for every field's label, so the fields themselves start on a line down the panel rather
 * than each one wherever its own label happens to end.
 */
const FIELD_LABEL_CLASS = 'tw:w-24 tw:shrink-0 tw:text-xs tw:text-muted-foreground';

/**
 * The choice of recording no confidence, which the platform select needs a string for. A leading
 * NUL collides with no level, and with nothing the analysis layer reads.
 */
const NO_CONFIDENCE = '\u0000none';

/** The level a select's value names, or `undefined` where it names none. */
function confidenceChoice(value: string): Confidence | undefined {
  return CONFIDENCE_LEVELS.find((level) => level === value);
}

/** Localized string keys the merge panel renders. */
export const MERGE_STRING_KEYS = [
  '%interlinearizer_analysisCatalog_mergeTitle%',
  '%interlinearizer_analysisCatalog_mergeForm%',
  '%interlinearizer_analysisCatalog_editGloss%',
  '%interlinearizer_analysisCatalog_editMorphemes%',
  '%interlinearizer_analysisCatalog_editMorphemesHint%',
  '%interlinearizer_analysisCatalog_editMorphemesOpen%',
  '%interlinearizer_analysisCatalog_editMorphemesSave%',
  '%interlinearizer_analysisCatalog_editMorphemesCancel%',
  '%interlinearizer_analysisCatalog_editMorphemesReset%',
  '%interlinearizer_analysisCatalog_confirmResetPrompt%',
  '%interlinearizer_analysisCatalog_confirmResetAction%',
  '%interlinearizer_analysisCatalog_confirmResplitPrompt%',
  '%interlinearizer_analysisCatalog_confirmResplitAction%',
  '%interlinearizer_analysisCatalog_morphemeNoGloss%',
  '%interlinearizer_analysisCatalog_noBreakdown%',
  '%interlinearizer_analysisCatalog_mergeMorphemeGlosses%',
  '%interlinearizer_analysisCatalog_mergeClearMorphemeGloss%',
  '%interlinearizer_analysisCatalog_morphemeGloss%',
  '%interlinearizer_analysisCatalog_mergeConfidence%',
  '%interlinearizer_analysisCatalog_mergeConfidenceNone%',
  ...Object.values(CONFIDENCE_LABEL_KEYS),
  '%interlinearizer_analysisCatalog_mergeUsageCount%',
  '%interlinearizer_analysisCatalog_mergePromote%',
  '%interlinearizer_analysisCatalog_mergeReorder%',
  '%interlinearizer_analysisCatalog_mergeRevertField%',
  '%interlinearizer_analysisCatalog_mergeReset%',
  '%interlinearizer_analysisCatalog_mergeWillCollapse%',
  '%interlinearizer_analysisCatalog_noGloss%',
  '%interlinearizer_analysisCatalog_mergeCancel%',
  '%interlinearizer_analysisCatalog_mergeConfirm%',
] as const satisfies `%${string}%`[];

/** Props for {@link CatalogMergeModal}. */
type CatalogMergeModalProps = Readonly<{
  /** The surface form every listed analysis shares, shown above them. */
  surfaceText: string;
  /** Every analysis of the form — the survivor, the ones it may absorb, and the rest. */
  candidates: readonly CatalogRow[];
  /** The analysis the panel was opened from, which starts as the survivor. */
  initialSurvivorId: string;
  /** BCP 47 tag the glosses are read and written under. */
  analysisLanguage: string;
  /** When false, the breakdown fields are not shown, as the view option hides them on the strip. */
  showMorphology: boolean;
  /** Writing system a re-split breakdown's minted morphemes are recorded under. */
  sourceLanguageTag: string;
  /**
   * Commits the merge, folding the checked analyses into the survivor under the settled content,
   * most-preferred first as the reader arranged them.
   */
  onConfirm: (
    survivorAnalysisId: string,
    mergedAnalysisIds: readonly string[],
    content: MergedContentDraft,
    surfaceText: string,
  ) => void;
  /** Backs out, leaving every analysis untouched. */
  onCancel: () => void;
  /** Resolved localizations covering at least {@link MERGE_STRING_KEYS}. */
  localizedStrings: LanguageStrings;
}>;

/** Props for {@link SortableCandidate}. */
type SortableCandidateProps = Readonly<{
  candidate: CatalogRow;
  /** Whether the merge is folding this analysis in, which the survivor always is. */
  merged: boolean;
  isSurvivor: boolean;
  surfaceText: string;
  /** Text shown where the analysis has no gloss in the analysis language. */
  noGloss: string;
  /** BCP 47 tag the morpheme glosses are read under. */
  analysisLanguage: string;
  onMergedChange: (merged: boolean) => void;
  onPromote: () => void;
  localizedStrings: LanguageStrings;
}>;

/**
 * One analysis in the listing: whether the merge folds it in, everything the merged content could
 * take from it, and the controls that move it.
 */
function SortableCandidate({
  candidate,
  merged,
  isSurvivor,
  surfaceText,
  noGloss,
  analysisLanguage,
  onMergedChange,
  onPromote,
  localizedStrings,
}: SortableCandidateProps) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: candidate.analysisId,
  });

  return (
    <li
      className="tw:flex tw:min-w-0 tw:items-center tw:gap-2 tw:rounded tw:border tw:border-border tw:px-2 tw:py-1.5"
      data-analysis-id={candidate.analysisId}
      data-testid="catalog-merge-candidate"
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <Button
        aria-label={formatReplacementString(
          localizedStrings['%interlinearizer_analysisCatalog_mergeReorder%'],
          { gloss: candidate.gloss || surfaceText },
        )}
        className="tw:cursor-grab"
        data-testid="catalog-merge-drag-handle"
        size="icon"
        type="button"
        variant="ghost"
        {...attributes}
        {...listeners}
      >
        <GripVertical aria-hidden className="tw:size-5" />
      </Button>

      <Checkbox
        // The survivor is what the others merge into, so its membership is not a choice.
        checked={merged}
        className="tw:size-5"
        data-testid="catalog-merge-check"
        disabled={isSurvivor}
        onCheckedChange={onMergedChange}
      />

      {/* Everything the merged content can take from this analysis, so a row that is about to donate a
          field says so on its face. */}
      <div className="tw:flex tw:min-w-0 tw:flex-1 tw:flex-col tw:gap-0.5">
        <div className="tw:flex tw:items-baseline tw:gap-2">
          <span className="tw:min-w-0 tw:flex-1 tw:truncate" data-testid="catalog-merge-gloss">
            {candidate.gloss || noGloss}
          </span>
          <span
            className="tw:text-xs tw:tabular-nums tw:text-muted-foreground"
            data-testid="catalog-merge-usage-count"
          >
            {formatReplacementString(
              localizedStrings['%interlinearizer_analysisCatalog_mergeUsageCount%'],
              { count: candidate.usageCount },
            )}
          </span>
        </div>

        {/* Each morpheme over its gloss, which is what tells apart two analyses their own glosses
            cannot. Laid out inline rather than in the boxed grid the content panel edits: a card is
            a summary in a drag list, where a box per candidate would read as another panel. */}
        <div
          className="tw:flex tw:flex-wrap tw:gap-x-3 tw:gap-y-0.5"
          data-testid="catalog-merge-breakdown"
        >
          {candidate.morphemes.length === 0 ? (
            <span
              className="tw:text-xs tw:italic tw:text-muted-foreground"
              data-testid="catalog-merge-morpheme-none"
            >
              {localizedStrings['%interlinearizer_analysisCatalog_noBreakdown%']}
            </span>
          ) : (
            candidate.morphemes.map((morpheme) => {
              const gloss = morpheme.gloss?.[analysisLanguage];
              return (
                <div
                  className="tw:flex tw:min-w-0 tw:flex-col"
                  data-testid="catalog-merge-morpheme"
                  key={morpheme.id}
                >
                  <span className="tw:truncate tw:font-mono tw:text-xs">{morpheme.form}</span>
                  <span
                    className={`tw:truncate tw:text-xs tw:text-muted-foreground${gloss ? '' : ' tw:italic'}`}
                    data-testid="catalog-merge-morpheme-gloss"
                  >
                    {gloss || localizedStrings['%interlinearizer_analysisCatalog_morphemeNoGloss%']}
                  </span>
                </div>
              );
            })
          )}
        </div>

        <div className="tw:flex tw:flex-wrap tw:gap-x-3 tw:text-xs tw:text-muted-foreground">
          {candidate.confidence && (
            <span>{localizedStrings[CONFIDENCE_LABEL_KEYS[candidate.confidence]]}</span>
          )}
        </div>
      </div>

      <Button
        aria-label={formatReplacementString(
          localizedStrings['%interlinearizer_analysisCatalog_mergePromote%'],
          { gloss: candidate.gloss || surfaceText },
        )}
        data-testid="catalog-merge-promote"
        disabled={isSurvivor}
        onClick={onPromote}
        size="icon"
        type="button"
        variant="ghost"
      >
        <ArrowUpToLine aria-hidden className="tw:size-5" />
      </Button>
    </li>
  );
}

/**
 * An X over the end of a field, taking back what the reader typed into it. Shown only where there
 * is an edit to take back, a control that undoes nothing reading as a way to clear the field.
 *
 * The field it sits over must hold end padding for it unconditionally, so text never runs under it
 * and the field does not widen as it appears.
 */
function InlineRevertButton({
  edited,
  label,
  onRevert,
  testId,
}: Readonly<{ edited: boolean; label: string; onRevert: () => void; testId: string }>) {
  if (!edited) return undefined;
  return (
    <Button
      aria-label={label}
      className="tw:absolute tw:inset-y-0 tw:end-1 tw:my-auto tw:size-5 tw:text-muted-foreground"
      data-testid={testId}
      onClick={onRevert}
      size="icon"
      type="button"
      variant="ghost"
    >
      <X aria-hidden className="tw:size-3.5" />
    </Button>
  );
}

/** A field with the control that takes its edit back sitting inside it, at the end of the field. */
function RevertableField({
  edited,
  field,
  label,
  onRevert,
  children,
}: Readonly<{
  edited: boolean;
  field: keyof MergeContentEdits;
  label: string;
  onRevert: () => void;
  children: ReactNode;
}>) {
  return (
    <div className="tw:relative tw:min-w-0">
      {children}
      <InlineRevertButton
        edited={edited}
        label={label}
        onRevert={onRevert}
        testId={`catalog-merge-revert-${field}`}
      />
    </div>
  );
}

/**
 * Where a drop on `overId` lands in `listedIds`, or `undefined` when the listing does not hold it —
 * a place of its own, which an index cannot express without reading as one counted from the end.
 */
export function dropIndex(listedIds: readonly string[], overId: string): number | undefined {
  const index = listedIds.indexOf(overId);
  return index === -1 ? undefined : index;
}

/**
 * Settles what one surface form's analyses should say and which of them should say it: editable
 * merged content over the listing of its homographs, each of which the merge either folds in or
 * leaves standing.
 */
export default function CatalogMergeModal({
  surfaceText,
  candidates,
  initialSurvivorId,
  analysisLanguage,
  showMorphology,
  sourceLanguageTag,
  onConfirm,
  onCancel,
  localizedStrings,
}: CatalogMergeModalProps) {
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

  // Visible cell text, so an unresolved key would leave an analysis nameless in a list the reader
  // chooses from. The em dash reads as "no gloss" in any language, as it does in the listing.
  const noGloss =
    resolvedOrEmpty(localizedStrings['%interlinearizer_analysisCatalog_noGloss%']) || '—';

  const glossFieldId = useId();
  const [breakdownDraft, setBreakdownDraft] = useState<string | undefined>(undefined);
  const [edits, setEdits] = useState<MergeContentEdits>({});

  /**
   * The analyses the merge would fold in, the survivor excluded — it is always in the merge, so
   * holding it here would be a second place its membership could be said to change.
   */
  const [mergedIds, setMergedIds] = useState<ReadonlySet<string>>(new Set());

  /** Records one field's edit, or drops it back to what the merged analyses derive. */
  const editField = <K extends keyof MergeContentEdits>(
    field: K,
    value: MergeContentEdits[K] | undefined,
  ) =>
    setEdits((previous) => {
      const next = { ...previous };
      if (value === undefined) delete next[field];
      else next[field] = value;
      return next;
    });

  /**
   * The analyses the reader has arranged, most-preferred first. Held as ids so the listing follows
   * an edit made beside the panel rather than pinning the rows as they were opened.
   */
  const [orderedIds, setOrderedIds] = useState<readonly string[]>(() => [initialSurvivorId]);

  // An analysis of the form the arrangement has nothing to say about — one an edit beside the panel
  // raised — lands at the foot, unchecked, rather than going unlisted.
  const order = [
    ...orderedIds
      .map((id) => candidates.find((r) => r.analysisId === id))
      .filter((r) => r !== undefined),
    ...candidates.filter((r) => !orderedIds.includes(r.analysisId)),
  ];
  const [survivor] = order;

  // Every listed analysis, not only those the reader has rearranged: a drop resolves against what is
  // on screen.
  const listedIds = order.map((r) => r.analysisId);

  const checked = new Set([survivor.analysisId, ...mergedIds]);

  const { content, verdict } = deriveMergeContent({
    order,
    checked,
    edits,
    analysisLanguage,
    sourceLanguageTag,
  });

  /**
   * Restages the gloss edits against `nextForms`, each staying on the form it was typed about. A
   * `resplit` stages those forms as the reader's own breakdown; otherwise they are what the
   * analyses derive and no breakdown of the reader's is left standing.
   */
  const restageGlossEdits = (nextForms: readonly string[], resplit: boolean) =>
    setEdits((previous) => {
      const morphemeGlosses = remapMorphemeGlossEdits(
        previous.morphemeGlosses,
        content.morphemes,
        nextForms,
      );
      const next = { ...previous };
      if (resplit) next.morphemeForms = nextForms;
      else delete next.morphemeForms;
      if (morphemeGlosses) next.morphemeGlosses = morphemeGlosses;
      else delete next.morphemeGlosses;
      return next;
    });

  /** Stages a re-split, keeping each gloss edit on the form it was typed about. */
  const resplitTo = (forms: readonly string[]) => restageGlossEdits(forms, true);

  /**
   * Keeps each gloss edit on the form it was typed about when a change of survivor or of membership
   * would swap the derived breakdown. A re-split of the reader's outranks what the analyses derive,
   * so it stands through the change and the edits stay where it put them.
   */
  const restageForSelection = (next: MergeReorder) => {
    if (edits.morphemeForms) return;
    const nextOrder = next.orderedIds
      .map((id) => candidates.find((r) => r.analysisId === id))
      .filter((r) => r !== undefined);
    const nextChecked = new Set([next.orderedIds[0], ...next.mergedIds]);
    restageGlossEdits(
      deriveBreakdown(nextOrder, nextChecked).map((m) => m.form),
      false,
    );
  };

  /** Moves one analysis, keeping the arrangement and the merge set in step. */
  const applyReorder = (analysisId: string, toIndex: number) => {
    const next = reorderForMerge({ orderedIds: listedIds, mergedIds }, analysisId, toIndex);
    restageForSelection(next);
    setOrderedIds(next.orderedIds);
    setMergedIds(next.mergedIds);
  };

  // Named by its form where it carries no gloss, a warning that named neither leaving nothing to
  // recognize the analysis by.
  const collapsingGloss =
    verdict.reason === 'will-collapse'
      ? candidates.find((r) => r.analysisId === verdict.collapsingAnalysisId)?.gloss || surfaceText
      : '';

  // The keyboard sensor is registered so a drag is not the only way to rearrange the listing.
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  /* v8 ignore start -- a drop resolves against element rects, which jsdom reports as zero-sized, so
     no drag can complete under test; the rule it hands to is covered directly */
  /** Lands a dragged analysis where it was dropped; a drop outside the listing moves nothing. */
  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over) return;
    const toIndex = dropIndex(listedIds, String(over.id));
    if (toIndex !== undefined) applyReorder(String(active.id), toIndex);
  };
  /* v8 ignore stop */

  /** Puts one analysis into the merge or takes it out; the survivor's membership never moves. */
  const setMerged = (analysisId: string, merged: boolean) => {
    const next = new Set(mergedIds);
    if (merged) next.add(analysisId);
    else next.delete(analysisId);
    restageForSelection({ orderedIds: listedIds, mergedIds: next });
    setMergedIds(next);
  };

  return (
    <ModalShell
      onClose={onCancel}
      title={localizedStrings['%interlinearizer_analysisCatalog_mergeTitle%']}
      titleTestId="catalog-merge-title"
      width="tw:w-fit tw:max-w-2xl"
    >
      {/* The form is what the whole decision is about, so it is centered over the panel. */}
      <div className="tw:flex tw:flex-col tw:items-center tw:gap-1">
        <span
          className="tw:text-xs tw:text-muted-foreground"
          data-testid="catalog-merge-form-label"
        >
          {localizedStrings['%interlinearizer_analysisCatalog_mergeForm%']}
        </span>
        <p className="tw:text-lg tw:font-semibold" data-testid="catalog-merge-form">
          {surfaceText}
        </p>
      </div>

      {/* Bordered as an analysis in the listing is, the merged content being what they all merge into. */}
      <div className="tw:mt-4 tw:flex tw:flex-col tw:gap-3 tw:rounded tw:border tw:border-border tw:p-3">
        <div className="tw:flex tw:items-center tw:gap-3">
          <Label className={FIELD_LABEL_CLASS} htmlFor={glossFieldId}>
            {localizedStrings['%interlinearizer_analysisCatalog_editGloss%']}
          </Label>
          <div className="tw:min-w-0 tw:flex-1">
            <RevertableField
              edited={edits.gloss !== undefined}
              field="gloss"
              label={localizedStrings['%interlinearizer_analysisCatalog_mergeRevertField%']}
              onRevert={() => editField('gloss', undefined)}
            >
              <Input
                className="tw:h-7 tw:w-full tw:min-w-0 tw:pe-7 tw:text-sm"
                data-testid="catalog-merge-content-gloss"
                id={glossFieldId}
                onChange={(e) => editField('gloss', e.target.value)}
                type="text"
                value={content.gloss}
              />
            </RevertableField>
          </div>
        </div>

        {/* Boxed as the row editor's breakdown is, so the forms and their glosses read as one unit
            wherever a breakdown is edited. */}
        {showMorphology && (
          <div className="tw:flex tw:w-fit tw:max-w-full tw:flex-col tw:gap-1.5">
            {/* The breakdown is edited where it is shown: clicking a form opens the editor, rather
                than a separate field naming the same rows again. */}
            <div className="tw:flex tw:items-center tw:gap-1">
              <Popover open={breakdownDraft !== undefined}>
                {content.morphemes.length === 0 ? (
                  // Nothing split yet, so there is no forms row to click.
                  <PopoverAnchor asChild>
                    <Button
                      aria-label={formatReplacementString(
                        localizedStrings['%interlinearizer_analysisCatalog_editMorphemesOpen%'],
                        { form: surfaceText },
                      )}
                      className="tw:h-auto tw:w-fit tw:px-1 tw:py-0 tw:font-mono tw:text-xs"
                      data-testid="catalog-merge-breakdown-open"
                      onClick={() => setBreakdownDraft(surfaceText)}
                      size="sm"
                      type="button"
                      variant="link"
                    >
                      {surfaceText}
                    </Button>
                  </PopoverAnchor>
                ) : (
                  <MorphemeBox
                    analysisLanguage={analysisLanguage}
                    disabled={false}
                    glossTestId="catalog-merge-content-morpheme-gloss"
                    morphemeTestId="catalog-merge-content-morpheme"
                    readOnly={false}
                    morphemes={content.morphemes}
                    onEditBreakdown={() =>
                      setBreakdownDraft(content.morphemes.map((m) => m.form).join(' '))
                    }
                    popoverOpen={breakdownDraft !== undefined}
                    rowLabels={{
                      forms: localizedStrings['%interlinearizer_analysisCatalog_editMorphemes%'],
                      glosses:
                        localizedStrings['%interlinearizer_analysisCatalog_mergeMorphemeGlosses%'],
                    }}
                    surfaceText={surfaceText}
                    renderGloss={(morpheme, index) => {
                      const glossEdits = edits.morphemeGlosses ?? {};
                      return (
                        <div className="tw:relative">
                          <Input
                            aria-label={
                              resolvedOrEmpty(
                                formatReplacementString(
                                  localizedStrings[
                                    '%interlinearizer_analysisCatalog_morphemeGloss%'
                                  ],
                                  { form: morpheme.form },
                                ),
                              ) || undefined
                            }
                            className="tw:h-7 tw:pe-7 tw:text-sm"
                            data-testid="catalog-merge-content-morpheme-gloss"
                            onChange={(e) =>
                              editField('morphemeGlosses', {
                                ...glossEdits,
                                [index]: e.target.value,
                              })
                            }
                            // Sized to the gloss it holds, so a row of them is as wide as its contents
                            // rather than sharing out room none asked for; the floor keeps an empty
                            // field clickable.
                            style={{ fieldSizing: 'content', minWidth: '6ch' }}
                            type="text"
                            value={morpheme.gloss?.[analysisLanguage] ?? ''}
                          />
                          <InlineRevertButton
                            edited={glossEdits[index] !== undefined}
                            label={formatReplacementString(
                              localizedStrings[
                                '%interlinearizer_analysisCatalog_mergeClearMorphemeGloss%'
                              ],
                              { form: morpheme.form },
                            )}
                            onRevert={() =>
                              editField(
                                'morphemeGlosses',
                                // The one morpheme's edit dropped, the rest of them standing; emptied
                                // of every edit the field is untouched again.
                                Object.fromEntries(
                                  Object.entries(glossEdits).filter(([at]) => Number(at) !== index),
                                ),
                              )
                            }
                            testId="catalog-merge-revert-morpheme-gloss"
                          />
                        </div>
                      );
                    }}
                  />
                )}
                {breakdownDraft !== undefined && (
                  <MorphemeBreakdownPopover
                    draft={breakdownDraft}
                    initialValue={content.morphemes.map((m) => m.form).join(' ') || surfaceText}
                    labels={breakdownLabels}
                    morphemes={content.morphemes}
                    needsResetConfirm={content.morphemes.some(morphemeCarriesAnnotation)}
                    onClose={() => setBreakdownDraft(undefined)}
                    onDraftChange={(draft) => setBreakdownDraft(draft)}
                    onReset={content.morphemes.length > 0 ? () => resplitTo([]) : undefined}
                    // Staged like every other field here; the merge commits it.
                    onSave={(value) => resplitTo(breakdownDraftForms(value))}
                  />
                )}
              </Popover>
              {edits.morphemeForms !== undefined && (
                <Button
                  aria-label={
                    localizedStrings['%interlinearizer_analysisCatalog_mergeRevertField%']
                  }
                  className="tw:size-5 tw:shrink-0 tw:text-muted-foreground"
                  data-testid="catalog-merge-revert-morphemeForms"
                  // Taking the re-split back returns the derived breakdown, so the gloss edits move
                  // with it rather than staying at the places the re-split gave them.
                  onClick={() =>
                    restageGlossEdits(
                      deriveBreakdown(order, checked).map((m) => m.form),
                      false,
                    )
                  }
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <X aria-hidden className="tw:size-3.5" />
                </Button>
              )}
            </div>
          </div>
        )}

        {/* The field a reader settles after the gloss and its breakdown, set smaller so it does not
            read as the decision the panel is about. */}
        <div className="tw:flex tw:items-center tw:gap-3">
          <span className={FIELD_LABEL_CLASS}>
            {localizedStrings['%interlinearizer_analysisCatalog_mergeConfidence%']}
          </span>
          <Select
            onValueChange={(value) => editField('confidence', confidenceChoice(value) ?? CLEARED)}
            value={content.confidence ?? NO_CONFIDENCE}
          >
            <SelectTrigger
              aria-label={localizedStrings['%interlinearizer_analysisCatalog_mergeConfidence%']}
              className="tw:h-6 tw:text-xs"
              data-testid="catalog-merge-content-confidence"
              size="sm"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem data-testid="catalog-merge-confidence-none" value={NO_CONFIDENCE}>
                {localizedStrings['%interlinearizer_analysisCatalog_mergeConfidenceNone%']}
              </SelectItem>
              {CONFIDENCE_LEVELS.map((level) => (
                <SelectItem
                  data-testid={`catalog-merge-confidence-${level}`}
                  key={level}
                  value={level}
                >
                  {localizedStrings[CONFIDENCE_LABEL_KEYS[level]]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* Beside the select rather than inside it, a select having no room to overlay one. */}
          {edits.confidence !== undefined && (
            <Button
              aria-label={localizedStrings['%interlinearizer_analysisCatalog_mergeRevertField%']}
              className="tw:size-7 tw:shrink-0 tw:text-muted-foreground"
              data-testid="catalog-merge-revert-confidence"
              onClick={() => editField('confidence', undefined)}
              size="icon"
              type="button"
              variant="ghost"
            >
              <X aria-hidden className="tw:size-3.5" />
            </Button>
          )}
        </div>
      </div>

      {verdict.reason === 'will-collapse' && (
        <p
          className="tw:mt-3 tw:text-xs tw:text-muted-foreground"
          data-testid="catalog-merge-collapse-warning"
        >
          {formatReplacementString(
            localizedStrings['%interlinearizer_analysisCatalog_mergeWillCollapse%'],
            { gloss: collapsingGloss },
          )}
        </p>
      )}

      <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd} sensors={sensors}>
        <SortableContext items={listedIds} strategy={verticalListSortingStrategy}>
          <ul className="tw:mt-4 tw:flex tw:max-h-[40vh] tw:flex-col tw:gap-1.5 tw:overflow-y-auto">
            {order.map((candidate) => (
              <SortableCandidate
                key={candidate.analysisId}
                candidate={candidate}
                isSurvivor={candidate.analysisId === survivor.analysisId}
                localizedStrings={localizedStrings}
                analysisLanguage={analysisLanguage}
                merged={checked.has(candidate.analysisId)}
                noGloss={noGloss}
                onMergedChange={(value) => setMerged(candidate.analysisId, value)}
                onPromote={() => applyReorder(candidate.analysisId, 0)}
                surfaceText={surfaceText}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      <div className="tw:mt-4 tw:flex tw:justify-end tw:gap-2">
        {/* Offered only once there is something to undo, beside the buttons that end the whole
            decision rather than among the fields it takes back. */}
        {Object.keys(edits).length > 0 && (
          <Button
            className="tw:me-auto"
            data-testid="catalog-merge-reset"
            onClick={() => setEdits({})}
            size="sm"
            type="button"
            variant="ghost"
          >
            {localizedStrings['%interlinearizer_analysisCatalog_mergeReset%']}
          </Button>
        )}
        <Button data-testid="catalog-merge-cancel" onClick={onCancel} variant="outline">
          {localizedStrings['%interlinearizer_analysisCatalog_mergeCancel%']}
        </Button>
        <Button
          data-testid="catalog-merge-confirm"
          disabled={!verdict.canConfirm}
          onClick={() =>
            onConfirm(
              survivor.analysisId,
              order
                .filter((r) => r !== survivor && mergedIds.has(r.analysisId))
                .map((r) => r.analysisId),
              content,
              surfaceText,
            )
          }
        >
          {localizedStrings['%interlinearizer_analysisCatalog_mergeConfirm%']}
        </Button>
      </div>
    </ModalShell>
  );
}
