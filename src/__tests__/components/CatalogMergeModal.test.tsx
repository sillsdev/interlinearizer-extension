/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MorphemeAnalysis } from 'interlinearizer';
import CatalogMergeModal, {
  MERGE_STRING_KEYS,
  dropIndex,
} from '../../components/CatalogMergeModal';
import type { CatalogRow } from '../../utils/analysis-query';

/** Each key resolving to itself: the text arrives as a prop, so only key placement is assertable. */
const STRINGS = Object.fromEntries(MERGE_STRING_KEYS.map((k) => [k, k]));

const analysisLanguage = 'en';

/**
 * Builds a catalog row of the one surface form these tests merge, carrying only what a case sets.
 *
 * The listed gloss also lands in `glosses` under the analysis language, as a row built from a
 * stored analysis carries it; a case setting `glosses` outright is opting into a further language.
 */
function row(analysisId: string, overrides: Partial<CatalogRow> = {}): CatalogRow {
  const gloss = overrides.gloss ?? '';
  return {
    analysisId,
    surfaceText: 'λόγος',
    gloss: '',
    glosses: gloss ? { [analysisLanguage]: gloss } : undefined,
    morphemes: [],
    usageCount: 0,
    usageCountInBook: 0,
    usages: [],
    books: new Set(),
    searchText: '',
    ...overrides,
  };
}

/** Builds a morpheme of the source writing system, glossed only where a case says so. */
function morpheme(id: string, form: string, gloss?: string): MorphemeAnalysis {
  return {
    id,
    form,
    writingSystem: 'grc',
    gloss: gloss === undefined ? undefined : { [analysisLanguage]: gloss },
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
  const initialSurvivorId = overrides.initialSurvivorId ?? candidates[0].analysisId;
  const modal = (over: readonly CatalogRow[]) => (
    <CatalogMergeModal
      analysisLanguage={analysisLanguage}
      candidates={over}
      initialSurvivorId={initialSurvivorId}
      localizedStrings={overrides.strings ?? STRINGS}
      onCancel={onCancel}
      onConfirm={onConfirm}
      sourceLanguageTag="grc"
      surfaceText="λόγος"
    />
  );
  const { rerender } = render(modal(candidates));
  /** Re-renders the mounted modal over a changed listing, as an edit beside the panel leaves it. */
  const setCandidates = (next: readonly CatalogRow[]) => rerender(modal(next));
  return { onConfirm, onCancel, setCandidates };
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

  it('lists an analysis of the form an edit beside the panel raised while it was open', () => {
    const { setCandidates } = renderModal([
      row('ta-1', { gloss: 'word' }),
      row('ta-2', { gloss: 'speech' }),
    ]);

    setCandidates([
      row('ta-1', { gloss: 'word' }),
      row('ta-2', { gloss: 'speech' }),
      row('ta-3', { gloss: 'account' }),
    ]);

    expect(
      screen.getAllByTestId('catalog-merge-candidate').map((el) => el.dataset.analysisId),
    ).toEqual(['ta-1', 'ta-2', 'ta-3']);
  });

  it('warns about an analysis raised while it was open that the master comes to match', async () => {
    const { setCandidates } = renderModal([
      row('ta-1', { gloss: 'word' }),
      row('ta-2', { gloss: 'speech' }),
    ]);

    setCandidates([
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

  it('leaves an analysis raised while it was open out of the merge until it is checked', () => {
    const { setCandidates } = renderModal([
      row('ta-1', { gloss: 'word' }),
      row('ta-2', { gloss: 'speech' }),
    ]);

    setCandidates([
      row('ta-1', { gloss: 'word' }),
      row('ta-2', { gloss: 'speech' }),
      row('ta-3', { gloss: 'account' }),
    ]);

    expect(screen.getAllByTestId('catalog-merge-check')[2]).not.toBeChecked();
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

  it('fills the master breakdown from the highest-ranked analysis in the merge that has one', async () => {
    const user = userEvent.setup();
    renderModal([
      row('ta-1', { gloss: 'word' }),
      row('ta-2', { gloss: 'speech', morphemes: [morpheme('m-1', 'λόγος')] }),
      row('ta-3', { gloss: 'reason', morphemes: [morpheme('m-2', 'λόγ'), morpheme('m-3', 'ος')] }),
    ]);

    await user.click(screen.getAllByTestId('catalog-merge-check')[2]);

    expect(screen.getByTestId('catalog-merge-master-morphemes')).toHaveValue('λόγ ος');
  });

  it('re-splits the master when the reader edits the breakdown', async () => {
    const user = userEvent.setup();
    renderModal([
      row('ta-1', { gloss: 'word', morphemes: [morpheme('m-1', 'λόγος')] }),
      row('ta-2', { gloss: 'speech' }),
    ]);

    const field = screen.getByTestId('catalog-merge-master-morphemes');
    await user.clear(field);
    await user.type(field, 'λόγ ος');

    expect(field).toHaveValue('λόγ ος');
  });

  it('reads a breakdown of the whole form as no breakdown at all', async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderModal([
      row('ta-1', { gloss: 'word', morphemes: [morpheme('m-1', 'λόγ'), morpheme('m-2', 'ος')] }),
      row('ta-2', { gloss: 'speech' }),
    ]);
    await user.click(screen.getAllByTestId('catalog-merge-check')[1]);

    const field = screen.getByTestId('catalog-merge-master-morphemes');
    await user.clear(field);
    await user.type(field, 'λόγος');
    await user.click(screen.getByTestId('catalog-merge-confirm'));

    expect(onConfirm.mock.calls[0][2].morphemes).toEqual([]);
  });

  it('takes an edited breakdown back to what the merged analyses derive', async () => {
    const user = userEvent.setup();
    renderModal([
      row('ta-1', { gloss: 'word', morphemes: [morpheme('m-1', 'λόγ'), morpheme('m-2', 'ος')] }),
      row('ta-2', { gloss: 'speech' }),
    ]);

    const field = screen.getByTestId('catalog-merge-master-morphemes');
    await user.clear(field);
    await user.type(field, 'λόγο ς');
    await user.click(screen.getByTestId('catalog-merge-revert-morphemeForms'));

    expect(field).toHaveValue('λόγ ος');
  });

  it('fills each morpheme gloss from the highest-ranked analysis in the merge carrying its form', async () => {
    const user = userEvent.setup();
    renderModal([
      row('ta-1', {
        gloss: 'word',
        morphemes: [morpheme('m-1', 'λόγ'), morpheme('m-2', 'ος')],
      }),
      row('ta-2', {
        gloss: 'speech',
        morphemes: [morpheme('m-3', 'λόγ', 'say'), morpheme('m-4', 'ος', 'nom.sg')],
      }),
    ]);

    await user.click(screen.getAllByTestId('catalog-merge-check')[1]);

    const glosses = screen.getAllByTestId('catalog-merge-master-morpheme-gloss');
    expect(glosses[0]).toHaveValue('say');
    expect(glosses[1]).toHaveValue('nom.sg');
  });

  it('keeps what the reader types into a morpheme gloss', async () => {
    const user = userEvent.setup();
    renderModal([
      row('ta-1', { gloss: 'word', morphemes: [morpheme('m-1', 'λόγ'), morpheme('m-2', 'ος')] }),
      row('ta-2', { gloss: 'speech' }),
    ]);

    await user.type(screen.getAllByTestId('catalog-merge-master-morpheme-gloss')[0], 'say');

    expect(screen.getAllByTestId('catalog-merge-master-morpheme-gloss')[0]).toHaveValue('say');
  });

  it('takes one morpheme gloss back to what the merged analyses derive', async () => {
    const user = userEvent.setup();
    renderModal([
      row('ta-1', {
        gloss: 'word',
        morphemes: [morpheme('m-1', 'λόγ', 'say'), morpheme('m-2', 'ος', 'nom.sg')],
      }),
      row('ta-2', { gloss: 'speech' }),
    ]);
    await user.type(screen.getAllByTestId('catalog-merge-master-morpheme-gloss')[0], '-stem');

    await user.click(screen.getByTestId('catalog-merge-revert-morpheme-gloss'));

    const glosses = screen.getAllByTestId('catalog-merge-master-morpheme-gloss');
    expect(glosses[0]).toHaveValue('say');
    expect(glosses[1]).toHaveValue('nom.sg');
  });

  it('offers no revert on a morpheme gloss the reader has not touched', () => {
    renderModal([
      row('ta-1', { gloss: 'word', morphemes: [morpheme('m-1', 'λόγ', 'say')] }),
      row('ta-2', { gloss: 'speech' }),
    ]);

    expect(screen.queryByTestId('catalog-merge-revert-morpheme-gloss')).not.toBeInTheDocument();
  });

  it('offers no morpheme gloss field once the breakdown is emptied back to the whole word', async () => {
    const user = userEvent.setup();
    renderModal([
      row('ta-1', { gloss: 'word', morphemes: [morpheme('m-1', 'λόγ'), morpheme('m-2', 'ος')] }),
      row('ta-2', { gloss: 'speech' }),
    ]);
    await user.type(screen.getAllByTestId('catalog-merge-master-morpheme-gloss')[1], 'nom.sg');

    const field = screen.getByTestId('catalog-merge-master-morphemes');
    await user.clear(field);
    await user.type(field, 'λόγος');

    expect(screen.queryAllByTestId('catalog-merge-master-morpheme-gloss')).toHaveLength(0);
  });

  it('keeps a typed morpheme gloss with the place it was typed into across a re-split', async () => {
    const user = userEvent.setup();
    renderModal([
      row('ta-1', { gloss: 'word', morphemes: [morpheme('m-1', 'λόγ'), morpheme('m-2', 'ος')] }),
      row('ta-2', { gloss: 'speech' }),
    ]);
    await user.type(screen.getAllByTestId('catalog-merge-master-morpheme-gloss')[0], 'say');

    const field = screen.getByTestId('catalog-merge-master-morphemes');
    await user.clear(field);
    await user.type(field, 'λό γος');

    expect(screen.getAllByTestId('catalog-merge-master-morpheme-gloss')[0]).toHaveValue('say');
  });

  it('keeps a typed morpheme gloss across a change of survivor', async () => {
    const user = userEvent.setup();
    renderModal([
      row('ta-1', { gloss: 'word', morphemes: [morpheme('m-1', 'λόγ'), morpheme('m-2', 'ος')] }),
      row('ta-2', {
        gloss: 'speech',
        morphemes: [morpheme('m-3', 'λόγ', 'say'), morpheme('m-4', 'ος')],
      }),
    ]);
    await user.type(screen.getAllByTestId('catalog-merge-master-morpheme-gloss')[0], 'word-stem');

    await user.click(screen.getAllByTestId('catalog-merge-promote')[1]);

    expect(screen.getAllByTestId('catalog-merge-master-morpheme-gloss')[0]).toHaveValue(
      'word-stem',
    );
  });

  it('offers a field per feature the merge settles on, named as the analysis recorded it', async () => {
    const user = userEvent.setup();
    renderModal([
      row('ta-1', { gloss: 'word' }),
      row('ta-2', { gloss: 'speech', features: { Case: 'Nom', Number: 'Sg' } }),
    ]);

    await user.click(screen.getAllByTestId('catalog-merge-check')[1]);

    expect(screen.getByTestId('catalog-merge-master-feature-Case')).toHaveValue('Nom');
    expect(screen.getByTestId('catalog-merge-master-feature-Number')).toHaveValue('Sg');
    expect(screen.getByTestId('catalog-merge-feature-name-Case')).toHaveValue('Case');
  });

  it('renames a feature, carrying its value onto the new name', async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderModal([
      row('ta-1', { gloss: 'word', features: { Case: 'Nom' } }),
      row('ta-2', { gloss: 'speech' }),
    ]);
    await user.click(screen.getAllByTestId('catalog-merge-check')[1]);

    const nameField = screen.getByTestId('catalog-merge-feature-name-Case');
    await user.clear(nameField);
    await user.type(nameField, 'Kasus');

    await user.click(screen.getByTestId('catalog-merge-confirm'));
    expect(onConfirm.mock.calls[0][2].features).toEqual({ Kasus: 'Nom' });
  });

  it('records no feature while its row is still being named', async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderModal([
      row('ta-1', { gloss: 'word', features: { Case: 'Nom' } }),
      row('ta-2', { gloss: 'speech' }),
    ]);
    await user.click(screen.getAllByTestId('catalog-merge-check')[1]);

    await user.clear(screen.getByTestId('catalog-merge-feature-name-Case'));

    await user.click(screen.getByTestId('catalog-merge-confirm'));
    expect(onConfirm.mock.calls[0][2].features).toBeUndefined();
  });

  it('keeps what the reader types into a feature value', async () => {
    const user = userEvent.setup();
    renderModal([
      row('ta-1', { gloss: 'word', features: { Case: 'Nom' } }),
      row('ta-2', { gloss: 'speech' }),
    ]);

    const field = screen.getByTestId('catalog-merge-master-feature-Case');
    await user.clear(field);
    await user.type(field, 'Gen');

    expect(screen.getByTestId('catalog-merge-master-feature-Case')).toHaveValue('Gen');
  });

  it('records no feature whose value the reader emptied', async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderModal([
      row('ta-1', { gloss: 'word', features: { Case: 'Nom', Number: 'Sg' } }),
      row('ta-2', { gloss: 'speech' }),
    ]);
    await user.click(screen.getAllByTestId('catalog-merge-check')[1]);

    await user.clear(screen.getByTestId('catalog-merge-master-feature-Case'));
    await user.click(screen.getByTestId('catalog-merge-confirm'));

    expect(onConfirm.mock.calls[0][2].features).toEqual({ Number: 'Sg' });
  });

  it('withholds confirmation while two feature rows are named the same', async () => {
    const user = userEvent.setup();
    renderModal([
      row('ta-1', { gloss: 'word', features: { Case: 'Nom', Number: 'Sg' } }),
      row('ta-2', { gloss: 'speech' }),
    ]);
    await user.click(screen.getAllByTestId('catalog-merge-check')[1]);

    const nameField = screen.getByTestId('catalog-merge-feature-name-Number');
    await user.clear(nameField);
    await user.type(nameField, 'Case');

    expect(screen.getByTestId('catalog-merge-duplicate-feature-warning')).toBeInTheDocument();
    expect(screen.getByTestId('catalog-merge-confirm')).toBeDisabled();
  });

  // The collision lives only in the edits, so taking those back leaves nothing to withhold over.
  it('restores confirmation once the edits holding the collision are taken back', async () => {
    const user = userEvent.setup();
    renderModal([
      row('ta-1', { gloss: 'word', features: { Case: 'Nom', Number: 'Sg' } }),
      row('ta-2', { gloss: 'speech' }),
    ]);
    await user.click(screen.getAllByTestId('catalog-merge-check')[1]);
    const nameField = screen.getByTestId('catalog-merge-feature-name-Number');
    await user.clear(nameField);
    await user.type(nameField, 'Case');

    await user.click(screen.getByTestId('catalog-merge-reset'));

    expect(screen.getByTestId('catalog-merge-feature-name-Number')).toHaveValue('Number');
    expect(screen.queryByTestId('catalog-merge-duplicate-feature-warning')).not.toBeInTheDocument();
    expect(screen.getByTestId('catalog-merge-confirm')).toBeEnabled();
  });

  it('restores confirmation once the colliding feature name is changed', async () => {
    const user = userEvent.setup();
    renderModal([
      row('ta-1', { gloss: 'word', features: { Case: 'Nom', Number: 'Sg' } }),
      row('ta-2', { gloss: 'speech' }),
    ]);
    await user.click(screen.getAllByTestId('catalog-merge-check')[1]);

    const nameField = screen.getByTestId('catalog-merge-feature-name-Number');
    await user.clear(nameField);
    await user.type(nameField, 'Case');
    await user.clear(nameField);
    await user.type(nameField, 'Numerus');

    expect(screen.queryByTestId('catalog-merge-duplicate-feature-warning')).not.toBeInTheDocument();
    expect(screen.getByTestId('catalog-merge-confirm')).toBeEnabled();
  });

  it('records no features at all once every value is emptied', async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderModal([
      row('ta-1', { gloss: 'word', features: { Case: 'Nom' } }),
      row('ta-2', { gloss: 'speech' }),
    ]);
    await user.click(screen.getAllByTestId('catalog-merge-check')[1]);

    await user.clear(screen.getByTestId('catalog-merge-master-feature-Case'));
    await user.click(screen.getByTestId('catalog-merge-confirm'));

    expect(onConfirm.mock.calls[0][2].features).toBeUndefined();
  });

  it('drops a feature and its row from the control beside it', async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderModal([
      row('ta-1', { gloss: 'word', features: { Case: 'Nom', Number: 'Sg' } }),
      row('ta-2', { gloss: 'speech' }),
    ]);
    await user.click(screen.getAllByTestId('catalog-merge-check')[1]);

    await user.click(screen.getByTestId('catalog-merge-drop-feature-Case'));

    expect(screen.queryByTestId('catalog-merge-master-feature-Case')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('catalog-merge-confirm'));
    expect(onConfirm.mock.calls[0][2].features).toEqual({ Number: 'Sg' });
  });

  it('drops a feature that was added in this panel', async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderModal([
      row('ta-1', { gloss: 'word' }),
      row('ta-2', { gloss: 'speech' }),
    ]);
    await user.click(screen.getAllByTestId('catalog-merge-check')[1]);
    await user.click(screen.getByTestId('catalog-merge-feature-add'));
    await user.type(screen.getByTestId('catalog-merge-feature-name-new-1'), 'Case');
    await user.type(screen.getByTestId('catalog-merge-master-feature-new-1'), 'Nom');

    await user.click(screen.getByTestId('catalog-merge-drop-feature-new-1'));

    expect(screen.queryByTestId('catalog-merge-master-feature-new-1')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('catalog-merge-confirm'));
    expect(onConfirm.mock.calls[0][2].features).toBeUndefined();
  });

  it('adds an empty row for the reader to name a feature in', async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderModal([
      row('ta-1', { gloss: 'word' }),
      row('ta-2', { gloss: 'speech' }),
    ]);
    await user.click(screen.getAllByTestId('catalog-merge-check')[1]);

    await user.click(screen.getByTestId('catalog-merge-feature-add'));
    await user.type(screen.getByTestId('catalog-merge-feature-name-new-1'), 'Case');
    await user.type(screen.getByTestId('catalog-merge-master-feature-new-1'), 'Nom');

    await user.click(screen.getByTestId('catalog-merge-confirm'));
    expect(onConfirm.mock.calls[0][2].features).toEqual({ Case: 'Nom' });
  });

  it('keeps an added row standing while it is still empty', async () => {
    const user = userEvent.setup();
    renderModal([row('ta-1', { gloss: 'word' }), row('ta-2', { gloss: 'speech' })]);

    await user.click(screen.getByTestId('catalog-merge-feature-add'));

    expect(screen.getByTestId('catalog-merge-feature-name-new-1')).toHaveValue('');
    expect(screen.getByTestId('catalog-merge-master-feature-new-1')).toHaveValue('');
  });

  it('fills the confidence from the highest-ranked analysis in the merge carrying one', async () => {
    const user = userEvent.setup();
    renderModal([
      row('ta-1', { gloss: 'word' }),
      row('ta-2', { gloss: 'speech', confidence: 'high' }),
    ]);

    await user.click(screen.getAllByTestId('catalog-merge-check')[1]);

    expect(screen.getByTestId('catalog-merge-master-confidence')).toHaveTextContent('high');
  });

  it('records the confidence the reader picks', async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderModal([
      row('ta-1', { gloss: 'word', confidence: 'high' }),
      row('ta-2', { gloss: 'speech' }),
    ]);
    await user.click(screen.getAllByTestId('catalog-merge-check')[1]);

    await user.click(screen.getByTestId('catalog-merge-confidence-guess'));
    await user.click(screen.getByTestId('catalog-merge-confirm'));

    expect(onConfirm.mock.calls[0][2].confidence).toBe('guess');
  });

  it('records no confidence once the reader takes it to none', async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderModal([
      row('ta-1', { gloss: 'word', confidence: 'high' }),
      row('ta-2', { gloss: 'speech', confidence: 'low' }),
    ]);
    await user.click(screen.getAllByTestId('catalog-merge-check')[1]);

    await user.click(screen.getByTestId('catalog-merge-confidence-none'));
    await user.click(screen.getByTestId('catalog-merge-confirm'));

    expect(onConfirm.mock.calls[0][2].confidence).toBeUndefined();
  });

  it('takes an edited confidence back to what the merged analyses derive', async () => {
    const user = userEvent.setup();
    renderModal([
      row('ta-1', { gloss: 'word', confidence: 'high' }),
      row('ta-2', { gloss: 'speech' }),
    ]);
    await user.click(screen.getByTestId('catalog-merge-confidence-guess'));

    await user.click(screen.getByTestId('catalog-merge-revert-confidence'));

    expect(screen.getByTestId('catalog-merge-master-confidence')).toHaveTextContent('high');
  });

  it('commits the breakdown, morpheme glosses, features and confidence the master settled', async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderModal([
      row('ta-1', { gloss: 'word' }),
      row('ta-2', { gloss: 'speech' }),
    ]);
    await user.click(screen.getAllByTestId('catalog-merge-check')[1]);

    const breakdown = screen.getByTestId('catalog-merge-master-morphemes');
    await user.type(breakdown, 'λόγ ος');
    await user.type(screen.getAllByTestId('catalog-merge-master-morpheme-gloss')[0], 'say');
    await user.click(screen.getByTestId('catalog-merge-feature-add'));
    await user.type(screen.getByTestId('catalog-merge-feature-name-new-1'), 'Case');
    await user.type(screen.getByTestId('catalog-merge-master-feature-new-1'), 'Nom');
    await user.click(screen.getByTestId('catalog-merge-confidence-medium'));
    await user.click(screen.getByTestId('catalog-merge-confirm'));

    const content = onConfirm.mock.calls[0][2];
    expect(content.morphemes.map((m: MorphemeAnalysis) => m.form)).toEqual(['λόγ', 'ος']);
    expect(content.morphemes[0].gloss).toEqual({ en: 'say' });
    expect(content.features).toEqual({ Case: 'Nom' });
    expect(content.confidence).toBe('medium');
  });

  it('takes the breakdown, features and confidence back with every other edited field', async () => {
    const user = userEvent.setup();
    renderModal([
      row('ta-1', {
        gloss: 'word',
        morphemes: [morpheme('m-1', 'λόγος', 'word')],
        features: { Case: 'Nom' },
        confidence: 'high',
      }),
      row('ta-2', { gloss: 'speech' }),
    ]);

    const breakdown = screen.getByTestId('catalog-merge-master-morphemes');
    await user.clear(breakdown);
    await user.type(breakdown, 'λόγ ος');
    await user.clear(screen.getByTestId('catalog-merge-master-feature-Case'));
    await user.click(screen.getByTestId('catalog-merge-confidence-guess'));

    await user.click(screen.getByTestId('catalog-merge-reset'));

    expect(screen.getByTestId('catalog-merge-master-morphemes')).toHaveValue('λόγος');
    expect(screen.getByTestId('catalog-merge-master-feature-Case')).toHaveValue('Nom');
    expect(screen.getByTestId('catalog-merge-master-confidence')).toHaveTextContent('high');
  });
});

describe('dropIndex', () => {
  // Until the reader moves something, no analysis has been rearranged — so this is the state every
  // first drag resolves against.
  it('resolves a drop on an analysis the reader has not yet rearranged', () => {
    expect(dropIndex(['ta-1', 'ta-2', 'ta-3', 'ta-4'], 'ta-4')).toBe(3);
  });

  it('resolves a drop on the analysis heading the listing', () => {
    expect(dropIndex(['ta-1', 'ta-2', 'ta-3'], 'ta-1')).toBe(0);
  });

  it('reports no place for a drop on something the listing does not hold', () => {
    expect(dropIndex(['ta-1', 'ta-2'], 'ta-9')).toBeUndefined();
  });
});
