/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from 'platform-bible-react';
import type { ComponentProps } from 'react';
import CatalogRowHeader, { ROW_HEADER_STRING_KEYS } from '../../components/CatalogRowHeader';
import type { CatalogRow } from '../../utils/analysis-query';
import { testSenseRef, withLexicon } from './test-helpers';

/**
 * Each key resolving to itself, except those that fill in placeholders, such as the check box's
 * label, which names the row's form and gloss.
 */
const STRINGS = {
  ...Object.fromEntries(ROW_HEADER_STRING_KEYS.map((k) => [k, k])),
  '%interlinearizer_analysisCatalog_check%': 'Select {form}: {gloss}',
  '%interlinearizer_analysisCatalog_senseDiffers%': 'Lexicon says {gloss}',
};

/** The lexicon every header is rendered under. */
const SENSES = { 's-word': { gloss: { en: 'word' } } };

/** A row of one analysis, carrying only what a case sets beyond its form and gloss. */
function row(overrides: Partial<CatalogRow> = {}): CatalogRow {
  return {
    analysisId: 'ta-1',
    surfaceText: 'λόγος',
    form: 'λόγος',
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
    analysisLanguage: 'en',
    usageCountInBookLabel: 'uses in Genesis',
    isExpanded: false,
    onToggle: jest.fn(),
    isNotInText: false,
    isChecked: false,
    onCheckedChange: jest.fn(),
    localizedStrings: STRINGS,
    ...overrides,
  };
  const { ui, resolveSense } = withLexicon(
    <TooltipProvider>
      <CatalogRowHeader {...props} />
    </TooltipProvider>,
    SENSES,
  );
  render(ui);
  return { ...props, resolveSense };
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

  it('leaves a gloss unmarked when its analysis links to no lexicon sense', () => {
    const { resolveSense } = renderHeader();

    expect(screen.queryByTestId('catalog-sense-link')).not.toBeInTheDocument();
    expect(resolveSense).not.toHaveBeenCalled();
  });

  it('marks a gloss whose analysis links to a sense glossed the same', async () => {
    const { resolveSense } = renderHeader({ row: row({ glossSenseRef: testSenseRef('s-word') }) });

    await waitFor(() => expect(resolveSense).toHaveBeenCalled());
    // An agreeing sense marks the row just as a pending one does, so wait out the lookup itself.
    await act(async () => {
      await resolveSense.mock.results[0].value;
    });
    const mark = screen.getByTestId('catalog-sense-link');
    expect(mark).toHaveAttribute('data-differs', 'false');
    expect(mark).toHaveTextContent('%interlinearizer_analysisCatalog_senseLinked%');
  });

  it("shows the linked sense's gloss where the analysis stores none, marked as from the lexicon", async () => {
    renderHeader({ row: row({ gloss: '', glossSenseRef: testSenseRef('s-word') }) });

    await waitFor(() => expect(screen.getByTestId('catalog-row-gloss')).toHaveTextContent('word'));
    expect(screen.getByTestId('catalog-sense-link')).toHaveTextContent(
      '%interlinearizer_analysisCatalog_senseGloss%',
    );
  });

  it("marks a typed gloss that differs from its linked sense's, naming the sense's", async () => {
    renderHeader({ row: row({ gloss: 'utterance', glossSenseRef: testSenseRef('s-word') }) });

    await waitFor(() => expect(screen.getByTestId('book-alert-icon')).toBeInTheDocument());
    expect(screen.getByTestId('catalog-row-gloss')).toHaveTextContent('utterance');
    expect(screen.getByTestId('catalog-sense-link')).toHaveTextContent('Lexicon says word');
  });

  it('marks a link the lexicon cannot resolve as a link and nothing more', async () => {
    const { resolveSense } = renderHeader({
      row: row({ gloss: '', glossSenseRef: testSenseRef('gone') }),
    });

    await waitFor(() => expect(resolveSense).toHaveBeenCalled());
    await act(async () => {
      await resolveSense.mock.results[0].value;
    });
    expect(screen.getByTestId('catalog-row-gloss')).toHaveTextContent('—');
    expect(screen.getByTestId('catalog-sense-link')).toHaveTextContent(
      '%interlinearizer_analysisCatalog_senseLinked%',
    );
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

  it('names each count on hover', () => {
    const stale = { tokenRef: 'GEN 1:1:0', book: 'GEN', chapter: 1, verse: 1, charStart: 0 };
    renderHeader({
      row: row({ staleLocations: [stale] }),
      localizedStrings: {
        ...STRINGS,
        '%interlinearizer_analysisCatalog_usageCount%': 'uses',
        '%interlinearizer_analysisCatalog_staleCount%': 'stale',
      },
    });

    expect(screen.getByTestId('catalog-row-usage-count')).toHaveAttribute('title', 'uses');
    expect(screen.getByTestId('catalog-row-usage-count-in-book')).toHaveAttribute(
      'title',
      'uses in Genesis',
    );
    expect(screen.getByTestId('catalog-row-stale-count')).toHaveAttribute('title', 'stale');
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

  it('marks an analysis whose form the text lacks', () => {
    renderHeader({ isNotInText: true });

    expect(screen.getByTestId('catalog-row-not-in-text')).toHaveTextContent(
      '%interlinearizer_analysisCatalog_notInText%',
    );
  });

  it('leaves unmarked an analysis whose form the text holds', () => {
    renderHeader();

    expect(screen.queryByTestId('catalog-row-not-in-text')).not.toBeInTheDocument();
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

  it('labels the check box with the form and gloss it selects', () => {
    renderHeader();

    expect(screen.getByTestId('catalog-row-check')).toHaveAccessibleName('Select λόγος: word');
  });

  it('labels the check box of an analysis with no gloss by the placeholder', () => {
    renderHeader({
      row: row({ gloss: '' }),
      localizedStrings: { ...STRINGS, '%interlinearizer_analysisCatalog_noGloss%': '(none)' },
    });

    expect(screen.getByTestId('catalog-row-check')).toHaveAccessibleName('Select λόγος: (none)');
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
