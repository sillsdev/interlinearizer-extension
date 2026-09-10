/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CatalogMergeModal, { MERGE_STRING_KEYS } from '../../components/CatalogMergeModal';
import type { CatalogRow } from '../../utils/analysis-query';

/** Each key resolving to itself: the text arrives as a prop, so only key placement is assertable. */
const STRINGS = Object.fromEntries(MERGE_STRING_KEYS.map((k) => [k, k]));

const analysisLanguage = 'en';

/** Builds a catalog row of the one surface form these tests merge, carrying only what a case sets. */
function row(analysisId: string, overrides: Partial<CatalogRow> = {}): CatalogRow {
  return {
    analysisId,
    surfaceText: 'λόγος',
    gloss: '',
    morphemes: [],
    usageCount: 0,
    usageCountInBook: 0,
    usages: [],
    books: new Set(),
    searchText: '',
    ...overrides,
  };
}

/** The modal over `candidates`, opened from the first of them unless told otherwise. */
function renderModal(
  candidates: readonly CatalogRow[],
  overrides: {
    onConfirm?: jest.Mock;
    onCancel?: jest.Mock;
    initialSurvivorId?: string;
    strings?: Record<string, string>;
  } = {},
) {
  const onConfirm = overrides.onConfirm ?? jest.fn();
  const onCancel = overrides.onCancel ?? jest.fn();
  render(
    <CatalogMergeModal
      analysisLanguage={analysisLanguage}
      candidates={candidates}
      initialSurvivorId={overrides.initialSurvivorId ?? candidates[0].analysisId}
      localizedStrings={overrides.strings ?? STRINGS}
      onCancel={onCancel}
      onConfirm={onConfirm}
      sourceLanguageTag="grc"
      surfaceText="λόγος"
    />,
  );
  return { onConfirm, onCancel };
}

describe('CatalogMergeModal', () => {
  it('fills the master gloss from the analysis the merge was opened from', () => {
    renderModal([row('ta-1', { gloss: 'word' }), row('ta-2', { gloss: 'speech' })]);

    expect(screen.getByTestId('catalog-merge-master-gloss')).toHaveValue('word');
  });

  it('keeps what the reader types into the master gloss', async () => {
    renderModal([row('ta-1', { gloss: 'word' }), row('ta-2', { gloss: 'speech' })]);

    await userEvent.clear(screen.getByTestId('catalog-merge-master-gloss'));
    await userEvent.type(screen.getByTestId('catalog-merge-master-gloss'), 'utterance');

    expect(screen.getByTestId('catalog-merge-master-gloss')).toHaveValue('utterance');
  });

  it('lists every analysis of the form, the survivor first', () => {
    renderModal([row('ta-1', { gloss: 'word' }), row('ta-2', { gloss: 'speech' })], {
      initialSurvivorId: 'ta-2',
    });

    expect(
      screen.getAllByTestId('catalog-merge-candidate').map((el) => el.dataset.analysisId),
    ).toEqual(['ta-2', 'ta-1']);
  });

  it('holds the survivor in the merge, its checkbox being no decision to make', () => {
    renderModal([row('ta-1', { gloss: 'word' }), row('ta-2', { gloss: 'speech' })]);

    const [survivorBox] = screen.getAllByTestId('catalog-merge-check');
    expect(survivorBox).toBeChecked();
    expect(survivorBox).toBeDisabled();
  });

  it('leaves every other analysis out of the merge until it is checked', () => {
    renderModal([row('ta-1', { gloss: 'word' }), row('ta-2', { gloss: 'speech' })]);

    expect(screen.getAllByTestId('catalog-merge-check')[1]).not.toBeChecked();
  });

  it('fills a field the survivor lacks once a lower analysis joins the merge', async () => {
    renderModal([row('ta-1'), row('ta-2', { gloss: 'speech' })]);

    await userEvent.click(screen.getAllByTestId('catalog-merge-check')[1]);

    expect(screen.getByTestId('catalog-merge-master-gloss')).toHaveValue('speech');
  });

  it('empties a field again when the only analysis donating it leaves the merge', async () => {
    renderModal([row('ta-1'), row('ta-2', { gloss: 'speech' })]);
    const donorBox = screen.getAllByTestId('catalog-merge-check')[1];

    await userEvent.click(donorBox);
    await userEvent.click(donorBox);

    expect(screen.getByTestId('catalog-merge-master-gloss')).toHaveValue('');
  });

  it('withholds the merge while the survivor is the only analysis in it', () => {
    renderModal([row('ta-1', { gloss: 'word' }), row('ta-2', { gloss: 'speech' })]);

    expect(screen.getByTestId('catalog-merge-confirm')).toBeDisabled();
  });

  it('offers the merge once another analysis joins it', async () => {
    renderModal([row('ta-1', { gloss: 'word' }), row('ta-2', { gloss: 'speech' })]);

    await userEvent.click(screen.getAllByTestId('catalog-merge-check')[1]);

    expect(screen.getByTestId('catalog-merge-confirm')).toBeEnabled();
  });

  it('commits the survivor and every analysis folded into it', async () => {
    const { onConfirm } = renderModal([
      row('ta-1', { gloss: 'word' }),
      row('ta-2', { gloss: 'speech' }),
      row('ta-3', { gloss: 'account' }),
    ]);

    await userEvent.click(screen.getAllByTestId('catalog-merge-check')[2]);
    await userEvent.click(screen.getByTestId('catalog-merge-confirm'));

    expect(onConfirm).toHaveBeenCalledWith(
      'ta-1',
      ['ta-3'],
      { gloss: 'word', morphemes: [], pos: undefined, features: undefined, confidence: undefined },
      'λόγος',
    );
  });

  it('commits the content the master settled rather than what the survivor said', async () => {
    const { onConfirm } = renderModal([
      row('ta-1', { gloss: 'word' }),
      row('ta-2', { gloss: 'speech' }),
    ]);

    await userEvent.click(screen.getAllByTestId('catalog-merge-check')[1]);
    await userEvent.clear(screen.getByTestId('catalog-merge-master-gloss'));
    await userEvent.type(screen.getByTestId('catalog-merge-master-gloss'), 'utterance');
    await userEvent.click(screen.getByTestId('catalog-merge-confirm'));

    expect(onConfirm).toHaveBeenCalledWith(
      'ta-1',
      ['ta-2'],
      expect.objectContaining({ gloss: 'utterance' }),
      'λόγος',
    );
  });

  it('makes a promoted analysis the survivor the rest merge into', async () => {
    const { onConfirm } = renderModal([
      row('ta-1', { gloss: 'word' }),
      row('ta-2', { gloss: 'speech' }),
    ]);

    await userEvent.click(screen.getAllByTestId('catalog-merge-promote')[1]);
    await userEvent.click(screen.getByTestId('catalog-merge-confirm'));

    expect(onConfirm).toHaveBeenCalledWith('ta-2', ['ta-1'], expect.anything(), 'λόγος');
  });

  it('lifts a promoted analysis to the top of the listing', async () => {
    renderModal([row('ta-1', { gloss: 'word' }), row('ta-2', { gloss: 'speech' })]);

    await userEvent.click(screen.getAllByTestId('catalog-merge-promote')[1]);

    expect(
      screen.getAllByTestId('catalog-merge-candidate').map((el) => el.dataset.analysisId),
    ).toEqual(['ta-2', 'ta-1']);
  });

  it('keeps the analysis a promotion displaced in the merge', async () => {
    renderModal([row('ta-1', { gloss: 'word' }), row('ta-2', { gloss: 'speech' })]);

    await userEvent.click(screen.getAllByTestId('catalog-merge-promote')[1]);

    expect(screen.getAllByTestId('catalog-merge-check')[1]).toBeChecked();
  });

  it('offers no promotion on the analysis already surviving', () => {
    renderModal([row('ta-1', { gloss: 'word' }), row('ta-2', { gloss: 'speech' })]);

    expect(screen.getAllByTestId('catalog-merge-promote')[0]).toBeDisabled();
  });

  it('refills the master from the analysis a promotion made survivor', async () => {
    renderModal([row('ta-1', { pos: 'noun' }), row('ta-2', { pos: 'verb' })]);

    await userEvent.click(screen.getAllByTestId('catalog-merge-promote')[1]);

    expect(screen.getByTestId('catalog-merge-master-pos')).toHaveValue('verb');
  });

  it('names each analysis by how many tokens carry it', () => {
    renderModal([
      row('ta-1', { gloss: 'word', usageCount: 12 }),
      row('ta-2', { gloss: 'speech', usageCount: 3 }),
    ]);

    expect(screen.getAllByTestId('catalog-merge-usage-count')[0]).toHaveTextContent(
      '%interlinearizer_analysisCatalog_mergeUsageCount%',
    );
  });

  it('shows each analysis the fields the master could take from it', () => {
    renderModal([
      row('ta-1', { gloss: 'word' }),
      row('ta-2', { gloss: 'speech', pos: 'verb', confidence: 'low' }),
    ]);

    const donor = screen.getAllByTestId('catalog-merge-candidate')[1];
    expect(donor).toHaveTextContent('verb');
    expect(donor).toHaveTextContent('low');
  });

  it('says nothing about collapsing while every analysis left out stays distinct', async () => {
    renderModal([
      row('ta-1', { gloss: 'word' }),
      row('ta-2', { gloss: 'speech' }),
      row('ta-3', { gloss: 'account' }),
    ]);

    await userEvent.click(screen.getAllByTestId('catalog-merge-check')[1]);

    expect(screen.queryByTestId('catalog-merge-collapse-warning')).not.toBeInTheDocument();
  });

  it('warns that an analysis left out will be absorbed when the master comes to match it', async () => {
    renderModal([
      row('ta-1', { gloss: 'word' }),
      row('ta-2', { gloss: 'speech' }),
      row('ta-3', { gloss: 'account' }),
    ]);

    await userEvent.click(screen.getAllByTestId('catalog-merge-check')[1]);
    await userEvent.clear(screen.getByTestId('catalog-merge-master-gloss'));
    await userEvent.type(screen.getByTestId('catalog-merge-master-gloss'), 'account');

    expect(screen.getByTestId('catalog-merge-collapse-warning')).toHaveTextContent(
      '%interlinearizer_analysisCatalog_mergeWillCollapse%',
    );
  });

  it('still allows a merge that will collapse, the warning having said so', async () => {
    renderModal([
      row('ta-1', { gloss: 'word' }),
      row('ta-2', { gloss: 'speech' }),
      row('ta-3', { gloss: 'account' }),
    ]);

    await userEvent.click(screen.getAllByTestId('catalog-merge-check')[1]);
    await userEvent.clear(screen.getByTestId('catalog-merge-master-gloss'));
    await userEvent.type(screen.getByTestId('catalog-merge-master-gloss'), 'account');

    expect(screen.getByTestId('catalog-merge-confirm')).toBeEnabled();
  });

  // Resolved rather than echoed as its key, the substitution being the whole of what is asserted.
  it('names a collapsing analysis by its form where it carries no gloss', async () => {
    renderModal([row('ta-1', { gloss: 'word' }), row('ta-2', { gloss: 'speech' }), row('ta-3')], {
      strings: {
        ...STRINGS,
        '%interlinearizer_analysisCatalog_mergeWillCollapse%': 'also absorbs {gloss}',
      },
    });

    await userEvent.click(screen.getAllByTestId('catalog-merge-check')[1]);
    await userEvent.clear(screen.getByTestId('catalog-merge-master-gloss'));

    expect(screen.getByTestId('catalog-merge-collapse-warning')).toHaveTextContent(
      'also absorbs λόγος',
    );
  });

  it('records no part of speech when the field is cleared', async () => {
    const { onConfirm } = renderModal([
      row('ta-1', { gloss: 'word', pos: 'noun' }),
      row('ta-2', { gloss: 'speech' }),
    ]);

    await userEvent.click(screen.getAllByTestId('catalog-merge-check')[1]);
    await userEvent.clear(screen.getByTestId('catalog-merge-master-pos'));
    await userEvent.click(screen.getByTestId('catalog-merge-confirm'));

    expect(onConfirm).toHaveBeenCalledWith(
      'ta-1',
      ['ta-2'],
      expect.objectContaining({ pos: undefined }),
      'λόγος',
    );
  });

  it('offers no revert on a field the reader has not edited', () => {
    renderModal([row('ta-1', { gloss: 'word' }), row('ta-2', { gloss: 'speech' })]);

    expect(screen.queryByTestId('catalog-merge-revert-gloss')).not.toBeInTheDocument();
  });

  it('takes an edited field back to what the merged analyses derive', async () => {
    renderModal([row('ta-1', { gloss: 'word' }), row('ta-2', { gloss: 'speech' })]);

    await userEvent.clear(screen.getByTestId('catalog-merge-master-gloss'));
    await userEvent.type(screen.getByTestId('catalog-merge-master-gloss'), 'utterance');
    await userEvent.click(screen.getByTestId('catalog-merge-revert-gloss'));

    expect(screen.getByTestId('catalog-merge-master-gloss')).toHaveValue('word');
  });

  it('takes an edited part of speech back to what the merged analyses derive', async () => {
    renderModal([row('ta-1', { gloss: 'word', pos: 'noun' })]);

    await userEvent.clear(screen.getByTestId('catalog-merge-master-pos'));
    await userEvent.click(screen.getByTestId('catalog-merge-revert-pos'));

    expect(screen.getByTestId('catalog-merge-master-pos')).toHaveValue('noun');
  });

  it('takes every edited field back at once', async () => {
    renderModal([row('ta-1', { gloss: 'word', pos: 'noun' })]);

    await userEvent.type(screen.getByTestId('catalog-merge-master-gloss'), 'ing');
    await userEvent.type(screen.getByTestId('catalog-merge-master-pos'), 's');
    await userEvent.click(screen.getByTestId('catalog-merge-reset'));

    expect(screen.getByTestId('catalog-merge-master-gloss')).toHaveValue('word');
    expect(screen.getByTestId('catalog-merge-master-pos')).toHaveValue('noun');
  });

  it('offers no reset while nothing has been edited', () => {
    renderModal([row('ta-1', { gloss: 'word' }), row('ta-2', { gloss: 'speech' })]);

    expect(screen.queryByTestId('catalog-merge-reset')).not.toBeInTheDocument();
  });

  it('shows the breakdown of an analysis that has one', () => {
    renderModal([
      row('ta-1', { gloss: 'word' }),
      row('ta-2', {
        gloss: 'speech',
        morphemes: [
          { id: 'm-1', form: 'λόγ', writingSystem: 'grc' },
          { id: 'm-2', form: 'ος', writingSystem: 'grc' },
        ],
      }),
    ]);

    const breakdown = screen.getByTestId('catalog-merge-breakdown');
    expect(breakdown).toHaveTextContent('λόγ');
    expect(breakdown).toHaveTextContent('ος');
  });

  it('shows no breakdown for an analysis that segments nothing', () => {
    renderModal([row('ta-1', { gloss: 'word' }), row('ta-2', { gloss: 'speech' })]);

    expect(screen.queryByTestId('catalog-merge-breakdown')).not.toBeInTheDocument();
  });

  it('names each feature an analysis carries', () => {
    renderModal([
      row('ta-1', { gloss: 'word' }),
      row('ta-2', { gloss: 'speech', features: { Case: 'Nom', Number: 'Sg' } }),
    ]);

    const donor = screen.getAllByTestId('catalog-merge-candidate')[1];
    expect(donor).toHaveTextContent('Case=Nom');
    expect(donor).toHaveTextContent('Number=Sg');
  });

  it('offers every analysis a handle to reorder it by', () => {
    renderModal([row('ta-1', { gloss: 'word' }), row('ta-2', { gloss: 'speech' })]);

    expect(screen.getAllByTestId('catalog-merge-drag-handle')).toHaveLength(2);
  });
});
