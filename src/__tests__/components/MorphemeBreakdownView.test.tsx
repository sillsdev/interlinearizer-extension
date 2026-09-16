/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen, within } from '@testing-library/react';
import type { MorphemeAnalysis } from 'interlinearizer';
import MorphemeBreakdownView, {
  BREAKDOWN_VIEW_STRING_KEYS,
} from '../../components/MorphemeBreakdownView';

/** Each key resolving to itself: the text arrives as a prop, so only key placement is assertable. */
const STRINGS = Object.fromEntries(BREAKDOWN_VIEW_STRING_KEYS.map((k) => [k, k]));

const ANALYSIS_LANGUAGE = 'en';

/** Builds a morpheme of the source writing system, glossed only where a case says so. */
function morpheme(
  id: string,
  form: string,
  gloss?: Readonly<Record<string, string>>,
): MorphemeAnalysis {
  return { id, form, writingSystem: 'grc', gloss };
}

/** The view over `morphemes`, marked with the test ids every case reaches it by. */
function renderView(morphemes: readonly MorphemeAnalysis[], analysisLanguage = ANALYSIS_LANGUAGE) {
  render(
    <MorphemeBreakdownView
      analysisLanguage={analysisLanguage}
      glossTestId="breakdown-gloss"
      localizedStrings={STRINGS}
      morphemeTestId="breakdown-morpheme"
      morphemes={morphemes}
    />,
  );
}

describe('MorphemeBreakdownView', () => {
  it('shows each morpheme of a breakdown', () => {
    renderView([morpheme('m-1', 'λόγ'), morpheme('m-2', 'ος')]);

    const columns = screen.getAllByTestId('breakdown-morpheme');
    expect(columns).toHaveLength(2);
    expect(columns[0]).toHaveTextContent('λόγ');
    expect(columns[1]).toHaveTextContent('ος');
  });

  it('keeps the morphemes in the order the breakdown records them', () => {
    // A breakdown read out of order says the word is segmented other than it is, which is the one
    // thing the forms are there to convey.
    renderView([morpheme('m-1', 'ἀπο'), morpheme('m-2', 'στελ'), morpheme('m-3', 'λω')]);

    expect(screen.getAllByTestId('breakdown-morpheme').map((column) => column.textContent)).toEqual(
      [
        'ἀπο%interlinearizer_analysisCatalog_morphemeNoGloss%',
        'στελ%interlinearizer_analysisCatalog_morphemeNoGloss%',
        'λω%interlinearizer_analysisCatalog_morphemeNoGloss%',
      ],
    );
  });

  it("shows a morpheme's gloss in the analysis language", () => {
    renderView([morpheme('m-1', 'λόγ', { en: 'word' })]);

    expect(screen.getByTestId('breakdown-gloss')).toHaveTextContent('word');
  });

  it('names the absence where a morpheme carries no gloss', () => {
    // A blank cell reads as a rendering gap in a view that offers no field to fill.
    renderView([morpheme('m-1', 'λόγ')]);

    expect(screen.getByTestId('breakdown-gloss')).toHaveTextContent(
      '%interlinearizer_analysisCatalog_morphemeNoGloss%',
    );
  });

  it('names the absence where a morpheme is glossed only in another language', () => {
    renderView([morpheme('m-1', 'λόγ', { fr: 'parole' })]);

    const gloss = screen.getByTestId('breakdown-gloss');
    expect(gloss).toHaveTextContent('%interlinearizer_analysisCatalog_morphemeNoGloss%');
    expect(gloss).not.toHaveTextContent('parole');
  });

  it('names the absence where a morpheme is glossed to an empty string', () => {
    // An emptied gloss is the same absence as an unset one, which a blank cell would not say.
    renderView([morpheme('m-1', 'λόγ', { en: '' })]);

    expect(screen.getByTestId('breakdown-gloss')).toHaveTextContent(
      '%interlinearizer_analysisCatalog_morphemeNoGloss%',
    );
  });

  it('reads the glosses under the analysis language it is given', () => {
    renderView([morpheme('m-1', 'λόγ', { en: 'word', fr: 'parole' })], 'fr');

    expect(screen.getByTestId('breakdown-gloss')).toHaveTextContent('parole');
  });

  it('glosses each morpheme from its own record', () => {
    renderView([morpheme('m-1', 'λόγ', { en: 'word' }), morpheme('m-2', 'ος', { en: 'NOM.SG' })]);

    const columns = screen.getAllByTestId('breakdown-morpheme');
    expect(within(columns[0]).getByTestId('breakdown-gloss')).toHaveTextContent('word');
    expect(within(columns[1]).getByTestId('breakdown-gloss')).toHaveTextContent('NOM.SG');
  });

  it('says outright that a word carrying no breakdown is not split', () => {
    renderView([]);

    expect(screen.getByTestId('breakdown-morpheme-none')).toHaveTextContent(
      '%interlinearizer_analysisCatalog_noBreakdown%',
    );
  });

  it('shows no morpheme columns for a word carrying no breakdown', () => {
    renderView([]);

    expect(screen.queryByTestId('breakdown-morpheme')).not.toBeInTheDocument();
  });

  it('shows no not-split notice for a word that has a breakdown', () => {
    renderView([morpheme('m-1', 'λόγ')]);

    expect(screen.queryByTestId('breakdown-morpheme-none')).not.toBeInTheDocument();
  });
});
