/** @file Unit tests for components/MorphemeEditor.tsx. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { useLocalizedStrings } from '@papi/frontend/react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import * as AnalysisStore from '../../components/AnalysisStore';
import { MorphemeBreakdownPopover, MorphemeGlossInput } from '../../components/MorphemeEditor';

jest.mock('../../components/AnalysisStore');

const LOCALIZED = {
  '%interlinearizer_morphemeEditor_splitLabel%': 'Split into morphemes',
  '%interlinearizer_morphemeEditor_delete%': 'Delete',
  '%interlinearizer_morphemeEditor_cancel%': 'Cancel',
  '%interlinearizer_morphemeEditor_done%': 'Done',
  '%interlinearizer_morphemeGloss_label%': 'Gloss for morpheme {form}',
};

beforeEach(() => {
  jest.mocked(useLocalizedStrings).mockReturnValue([LOCALIZED, false]);
});

/**
 * Renders {@link MorphemeBreakdownPopover} with the two structural props (`surfaceText`,
 * `glossInputId`) defaulted so each test only supplies what it asserts on.
 *
 * @param props - Overrides merged over the defaults; callers pass their own `onSave`/`onClose`
 *   spies.
 * @returns The render result.
 */
function renderPopover(props: Partial<ComponentProps<typeof MorphemeBreakdownPopover>> = {}) {
  return render(
    <MorphemeBreakdownPopover
      glossInputId="gloss-1"
      initialValue="test"
      onClose={jest.fn()}
      onSave={jest.fn()}
      surfaceText="word"
      {...props}
    />,
  );
}

describe('MorphemeBreakdownPopover', () => {
  it('renders with the initial value pre-filled', () => {
    renderPopover({ initialValue: 'un- believe -able' });
    const input = screen.getByRole('textbox');
    expect(input).toHaveValue('un- believe -able');
  });

  it('auto-focuses and selects the input on mount', () => {
    renderPopover({ initialValue: 'word' });
    expect(screen.getByRole('textbox')).toHaveFocus();
  });

  it('calls onSave and onClose when Done button is clicked', async () => {
    const onSave = jest.fn();
    const onClose = jest.fn();
    renderPopover({ initialValue: 'un- believe', onSave, onClose, surfaceText: 'unbelieve' });
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onSave).toHaveBeenCalledWith('un- believe');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onSave with the edited value', async () => {
    const onSave = jest.fn();
    renderPopover({ initialValue: 'word', onSave, surfaceText: 'word' });
    await userEvent.clear(screen.getByRole('textbox'));
    await userEvent.type(screen.getByRole('textbox'), 'wor -d');
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onSave).toHaveBeenCalledWith('wor -d');
  });

  it('does not save when Done is clicked with unchanged text and an existing breakdown', async () => {
    const onSave = jest.fn();
    const onClose = jest.fn();
    renderPopover({
      initialValue: 'un- believe',
      onSave,
      onClose,
      onDelete: jest.fn(),
      surfaceText: 'unbelieve',
    });
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('saves when Done is clicked with edited text and an existing breakdown', async () => {
    const onSave = jest.fn();
    renderPopover({
      initialValue: 'un- believe',
      onSave,
      onDelete: jest.fn(),
      surfaceText: 'unbelieve',
    });
    await userEvent.type(screen.getByRole('textbox'), ' -r');
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onSave).toHaveBeenCalledWith('un- believe -r');
  });

  it('commits a multi-morpheme breakdown on Enter key', async () => {
    const onSave = jest.fn();
    const onClose = jest.fn();
    renderPopover({ initialValue: 'te -st', onSave, onClose, surfaceText: 'test' });
    await userEvent.keyboard('{Enter}');
    expect(onSave).toHaveBeenCalledWith('te -st');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('dismisses without saving on Escape key', async () => {
    const onSave = jest.fn();
    const onClose = jest.fn();
    renderPopover({ initialValue: 'te -st', onSave, onClose, surfaceText: 'test' });
    await userEvent.keyboard('{Escape}');
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('dismisses without saving when Cancel button is clicked', async () => {
    const onSave = jest.fn();
    const onClose = jest.fn();
    renderPopover({ initialValue: 'te -st', onSave, onClose, surfaceText: 'test' });
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes without saving when interacting outside with unchanged text', async () => {
    const onSave = jest.fn();
    const onClose = jest.fn();
    renderPopover({ initialValue: 'te -st', onSave, onClose, surfaceText: 'test' });
    // The platform-bible-react mock exposes a sentinel button that fires onInteractOutside,
    // simulating a pointer interaction outside the popover.
    await userEvent.click(screen.getByTestId('popover-outside'));
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('saves on outside interaction when the text was edited', async () => {
    const onSave = jest.fn();
    renderPopover({ initialValue: 'test', onSave, surfaceText: 'whole' });
    await userEvent.type(screen.getByRole('textbox'), ' -er');
    await userEvent.click(screen.getByTestId('popover-outside'));
    expect(onSave).toHaveBeenCalledWith('test -er');
  });

  it('does not save on outside interaction when the input is only whitespace', async () => {
    const onSave = jest.fn();
    renderPopover({ initialValue: '   ', onSave });
    await userEvent.click(screen.getByTestId('popover-outside'));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('does not dismiss when clicking inside the popover panel', async () => {
    const onClose = jest.fn();
    renderPopover({ onClose });
    const label = screen.getByText('Split into morphemes');
    await userEvent.click(label);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('stops clicks inside the panel from reaching ancestor click handlers', async () => {
    // The panel is portaled to document.body, but React synthetic events bubble through the React
    // tree to the token chip and its phrase-selection click handlers; the panel must contain them.
    const ancestorClick = jest.fn();
    render(
      <div role="presentation" onClick={ancestorClick}>
        <MorphemeBreakdownPopover
          glossInputId="gloss-1"
          initialValue="test"
          onClose={jest.fn()}
          onSave={jest.fn()}
          surfaceText="word"
        />
      </div>,
    );
    await userEvent.click(screen.getByText('Split into morphemes'));
    expect(ancestorClick).not.toHaveBeenCalled();
  });

  it('stops mouse-downs inside the panel from reaching ancestor mouse-down handlers', () => {
    // A mouse-down that escaped the panel would reach the chip label's mouse-down handler, which
    // focuses the gloss input behind the popover and blurs the editor mid-edit.
    const ancestorMouseDown = jest.fn();
    render(
      <div role="presentation" onMouseDown={ancestorMouseDown}>
        <MorphemeBreakdownPopover
          glossInputId="gloss-1"
          initialValue="test"
          onClose={jest.fn()}
          onSave={jest.fn()}
          surfaceText="word"
        />
      </div>,
    );
    fireEvent.mouseDown(screen.getByText('Split into morphemes'));
    expect(ancestorMouseDown).not.toHaveBeenCalled();
  });

  it('disables Done when the input is only whitespace', () => {
    renderPopover({ initialValue: '   ' });
    expect(screen.getByRole('button', { name: 'Done' })).toBeDisabled();
  });

  it('does not save whitespace on Enter', async () => {
    const onSave = jest.fn();
    renderPopover({ initialValue: '  ', onSave, surfaceText: 'word' });
    await userEvent.keyboard('{Enter}');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('disables Done for a breakdown that is just the whole word as one morpheme', () => {
    renderPopover({ initialValue: 'word', surfaceText: 'word' });
    expect(screen.getByRole('button', { name: 'Done' })).toBeDisabled();
  });

  it('does not save a breakdown that is just the whole word as one morpheme on Enter', async () => {
    const onSave = jest.fn();
    renderPopover({ initialValue: 'word', onSave, surfaceText: 'word' });
    await userEvent.keyboard('{Enter}');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('does not render a Delete button when onDelete is not provided', () => {
    renderPopover();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('calls onDelete and onClose without saving when Delete is clicked', async () => {
    const onDelete = jest.fn();
    const onSave = jest.fn();
    const onClose = jest.fn();
    renderPopover({
      initialValue: 'un- believe',
      onSave,
      onClose,
      onDelete,
      surfaceText: 'unbelieve',
    });
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('renders inside the popover content panel', () => {
    // Positioning, portaling, and flipping are owned by the platform-bible-react Popover; this
    // only verifies the editor renders as the popover's content.
    renderPopover();
    const content = screen.getByTestId('popover-content');
    expect(content).toContainElement(screen.getByText('Split into morphemes'));
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
