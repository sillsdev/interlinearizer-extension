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

  it('dismisses when the backdrop is clicked', async () => {
    const onClose = jest.fn();
    render(<MorphemeBreakdownPopover initialValue="test" onSave={jest.fn()} onClose={onClose} />);
    // The backdrop is the fixed full-screen div; getByRole won't find it, so query the DOM.
    const backdrop = document.querySelector('.tw\\:fixed.tw\\:inset-0');
    if (!backdrop) throw new Error('Backdrop not found');
    await userEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
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
