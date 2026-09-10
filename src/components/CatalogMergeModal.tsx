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
import { ArrowUpToLine, GripVertical, Plus, X } from 'lucide-react';
import {
  Button,
  Checkbox,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from 'platform-bible-react';
import { formatReplacementString, type LanguageStrings } from 'platform-bible-utils';
import { useId, useRef, useState, type ReactNode } from 'react';
import type { Confidence } from 'interlinearizer';
import { breakdownDraftForms } from './CatalogRowEditor';
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

/**
 * The name each confidence level is offered under. Confidence is a closed vocabulary, unlike a part
 * of speech or a feature value, so it is named rather than shown as the record stores it.
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
  '%interlinearizer_analysisCatalog_mergePos%',
  '%interlinearizer_analysisCatalog_editMorphemes%',
  '%interlinearizer_analysisCatalog_mergeMorphemeGlosses%',
  '%interlinearizer_analysisCatalog_mergeClearMorphemeGloss%',
  '%interlinearizer_analysisCatalog_morphemeGloss%',
  '%interlinearizer_analysisCatalog_mergeFeatures%',
  '%interlinearizer_analysisCatalog_mergeFeatureName%',
  '%interlinearizer_analysisCatalog_mergeFeatureValue%',
  '%interlinearizer_analysisCatalog_mergeAddFeature%',
  '%interlinearizer_analysisCatalog_mergeDropFeature%',
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
        <ArrowUpToLine aria-hidden className="tw:size-5" />
      </Button>
    </li>
  );
}

/**
 * The breakdown as a line of space-separated forms, which the master re-splits from on every
 * keystroke.
 *
 * The line refills whenever the derived breakdown moves under it — a checkbox or a promotion — the
 * reader having then asked for a breakdown they did not type.
 */
function BreakdownInput({
  derivedForms,
  fieldId,
  onFormsChange,
  surfaceText,
}: Readonly<{
  /** The forms the merge settles on, joined. */
  derivedForms: string;
  fieldId: string;
  onFormsChange: (forms: readonly string[]) => void;
  surfaceText: string;
}>) {
  // Held as typed rather than read back off the normalized forms, where a trailing space would be
  // swallowed as it was typed and leave the next form unreachable.
  const [draft, setDraft] = useState(derivedForms);
  const [draftOf, setDraftOf] = useState(derivedForms);

  // Adjusted during render rather than in an effect, so the line never paints one frame holding a
  // breakdown the panel has moved off.
  if (derivedForms !== draftOf) {
    setDraftOf(derivedForms);
    setDraft(derivedForms);
  }

  return (
    <Input
      className="tw:h-7 tw:min-w-0 tw:pe-7 tw:font-mono tw:text-sm"
      data-testid="catalog-merge-master-morphemes"
      id={fieldId}
      onChange={(e) => {
        const forms = breakdownDraftForms(e.target.value, surfaceText);
        setDraft(e.target.value);
        // Synced against what the edit derives to, so its own normalization does not read back as
        // the panel moving the breakdown out from under the reader.
        setDraftOf(forms.join(' '));
        onFormsChange(forms);
      }}
      // Sized to the breakdown it holds, so the box around it is as wide as the forms rather than
      // as wide as the panel; the floor keeps an empty field clickable.
      style={{ fieldSizing: 'content', minWidth: '12ch' }}
      type="text"
      value={draft}
    />
  );
}

/** One feature row as the reader is working on it, before it is folded back into the record. */
type FeatureRow = Readonly<{
  /** Identity across renames, which the record's own key cannot supply. */
  key: string;
  name: string;
  value: string;
}>;

/** The rows a record of features reads as, in the order it lists them. */
function rowsOfFeatures(features: Readonly<Record<string, string>>): readonly FeatureRow[] {
  return Object.entries(features).map(([name, value]) => ({ key: name, name, value }));
}

/**
 * The record a set of rows writes, an unnamed or emptied row recording nothing — a feature carrying
 * nothing is no different from one that is not there.
 */
function featuresOfRows(rows: readonly FeatureRow[]): Readonly<Record<string, string>> {
  const features: Record<string, string> = {};
  rows.forEach(({ name, value }) => {
    if (name.trim() && value) features[name.trim()] = value;
  });
  return features;
}

/**
 * The features the merge would write, a name and a value per row, with an empty row that adds one.
 *
 * Names are edited as the analyses recorded them — a feature vocabulary is the project's, not the
 * extension's. A row survives being renamed or emptied to nothing, neither of which the record
 * itself can hold.
 */
function FeatureFields({
  features,
  onFeaturesChange,
  localizedStrings,
}: Readonly<{
  /** The features the merge settles on, which the fields are filled from. */
  features: Readonly<Record<string, string>>;
  onFeaturesChange: (features: Readonly<Record<string, string>>) => void;
  localizedStrings: LanguageStrings;
}>) {
  const [rows, setRows] = useState<readonly FeatureRow[]>(() => rowsOfFeatures(features));
  const [rowsOf, setRowsOf] = useState(features);
  const nextKey = useRef(0);

  // Refilled during render rather than in an effect, so the rows never paint one frame holding
  // features the panel has moved off. Compared by content, the derivation rebuilding the record on
  // every render.
  if (JSON.stringify(features) !== JSON.stringify(rowsOf)) {
    setRows(rowsOfFeatures(features));
    setRowsOf(features);
  }

  /** Writes the rows back, both to the fields and to what the merge would record. */
  const commit = (next: readonly FeatureRow[]) => {
    const written = featuresOfRows(next);
    setRows(next);
    setRowsOf(written);
    onFeaturesChange(written);
  };

  const editRow = (key: string, patch: Partial<FeatureRow>) =>
    commit(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <div className="tw:flex tw:flex-col tw:gap-1.5">
      {rows.map((featureRow) => (
        <div className="tw:flex tw:items-center tw:gap-2" key={featureRow.key}>
          <Input
            aria-label={localizedStrings['%interlinearizer_analysisCatalog_mergeFeatureName%']}
            className="tw:h-7 tw:w-24 tw:min-w-0 tw:text-xs"
            data-testid={`catalog-merge-feature-name-${featureRow.key}`}
            onChange={(e) => editRow(featureRow.key, { name: e.target.value })}
            type="text"
            value={featureRow.name}
          />
          <Input
            // Named by its feature where it has one, a row still being named having only the
            // generic label to go by.
            aria-label={
              featureRow.name ||
              localizedStrings['%interlinearizer_analysisCatalog_mergeFeatureValue%']
            }
            className="tw:h-7 tw:w-full tw:min-w-0 tw:flex-1 tw:text-xs"
            data-testid={`catalog-merge-master-feature-${featureRow.key}`}
            onChange={(e) => editRow(featureRow.key, { value: e.target.value })}
            type="text"
            value={featureRow.value}
          />
          {/* The row's own delete, which is what an emptied field cannot say: a feature typed back
              to nothing is still a row the reader is working on. */}
          <Button
            aria-label={formatReplacementString(
              localizedStrings['%interlinearizer_analysisCatalog_mergeDropFeature%'],
              { name: featureRow.name },
            )}
            className="tw:size-7 tw:shrink-0 tw:text-muted-foreground"
            data-testid={`catalog-merge-drop-feature-${featureRow.key}`}
            onClick={() => commit(rows.filter((r) => r.key !== featureRow.key))}
            size="icon"
            type="button"
            variant="ghost"
          >
            <X aria-hidden className="tw:size-3.5" />
          </Button>
        </div>
      ))}

      {/* Adds an empty row rather than asking for the feature up front, the row's own fields being
          where a name and a value are typed. */}
      <Button
        aria-label={localizedStrings['%interlinearizer_analysisCatalog_mergeAddFeature%']}
        className="tw:size-7 tw:shrink-0 tw:self-end"
        data-testid="catalog-merge-feature-add"
        onClick={() => {
          nextKey.current += 1;
          commit([...rows, { key: `new-${nextKey.current}`, name: '', value: '' }]);
        }}
        size="icon"
        type="button"
        variant="ghost"
      >
        <Plus aria-hidden className="tw:size-3.5" />
      </Button>
    </div>
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
  field: keyof MergeMasterEdits;
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
  const morphemesFieldId = useId();
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

      {/* Bordered as an analysis in the listing is, the master being the one they all merge into. */}
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
                data-testid="catalog-merge-master-gloss"
                id={glossFieldId}
                onChange={(e) => editField('gloss', e.target.value)}
                type="text"
                value={master.gloss}
              />
            </RevertableField>
          </div>
        </div>

        {/* Boxed as the row editor's breakdown is, so the forms and their glosses read as one unit
            wherever a breakdown is edited. */}
        <div className="tw:flex tw:w-fit tw:max-w-full tw:flex-col tw:gap-1.5 tw:rounded tw:border tw:border-border tw:bg-background tw:p-2">
          <div className="tw:flex tw:items-center tw:gap-3">
            <Label className={FIELD_LABEL_CLASS} htmlFor={morphemesFieldId}>
              {localizedStrings['%interlinearizer_analysisCatalog_editMorphemes%']}
            </Label>
            <RevertableField
              edited={edits.morphemeForms !== undefined}
              field="morphemeForms"
              label={localizedStrings['%interlinearizer_analysisCatalog_mergeRevertField%']}
              onRevert={() => editField('morphemeForms', undefined)}
            >
              <BreakdownInput
                derivedForms={master.morphemes.map((m) => m.form).join(' ')}
                fieldId={morphemesFieldId}
                onFormsChange={(forms) => editField('morphemeForms', forms)}
                surfaceText={surfaceText}
              />
            </RevertableField>
          </div>

          {master.morphemes.length > 0 && (
            <div className="tw:flex tw:items-end tw:gap-3">
              {/* Named, the row of fields under the forms otherwise reading as a second breakdown. */}
              <span
                className={`${FIELD_LABEL_CLASS} tw:pb-1.5`}
                data-testid="catalog-merge-morpheme-glosses-label"
              >
                {localizedStrings['%interlinearizer_analysisCatalog_mergeMorphemeGlosses%']}
              </span>
              <div className="tw:flex tw:min-w-0 tw:gap-2">
                {master.morphemes.map((morpheme) => {
                  const glossEdits = edits.morphemeGlosses ?? {};
                  const edited = glossEdits[morpheme.form] !== undefined;
                  return (
                    // Form above gloss, as the row editor and the interlinear view arrange them.
                    <div
                      className="tw:flex tw:min-w-0 tw:flex-col tw:items-start"
                      key={morpheme.form}
                    >
                      <span className="tw:max-w-full tw:truncate tw:text-sm">{morpheme.form}</span>
                      <div className="tw:relative">
                        <Input
                          aria-label={
                            resolvedOrEmpty(
                              formatReplacementString(
                                localizedStrings['%interlinearizer_analysisCatalog_morphemeGloss%'],
                                { form: morpheme.form },
                              ),
                            ) || undefined
                          }
                          className="tw:h-7 tw:pe-7 tw:text-sm"
                          data-testid="catalog-merge-master-morpheme-gloss"
                          onChange={(e) =>
                            editField('morphemeGlosses', {
                              ...glossEdits,
                              [morpheme.form]: e.target.value,
                            })
                          }
                          // Sized to the gloss it holds, so a row of them is as wide as its
                          // contents rather than sharing out room none asked for; the floor keeps
                          // an empty field clickable.
                          style={{ fieldSizing: 'content', minWidth: '6ch' }}
                          type="text"
                          value={morpheme.gloss?.[analysisLanguage] ?? ''}
                        />
                        <InlineRevertButton
                          edited={edited}
                          label={formatReplacementString(
                            localizedStrings[
                              '%interlinearizer_analysisCatalog_mergeClearMorphemeGloss%'
                            ],
                            { form: morpheme.form },
                          )}
                          onRevert={() =>
                            editField(
                              'morphemeGlosses',
                              // The one form's edit dropped, the rest of them standing; emptied of
                              // every edit the field is untouched again.
                              Object.fromEntries(
                                Object.entries(glossEdits).filter(
                                  ([form]) => form !== morpheme.form,
                                ),
                              ),
                            )
                          }
                          testId="catalog-merge-revert-morpheme-gloss"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* The fields a reader settles after the gloss and its breakdown, set smaller so they do
            not read as the decision the panel is about. Part of speech and confidence share a row,
            neither being wide. */}
        <div className="tw:flex tw:items-center tw:gap-3">
          <Label className={FIELD_LABEL_CLASS} htmlFor={posFieldId}>
            {localizedStrings['%interlinearizer_analysisCatalog_mergePos%']}
          </Label>
          <div className="tw:min-w-0 tw:flex-1">
            <RevertableField
              edited={edits.pos !== undefined}
              field="pos"
              label={localizedStrings['%interlinearizer_analysisCatalog_mergeRevertField%']}
              onRevert={() => editField('pos', undefined)}
            >
              <Input
                className="tw:h-7 tw:w-full tw:min-w-0 tw:pe-7 tw:text-xs"
                data-testid="catalog-merge-master-pos"
                id={posFieldId}
                // Absence and emptiness are the same thing for a free-form tag, so a cleared field
                // records no part of speech rather than an empty one.
                onChange={(e) => editField('pos', e.target.value || CLEARED)}
                type="text"
                value={master.pos ?? ''}
              />
            </RevertableField>
          </div>

          <span className="tw:shrink-0 tw:text-xs tw:text-muted-foreground">
            {localizedStrings['%interlinearizer_analysisCatalog_mergeConfidence%']}
          </span>
          <Select
            onValueChange={(value) => editField('confidence', confidenceChoice(value) ?? CLEARED)}
            value={master.confidence ?? NO_CONFIDENCE}
          >
            <SelectTrigger
              aria-label={localizedStrings['%interlinearizer_analysisCatalog_mergeConfidence%']}
              className="tw:h-6 tw:text-xs"
              data-testid="catalog-merge-master-confidence"
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

        <div className="tw:flex tw:items-start tw:gap-3">
          <span className={`${FIELD_LABEL_CLASS} tw:mt-1.5`}>
            {localizedStrings['%interlinearizer_analysisCatalog_mergeFeatures%']}
          </span>
          <div className="tw:min-w-0 tw:flex-1">
            <FeatureFields
              features={master.features ?? {}}
              localizedStrings={localizedStrings}
              // Emptied of every feature the merge records none, which is what an analysis carrying
              // no features says.
              onFeaturesChange={(features) =>
                editField('features', Object.keys(features).length > 0 ? features : CLEARED)
              }
            />
          </div>
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
        <SortableContext items={[...orderedIds]} strategy={verticalListSortingStrategy}>
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
          onClick={() => onConfirm(survivor.analysisId, [...mergedIds], master, surfaceText)}
        >
          {localizedStrings['%interlinearizer_analysisCatalog_mergeConfirm%']}
        </Button>
      </div>
    </ModalShell>
  );
}
