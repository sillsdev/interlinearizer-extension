/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen, waitFor, within } from '@testing-library/react';
import type { MorphemeAnalysis } from 'interlinearizer';
import { TooltipProvider } from 'platform-bible-react';
import type { ComponentProps } from 'react';
import CatalogSenseLinks, {
  SENSE_LINK_MARK_STRING_KEYS,
  SENSE_LINKS_STRING_KEYS,
} from '../../components/CatalogSenseLinks';
import { testSenseRef, withLexicon } from './test-helpers';

const STRINGS = {
  ...Object.fromEntries(
    [...SENSE_LINKS_STRING_KEYS, ...SENSE_LINK_MARK_STRING_KEYS].map((k) => [k, k]),
  ),
  '%interlinearizer_analysisCatalog_senseDiffers%': 'Lexicon says {gloss}',
};

const SENSES = {
  's-word': { gloss: { en: 'word' }, lexemeForm: { grc: 'λόγος' }, senseLabel: '1' },
  's-stem': { gloss: { en: 'speak' }, lexemeForm: { grc: 'λογ' } },
  's-bare': { gloss: { en: 'bare' } },
};

/** A morpheme of `form`, linked to `senseId` when one is given. */
function morpheme(id: string, form: string, senseId?: string, gloss?: string): MorphemeAnalysis {
  return {
    id,
    form,
    writingSystem: 'grc',
    ...(senseId && { senseRef: testSenseRef(senseId) }),
    ...(gloss && { gloss: { en: gloss } }),
  };
}

/** The list, under a lexicon holding {@link SENSES}, linking nothing unless a test says. */
function renderLinks(overrides: Partial<ComponentProps<typeof CatalogSenseLinks>> = {}) {
  const props = {
    surfaceText: 'λόγος',
    gloss: '',
    morphemes: [],
    showMorphology: true,
    analysisLanguage: 'en',
    localizedStrings: STRINGS,
    ...overrides,
  };
  const { ui, resolveSense } = withLexicon(
    <TooltipProvider>
      <CatalogSenseLinks {...props} />
    </TooltipProvider>,
    SENSES,
  );
  render(ui);
  return { resolveSense };
}

describe('CatalogSenseLinks', () => {
  it('renders nothing when nothing is linked', () => {
    renderLinks({ morphemes: [morpheme('m-1', 'λογ')] });

    expect(screen.queryByTestId('catalog-sense-links')).not.toBeInTheDocument();
  });

  it("names the word's sense by its entry and gloss", async () => {
    renderLinks({ glossSenseRef: testSenseRef('s-word') });

    const line = screen.getByTestId('catalog-sense-line');
    await waitFor(() =>
      expect(within(line).getByTestId('catalog-sense-entry')).toHaveTextContent('λόγος 1'),
    );
    expect(within(line).getByTestId('catalog-sense-gloss')).toHaveTextContent('word');
  });

  it('names a sense its lexicon lists under no form by its gloss alone', async () => {
    renderLinks({ glossSenseRef: testSenseRef('s-bare') });

    const line = screen.getByTestId('catalog-sense-line');
    await waitFor(() =>
      expect(within(line).getByTestId('catalog-sense-gloss')).toHaveTextContent('bare'),
    );
    expect(within(line).queryByTestId('catalog-sense-entry')).not.toBeInTheDocument();
  });

  it('lists only the morphemes that link to a sense', async () => {
    renderLinks({
      morphemes: [morpheme('m-1', 'λογ', 's-stem'), morpheme('m-2', 'ος')],
    });

    const lines = screen.getAllByTestId('catalog-sense-line');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveTextContent('λογ');
    await waitFor(() => expect(lines[0]).toHaveTextContent('speak'));
  });

  it("lists no morpheme's link while the breakdown is hidden", () => {
    renderLinks({
      showMorphology: false,
      morphemes: [morpheme('m-1', 'λογ', 's-stem')],
    });

    expect(screen.queryByTestId('catalog-sense-links')).not.toBeInTheDocument();
  });

  it('shows a zero morpheme by the zero sign', () => {
    renderLinks({ morphemes: [morpheme('m-1', '', 's-stem')] });

    expect(screen.getByTestId('catalog-sense-line')).toHaveTextContent('∅');
  });

  it("marks a morpheme's typed gloss that differs from its sense's", async () => {
    renderLinks({ morphemes: [morpheme('m-1', 'λογ', 's-stem', 'say')] });

    await waitFor(() =>
      expect(screen.getByTestId('catalog-sense-link')).toHaveAttribute('data-differs', 'true'),
    );
    expect(screen.getByTestId('catalog-sense-link')).toHaveTextContent('Lexicon says speak');
  });

  it('shows a link the lexicon cannot resolve as a link and nothing more', async () => {
    const { resolveSense } = renderLinks({ glossSenseRef: testSenseRef('gone') });

    await waitFor(() => expect(resolveSense).toHaveBeenCalled());
    const line = screen.getByTestId('catalog-sense-line');
    expect(within(line).getByTestId('catalog-sense-link')).toHaveTextContent(
      '%interlinearizer_analysisCatalog_senseLinked%',
    );
    expect(within(line).queryByTestId('catalog-sense-entry')).not.toBeInTheDocument();
    expect(within(line).queryByTestId('catalog-sense-gloss')).not.toBeInTheDocument();
  });
});
