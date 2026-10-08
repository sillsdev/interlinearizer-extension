/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from 'platform-bible-react';
import type { ComponentProps } from 'react';
import CatalogRowHeader, { ROW_HEADER_STRING_KEYS } from '../../components/CatalogRowHeader';
import type { CatalogRow } from '../../utils/analysis-query';

/** Each key resolving to itself, except the check box's label, which names the row's form. */
const STRINGS = {
  ...Object.fromEntries(ROW_HEADER_STRING_KEYS.map((k) => [k, k])),
  '%interlinearizer_analysisCatalog_check%': 'Select {form}',
};

/** A row of one analysis, carrying only what a case sets beyond its form and gloss. */
function row(overrides: Partial<CatalogRow> = {}): CatalogRow {
  return {
    analysisId: 'ta-1',
    surfaceText: 'λόγος',
    gloss: 'word',
    morphemes: [],
    usageCount: 0,
    usageCountInBook: 0,
    usages: [],
    staleLocations: [],
    books: new Set(),
    searchText: '',
    ...overrides,
  };
}

/** The header, collapsed and checkable, with every callback stubbed unless a test says otherwise. */
function renderHeader(overrides: Partial<ComponentProps<typeof CatalogRowHeader>> = {}) {
  const props = {
    row: row(),
    usageCountInBookLabel: 'uses in Genesis',
    isExpanded: false,
    onToggle: jest.fn(),
    isChecked: false,
    onCheckedChange: jest.fn(),
    localizedStrings: STRINGS,
    ...overrides,
  };
  render(
    <TooltipProvider>
      <CatalogRowHeader {...props} />
    </TooltipProvider>,
  );
  return props;
}

describe('CatalogRowHeader', () => {
  it('names the analysis by its surface form and gloss', () => {
    renderHeader();

    expect(screen.getByTestId('catalog-row-surface')).toHaveTextContent('λόγος');
    expect(screen.getByTestId('catalog-row-gloss')).toHaveTextContent('word');
  });

  it('offers the surface form and gloss in full, both being truncated to one line', () => {
    renderHeader();

    expect(screen.getByTestId('catalog-row-surface')).toHaveAttribute('title', 'λόγος');
    expect(screen.getByTestId('catalog-row-gloss')).toHaveAttribute('title', 'word');
  });

  it('marks a missing gloss with the localized placeholder', () => {
    renderHeader({
      row: row({ gloss: '' }),
      localizedStrings: { ...STRINGS, '%interlinearizer_analysisCatalog_noGloss%': '(none)' },
    });

    expect(screen.getByTestId('catalog-row-gloss')).toHaveTextContent('(none)');
  });

  it('marks a missing gloss with a dash until the placeholder resolves', () => {
    renderHeader({ row: row({ gloss: '' }) });

    expect(screen.getByTestId('catalog-row-gloss')).toHaveTextContent('—');
  });

  it('spells out what each usage count means for assistive tech', () => {
    renderHeader({ row: row({ usageCount: 5, usageCountInBook: 2 }) });

    expect(screen.getByTestId('catalog-row-usage-count')).toHaveTextContent(
      '5 %interlinearizer_analysisCatalog_usageCount%',
    );
    expect(screen.getByTestId('catalog-row-usage-count-in-book')).toHaveTextContent(
      '2 uses in Genesis',
    );
  });

  it('counts the places the analysis went stale at', () => {
    const stale = { tokenRef: 'GEN 1:1:0', book: 'GEN', chapter: 1, verse: 1, charStart: 0 };
    renderHeader({ row: row({ staleLocations: [stale, { ...stale, tokenRef: 'GEN 1:2:0' }] }) });

    expect(screen.getByTestId('catalog-row-stale-count')).toHaveTextContent('2');
  });

  it('shows no stale count for an analysis with none', () => {
    renderHeader();

    expect(screen.queryByTestId('catalog-row-stale-count')).not.toBeInTheDocument();
  });

  it('leaves the toggle unlabeled so that its own content names it', () => {
    renderHeader();

    expect(screen.getByTestId('catalog-row-toggle')).not.toHaveAttribute('aria-label');
  });

  it('marks a collapsed row as collapsed', () => {
    renderHeader();

    expect(screen.getByTestId('catalog-row-toggle')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTestId('chevron-right-icon')).toBeInTheDocument();
  });

  it('marks an expanded row as expanded', () => {
    renderHeader({ isExpanded: true });

    expect(screen.getByTestId('catalog-row-toggle')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('chevron-down-icon')).toBeInTheDocument();
  });

  it('asks for the row to be toggled', async () => {
    const { onToggle } = renderHeader();

    await userEvent.click(screen.getByTestId('catalog-row-toggle'));

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('labels the check box with the form it selects', () => {
    renderHeader();

    expect(screen.getByTestId('catalog-row-check')).toHaveAccessibleName('Select λόγος');
  });

  it('shows the row as checked', () => {
    renderHeader({ isChecked: true });

    expect(screen.getByTestId('catalog-row-check')).toBeChecked();
  });

  it('asks for the row to be checked by its analysis', async () => {
    const { onCheckedChange } = renderHeader();

    await userEvent.click(screen.getByTestId('catalog-row-check'));

    expect(onCheckedChange).toHaveBeenCalledWith('ta-1', true);
  });

  it('offers no check box without a way to report it', () => {
    renderHeader({ onCheckedChange: undefined });

    expect(screen.queryByTestId('catalog-row-check')).not.toBeInTheDocument();
  });
});
