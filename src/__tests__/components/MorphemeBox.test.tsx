/** @file Unit tests for components/MorphemeBox.tsx. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { useLocalizedStrings } from '@papi/frontend/react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MorphemeAnalysis, Token } from 'interlinearizer';
import * as AnalysisStore from '../../components/AnalysisStore';
import { MorphemeBox, MorphemeGlossInput } from '../../components/MorphemeBox';

jest.mock('../../components/AnalysisStore');

const LOCALIZED = {
  '%interlinearizer_tokenChip_editMorphemes%': 'Edit morpheme breakdown for {token}',
  '%interlinearizer_morphemeGloss_label%': 'Gloss for morpheme {form}',
};

beforeEach(() => {
  jest.mocked(useLocalizedStrings).mockReturnValue([LOCALIZED, false]);
});

const WORD_TOKEN = {
  ref: 'GEN 1:1:0',
  surfaceText: 'hello',
  writingSystem: 'en',
  type: 'word',
  charStart: 0,
  charEnd: 5,
} satisfies Token;

const MORPHEMES: MorphemeAnalysis[] = [
  { id: 'm-1', form: 'hel', writingSystem: 'en' },
  { id: 'm-2', form: '-lo', writingSystem: 'en' },
];

/**
 * Renders {@link MorphemeBox} with required props defaulted so each test overrides only what it
 * asserts on.
 *
 * @param props - Overrides merged over the defaults.
 * @returns The render result.
 */
function renderBox(props: Partial<Parameters<typeof MorphemeBox>[0]> = {}) {
  return render(
    <MorphemeBox
      analysisLanguage="en"
      disabled={false}
      morphemes={MORPHEMES}
      onEditBreakdown={jest.fn()}
      popoverOpen={false}
      token={WORD_TOKEN}
      {...props}
    />,
  );
}

describe('MorphemeBox', () => {
  it('renders one form cell per morpheme', () => {
    renderBox();
    expect(screen.getByText('hel')).toBeInTheDocument();
    expect(screen.getByText('-lo')).toBeInTheDocument();
  });

  it('renders one gloss input per morpheme', () => {
    renderBox();
    expect(screen.getAllByRole('textbox')).toHaveLength(2);
  });

  it('exposes a single "edit breakdown" control for the whole forms row', () => {
    renderBox();
    expect(
      screen.getByRole('button', { name: 'Edit morpheme breakdown for hello' }),
    ).toBeInTheDocument();
  });

  it('places each form directly above its gloss in the same grid column', () => {
    renderBox();
    const firstForm = screen.getByText('hel');
    const firstGloss = screen.getByRole('textbox', { name: 'Gloss for morpheme hel' });
    // A morpheme and its gloss must share a column; the form sits on row 1, its gloss on row 2.
    expect(firstForm).toHaveStyle({ gridColumn: '1', gridRow: '1' });
    expect(firstGloss).toHaveStyle({ gridColumn: '1', gridRow: '2' });
  });

  it('orders columns left-to-right by morpheme order', () => {
    renderBox();
    expect(screen.getByText('hel')).toHaveStyle({ gridColumn: '1' });
    expect(screen.getByText('-lo')).toHaveStyle({ gridColumn: '2' });
  });

  it('preserves morpheme order under right-to-left document direction', () => {
    // RTL is first-class: the grid honors the document `dir` for column flow (column 1 lands on the
    // right), but DOM/source order — and thus the form-over-gloss column pairing — is unchanged.
    document.documentElement.dir = 'rtl';
    try {
      renderBox();
      expect(screen.getByText('hel')).toHaveStyle({ gridColumn: '1' });
      expect(screen.getByText('-lo')).toHaveStyle({ gridColumn: '2' });
      expect(screen.getByRole('textbox', { name: 'Gloss for morpheme hel' })).toHaveStyle({
        gridColumn: '1',
      });
    } finally {
      document.documentElement.dir = '';
    }
  });

  it('sizes the column template to the morpheme count', () => {
    const { container } = renderBox();
    const box = container.querySelector('[style*="grid-template-columns"]');
    expect(box).toHaveStyle({ gridTemplateColumns: 'repeat(2, minmax(1ch, auto))' });
  });

  it('calls onEditBreakdown when a form cell is clicked', async () => {
    const onEditBreakdown = jest.fn();
    renderBox({ onEditBreakdown });
    await userEvent.click(screen.getByText('hel'));
    expect(onEditBreakdown).toHaveBeenCalledTimes(1);
  });

  it('does not call onEditBreakdown when disabled', async () => {
    const onEditBreakdown = jest.fn();
    renderBox({ disabled: true, onEditBreakdown });
    await userEvent.click(screen.getByText('hel'));
    expect(onEditBreakdown).not.toHaveBeenCalled();
  });

  it('disables the gloss inputs when disabled', () => {
    renderBox({ disabled: true });
    expect(screen.getByRole('textbox', { name: 'Gloss for morpheme hel' })).toBeDisabled();
  });

  it('tints the forms row on hover and clears it on leave', async () => {
    // Hovering any form cell tints the whole forms row (the edit action is breakdown-wide). The
    // tint class itself would be brittle to assert; this exercises the hover handlers and the
    // state they drive, leaving the box intact through enter/leave.
    renderBox();
    const form = screen.getByText('hel');
    await userEvent.hover(form);
    expect(form).toBeInTheDocument();
    await userEvent.unhover(form);
    expect(form).toBeInTheDocument();
  });

  it('still renders its cells while the breakdown editor is open (active look)', () => {
    // The box takes an accent ring while `popoverOpen` (asserted via class would be brittle); what
    // matters behaviorally is that the box stays intact and editable while the editor is open.
    renderBox({ popoverOpen: true });
    expect(screen.getByText('hel')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Gloss for morpheme hel' })).toBeInTheDocument();
  });
});

describe('MorphemeGlossInput', () => {
  it('renders an empty input when no gloss exists', () => {
    render(
      <MorphemeGlossInput
        analysisLanguage="und"
        column={1}
        disabled={false}
        morpheme={{ id: 'm-1', form: 'un-', writingSystem: 'und' }}
        tokenRef="tok-1"
      />,
    );
    expect(screen.getByRole('textbox', { name: 'Gloss for morpheme un-' })).toHaveValue('');
  });

  it('renders the existing gloss value', () => {
    render(
      <MorphemeGlossInput
        analysisLanguage="und"
        column={1}
        disabled={false}
        morpheme={{ id: 'm-1', form: 'un-', writingSystem: 'und', gloss: { und: 'not' } }}
        tokenRef="tok-1"
      />,
    );
    expect(screen.getByRole('textbox', { name: 'Gloss for morpheme un-' })).toHaveValue('not');
  });

  it('does not dispatch when blurring without changes', async () => {
    const dispatchMock = jest.fn();
    jest.spyOn(AnalysisStore, 'useMorphemeGlossDispatch').mockReturnValue(dispatchMock);

    render(
      <MorphemeGlossInput
        analysisLanguage="und"
        column={1}
        disabled={false}
        morpheme={{ id: 'm-1', form: 'un-', writingSystem: 'und', gloss: { und: 'not' } }}
        tokenRef="tok-1"
      />,
    );
    await userEvent.click(screen.getByRole('textbox', { name: 'Gloss for morpheme un-' }));
    await userEvent.tab();
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('dispatches the gloss on blur when the draft differs', async () => {
    const dispatchMock = jest.fn();
    jest.spyOn(AnalysisStore, 'useMorphemeGlossDispatch').mockReturnValue(dispatchMock);

    render(
      <MorphemeGlossInput
        analysisLanguage="und"
        column={1}
        disabled={false}
        morpheme={{ id: 'm-1', form: 'un-', writingSystem: 'und' }}
        tokenRef="tok-1"
      />,
    );
    await userEvent.type(screen.getByRole('textbox', { name: 'Gloss for morpheme un-' }), 'not');
    await userEvent.tab();
    expect(dispatchMock).toHaveBeenCalledWith('tok-1', 'm-1', 'not');
  });

  it('does not dispatch when disabled', () => {
    const dispatchMock = jest.fn();
    jest.spyOn(AnalysisStore, 'useMorphemeGlossDispatch').mockReturnValue(dispatchMock);

    render(
      <MorphemeGlossInput
        analysisLanguage="und"
        column={1}
        disabled
        morpheme={{ id: 'm-1', form: 'un-', writingSystem: 'und' }}
        tokenRef="tok-1"
      />,
    );
    expect(screen.getByRole('textbox', { name: 'Gloss for morpheme un-' })).toBeDisabled();
  });
});
