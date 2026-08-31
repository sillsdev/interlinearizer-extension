import { ListFilter } from 'lucide-react';
import {
  Button,
  Label,
  MultiSelectComboBox,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from 'platform-bible-react';
import { formatReplacementString, type LanguageStrings } from 'platform-bible-utils';
import { useId, useState } from 'react';
import type { Confidence } from 'interlinearizer';
import type { CatalogFacets, CatalogFilters } from '../utils/analysis-query';

/**
 * The name each confidence level is offered under. Confidence is a closed vocabulary, unlike a part
 * of speech or a feature value, so it is named rather than shown as the record stores it. Covers
 * every member of {@link Confidence}, so a level added there fails to compile until it is named
 * here.
 */
const CONFIDENCE_LABEL_KEYS = {
  high: '%interlinearizer_analysisCatalog_confidence_high%',
  medium: '%interlinearizer_analysisCatalog_confidence_medium%',
  low: '%interlinearizer_analysisCatalog_confidence_low%',
  guess: '%interlinearizer_analysisCatalog_confidence_guess%',
} as const satisfies Record<Confidence, `%${string}%`>;

/** Localized string keys the filter controls render. */
export const FILTER_STRING_KEYS = [
  '%interlinearizer_analysisCatalog_filters%',
  '%interlinearizer_analysisCatalog_filtersActive%',
  '%interlinearizer_analysisCatalog_filter_selection%',
  '%interlinearizer_analysisCatalog_filter_untagged%',
  '%interlinearizer_analysisCatalog_filter_empty%',
  '%interlinearizer_analysisCatalog_filter_recordedValue%',
  '%interlinearizer_analysisCatalog_filter_books%',
  '%interlinearizer_analysisCatalog_filter_pos%',
  '%interlinearizer_analysisCatalog_filter_confidence%',
  '%interlinearizer_analysisCatalog_filter_missingGloss%',
  '%interlinearizer_analysisCatalog_filter_morphemes%',
  '%interlinearizer_analysisCatalog_filter_morphemes_has%',
  '%interlinearizer_analysisCatalog_filter_morphemes_lacks%',
  '%interlinearizer_analysisCatalog_filter_zeroUsages%',
  ...Object.values(CONFIDENCE_LABEL_KEYS),
] as const satisfies `%${string}%`[];

/**
 * Stands for the choice of carrying no value at all for a field, which {@link CatalogFacets} lists
 * as `undefined`. The platform combo box speaks strings alone, so the absent choice needs a
 * spelling of its own, and a leading NUL is one no part of speech, confidence level, or feature
 * value can collide with — no text format the analysis layer reads carries one inside a value.
 */
const UNTAGGED_VALUE = '\u0000untagged';

/**
 * Stands for the choice of carrying the empty string, which a free-text field may hold. The
 * platform control cannot carry an empty value, so that choice needs a spelling of its own, kept
 * clear of any real value the same way {@link UNTAGGED_VALUE} is.
 */
const EMPTY_VALUE = '\u0000empty';

/** How one choice is spelled to the platform control, the two absent-value choices included. */
function valueOf(choice: string | undefined): string {
  if (choice === undefined) return UNTAGGED_VALUE;
  return choice === '' ? EMPTY_VALUE : choice;
}

/**
 * Whether a field earns a control: one the rows offer a choice for, or one still narrowing the list
 * by a selection its choices no longer cover. A field can stop offering choices while a reader is
 * filtered to one of them, and a selection with no control left is one nothing on screen can
 * clear.
 */
function isFilterable(
  choices: readonly unknown[] | undefined,
  selected: readonly unknown[] | undefined,
): boolean {
  return choices !== undefined || (selected?.length ?? 0) > 0;
}

/**
 * The breakdown filter's inactive choice, spelled out because {@link CatalogFilters} spells it
 * `undefined` while the platform select needs a value for every choice it offers.
 */
const MORPHEMES_EITHER = 'either';

/** Reads the breakdown filter the select reported back, its inactive choice reading as no filter. */
function morphemeChoice(value: string): CatalogFilters['morphemes'] {
  if (value === 'has') return 'has';
  if (value === 'lacks') return 'lacks';
  return undefined;
}

/** Props for {@link FacetFilter}. */
type FacetFilterProps<T extends string> = Readonly<{
  /**
   * The choices the rows offer for this field, `undefined` standing for carrying no value. Absent
   * where the rows have stopped offering any, which leaves only what is still selected to offer.
   */
  choices: readonly (T | undefined)[] | undefined;
  /** The choices currently selected; absent or empty means the field narrows nothing. */
  selected: readonly (T | undefined)[] | undefined;
  /** Records a new selection, in the field's own terms rather than the control's. */
  onChange: (selected: readonly (T | undefined)[]) => void;
  /** What the field is called, shown alone while nothing is selected. */
  label: string;
  /** Resolved localizations, for the labels every field's control shares. */
  localizedStrings: LanguageStrings;
  /**
   * What a value is called, for a field whose values are a closed vocabulary. Omitted where the
   * values are free text from the data, which name themselves.
   */
  labelFor?: (choice: T) => string;
  /** Identifies the control, so a test can tell one field's choices from another's. */
  id: string;
}>;

/**
 * One field's choices, as a multi-select whose trigger names the field while nothing is selected
 * and names the selection once something is.
 *
 * Carrying no value is offered as a choice of its own, which is what lets a reader ask which
 * analyses are still missing the field as readily as which carry a given value.
 */
function FacetFilter<T extends string>({
  choices,
  selected,
  onChange,
  label,
  localizedStrings,
  labelFor,
  id,
}: FacetFilterProps<T>) {
  // Trimmed, as every label here is: the platform control resolves a choice by its label and trims
  // what it hands back, so a label with surrounding whitespace names a choice it can never resolve.
  const untaggedLabel =
    localizedStrings['%interlinearizer_analysisCatalog_filter_untagged%'].trim();
  const emptyLabel = localizedStrings['%interlinearizer_analysisCatalog_filter_empty%'].trim();

  /**
   * The choices to offer: the field's own, plus any still selected that it no longer lists. An edit
   * elsewhere can retire the last row carrying a value while a reader is filtered to it, and a
   * selection whose choice went unoffered would narrow the list with nothing on screen to clear it
   * by.
   */
  const offered = [
    ...(choices ?? []),
    ...(selected ?? []).filter((choice) => !(choices ?? []).includes(choice)),
  ];

  /**
   * Each control value read back to the choice it stands for. Held as a map rather than compared
   * against the sentinels so that a choice the field spells as absence or as the empty string is
   * recovered as the choice it is.
   */
  const choiceByValue = new Map<string, T | undefined>(
    offered.map((choice) => [valueOf(choice), choice]),
  );

  /**
   * What a recorded value is called before any marking that tells it apart from another choice.
   *
   * Trimmed, since that is the spelling the control reports back for it. A value that is nothing
   * but whitespace is left with no name at all and so borrows the empty value's, the marking below
   * being what tells those two apart.
   */
  const nameOfValue = (choice: T) => (labelFor ? labelFor(choice) : choice).trim() || emptyLabel;

  /**
   * What each offered choice is called, no two alike: the platform control cannot tell two options
   * sharing a label apart, so only a distinctly named choice can be filtered by.
   *
   * A value reading as a label another choice holds is marked as recorded repeatedly, since a value
   * can be spelled like the marking itself.
   */
  const labelByChoice = new Map<T | undefined, string>();
  const claimed = new Set<string>();
  offered.forEach((choice) => {
    if (choice === undefined) claimed.add(untaggedLabel);
    if (choice === '') claimed.add(emptyLabel);
  });
  offered.forEach((choice) => {
    if (choice === undefined) return labelByChoice.set(choice, untaggedLabel);
    if (choice === '') return labelByChoice.set(choice, emptyLabel);
    let name = nameOfValue(choice);
    while (claimed.has(name)) {
      name = formatReplacementString(
        localizedStrings['%interlinearizer_analysisCatalog_filter_recordedValue%'],
        { value: name },
      );
    }
    claimed.add(name);
    return labelByChoice.set(choice, name);
  });

  /** Every choice as the control takes it. */
  const entries = [...labelByChoice].map(([choice, choiceLabel]) => ({
    label: choiceLabel,
    value: valueOf(choice),
  }));

  const selectedValues = (selected ?? []).map(valueOf);
  const selectedLabels = entries
    .filter((entry) => selectedValues.includes(entry.value))
    .map((entry) => entry.label);

  return (
    <MultiSelectComboBox
      customSelectedText={
        selectedLabels.length === 0
          ? undefined
          : formatReplacementString(
              localizedStrings['%interlinearizer_analysisCatalog_filter_selection%'],
              { label, values: selectedLabels.join(', ') },
            )
      }
      entries={entries}
      id={id}
      onChange={(values) => onChange(values.map((value) => choiceByValue.get(value)))}
      placeholder={label}
      selected={selectedValues}
      variant="outline"
    />
  );
}

/** One of the filters that is simply on or off, as a labeled switch. */
function FilterToggle({
  isOn,
  label,
  onChange,
}: Readonly<{
  isOn: boolean;
  label: string;
  onChange: (isOn: boolean) => void;
}>) {
  const switchId = useId();
  return (
    <div className="tw:flex tw:items-center tw:justify-between tw:gap-4">
      <Label className="tw:cursor-pointer tw:text-sm" htmlFor={switchId}>
        {label}
      </Label>
      <Switch checked={isOn} id={switchId} onCheckedChange={onChange} />
    </div>
  );
}

/** Props for {@link CatalogFilterPopover}. */
type CatalogFilterPopoverProps = Readonly<{
  /**
   * The choices worth offering, derived from every row rather than from the narrowed ones — a facet
   * judged against its own selection's survivors collapses the moment a choice is made.
   */
  facets: CatalogFacets;
  /** The filters currently narrowing the listing. */
  filters: CatalogFilters;
  /** Records a new set of filters. */
  onFiltersChange: (filters: CatalogFilters) => void;
  /** BCP 47 tag the missing-gloss filter asks about, named in its label. */
  analysisLanguage: string;
  /** Resolved localizations covering at least {@link FILTER_STRING_KEYS}. */
  localizedStrings: LanguageStrings;
}>;

/**
 * The catalog's filters, behind one control so a panel narrow enough to need filtering is not
 * itself filled with them. The button names how many are active, since a narrowed list with its
 * filters folded away would otherwise look like a short draft.
 *
 * A facet offering fewer than two choices raises no control at all: {@link CatalogFacets} omits it,
 * because a lone choice is the state every row is already in, so choosing it would narrow nothing.
 */
export default function CatalogFilterPopover({
  facets,
  filters,
  onFiltersChange,
  analysisLanguage,
  localizedStrings,
}: CatalogFilterPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);

  const filtersLabel = localizedStrings['%interlinearizer_analysisCatalog_filters%'];

  /**
   * The feature names to raise a control for: those the rows offer choices for, and any a selection
   * still narrows by. A name is dropped from the facets once its rows stop offering it, which would
   * otherwise strand a selection made before that.
   */
  const featureNames = [
    ...new Set([
      ...Object.keys(facets.features ?? {}),
      ...Object.entries(filters.features ?? {})
        .filter(([, values]) => values?.length)
        .map(([name]) => name),
    ]),
  ];

  /**
   * How many of the filter groups are narrowing anything. Each named feature counts on its own, as
   * each is chosen and cleared on its own; an emptied selection counts for nothing, matching the
   * query core's reading of it as no filter rather than as one nothing satisfies.
   */
  const activeCount =
    [
      filters.books,
      filters.pos,
      filters.confidence,
      ...Object.values(filters.features ?? {}),
    ].filter((selected) => selected?.length).length +
    [filters.missingGloss, filters.morphemes, filters.zeroUsages].filter(Boolean).length;

  return (
    <Popover onOpenChange={setIsOpen} open={isOpen}>
      <PopoverTrigger asChild>
        <Button
          className="tw:shrink-0"
          data-testid="catalog-filters-button"
          size="sm"
          variant="ghost"
        >
          <ListFilter className="tw:size-4" />
          {activeCount === 0
            ? filtersLabel
            : formatReplacementString(
                localizedStrings['%interlinearizer_analysisCatalog_filtersActive%'],
                { count: activeCount },
              )}
        </Button>
      </PopoverTrigger>

      {/* Mounted only while open so each opening starts from a fresh panel. */}
      {isOpen && (
        <PopoverContent
          align="end"
          aria-label={filtersLabel}
          className="tw:flex tw:w-auto tw:min-w-56 tw:flex-col tw:gap-3"
          data-testid="catalog-filters-panel"
        >
          {isFilterable(facets.books, filters.books) && (
            <FacetFilter
              choices={facets.books}
              id="catalog-filter-books"
              label={localizedStrings['%interlinearizer_analysisCatalog_filter_books%']}
              // An analysis in no book is one nothing uses, which the unused-only filter keeps on
              // its own terms, so the books facet never offers an untagged choice to narrow to.
              onChange={(books) =>
                onFiltersChange({
                  ...filters,
                  books: books.filter((book) => book !== undefined),
                })
              }
              selected={filters.books}
              localizedStrings={localizedStrings}
            />
          )}

          {isFilterable(facets.pos, filters.pos) && (
            <FacetFilter
              choices={facets.pos}
              id="catalog-filter-pos"
              label={localizedStrings['%interlinearizer_analysisCatalog_filter_pos%']}
              onChange={(pos) => onFiltersChange({ ...filters, pos })}
              selected={filters.pos}
              localizedStrings={localizedStrings}
            />
          )}

          {isFilterable(facets.confidence, filters.confidence) && (
            <FacetFilter
              choices={facets.confidence}
              id="catalog-filter-confidence"
              label={localizedStrings['%interlinearizer_analysisCatalog_filter_confidence%']}
              labelFor={(confidence) => localizedStrings[CONFIDENCE_LABEL_KEYS[confidence]]}
              onChange={(confidence) => onFiltersChange({ ...filters, confidence })}
              selected={filters.confidence}
              localizedStrings={localizedStrings}
            />
          )}

          {/*
            One control per named feature, each judged on its own values — a row satisfies the whole
            selection only by satisfying every named feature in it. Feature names come out of the
            data, so each is shown as it was recorded rather than under a localized name.
          */}
          {featureNames.map((name) => (
            <FacetFilter
              choices={facets.features?.[name]}
              id={`catalog-filter-feature-${name}`}
              key={name}
              label={name}
              onChange={(values) =>
                onFiltersChange({ ...filters, features: { ...filters.features, [name]: values } })
              }
              selected={filters.features?.[name]}
              localizedStrings={localizedStrings}
            />
          ))}

          {/*
            Three states rather than a switch: a reader asks which analyses are broken down and which
            are still whole as readily as either, and neither question is the other's off position.
          */}
          <Select
            onValueChange={(value) =>
              onFiltersChange({ ...filters, morphemes: morphemeChoice(value) })
            }
            value={filters.morphemes ?? MORPHEMES_EITHER}
          >
            <SelectTrigger
              aria-label={localizedStrings['%interlinearizer_analysisCatalog_filter_morphemes%']}
              data-testid="catalog-filter-morphemes"
              size="sm"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem data-testid="catalog-filter-morphemes-any" value={MORPHEMES_EITHER}>
                {localizedStrings['%interlinearizer_analysisCatalog_filter_morphemes%']}
              </SelectItem>
              <SelectItem data-testid="catalog-filter-morphemes-has" value="has">
                {localizedStrings['%interlinearizer_analysisCatalog_filter_morphemes_has%']}
              </SelectItem>
              <SelectItem data-testid="catalog-filter-morphemes-lacks" value="lacks">
                {localizedStrings['%interlinearizer_analysisCatalog_filter_morphemes_lacks%']}
              </SelectItem>
            </SelectContent>
          </Select>

          <FilterToggle
            isOn={filters.missingGloss ?? false}
            label={formatReplacementString(
              localizedStrings['%interlinearizer_analysisCatalog_filter_missingGloss%'],
              { language: analysisLanguage },
            )}
            onChange={(missingGloss) => onFiltersChange({ ...filters, missingGloss })}
          />

          {/*
            Matches nothing against today's data — no write path leaves an analysis unused, because
            detaching its last link drops the payload with it. Shipped anyway so a Paratext 9 import,
            and the catalog's own delete and merge, arrive with their filter already in place.
          */}
          <FilterToggle
            isOn={filters.zeroUsages ?? false}
            label={localizedStrings['%interlinearizer_analysisCatalog_filter_zeroUsages%']}
            onChange={(zeroUsages) => onFiltersChange({ ...filters, zeroUsages })}
          />
        </PopoverContent>
      )}
    </Popover>
  );
}
