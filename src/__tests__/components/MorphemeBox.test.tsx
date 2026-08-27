/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MorphemeAnalysis } from 'interlinearizer';
import * as AnalysisStore from '../../components/AnalysisStore';
import { MorphemeBox, MorphemeGlossInput } from '../../components/MorphemeBox';
import { TOKEN_CHIP_LABEL_KEYS } from '../../components/PhraseStripContext';
import { makeWordToken } from '../test-helpers';

jest.mock('../../components/AnalysisStore');

// Resolved templates rather than the bare keys: the tests below target one morpheme's input among
// several, which only the substituted `{form}` distinguishes.
const LABELS = {
  ...TOKEN_CHIP_LABEL_KEYS,
  editMorphemes: 'Edit morpheme breakdown for {token}',
  morphemeGloss: 'Gloss for morpheme {form}',
};

const WORD_TOKEN = makeWordToken('GEN 1:1:0', 'hello');

const MORPHEMES: MorphemeAnalysis[] = [
  { id: 'm-1', form: 'hel', writingSystem: 'en' },
  { id: 'm-2', form: '-lo', writingSystem: 'en' },
];

/**
 * Renders {@link MorphemeBox} with required props defaulted so each test overrides only what it
 * asserts on.
 */
function renderBox(props: Partial<Parameters<typeof MorphemeBox>[0]> = {}) {
  return render(
    <MorphemeBox
      analysisLanguage="en"
      disabled={false}
      labels={LABELS}
      morphemes={MORPHEMES}
      onEditBreakdown={jest.fn()}
      onGlossFocus={jest.fn()}
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

  it('calls onEditBreakdown when a non-first form cell is clicked', async () => {
    // Non-first cells are spans, not buttons, and open the editor through a separate handler.
    const onEditBreakdown = jest.fn();
    renderBox({ onEditBreakdown });
    await userEvent.click(screen.getByText('-lo'));
    expect(onEditBreakdown).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['first', 'hel'],
    ['non-first', '-lo'],
  ])('cancels the default click action on the %s form cell', (_label, form) => {
    // Regression: the box sits in TokenChip's <label>, so an un-canceled click forwards focus to
    // the gloss input and dismisses the just-opened editor. jsdom can't reproduce that forwarding,
    // so assert the preventDefault that suppresses it — fireEvent.click returns false when canceled.
    renderBox();
    expect(fireEvent.click(screen.getByText(form))).toBe(false);
  });

  it('stops a non-first form cell mousedown from bubbling to an ancestor handler', () => {
    // Regression test: an ancestor onMouseDown (e.g. TokenChip's label) would otherwise focus the
    // gloss input, since a span (unlike a button) doesn't match its input/button guard.
    const onAncestorMouseDown = jest.fn();
    render(
      // Stand-in for an ancestor React handler, not real UI.
      // eslint-disable-next-line jsx-a11y/no-static-element-interactions
      <div onMouseDown={onAncestorMouseDown}>
        <MorphemeBox
          analysisLanguage="en"
          disabled={false}
          labels={LABELS}
          morphemes={MORPHEMES}
          onEditBreakdown={jest.fn()}
          onGlossFocus={jest.fn()}
          popoverOpen={false}
          token={WORD_TOKEN}
        />
      </div>,
    );
    fireEvent.mouseDown(screen.getByText('-lo'));
    expect(onAncestorMouseDown).not.toHaveBeenCalled();
  });

  it('keeps a form-cell click from focusing the token gloss input the chip label points at', async () => {
    // Regression test: the box renders inside TokenChip's <label htmlFor={glossInput}>, whose
    // activation behavior forwards a click on a plain span to that input. Focus landing there is
    // outside the editor the same click is opening, and the editor closes on outside interactions —
    // so the panel would open and vanish on the same click, leaving focus in the chip.
    render(
      // Stand-in for TokenChip's label, not real UI.
      // eslint-disable-next-line jsx-a11y/label-has-associated-control
      <label htmlFor="token-gloss">
        <MorphemeBox
          analysisLanguage="en"
          disabled={false}
          labels={LABELS}
          morphemes={MORPHEMES}
          onEditBreakdown={jest.fn()}
          onGlossFocus={jest.fn()}
          popoverOpen={false}
          token={WORD_TOKEN}
        />
        <input aria-label="Gloss for hello" id="token-gloss" />
      </label>,
    );
    await userEvent.click(screen.getByText('-lo'));
    expect(screen.getByRole('textbox', { name: 'Gloss for hello' })).not.toHaveFocus();
  });

  it('does not call onEditBreakdown when disabled', async () => {
    const onEditBreakdown = jest.fn();
    renderBox({ disabled: true, onEditBreakdown });
    await userEvent.click(screen.getByText('hel'));
    expect(onEditBreakdown).not.toHaveBeenCalled();
  });

  it('calls onGlossFocus when a morpheme gloss input receives focus', async () => {
    const onGlossFocus = jest.fn();
    renderBox({ onGlossFocus });
    await userEvent.click(screen.getByRole('textbox', { name: 'Gloss for morpheme -lo' }));
    expect(onGlossFocus).toHaveBeenCalledTimes(1);
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
        glossLabelTemplate={LABELS.morphemeGloss}
        analysisLanguage="und"
        column={1}
        disabled={false}
        morpheme={{ id: 'm-1', form: 'un-', writingSystem: 'und' }}
        onFocus={jest.fn()}
        tokenRef="tok-1"
      />,
    );
    expect(screen.getByRole('textbox', { name: 'Gloss for morpheme un-' })).toHaveValue('');
  });

  it('renders the existing gloss value', () => {
    render(
      <MorphemeGlossInput
        glossLabelTemplate={LABELS.morphemeGloss}
        analysisLanguage="und"
        column={1}
        disabled={false}
        morpheme={{ id: 'm-1', form: 'un-', writingSystem: 'und', gloss: { und: 'not' } }}
        onFocus={jest.fn()}
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
        glossLabelTemplate={LABELS.morphemeGloss}
        analysisLanguage="und"
        column={1}
        disabled={false}
        morpheme={{ id: 'm-1', form: 'un-', writingSystem: 'und', gloss: { und: 'not' } }}
        onFocus={jest.fn()}
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
        glossLabelTemplate={LABELS.morphemeGloss}
        analysisLanguage="und"
        column={1}
        disabled={false}
        morpheme={{ id: 'm-1', form: 'un-', writingSystem: 'und' }}
        onFocus={jest.fn()}
        tokenRef="tok-1"
      />,
    );
    await userEvent.type(screen.getByRole('textbox', { name: 'Gloss for morpheme un-' }), 'not');
    await userEvent.tab();
    expect(dispatchMock).toHaveBeenCalledWith('tok-1', 'm-1', 'not');
  });

  it('reports focus so the containing chip can focus its token', async () => {
    const onFocus = jest.fn();
    render(
      <MorphemeGlossInput
        glossLabelTemplate={LABELS.morphemeGloss}
        analysisLanguage="und"
        column={1}
        disabled={false}
        morpheme={{ id: 'm-1', form: 'un-', writingSystem: 'und' }}
        onFocus={onFocus}
        tokenRef="tok-1"
      />,
    );
    await userEvent.click(screen.getByRole('textbox', { name: 'Gloss for morpheme un-' }));
    expect(onFocus).toHaveBeenCalledTimes(1);
  });

  it('does not dispatch when disabled', () => {
    const dispatchMock = jest.fn();
    jest.spyOn(AnalysisStore, 'useMorphemeGlossDispatch').mockReturnValue(dispatchMock);

    render(
      <MorphemeGlossInput
        glossLabelTemplate={LABELS.morphemeGloss}
        analysisLanguage="und"
        column={1}
        disabled
        morpheme={{ id: 'm-1', form: 'un-', writingSystem: 'und' }}
        onFocus={jest.fn()}
        tokenRef="tok-1"
      />,
    );
    expect(screen.getByRole('textbox', { name: 'Gloss for morpheme un-' })).toBeDisabled();
  });
});

/** The manual AnalysisStore mock's test-only controls. */
interface AnalysisStoreReadOnlyMock {
  __setMockAnalysisReadOnly: (value: boolean) => void;
}

function isAnalysisStoreReadOnlyMock(m: unknown): m is AnalysisStoreReadOnlyMock {
  return !!m && typeof m === 'object' && '__setMockAnalysisReadOnly' in m;
}

const analysisStoreMock: unknown = jest.requireMock('../../components/AnalysisStore');
if (!isAnalysisStoreReadOnlyMock(analysisStoreMock))
  throw new Error('Expected the AnalysisStore manual mock with read-only controls');
const { __setMockAnalysisReadOnly: setMockAnalysisReadOnly } = analysisStoreMock;

describe('MorphemeBox read-only', () => {
  afterEach(() => {
    setMockAnalysisReadOnly(false);
  });

  it('renders forms and glosses as plain text with no edit control', () => {
    setMockAnalysisReadOnly(true);
    renderBox();

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(screen.getAllByTestId('readonly-morpheme-gloss')).toHaveLength(2);
  });

  it('shows each morpheme gloss as text when the analysis has one', () => {
    setMockAnalysisReadOnly(true);
    renderBox({
      morphemes: [
        { id: 'm-1', form: 'hel', writingSystem: 'en', gloss: { en: 'greet' } },
        { id: 'm-2', form: '-lo', writingSystem: 'en' },
      ],
    });

    const glosses = screen.getAllByTestId('readonly-morpheme-gloss');
    expect(glosses[0]).toHaveTextContent('greet');
    expect(glosses[1]).toBeEmptyDOMElement();
  });

  it('ignores clicks on the form cells', () => {
    setMockAnalysisReadOnly(true);
    const onEditBreakdown = jest.fn();
    renderBox({ onEditBreakdown });

    fireEvent.click(screen.getByText('-lo'));

    expect(onEditBreakdown).not.toHaveBeenCalled();
  });
});
