/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { useLocalizedStrings } from '@papi/frontend/react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { MorphemeBreakdownPopover } from '../../components/MorphemeEditor';

jest.mock('../../components/AnalysisStore');

const LOCALIZED = {
  '%interlinearizer_morphemeEditor_splitLabel%': 'Split into morphemes',
  '%interlinearizer_morphemeEditor_reset%': 'Reset',
  '%interlinearizer_morphemeEditor_cancel%': 'Cancel',
  '%interlinearizer_morphemeEditor_done%': 'Done',
  '%interlinearizer_morphemeEditor_emptyHint%': 'Enter morpheme forms separated by spaces',
  '%interlinearizer_morphemeEditor_confirmResetPrompt%': 'Discard this breakdown and its glosses?',
  '%interlinearizer_morphemeEditor_confirmResetAction%': 'Reset',
  '%interlinearizer_morphemeGloss_label%': 'Gloss for morpheme {form}',
};

beforeEach(() => {
  jest.mocked(useLocalizedStrings).mockReturnValue([LOCALIZED, false]);
});

/**
 * Renders {@link MorphemeBreakdownPopover} with the two structural props (`surfaceText`,
 * `glossInputId`) defaulted so each test only supplies what it asserts on.
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

  it('auto-focuses and selects the input on open', () => {
    renderPopover({ initialValue: 'word' });
    const input = screen.getByRole('textbox');
    expect(input).toHaveFocus();
    // The popover's open auto-focus selects the value too, so a fresh keystroke replaces it.
    // Asserting the selection range catches a regression that suppresses that auto-focus.
    expect(input).toHaveProperty('selectionStart', 0);
    expect(input).toHaveProperty('selectionEnd', 'word'.length);
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
      onReset: jest.fn(),
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
      onReset: jest.fn(),
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
    // The platform-bible-react mock exposes a sentinel button that fires onPointerDownOutside,
    // simulating a pointer press outside the popover.
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
    // Start from a real word and edit it down to whitespace so the draft differs from initialValue
    // (isUnedited is false). This forces handleInteractOutside past the unedited guard into
    // handleSave, where the isEmpty check is what rejects the empty breakdown — the behavior this
    // test names. If isEmpty were removed, handleSave would call onSave and this fails.
    renderPopover({ initialValue: 'word', onSave, surfaceText: 'whole' });
    await userEvent.clear(screen.getByRole('textbox'));
    await userEvent.type(screen.getByRole('textbox'), '   ');
    await userEvent.click(screen.getByTestId('popover-outside'));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('dismisses on outside interaction when the input is only whitespace', async () => {
    // An outside click on a modal popover must always dismiss it. handleSave refuses to interpret
    // an empty draft and returns without closing, so handleInteractOutside has to close directly.
    const onClose = jest.fn();
    renderPopover({ initialValue: 'word', onClose, surfaceText: 'whole' });
    await userEvent.clear(screen.getByRole('textbox'));
    await userEvent.type(screen.getByRole('textbox'), '   ');
    await userEvent.click(screen.getByTestId('popover-outside'));
    expect(onClose).toHaveBeenCalledTimes(1);
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

  it('keeps Done enabled for an unedited draft', () => {
    // Done means "I'm finished here", not "commit": the panel always opens pre-filled, so
    // disabling it while unedited would leave a dead primary button on every open.
    renderPopover({ initialValue: 'word', surfaceText: 'word' });
    expect(screen.getByRole('button', { name: 'Done' })).toBeEnabled();
  });

  it('saves a single morpheme that differs from the surface text', async () => {
    // A one-form breakdown is a legitimate analysis when it normalizes the surface to an
    // underlying form; only a form equal to the surface text means "no segmentation".
    const onSave = jest.fn();
    renderPopover({ initialValue: 'running', onSave, onReset: jest.fn(), surfaceText: 'running' });
    await userEvent.clear(screen.getByRole('textbox'));
    await userEvent.type(screen.getByRole('textbox'), 'run');
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onSave).toHaveBeenCalledWith('run');
  });

  it('resets when the draft is edited down to the bare surface form', async () => {
    const onReset = jest.fn();
    const onSave = jest.fn();
    const onClose = jest.fn();
    renderPopover({
      initialValue: 'un- believe -able',
      onSave,
      onClose,
      onReset,
      surfaceText: 'unbelievable',
    });
    await userEvent.clear(screen.getByRole('textbox'));
    await userEvent.type(screen.getByRole('textbox'), 'unbelievable');
    await userEvent.keyboard('{Enter}');
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not reset an unedited whole-word draft on a token with no breakdown', async () => {
    // Without a breakdown the pre-fill already is the surface text, so committing is a no-op
    // dismissal rather than a request to remove something.
    const onSave = jest.fn();
    const onClose = jest.fn();
    renderPopover({ initialValue: 'word', onSave, onClose, surfaceText: 'word' });
    await userEvent.keyboard('{Enter}');
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not render a Reset button when onReset is not provided', () => {
    renderPopover();
    expect(screen.queryByRole('button', { name: 'Reset' })).not.toBeInTheDocument();
  });

  it('calls onReset and onClose without saving when Reset is clicked', async () => {
    const onReset = jest.fn();
    const onSave = jest.fn();
    const onClose = jest.fn();
    renderPopover({
      initialValue: 'un- believe',
      onSave,
      onClose,
      onReset,
      surfaceText: 'unbelieve',
    });
    await userEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('shows the format hint when the draft is empty', async () => {
    renderPopover({ initialValue: 'word' });
    await userEvent.clear(screen.getByRole('textbox'));
    expect(screen.getByTestId('morpheme-empty-hint')).toBeInTheDocument();
  });

  it('does not show the format hint when the draft is non-empty', () => {
    renderPopover({ initialValue: 'word' });
    expect(screen.queryByTestId('morpheme-empty-hint')).not.toBeInTheDocument();
  });

  it('renders inside the popover content panel', () => {
    // Positioning, portaling, and flipping are owned by the platform-bible-react Popover; this
    // only verifies the editor renders as the popover's content.
    renderPopover();
    const content = screen.getByTestId('popover-content');
    expect(content).toContainElement(screen.getByText('Split into morphemes'));
  });

  it('focuses the first morpheme gloss field of the chip when the popover closes', async () => {
    // The chip label holds the morpheme gloss inputs before the token gloss input; on close, focus
    // should land on the first morpheme gloss, scoped to this token's label via glossInputId.
    render(
      <label>
        <input aria-label="morpheme gloss" data-morpheme-gloss="true" />
        <input aria-label="token gloss" id="gloss-1" />
        <MorphemeBreakdownPopover
          glossInputId="gloss-1"
          initialValue="word"
          onClose={jest.fn()}
          onSave={jest.fn()}
          surfaceText="word"
        />
      </label>,
    );
    await userEvent.click(screen.getByTestId('popover-close'));
    expect(screen.getByRole('textbox', { name: 'morpheme gloss' })).toHaveFocus();
  });

  it('leaves focus alone when the popover was dismissed by a press outside it', async () => {
    // A press outside has already put focus where the user aimed it — typically another token they
    // clicked. Pulling focus back to this chip's first morpheme gloss would yank it out of that
    // token, so the close-focus redirect is skipped for this dismissal route.
    render(
      <>
        <label>
          <input aria-label="morpheme gloss" data-morpheme-gloss="true" />
          <input aria-label="token gloss" id="gloss-1" />
          <MorphemeBreakdownPopover
            glossInputId="gloss-1"
            initialValue="word"
            onClose={jest.fn()}
            onSave={jest.fn()}
            surfaceText="word"
          />
        </label>
        <input aria-label="another token gloss" />
      </>,
    );
    // fireEvent so the sentinels themselves never take focus: what matters is where the outside
    // press left focus, which is stood in for by focusing the other token's gloss directly.
    fireEvent.click(screen.getByTestId('popover-outside'));
    const elsewhere = screen.getByRole('textbox', { name: 'another token gloss' });
    elsewhere.focus();
    fireEvent.click(screen.getByTestId('popover-close'));
    expect(elsewhere).toHaveFocus();
  });

  describe('reset confirmation', () => {
    /**
     * Renders the popover on a glossed, solely-linked breakdown — the state in which a reset is
     * irreversible, so both reset routes confirm first.
     */
    function renderConfirming(
      props: Partial<ComponentProps<typeof MorphemeBreakdownPopover>> = {},
    ) {
      return renderPopover({
        initialValue: 'un- believe -able',
        needsResetConfirm: true,
        onReset: jest.fn(),
        surfaceText: 'unbelievable',
        ...props,
      });
    }

    it('asks before resetting when the Reset button is clicked', async () => {
      const onReset = jest.fn();
      const onClose = jest.fn();
      renderConfirming({ onReset, onClose });
      await userEvent.click(screen.getByRole('button', { name: 'Reset' }));
      expect(screen.getByTestId('morpheme-reset-confirm')).toBeInTheDocument();
      expect(onReset).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });

    it('asks before resetting when the draft is edited down to the bare surface form', async () => {
      const onReset = jest.fn();
      renderConfirming({ onReset });
      await userEvent.clear(screen.getByRole('textbox'));
      await userEvent.type(screen.getByRole('textbox'), 'unbelievable');
      await userEvent.keyboard('{Enter}');
      expect(screen.getByTestId('morpheme-reset-confirm')).toBeInTheDocument();
      expect(onReset).not.toHaveBeenCalled();
    });

    it('resets and closes when the confirmation is accepted', async () => {
      const onReset = jest.fn();
      const onClose = jest.fn();
      renderConfirming({ onReset, onClose });
      await userEvent.click(screen.getByRole('button', { name: 'Reset' }));
      await userEvent.click(screen.getByTestId('morpheme-reset-confirm-action'));
      expect(onReset).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('returns to the editor without resetting when the confirmation is canceled', async () => {
      const onReset = jest.fn();
      const onClose = jest.fn();
      renderConfirming({ onReset, onClose });
      await userEvent.click(screen.getByRole('button', { name: 'Reset' }));
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(onReset).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByRole('textbox')).toHaveValue('un- believe -able');
    });

    it('dismisses without resetting when interacting outside the confirmation', async () => {
      // The confirmation exists because the loss is irreversible, so a stray outside click must
      // not answer it — even though an outside click on an edited draft normally commits.
      const onReset = jest.fn();
      const onSave = jest.fn();
      const onClose = jest.fn();
      renderConfirming({ onReset, onSave, onClose });
      await userEvent.click(screen.getByRole('button', { name: 'Reset' }));
      await userEvent.click(screen.getByTestId('popover-outside'));
      expect(onReset).not.toHaveBeenCalled();
      expect(onSave).not.toHaveBeenCalled();
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('resets without asking when the breakdown has no glosses to lose', async () => {
      const onReset = jest.fn();
      const onClose = jest.fn();
      renderConfirming({ needsResetConfirm: false, onReset, onClose });
      await userEvent.click(screen.getByRole('button', { name: 'Reset' }));
      expect(screen.queryByTestId('morpheme-reset-confirm')).not.toBeInTheDocument();
      expect(onReset).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('falls back to the token gloss input on close when the chip has no morpheme gloss field', async () => {
    render(
      <label>
        <input aria-label="token gloss" id="gloss-1" />
        <MorphemeBreakdownPopover
          glossInputId="gloss-1"
          initialValue="word"
          onClose={jest.fn()}
          onSave={jest.fn()}
          surfaceText="word"
        />
      </label>,
    );
    await userEvent.click(screen.getByTestId('popover-close'));
    expect(screen.getByRole('textbox', { name: 'token gloss' })).toHaveFocus();
  });
});
