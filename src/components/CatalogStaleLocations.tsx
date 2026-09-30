import { Button } from 'platform-bible-react';
import { formatReplacementString, type LanguageStrings } from 'platform-bible-utils';
import { useState } from 'react';
import { useAnalysisReadOnly } from './AnalysisStore';
import { usePublishedFocus } from './InterlinearNavContext';
import type { CatalogUsage } from '../utils/analysis-query';

/** Localized string keys the stale places render. */
export const STALE_LOCATION_STRING_KEYS = [
  '%interlinearizer_analysisCatalog_staleHeading%',
  '%interlinearizer_analysisCatalog_staleApply%',
  '%interlinearizer_analysisCatalog_staleApplyNoTarget%',
  '%interlinearizer_analysisCatalog_staleDiscard%',
  '%interlinearizer_analysisCatalog_showAllStale%',
] as const satisfies `%${string}%`[];

/** The word a stale analysis would be re-applied to. */
type ReapplyTarget = Readonly<{ tokenRef: string; surfaceText: string }>;

/**
 * The word focused in the view, or `undefined` when nothing is focused or its text cannot be read,
 * as for a token of a book no longer loaded.
 */
function reapplyTargetOf(
  focusedTokenRef: string | undefined,
  liveSurfaceText: (tokenRef: string) => string | undefined,
): ReapplyTarget | undefined {
  if (focusedTokenRef === undefined) return undefined;
  const surfaceText = liveSurfaceText(focusedTokenRef);
  return surfaceText === undefined ? undefined : { tokenRef: focusedTokenRef, surfaceText };
}

/** Props for {@link CatalogStaleLocations}. */
type CatalogStaleLocationsProps = Readonly<{
  /** The places the analysis went stale at, in document order. */
  locations: readonly CatalogUsage[];
  /** How many places are listed before the rest go behind an expander. */
  inlineLimit: number;
  /** Writes a place the way the row's usages are written. */
  labelFor: (location: CatalogUsage) => string;
  /** Moves the interlinear view to the verse a place sits in. */
  onSelect: (location: CatalogUsage) => void;
  /** Gives up a place. */
  onDiscard: (location: CatalogUsage) => void;
  /** Moves the analysis from a place onto the token at `tokenRef`. */
  onReapply: (location: CatalogUsage, tokenRef: string, surfaceText: string) => void;
  /** Reads the loaded book's current text for a token ref, `undefined` for one in any other book. */
  liveSurfaceText: (tokenRef: string) => string | undefined;
  /** Resolved localizations covering at least {@link STALE_LOCATION_STRING_KEYS}. */
  localizedStrings: LanguageStrings;
}>;

/**
 * The places an analysis was applied until the text there changed under it, each offered for
 * review: a jump to its verse, re-applying the analysis to the word focused in the view, or
 * discarding it.
 *
 * The jump names the verse alone: the place's own offset may belong to a different word by now.
 */
export default function CatalogStaleLocations({
  locations,
  inlineLimit,
  labelFor,
  onSelect,
  onDiscard,
  onReapply,
  liveSurfaceText,
  localizedStrings,
}: CatalogStaleLocationsProps) {
  const readOnly = useAnalysisReadOnly();
  // Subscribed here rather than in the row, so a focus move re-renders only the stale lists.
  const target = reapplyTargetOf(usePublishedFocus(), liveSurfaceText);

  const [showsAll, setShowsAll] = useState(false);
  const visible = showsAll ? locations : locations.slice(0, inlineLimit);
  const hiddenCount = locations.length - visible.length;

  const applyLabel = target
    ? formatReplacementString(localizedStrings['%interlinearizer_analysisCatalog_staleApply%'], {
        word: target.surfaceText,
      })
    : localizedStrings['%interlinearizer_analysisCatalog_staleApplyNoTarget%'];

  return (
    <div className="tw:flex tw:flex-col tw:gap-1" data-testid="catalog-stale-locations">
      <p className="tw:text-xs tw:gloss-stale">
        {localizedStrings['%interlinearizer_analysisCatalog_staleHeading%']}
      </p>
      <ul className="tw:flex tw:flex-col tw:gap-1">
        {visible.map((location) => (
          <li
            className="tw:flex tw:flex-wrap tw:items-center tw:gap-1"
            data-testid="catalog-stale-location"
            data-token-ref={location.tokenRef}
            key={location.tokenRef}
          >
            <Button
              className="tw:h-auto tw:px-1 tw:py-0 tw:text-xs tw:gloss-stale"
              data-testid="catalog-stale-location-jump"
              onClick={() => onSelect(location)}
              size="sm"
              variant="link"
            >
              {labelFor(location)}
            </Button>
            {!readOnly && (
              <>
                <Button
                  data-testid="catalog-stale-location-apply"
                  disabled={!target}
                  onClick={
                    target && (() => onReapply(location, target.tokenRef, target.surfaceText))
                  }
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {applyLabel}
                </Button>
                <Button
                  data-testid="catalog-stale-location-discard"
                  onClick={() => onDiscard(location)}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  {localizedStrings['%interlinearizer_analysisCatalog_staleDiscard%']}
                </Button>
              </>
            )}
          </li>
        ))}
      </ul>
      {hiddenCount > 0 && (
        <Button
          className="tw:self-start"
          data-testid="catalog-stale-locations-show-all"
          onClick={() => setShowsAll(true)}
          size="sm"
          variant="link"
        >
          {formatReplacementString(
            localizedStrings['%interlinearizer_analysisCatalog_showAllStale%'],
            { count: hiddenCount },
          )}
        </Button>
      )}
    </div>
  );
}
