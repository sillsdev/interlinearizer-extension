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
import { Button, Checkbox, Input, Label } from 'platform-bible-react';
import { formatReplacementString, type LanguageStrings } from 'platform-bible-utils';
import { useId, useState } from 'react';
import { ModalShell } from './modals/ModalShell';
import type { CatalogRow } from '../utils/analysis-query';
import { resolvedOrEmpty } from '../utils/localized-strings';
import {
  deriveMergeMaster,
  reorderForMerge,
  CLEARED,
  type MergeMaster,
  type MergeMasterEdits,
} from '../utils/merge-master';

/** Localized string keys the merge panel renders. */
export const MERGE_STRING_KEYS = [
  '%interlinearizer_analysisCatalog_mergeTitle%',
  '%interlinearizer_analysisCatalog_mergeForm%',
  '%interlinearizer_analysisCatalog_editGloss%',
  '%interlinearizer_analysisCatalog_mergePos%',
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
  /** Writing system a re-split breakdown's minted morphemes are recorded under. */
  sourceLanguageTag: string;
  /** Commits the merge, folding the checked analyses into the survivor under the settled content. */
  onConfirm: (
    survivorAnalysisId: string,
    mergedAnalysisIds: readonly string[],
    content: MergeMaster,
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
 * One analysis in the listing: whether the merge folds it in, everything the master could take from
 * it, and the controls that move it.
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
      className="tw:flex tw:min-w-0 tw:items-start tw:gap-2 tw:rounded tw:px-2 tw:py-1.5"
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
        <GripVertical aria-hidden className="tw:size-3" />
      </Button>

      <Checkbox
        // The survivor is what the others merge into, so its membership is not a choice.
        checked={merged}
        data-testid="catalog-merge-check"
        disabled={isSurvivor}
        onCheckedChange={onMergedChange}
      />

      {/* Everything the master can take from this analysis, so a row that is about to donate a
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
            cannot. */}
        {candidate.morphemes.length > 0 && (
          <div
            className="tw:flex tw:flex-wrap tw:gap-x-3 tw:gap-y-0.5"
            data-testid="catalog-merge-breakdown"
          >
            {candidate.morphemes.map((morpheme) => (
              <div className="tw:flex tw:min-w-0 tw:flex-col" key={morpheme.id}>
                <span className="tw:truncate tw:font-mono tw:text-xs">{morpheme.form}</span>
                <span className="tw:truncate tw:text-xs tw:text-muted-foreground">
                  {morpheme.gloss?.[analysisLanguage] ?? ''}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="tw:flex tw:flex-wrap tw:gap-x-3 tw:text-xs tw:text-muted-foreground">
          {candidate.pos && <span>{candidate.pos}</span>}
          {candidate.features &&
            Object.entries(candidate.features).map(([name, value]) => (
              <span key={name}>{`${name}=${value}`}</span>
            ))}
          {candidate.confidence && <span>{candidate.confidence}</span>}
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
        <ArrowUpToLine aria-hidden className="tw:size-3" />
      </Button>
    </li>
  );
}

/**
 * Drops one field's edit. Shown only where there is an edit to drop, a control that undoes nothing
 * reading as a way to clear the field.
 */
function RevertButton({
  edited,
  field,
  label,
  onRevert,
}: Readonly<{
  edited: boolean;
  field: keyof MergeMasterEdits;
  label: string;
  onRevert: () => void;
}>) {
  if (!edited) return undefined;
  return (
    <Button
      aria-label={label}
      data-testid={`catalog-merge-revert-${field}`}
      onClick={onRevert}
      size="icon"
      type="button"
      variant="ghost"
    >
      <X aria-hidden className="tw:size-3" />
    </Button>
  );
}

/**
 * Settles what one surface form's analyses should say and which of them should say it: an editable
 * master over the listing of its homographs, each of which the merge either folds in or leaves
 * standing.
 */
export default function CatalogMergeModal({
  surfaceText,
  candidates,
  initialSurvivorId,
  analysisLanguage,
  sourceLanguageTag,
  onConfirm,
  onCancel,
  localizedStrings,
}: CatalogMergeModalProps) {
  // Visible cell text, so an unresolved key would leave an analysis nameless in a list the reader
  // chooses from. The em dash reads as "no gloss" in any language, as it does in the listing.
  const noGloss =
    resolvedOrEmpty(localizedStrings['%interlinearizer_analysisCatalog_noGloss%']) || '—';

  const glossFieldId = useId();
  const posFieldId = useId();
  const [edits, setEdits] = useState<MergeMasterEdits>({});

  /**
   * The analyses the merge would fold in, the survivor excluded — it is always in the merge, so
   * holding it here would be a second place its membership could be said to change.
   */
  const [mergedIds, setMergedIds] = useState<ReadonlySet<string>>(new Set());

  /** Records one field's edit, or drops it back to what the merged analyses derive. */
  const editField = <K extends keyof MergeMasterEdits>(
    field: K,
    value: MergeMasterEdits[K] | undefined,
  ) =>
    setEdits((previous) => {
      const next = { ...previous };
      if (value === undefined) delete next[field];
      else next[field] = value;
      return next;
    });

  /**
   * The reader's arrangement of the analyses, most-preferred first. Held as ids so the listing
   * follows an edit made beside the panel rather than pinning the rows as they were opened.
   */
  const [orderedIds, setOrderedIds] = useState<readonly string[]>(() => [
    initialSurvivorId,
    ...candidates.filter((r) => r.analysisId !== initialSurvivorId).map((r) => r.analysisId),
  ]);

  const order = orderedIds
    .map((id) => candidates.find((r) => r.analysisId === id))
    .filter((r) => r !== undefined);
  const [survivor] = order;

  const checked = new Set([survivor.analysisId, ...mergedIds]);

  /** Moves one analysis, keeping the arrangement and the merge set in step. */
  const applyReorder = (analysisId: string, toIndex: number) => {
    const next = reorderForMerge({ orderedIds, mergedIds }, analysisId, toIndex);
    setOrderedIds(next.orderedIds);
    setMergedIds(next.mergedIds);
  };

  const { master, verdict } = deriveMergeMaster({
    order,
    checked,
    edits,
    analysisLanguage,
    sourceLanguageTag,
  });

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
    applyReorder(String(active.id), orderedIds.indexOf(String(over.id)));
  };
  /* v8 ignore stop */

  /** Puts one analysis into the merge or takes it out; the survivor's membership never moves. */
  const setMerged = (analysisId: string, merged: boolean) =>
    setMergedIds((previous) => {
      const next = new Set(previous);
      if (merged) next.add(analysisId);
      else next.delete(analysisId);
      return next;
    });

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

      <div className="tw:mt-4 tw:flex tw:items-center tw:gap-2">
        <Label className="tw:text-xs tw:text-muted-foreground" htmlFor={glossFieldId}>
          {localizedStrings['%interlinearizer_analysisCatalog_editGloss%']}
        </Label>
        <Input
          className="tw:h-7 tw:w-full tw:min-w-0 tw:text-sm"
          data-testid="catalog-merge-master-gloss"
          id={glossFieldId}
          onChange={(e) => editField('gloss', e.target.value)}
          type="text"
          value={master.gloss}
        />
        <RevertButton
          edited={edits.gloss !== undefined}
          field="gloss"
          label={localizedStrings['%interlinearizer_analysisCatalog_mergeRevertField%']}
          onRevert={() => editField('gloss', undefined)}
        />
      </div>

      <div className="tw:mt-2 tw:flex tw:items-center tw:gap-2">
        <Label className="tw:text-xs tw:text-muted-foreground" htmlFor={posFieldId}>
          {localizedStrings['%interlinearizer_analysisCatalog_mergePos%']}
        </Label>
        <Input
          className="tw:h-7 tw:w-full tw:min-w-0 tw:text-sm"
          data-testid="catalog-merge-master-pos"
          id={posFieldId}
          // Absence and emptiness are the same thing for a free-form tag, so a cleared field
          // records no part of speech rather than an empty one.
          onChange={(e) => editField('pos', e.target.value || CLEARED)}
          type="text"
          value={master.pos ?? ''}
        />
        <RevertButton
          edited={edits.pos !== undefined}
          field="pos"
          label={localizedStrings['%interlinearizer_analysisCatalog_mergeRevertField%']}
          onRevert={() => editField('pos', undefined)}
        />
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
        <SortableContext items={[...orderedIds]} strategy={verticalListSortingStrategy}>
          <ul className="tw:mt-4 tw:flex tw:max-h-[40vh] tw:flex-col tw:overflow-y-auto">
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
          onClick={() => onConfirm(survivor.analysisId, [...mergedIds], master, surfaceText)}
        >
          {localizedStrings['%interlinearizer_analysisCatalog_mergeConfirm%']}
        </Button>
      </div>
    </ModalShell>
  );
}
