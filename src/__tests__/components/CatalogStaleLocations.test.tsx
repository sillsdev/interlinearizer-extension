/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import CatalogStaleLocations, {
  STALE_LOCATION_STRING_KEYS,
} from '../../components/CatalogStaleLocations';
import { InterlinearNavProvider, useInterlinearNav } from '../../components/InterlinearNavContext';
import type { CatalogUsage } from '../../utils/analysis-query';
import { defaultScrRef, makeScrollGroupHook } from '../test-helpers';
import { EmptyAnalysisProvider } from './test-helpers';

/**
 * Each key resolving to itself, but for the templates whose filled-in value a case checks: the
 * focused word, and the count of places left unlisted.
 */
const STRINGS = {
  ...Object.fromEntries(STALE_LOCATION_STRING_KEYS.map((k) => [k, k])),
  '%interlinearizer_analysisCatalog_staleApply%': 'Apply to “{word}”',
  '%interlinearizer_analysisCatalog_showAllStale%': 'Show {count} more',
};

function place(tokenRef: string, verse: number): CatalogUsage {
  return { tokenRef, book: 'GEN', chapter: 1, verse, charStart: 0 };
}

/** Publishes `tokenRef` as the focused word, standing in for the view beside the catalog. */
function FocusPublishProbe({ tokenRef }: Readonly<{ tokenRef: string | undefined }>) {
  const { publishedFocus } = useInterlinearNav();
  useEffect(() => publishedFocus.publish(tokenRef), [publishedFocus, tokenRef]);
  return undefined;
}

/** Options every `renderPlaces` call may override. */
type PlacesOptions = Partial<{
  locations: readonly CatalogUsage[];
  hiddenCount: number;
  notice: string;
  focusedTokenRef: string;
  liveSurfaceText: (tokenRef: string) => string | undefined;
  readOnly: boolean;
}>;

/** Renders the places inside the providers they read focus and read-only state from. */
function renderPlaces(overrides: PlacesOptions = {}) {
  const onSelect = jest.fn();
  const onDiscard = jest.fn();
  const onReapply = jest.fn();
  const onShowAll = jest.fn();
  render(
    <InterlinearNavProvider useWebViewScrollGroupScrRef={makeScrollGroupHook(defaultScrRef)}>
      <EmptyAnalysisProvider analysisLanguage="en" readOnly={overrides.readOnly}>
        <FocusPublishProbe tokenRef={overrides.focusedTokenRef} />
        <CatalogStaleLocations
          hiddenCount={overrides.hiddenCount ?? 0}
          labelFor={(location) => `verse ${location.verse}`}
          liveSurfaceText={overrides.liveSurfaceText ?? (() => 'λόγου')}
          localizedStrings={STRINGS}
          locations={overrides.locations ?? [place('GEN 1:2:7', 2)]}
          onDiscard={onDiscard}
          onReapply={onReapply}
          onSelect={onSelect}
          onShowAll={onShowAll}
        >
          {overrides.notice}
        </CatalogStaleLocations>
      </EmptyAnalysisProvider>
    </InterlinearNavProvider>,
  );
  return { onSelect, onDiscard, onReapply, onShowAll };
}

function onlyPlace(): HTMLElement {
  return screen.getByTestId('catalog-stale-location');
}

describe('CatalogStaleLocations', () => {
  it('lists each place under the label it is given', () => {
    renderPlaces({ locations: [place('GEN 1:2:7', 2), place('GEN 1:5:0', 5)] });

    expect(
      screen.getAllByTestId('catalog-stale-location-jump').map((jump) => jump.textContent),
    ).toEqual(['verse 2', 'verse 5']);
  });

  it('reports a jump to the place clicked', async () => {
    const { onSelect } = renderPlaces();

    await userEvent.click(within(onlyPlace()).getByTestId('catalog-stale-location-jump'));

    expect(onSelect).toHaveBeenCalledWith(place('GEN 1:2:7', 2));
  });

  it('reports a discard of the place clicked', async () => {
    const { onDiscard } = renderPlaces();

    await userEvent.click(within(onlyPlace()).getByTestId('catalog-stale-location-discard'));

    expect(onDiscard).toHaveBeenCalledWith(place('GEN 1:2:7', 2));
  });

  it('names the focused word it would apply the analysis to', () => {
    renderPlaces({ focusedTokenRef: 'GEN 1:2:0' });

    expect(within(onlyPlace()).getByTestId('catalog-stale-location-apply')).toHaveTextContent(
      'Apply to “λόγου”',
    );
  });

  it('reports applying the analysis to the focused word', async () => {
    const { onReapply } = renderPlaces({ focusedTokenRef: 'GEN 1:2:0' });

    await userEvent.click(within(onlyPlace()).getByTestId('catalog-stale-location-apply'));

    expect(onReapply).toHaveBeenCalledWith(place('GEN 1:2:7', 2), 'GEN 1:2:0', 'λόγου');
  });

  it('says where to choose a word while no word is focused', () => {
    renderPlaces();

    expect(within(onlyPlace()).getByTestId('catalog-stale-location-apply-hint')).toHaveTextContent(
      '%interlinearizer_analysisCatalog_staleApplyNoTarget%',
    );
  });

  it('offers no apply button while no word is focused', () => {
    renderPlaces();

    expect(
      within(onlyPlace()).queryByTestId('catalog-stale-location-apply'),
    ).not.toBeInTheDocument();
  });

  it('drops the hint once a word is focused', () => {
    renderPlaces({ focusedTokenRef: 'GEN 1:2:0' });

    expect(
      within(onlyPlace()).queryByTestId('catalog-stale-location-apply-hint'),
    ).not.toBeInTheDocument();
  });

  // A focus the view left in a book no longer loaded has no text to name.
  it('withholds applying to a focused word whose text cannot be read', () => {
    renderPlaces({ focusedTokenRef: 'EXO 1:1:0', liveSurfaceText: () => undefined });

    expect(
      within(onlyPlace()).queryByTestId('catalog-stale-location-apply'),
    ).not.toBeInTheDocument();
  });

  it('offers neither applying nor discarding in a read-only analysis', () => {
    renderPlaces({ readOnly: true, focusedTokenRef: 'GEN 1:2:0' });

    expect(
      within(onlyPlace()).queryByTestId('catalog-stale-location-apply'),
    ).not.toBeInTheDocument();
    expect(
      within(onlyPlace()).queryByTestId('catalog-stale-location-discard'),
    ).not.toBeInTheDocument();
  });

  it('gives no hint in a read-only analysis', () => {
    renderPlaces({ readOnly: true });

    expect(
      within(onlyPlace()).queryByTestId('catalog-stale-location-apply-hint'),
    ).not.toBeInTheDocument();
  });

  it('still offers the jump in a read-only analysis', () => {
    renderPlaces({ readOnly: true });

    expect(within(onlyPlace()).getByTestId('catalog-stale-location-jump')).toBeInTheDocument();
  });

  describe('with places left unlisted', () => {
    it('counts them on the expander', () => {
      renderPlaces({ hiddenCount: 4 });

      expect(screen.getByTestId('catalog-stale-locations-show-all')).toHaveTextContent(
        'Show 4 more',
      );
    });

    it('asks for every place from the expander', async () => {
      const { onShowAll } = renderPlaces({ hiddenCount: 4 });

      await userEvent.click(screen.getByTestId('catalog-stale-locations-show-all'));

      expect(onShowAll).toHaveBeenCalledTimes(1);
    });
  });

  it('offers no expander when every place is listed', () => {
    renderPlaces();

    expect(screen.queryByTestId('catalog-stale-locations-show-all')).not.toBeInTheDocument();
  });

  it('shows the notice it is given below the list', () => {
    renderPlaces({ notice: 'still fetching' });

    expect(screen.getByTestId('catalog-stale-locations')).toHaveTextContent('still fetching');
  });
});
