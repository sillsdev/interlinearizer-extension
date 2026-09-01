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
 * of speech or a feature value, so it is named rather than shown as the record stores it.
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
   * The choices the rows offer for this field, `undefined` among them standing for carrying no
   * value. Raised only for a field the rows still offer choices for.
   */
  choices: readonly (T | undefined)[];
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
   * Each control value read back to the choice it stands for. Held as a map rather than compared
   * against the sentinels so that a choice the field spells as absence or as the empty string is
   * recovered as the choice it is.
   */
  const choiceByValue = new Map<string, T | undefined>(
    choices.map((choice) => [valueOf(choice), choice]),
  );

  /**
   * What a recorded value is called before any marking that tells it apart from another choice.
   *
   * A value that is nothing but whitespace has no name of its own and so borrows the empty value's,
   * the marking below being what tells those two apart.
   */
  const nameOfValue = (choice: T) => (labelFor ? labelFor(choice) : choice).trim() || emptyLabel;

  /**
   * What each choice is called, no two alike: the platform control cannot tell two options sharing
   * a label apart, so only a distinctly named choice can be filtered by.
   *
   * A value reading as a label another choice holds is marked as recorded repeatedly, since a value
   * can be spelled like the marking itself.
   */
  const labelByChoice = new Map<T | undefined, string>();
  const claimed = new Set<string>();
  choices.forEach((choice) => {
    if (choice === undefined) claimed.add(untaggedLabel);
    if (choice === '') claimed.add(emptyLabel);
  });
  choices.forEach((choice) => {
    if (choice === undefined) return labelByChoice.set(choice, untaggedLabel);
    if (choice === '') return labelByChoice.set(choice, emptyLabel);
    let name = nameOfValue(choice);
    // Bounded by the names already claimed: that many rounds of a marking that moves the name
    // produce more distinct spellings than there are names to collide with, so only one leaving
    // the name where it was reaches the bound — and spinning there would hang the panel.
    for (let round = 0; claimed.has(name) && round < claimed.size; round += 1) {
      // Trimmed because a marking is free to pad what it wraps, and an untrimmed name is both
      // unselectable and what the next round collides against.
      name = formatReplacementString(
        localizedStrings['%interlinearizer_analysisCatalog_filter_recordedValue%'],
        { value: name },
      ).trim();
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
  /** The choices worth offering as filters. */
  facets: CatalogFacets;
  /** The filters currently narrowing the listing. */
  filters: CatalogFilters;
  /** Records a new set of filters. */
  onFiltersChange: (filters: CatalogFilters) => void;
  /** Whether this project breaks words into morphemes, which the breakdown filter is offered for. */
  showMorphology: boolean;
  /** What the language the missing-gloss filter asks about is called, as its label names it. */
  analysisLanguageName: string;
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
 * That covers the facet-backed filters alone. The controls below them stand on a state every row
 * has rather than on a facet, so there is nothing for {@link CatalogFacets} to omit and they are
 * always raised — inert though one is against data that is uniform in what it asks about.
 */
export default function CatalogFilterPopover({
  facets,
  filters,
  onFiltersChange,
  showMorphology,
  analysisLanguageName,
  localizedStrings,
}: CatalogFilterPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);

  const filtersLabel = localizedStrings['%interlinearizer_analysisCatalog_filters%'];

  /** Each feature to raise a control for with its choices, being those the rows offer. */
  const featureFacets = Object.entries(facets.features ?? {});

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
          {facets.books !== undefined && (
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

          {facets.pos !== undefined && (
            <FacetFilter
              choices={facets.pos}
              id="catalog-filter-pos"
              label={localizedStrings['%interlinearizer_analysisCatalog_filter_pos%']}
              onChange={(pos) => onFiltersChange({ ...filters, pos })}
              selected={filters.pos}
              localizedStrings={localizedStrings}
            />
          )}

          {facets.confidence !== undefined && (
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
          {featureFacets.map(([name, choices]) => (
            <FacetFilter
              choices={choices}
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
          {(showMorphology || filters.morphemes !== undefined) && (
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
          )}

          <FilterToggle
            isOn={filters.missingGloss ?? false}
            label={formatReplacementString(
              localizedStrings['%interlinearizer_analysisCatalog_filter_missingGloss%'],
              { language: analysisLanguageName },
            )}
            onChange={(missingGloss) => onFiltersChange({ ...filters, missingGloss })}
          />

          {/* Matches nothing until a write path can leave an analysis unused, which none does yet. */}
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
