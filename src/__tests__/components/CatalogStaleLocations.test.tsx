/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { AnalysisStoreProvider } from '../../components/AnalysisStore';
import CatalogStaleLocations, {
  STALE_LOCATION_STRING_KEYS,
} from '../../components/CatalogStaleLocations';
import { InterlinearNavProvider, useInterlinearNav } from '../../components/InterlinearNavContext';
import type { CatalogUsage } from '../../utils/analysis-query';
import { defaultScrRef, makeScrollGroupHook } from '../test-helpers';

/**
 * Each key resolving to itself, but for the apply label, whose template has to resolve for the
 * focused word to reach the screen.
 */
const STRINGS = {
  ...Object.fromEntries(STALE_LOCATION_STRING_KEYS.map((k) => [k, k])),
  '%interlinearizer_analysisCatalog_staleApply%': 'Apply to “{word}”',
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
  inlineLimit: number;
  focusedTokenRef: string;
  liveSurfaceText: (tokenRef: string) => string | undefined;
  readOnly: boolean;
}>;

/** Renders the places inside the providers they read focus and read-only state from. */
function renderPlaces(overrides: PlacesOptions = {}) {
  const onSelect = jest.fn();
  const onDiscard = jest.fn();
  const onReapply = jest.fn();
  render(
    <InterlinearNavProvider useWebViewScrollGroupScrRef={makeScrollGroupHook(defaultScrRef)}>
      <AnalysisStoreProvider analysisLanguage="en" readOnly={overrides.readOnly}>
        <FocusPublishProbe tokenRef={overrides.focusedTokenRef} />
        <CatalogStaleLocations
          inlineLimit={overrides.inlineLimit ?? 12}
          labelFor={(location) => `verse ${location.verse}`}
          liveSurfaceText={overrides.liveSurfaceText ?? (() => 'λόγου')}
          localizedStrings={STRINGS}
          locations={overrides.locations ?? [place('GEN 1:2:7', 2)]}
          onDiscard={onDiscard}
          onReapply={onReapply}
          onSelect={onSelect}
        />
      </AnalysisStoreProvider>
    </InterlinearNavProvider>,
  );
  return { onSelect, onDiscard, onReapply };
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

  it('withholds applying while no word is focused', () => {
    renderPlaces();

    const apply = within(onlyPlace()).getByTestId('catalog-stale-location-apply');
    expect(apply).toBeDisabled();
    expect(apply).toHaveTextContent('%interlinearizer_analysisCatalog_staleApplyNoTarget%');
  });

  // A focus the view left in a book no longer loaded has no text to name.
  it('withholds applying to a focused word whose text cannot be read', () => {
    renderPlaces({ focusedTokenRef: 'EXO 1:1:0', liveSurfaceText: () => undefined });

    expect(within(onlyPlace()).getByTestId('catalog-stale-location-apply')).toBeDisabled();
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

  it('still offers the jump in a read-only analysis', () => {
    renderPlaces({ readOnly: true });

    expect(within(onlyPlace()).getByTestId('catalog-stale-location-jump')).toBeInTheDocument();
  });

  describe('with more places than fit inline', () => {
    /** More places than the inline limit these cases render with. */
    const MANY = Array.from({ length: 5 }, (_unused, index) =>
      place(`GEN 1:${index + 1}:0`, index + 1),
    );

    it('caps the inline list', () => {
      renderPlaces({ locations: MANY, inlineLimit: 3 });

      expect(screen.getAllByTestId('catalog-stale-location')).toHaveLength(3);
    });

    it('reveals the rest from the expander', async () => {
      renderPlaces({ locations: MANY, inlineLimit: 3 });

      await userEvent.click(screen.getByTestId('catalog-stale-locations-show-all'));

      expect(screen.getAllByTestId('catalog-stale-location')).toHaveLength(5);
      expect(screen.queryByTestId('catalog-stale-locations-show-all')).not.toBeInTheDocument();
    });
  });

  it('offers no expander when every place fits inline', () => {
    renderPlaces({ locations: [place('GEN 1:2:7', 2)], inlineLimit: 3 });

    expect(screen.queryByTestId('catalog-stale-locations-show-all')).not.toBeInTheDocument();
  });
});
