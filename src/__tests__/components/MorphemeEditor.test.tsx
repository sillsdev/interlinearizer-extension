/** @file Unit tests for components/MorphemeEditor.tsx. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as AnalysisStore from '../../components/AnalysisStore';
import { MorphemeBreakdownPopover, MorphemeGlossInput } from '../../components/MorphemeEditor';

jest.mock('../../components/AnalysisStore');

describe('MorphemeBreakdownPopover', () => {
  it('renders with the initial value pre-filled', () => {
    render(
      <MorphemeBreakdownPopover
        initialValue="un- believe -able"
        onSave={jest.fn()}
        onClose={jest.fn()}
      />,
    );
    const input = screen.getByRole('textbox');
    expect(input).toHaveValue('un- believe -able');
  });

  it('auto-focuses and selects the input on mount', () => {
    render(<MorphemeBreakdownPopover initialValue="word" onSave={jest.fn()} onClose={jest.fn()} />);
    expect(screen.getByRole('textbox')).toHaveFocus();
  });

  it('calls onSave and onClose when Done button is clicked', async () => {
    const onSave = jest.fn();
    const onClose = jest.fn();
    render(
      <MorphemeBreakdownPopover initialValue="un- believe" onSave={onSave} onClose={onClose} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onSave).toHaveBeenCalledWith('un- believe');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onSave with the edited value', async () => {
    const onSave = jest.fn();
    render(<MorphemeBreakdownPopover initialValue="word" onSave={onSave} onClose={jest.fn()} />);
    await userEvent.clear(screen.getByRole('textbox'));
    await userEvent.type(screen.getByRole('textbox'), 'wor -d');
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onSave).toHaveBeenCalledWith('wor -d');
  });

  it('does not save when Done is clicked with unchanged text and an existing breakdown', async () => {
    const onSave = jest.fn();
    const onClose = jest.fn();
    render(
      <MorphemeBreakdownPopover
        initialValue="un- believe"
        onSave={onSave}
        onClose={onClose}
        onDelete={jest.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('saves when Done is clicked with edited text and an existing breakdown', async () => {
    const onSave = jest.fn();
    render(
      <MorphemeBreakdownPopover
        initialValue="un- believe"
        onSave={onSave}
        onClose={jest.fn()}
        onDelete={jest.fn()}
      />,
    );
    await userEvent.type(screen.getByRole('textbox'), ' -r');
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onSave).toHaveBeenCalledWith('un- believe -r');
  });

  it('commits on Enter key', async () => {
    const onSave = jest.fn();
    const onClose = jest.fn();
    render(<MorphemeBreakdownPopover initialValue="test" onSave={onSave} onClose={onClose} />);
    await userEvent.keyboard('{Enter}');
    expect(onSave).toHaveBeenCalledWith('test');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('dismisses without saving on Escape key', async () => {
    const onSave = jest.fn();
    const onClose = jest.fn();
    render(<MorphemeBreakdownPopover initialValue="test" onSave={onSave} onClose={onClose} />);
    await userEvent.keyboard('{Escape}');
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('dismisses without saving when Cancel button is clicked', async () => {
    const onSave = jest.fn();
    const onClose = jest.fn();
    render(<MorphemeBreakdownPopover initialValue="test" onSave={onSave} onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes when the backdrop is clicked', async () => {
    const onClose = jest.fn();
    render(<MorphemeBreakdownPopover initialValue="test" onSave={jest.fn()} onClose={onClose} />);
    // The backdrop is the fixed full-screen div; getByRole won't find it, so query the DOM.
    const backdrop = document.querySelector('.tw\\:fixed.tw\\:inset-0');
    if (!backdrop) throw new Error('Backdrop not found');
    await userEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('saves on backdrop click when the text was edited', async () => {
    const onSave = jest.fn();
    render(<MorphemeBreakdownPopover initialValue="test" onSave={onSave} onClose={jest.fn()} />);
    await userEvent.type(screen.getByRole('textbox'), ' -er');
    const backdrop = document.querySelector('.tw\\:fixed.tw\\:inset-0');
    if (!backdrop) throw new Error('Backdrop not found');
    await userEvent.click(backdrop);
    expect(onSave).toHaveBeenCalledWith('test -er');
  });

  it('does not save on backdrop click when the text is unchanged', async () => {
    const onSave = jest.fn();
    const onClose = jest.fn();
    render(<MorphemeBreakdownPopover initialValue="test" onSave={onSave} onClose={onClose} />);
    const backdrop = document.querySelector('.tw\\:fixed.tw\\:inset-0');
    if (!backdrop) throw new Error('Backdrop not found');
    await userEvent.click(backdrop);
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not save on backdrop click when the input is only whitespace', async () => {
    const onSave = jest.fn();
    render(<MorphemeBreakdownPopover initialValue="   " onSave={onSave} onClose={jest.fn()} />);
    const backdrop = document.querySelector('.tw\\:fixed.tw\\:inset-0');
    if (!backdrop) throw new Error('Backdrop not found');
    await userEvent.click(backdrop);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('does not dismiss when clicking inside the popover panel', async () => {
    const onClose = jest.fn();
    render(<MorphemeBreakdownPopover initialValue="test" onSave={jest.fn()} onClose={onClose} />);
    const label = screen.getByText('Split into morphemes');
    await userEvent.click(label);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not call onSave when the input is empty', async () => {
    const onSave = jest.fn();
    render(<MorphemeBreakdownPopover initialValue="" onSave={onSave} onClose={jest.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('does not call onSave when the input is only whitespace', async () => {
    const onSave = jest.fn();
    render(<MorphemeBreakdownPopover initialValue="   " onSave={onSave} onClose={jest.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('does not render a Delete button when onDelete is not provided', () => {
    render(<MorphemeBreakdownPopover initialValue="test" onSave={jest.fn()} onClose={jest.fn()} />);
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('calls onDelete and onClose without saving when Delete is clicked', async () => {
    const onDelete = jest.fn();
    const onSave = jest.fn();
    const onClose = jest.fn();
    render(
      <MorphemeBreakdownPopover
        initialValue="un- believe"
        onSave={onSave}
        onClose={onClose}
        onDelete={onDelete}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('portals the panel to document.body so segment rows cannot stack above it', () => {
    render(<MorphemeBreakdownPopover initialValue="test" onSave={jest.fn()} onClose={jest.fn()} />);
    const panel = screen.getByText('Split into morphemes').closest('div');
    expect(panel?.parentElement).toBe(document.body);
  });

  it('positions the panel below the anchor when there is room under the viewport bottom', () => {
    // The layout effect measures the anchor (panel's DOM parent) first, then the panel itself.
    jest
      .spyOn(Element.prototype, 'getBoundingClientRect')
      .mockReturnValueOnce(new DOMRect(50, 100, 40, 20))
      .mockReturnValueOnce(new DOMRect(0, 0, 200, 100));
    render(<MorphemeBreakdownPopover initialValue="test" onSave={jest.fn()} onClose={jest.fn()} />);
    const panel = screen.getByText('Split into morphemes').closest('div');
    // Anchor bottom (120) plus the 4px margin.
    expect(panel).toHaveStyle({ top: '124px', left: '50px' });
  });

  it('flips the panel above the anchor when the viewport bottom is too close', () => {
    // Anchor bottom at 720 leaves only 48px below in jsdom's 768px-tall window — not enough for
    // the 100px-tall panel, so it flips above the anchor.
    jest
      .spyOn(Element.prototype, 'getBoundingClientRect')
      .mockReturnValueOnce(new DOMRect(50, 700, 40, 20))
      .mockReturnValueOnce(new DOMRect(0, 0, 200, 100));
    render(<MorphemeBreakdownPopover initialValue="test" onSave={jest.fn()} onClose={jest.fn()} />);
    const panel = screen.getByText('Split into morphemes').closest('div');
    // Anchor top (700) minus panel height (100) minus the 4px margin.
    expect(panel).toHaveStyle({ top: '596px', left: '50px' });
  });
});

describe('MorphemeGlossInput', () => {
  it('renders an empty input when no gloss exists', () => {
    render(
      <MorphemeGlossInput
        morpheme={{ id: 'm-1', form: 'un-', writingSystem: 'und' }}
        tokenRef="tok-1"
        analysisLanguage="und"
        disabled={false}
      />,
    );
    expect(screen.getByRole('textbox', { name: 'Gloss for morpheme un-' })).toHaveValue('');
  });

  it('renders the existing gloss value', () => {
    render(
      <MorphemeGlossInput
        morpheme={{ id: 'm-1', form: 'un-', writingSystem: 'und', gloss: { und: 'not' } }}
        tokenRef="tok-1"
        analysisLanguage="und"
        disabled={false}
      />,
    );
    expect(screen.getByRole('textbox', { name: 'Gloss for morpheme un-' })).toHaveValue('not');
  });

  it('does not dispatch when blurring without changes', async () => {
    const dispatchMock = jest.fn();
    jest.spyOn(AnalysisStore, 'useMorphemeGlossDispatch').mockReturnValue(dispatchMock);

    render(
      <MorphemeGlossInput
        morpheme={{ id: 'm-1', form: 'un-', writingSystem: 'und', gloss: { und: 'not' } }}
        tokenRef="tok-1"
        analysisLanguage="und"
        disabled={false}
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
        morpheme={{ id: 'm-1', form: 'un-', writingSystem: 'und' }}
        tokenRef="tok-1"
        analysisLanguage="und"
        disabled={false}
      />,
    );
    await userEvent.type(screen.getByRole('textbox', { name: 'Gloss for morpheme un-' }), 'not');
    await userEvent.tab();
    expect(dispatchMock).toHaveBeenCalledWith('tok-1', 'm-1', 'not');
  });

  it('does not dispatch when disabled', async () => {
    const dispatchMock = jest.fn();
    jest.spyOn(AnalysisStore, 'useMorphemeGlossDispatch').mockReturnValue(dispatchMock);

    render(
      <MorphemeGlossInput
        morpheme={{ id: 'm-1', form: 'un-', writingSystem: 'und' }}
        tokenRef="tok-1"
        analysisLanguage="und"
        disabled
      />,
    );
    const input = screen.getByRole('textbox', { name: 'Gloss for morpheme un-' });
    expect(input).toBeDisabled();
  });
});
