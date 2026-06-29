/** @file Unit tests for components/TokenChip.tsx. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { useLocalizedStrings } from '@papi/frontend/react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AssignmentStatus, Token, TokenSnapshot } from 'interlinearizer';
import * as AnalysisStore from '../../components/AnalysisStore';
import { AnalysisStoreProvider } from '../../components/AnalysisStore';
import { InertTokenChip, TokenChip } from '../../components/TokenChip';

jest.mock('../../components/AnalysisStore');

const LOCALIZED = {
  '%interlinearizer_tokenChip_editMorphemes%': 'Edit morpheme breakdown for {token}',
  '%interlinearizer_tokenChip_defineMorphemes%': 'Define morpheme breakdown for {token}',
};

beforeEach(() => {
  jest.mocked(useLocalizedStrings).mockReturnValue([LOCALIZED, false]);
});
jest.mock('../../components/MorphemeEditor', () => ({
  /**
   * Stub popover that renders a save button so tests can trigger onSave.
   *
   * @param props - Receives the same props as the real popover.
   * @returns A test stub element with a save button.
   */
  MorphemeBreakdownPopover({
    onSave,
    onClose,
    onDelete,
  }: Readonly<{ onSave: (v: string) => void; onClose: () => void; onDelete?: () => void }>) {
    return (
      <div data-testid="morpheme-popover">
        <button onClick={() => onSave('hel -lo')} type="button">
          mock-save
        </button>
        <button onClick={() => onSave('   ')} type="button">
          mock-save-empty
        </button>
        <button onClick={onClose} type="button">
          mock-close
        </button>
        {onDelete && (
          <button onClick={onDelete} type="button">
            mock-delete
          </button>
        )}
      </div>
    );
  },
}));
jest.mock('../../components/MorphemeBox', () => ({
  /**
   * Stub box that surfaces its `onEditBreakdown` callback as a button so analyzed-path tests can
   * open the editor, and echoes its `disabled`/`popoverOpen` props for assertions. The box's grid
   * internals (forms, gloss inputs, RTL order, hover, active look) are tested in MorphemeBox.test.
   *
   * @param props - Receives the same props as the real box.
   * @returns A test stub element with an edit-breakdown trigger.
   */
  MorphemeBox({
    onEditBreakdown,
    disabled,
    popoverOpen,
  }: Readonly<{ onEditBreakdown: () => void; disabled: boolean; popoverOpen: boolean }>) {
    return (
      <div data-morpheme-box-open={popoverOpen} data-testid="morpheme-box">
        <button disabled={disabled} onClick={onEditBreakdown} type="button">
          mock-edit-breakdown
        </button>
      </div>
    );
  },
}));

const WORD_TOKEN = {
  ref: 'GEN 1:1:0',
  surfaceText: 'hello',
  writingSystem: 'en',
  type: 'word',
  charStart: 0,
  charEnd: 5,
} satisfies Token;

/**
 * Minimal required props for {@link TokenChip}. Spread into render calls so tests only need to
 * override what they actually care about.
 *
 * @returns An object with all required props set to no-op stubs.
 */
function requiredProps(): { token: Token & { type: 'word' }; onFocus: () => void } {
  return {
    token: WORD_TOKEN,
    onFocus: jest.fn(),
  };
}

const PUNCT_TOKEN = {
  ref: 'GEN 1:1:p',
  surfaceText: '.',
  writingSystem: 'en',
  type: 'punctuation',
  charStart: 5,
  charEnd: 6,
} satisfies Token;

describe('InertTokenChip', () => {
  it('renders the surface text', () => {
    render(<InertTokenChip token={PUNCT_TOKEN} />);
    expect(screen.getByText('.')).toBeInTheDocument();
  });

  it('renders as an inline span', () => {
    render(<InertTokenChip token={PUNCT_TOKEN} />);
    expect(screen.getByText('.').tagName).toBe('SPAN');
  });
});

describe('TokenChip', () => {
  it('renders the surface text', () => {
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <TokenChip {...requiredProps()} />
      </AnalysisStoreProvider>,
    );
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('applies a border class to the outer container', () => {
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <TokenChip {...requiredProps()} />
      </AnalysisStoreProvider>,
    );
    const outer = screen.getByText('hello').closest('span')?.parentElement;
    expect(outer?.className).toContain('tw:border');
  });

  it('applies a destructive border when isSplitFree is true', () => {
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <TokenChip {...requiredProps()} isSplitFree />
      </AnalysisStoreProvider>,
    );
    const label = screen.getByText('hello').closest('label');
    expect(label?.className).toContain('tw:border-destructive');
  });

  it('does not apply a destructive border when isSplitFree is false', () => {
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <TokenChip {...requiredProps()} isSplitFree={false} />
      </AnalysisStoreProvider>,
    );
    const label = screen.getByText('hello').closest('label');
    expect(label?.className).not.toContain('tw:border-destructive');
    expect(label?.className).toContain('tw:border-border');
  });

  it('renders a gloss input', () => {
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <TokenChip {...requiredProps()} />
      </AnalysisStoreProvider>,
    );
    expect(screen.getByRole('textbox', { name: 'Gloss for hello' })).toBeInTheDocument();
  });

  it('shows the current gloss value from the store', () => {
    const initialAnalysis = {
      tokenAnalyses: [{ id: 'ta-1', surfaceText: 'hello', gloss: { und: 'in' } }],
      tokenAnalysisLinks: [
        {
          analysisId: 'ta-1',
          status: 'approved',
          token: { tokenRef: 'GEN 1:1:0', surfaceText: 'hello' },
        } satisfies {
          analysisId: string;
          status: AssignmentStatus;
          token: TokenSnapshot;
        },
      ],
      segmentAnalyses: [],
      segmentAnalysisLinks: [],
      phraseAnalyses: [],
      phraseAnalysisLinks: [],
    };
    render(
      <AnalysisStoreProvider initialAnalysis={initialAnalysis} analysisLanguage="und">
        <TokenChip {...requiredProps()} />
      </AnalysisStoreProvider>,
    );
    expect(screen.getByRole('textbox', { name: 'Gloss for hello' })).toHaveValue('in');
  });

  it('shows an empty string in the input when no gloss has been set', () => {
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <TokenChip {...requiredProps()} />
      </AnalysisStoreProvider>,
    );
    expect(screen.getByRole('textbox', { name: 'Gloss for hello' })).toHaveValue('');
  });

  it('calls the store onGlossChange spy once on blur with the final value', async () => {
    const spy = jest.fn();
    render(
      <AnalysisStoreProvider analysisLanguage="und" onGlossChange={spy}>
        <TokenChip {...requiredProps()} />
      </AnalysisStoreProvider>,
    );
    await userEvent.type(screen.getByRole('textbox', { name: 'Gloss for hello' }), 'in');
    expect(spy).not.toHaveBeenCalled();
    await userEvent.tab();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('GEN 1:1:0', 'in');
  });

  it('does not call the store onGlossChange spy when blurring without typing', async () => {
    const spy = jest.fn();
    render(
      <AnalysisStoreProvider analysisLanguage="und" onGlossChange={spy}>
        <TokenChip {...requiredProps()} />
      </AnalysisStoreProvider>,
    );
    await userEvent.click(screen.getByRole('textbox', { name: 'Gloss for hello' }));
    await userEvent.tab();
    expect(spy).not.toHaveBeenCalled();
  });

  it('calls onFocus when the input is focused', async () => {
    const handleFocus = jest.fn();
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <TokenChip {...requiredProps()} onFocus={handleFocus} />
      </AnalysisStoreProvider>,
    );
    await userEvent.click(screen.getByRole('textbox', { name: 'Gloss for hello' }));
    expect(handleFocus).toHaveBeenCalledTimes(1);
  });

  it('does not call onFocus when disabled', async () => {
    const handleFocus = jest.fn();
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <TokenChip {...requiredProps()} disabled onFocus={handleFocus} />
      </AnalysisStoreProvider>,
    );
    await userEvent.click(screen.getByRole('textbox', { name: 'Gloss for hello' }));
    expect(handleFocus).not.toHaveBeenCalled();
  });

  it('focuses the gloss input without native scrolling on a surface-text mouse-down', () => {
    const focusSpy = jest.spyOn(HTMLElement.prototype, 'focus');
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <TokenChip {...requiredProps()} />
      </AnalysisStoreProvider>,
    );

    // Clicking the word hits the label, whose native activation would forward focus to the input
    // with the browser's default scroll-into-view — realigning the segment list under the click.
    // The mouse-down handler must preempt it: default prevented, focus forwarded with
    // preventScroll.
    const defaultAllowed = fireEvent.mouseDown(screen.getByText('hello'));

    expect(defaultAllowed).toBe(false);
    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
    expect(screen.getByRole('textbox', { name: 'Gloss for hello' })).toHaveFocus();
  });

  it('leaves a mouse-down on the gloss input itself to the input handler', () => {
    const focusSpy = jest.spyOn(HTMLElement.prototype, 'focus');
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <TokenChip {...requiredProps()} />
      </AnalysisStoreProvider>,
    );

    // The input's own handler focuses once with preventScroll; the label handler (which the event
    // bubbles to) must stand down rather than focus a second time.
    fireEvent.mouseDown(screen.getByRole('textbox', { name: 'Gloss for hello' }));

    expect(focusSpy).toHaveBeenCalledTimes(1);
    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('does not intercept a surface-text mouse-down when disabled', () => {
    const focusSpy = jest.spyOn(HTMLElement.prototype, 'focus');
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <TokenChip {...requiredProps()} disabled />
      </AnalysisStoreProvider>,
    );

    const defaultAllowed = fireEvent.mouseDown(screen.getByText('hello'));

    expect(defaultAllowed).toBe(true);
    expect(focusSpy).not.toHaveBeenCalled();
  });

  it('renders remove button when onRemove is provided', () => {
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <TokenChip {...requiredProps()} onRemove={jest.fn()} />
      </AnalysisStoreProvider>,
    );
    expect(screen.getByRole('button', { name: 'Remove hello from phrase' })).toBeInTheDocument();
  });

  it('does not render remove button when onRemove is not provided', () => {
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <TokenChip {...requiredProps()} />
      </AnalysisStoreProvider>,
    );
    expect(
      screen.queryByRole('button', { name: 'Remove hello from phrase' }),
    ).not.toBeInTheDocument();
  });

  it('calls onRemove when the remove button is clicked', async () => {
    const onRemove = jest.fn();
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <TokenChip {...requiredProps()} onRemove={onRemove} />
      </AnalysisStoreProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Remove hello from phrase' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('applies destructive border on the remove button when hovered', async () => {
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <TokenChip {...requiredProps()} onRemove={jest.fn()} />
      </AnalysisStoreProvider>,
    );
    const removeBtn = screen.getByRole('button', { name: 'Remove hello from phrase' });
    await userEvent.hover(removeBtn);
    expect(removeBtn.className).toContain('tw:border-destructive');
  });

  it('removes destructive border when pointer leaves the remove button', async () => {
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <TokenChip {...requiredProps()} onRemove={jest.fn()} />
      </AnalysisStoreProvider>,
    );
    const removeBtn = screen.getByRole('button', { name: 'Remove hello from phrase' });
    await userEvent.hover(removeBtn);
    await userEvent.unhover(removeBtn);
    expect(removeBtn.className).not.toContain('tw:border-destructive');
  });

  it('clears remove-hover state when onRemove changes from a function to undefined', async () => {
    const onRemove = jest.fn();
    const { rerender } = render(
      <AnalysisStoreProvider analysisLanguage="und">
        <TokenChip {...requiredProps()} onRemove={onRemove} />
      </AnalysisStoreProvider>,
    );
    // Hover the remove button to set isRemoveHovered = true
    await userEvent.hover(screen.getByRole('button', { name: 'Remove hello from phrase' }));
    // Rerender without onRemove — the label border should revert to non-destructive
    rerender(
      <AnalysisStoreProvider analysisLanguage="und">
        <TokenChip {...requiredProps()} onRemove={undefined} />
      </AnalysisStoreProvider>,
    );
    const label = screen.getByText('hello').closest('label');
    expect(label?.className).not.toContain('tw:border-destructive');
  });

  describe('morphology UI', () => {
    it('does not render morpheme row when showMorphology is false', () => {
      render(
        <AnalysisStoreProvider analysisLanguage="und">
          <TokenChip {...requiredProps()} showMorphology={false} />
        </AnalysisStoreProvider>,
      );
      expect(
        screen.queryByRole('button', { name: 'Define morpheme breakdown for hello' }),
      ).not.toBeInTheDocument();
    });

    it('renders a "define" button when showMorphology is true and no morphemes exist', () => {
      render(
        <AnalysisStoreProvider analysisLanguage="und">
          <TokenChip {...requiredProps()} showMorphology />
        </AnalysisStoreProvider>,
      );
      expect(
        screen.getByRole('button', { name: 'Define morpheme breakdown for hello' }),
      ).toBeInTheDocument();
    });

    it('shows surface text on the define button for unanalyzed tokens', () => {
      render(
        <AnalysisStoreProvider analysisLanguage="und">
          <TokenChip {...requiredProps()} showMorphology />
        </AnalysisStoreProvider>,
      );
      const btn = screen.getByRole('button', { name: 'Define morpheme breakdown for hello' });
      expect(btn).toHaveTextContent('hello');
    });

    it('opens the popover when the define button is clicked', async () => {
      render(
        <AnalysisStoreProvider analysisLanguage="und">
          <TokenChip {...requiredProps()} showMorphology />
        </AnalysisStoreProvider>,
      );
      expect(screen.queryByTestId('morpheme-popover')).not.toBeInTheDocument();
      await userEvent.click(
        screen.getByRole('button', { name: 'Define morpheme breakdown for hello' }),
      );
      expect(screen.getByTestId('morpheme-popover')).toBeInTheDocument();
    });

    it('does not open the popover when disabled', async () => {
      render(
        <AnalysisStoreProvider analysisLanguage="und">
          <TokenChip {...requiredProps()} showMorphology disabled />
        </AnalysisStoreProvider>,
      );
      await userEvent.click(
        screen.getByRole('button', { name: 'Define morpheme breakdown for hello' }),
      );
      expect(screen.queryByTestId('morpheme-popover')).not.toBeInTheDocument();
    });

    it('renders the morpheme box instead of the define button when morphemes exist', () => {
      // AnalysisStore imported at top level
      jest.spyOn(AnalysisStore, 'useMorphemes').mockReturnValue([
        { id: 'm-1', form: 'hel', writingSystem: 'und' },
        { id: 'm-2', form: '-lo', writingSystem: 'und' },
      ]);
      render(
        <AnalysisStoreProvider analysisLanguage="und">
          <TokenChip {...requiredProps()} showMorphology />
        </AnalysisStoreProvider>,
      );
      expect(screen.getByTestId('morpheme-box')).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Define morpheme breakdown for hello' }),
      ).not.toBeInTheDocument();
    });

    it('marks the morpheme box active while the popover is open', async () => {
      // AnalysisStore imported at top level
      jest
        .spyOn(AnalysisStore, 'useMorphemes')
        .mockReturnValue([{ id: 'm-1', form: 'hel', writingSystem: 'und' }]);
      render(
        <AnalysisStoreProvider analysisLanguage="und">
          <TokenChip {...requiredProps()} showMorphology />
        </AnalysisStoreProvider>,
      );
      expect(screen.getByTestId('morpheme-box')).toHaveAttribute('data-morpheme-box-open', 'false');
      await userEvent.click(screen.getByRole('button', { name: 'mock-edit-breakdown' }));
      expect(screen.getByTestId('morpheme-box')).toHaveAttribute('data-morpheme-box-open', 'true');
    });

    it('opens the popover when the box requests breakdown editing on an analyzed token', async () => {
      // AnalysisStore imported at top level
      jest
        .spyOn(AnalysisStore, 'useMorphemes')
        .mockReturnValue([{ id: 'm-1', form: 'hel', writingSystem: 'und' }]);
      render(
        <AnalysisStoreProvider analysisLanguage="und">
          <TokenChip {...requiredProps()} showMorphology />
        </AnalysisStoreProvider>,
      );
      await userEvent.click(screen.getByRole('button', { name: 'mock-edit-breakdown' }));
      expect(screen.getByTestId('morpheme-popover')).toBeInTheDocument();
    });

    it('dispatches morpheme breakdown when saving from the popover', async () => {
      const mockDispatch = jest.fn();
      // AnalysisStore imported at top level
      jest.spyOn(AnalysisStore, 'useMorphemeBreakdownDispatch').mockReturnValue(mockDispatch);

      render(
        <AnalysisStoreProvider analysisLanguage="und">
          <TokenChip {...requiredProps()} showMorphology />
        </AnalysisStoreProvider>,
      );
      await userEvent.click(
        screen.getByRole('button', { name: 'Define morpheme breakdown for hello' }),
      );
      await userEvent.click(screen.getByRole('button', { name: 'mock-save' }));
      expect(mockDispatch).toHaveBeenCalledWith('GEN 1:1:0', 'hello', ['hel', '-lo'], 'en');
    });

    it('does not dispatch when the popover saves only whitespace', async () => {
      const mockDispatch = jest.fn();
      // AnalysisStore imported at top level
      jest.spyOn(AnalysisStore, 'useMorphemeBreakdownDispatch').mockReturnValue(mockDispatch);

      render(
        <AnalysisStoreProvider analysisLanguage="und">
          <TokenChip {...requiredProps()} showMorphology />
        </AnalysisStoreProvider>,
      );
      await userEvent.click(
        screen.getByRole('button', { name: 'Define morpheme breakdown for hello' }),
      );
      await userEvent.click(screen.getByRole('button', { name: 'mock-save-empty' }));
      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it('dispatches morpheme deletion when the popover delete is clicked', async () => {
      const mockDispatch = jest.fn();
      // AnalysisStore imported at top level
      jest
        .spyOn(AnalysisStore, 'useMorphemes')
        .mockReturnValue([{ id: 'm-1', form: 'hel', writingSystem: 'und' }]);
      jest.spyOn(AnalysisStore, 'useMorphemeDeleteDispatch').mockReturnValue(mockDispatch);

      render(
        <AnalysisStoreProvider analysisLanguage="und">
          <TokenChip {...requiredProps()} showMorphology />
        </AnalysisStoreProvider>,
      );
      await userEvent.click(screen.getByRole('button', { name: 'mock-edit-breakdown' }));
      await userEvent.click(screen.getByRole('button', { name: 'mock-delete' }));
      expect(mockDispatch).toHaveBeenCalledWith('GEN 1:1:0');
    });

    it('passes no onDelete to the popover when the token has no breakdown', async () => {
      render(
        <AnalysisStoreProvider analysisLanguage="und">
          <TokenChip {...requiredProps()} showMorphology />
        </AnalysisStoreProvider>,
      );
      await userEvent.click(
        screen.getByRole('button', { name: 'Define morpheme breakdown for hello' }),
      );
      expect(screen.getByTestId('morpheme-popover')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'mock-delete' })).not.toBeInTheDocument();
    });

    it('focuses the main gloss input on a surface-text mouse-down when the box precedes it', () => {
      // AnalysisStore imported at top level
      jest
        .spyOn(AnalysisStore, 'useMorphemes')
        .mockReturnValue([{ id: 'm-1', form: 'hel', writingSystem: 'und' }]);
      render(
        <AnalysisStoreProvider analysisLanguage="und">
          <TokenChip {...requiredProps()} showMorphology />
        </AnalysisStoreProvider>,
      );

      // The morpheme box (with its gloss inputs) sits before the main gloss input inside the label;
      // the label handler must route focus to the main gloss input by id, not the first input found.
      fireEvent.mouseDown(screen.getByText('hello'));

      expect(screen.getByRole('textbox', { name: 'Gloss for hello' })).toHaveFocus();
    });

    it('leaves a mouse-down on the morpheme button to the button itself', () => {
      const focusSpy = jest.spyOn(HTMLElement.prototype, 'focus');
      render(
        <AnalysisStoreProvider analysisLanguage="und">
          <TokenChip {...requiredProps()} showMorphology />
        </AnalysisStoreProvider>,
      );

      // The button opens the popover via its own click handler; the label handler must not focus
      // an input as a side effect of the same mouse-down.
      const defaultAllowed = fireEvent.mouseDown(
        screen.getByRole('button', { name: 'Define morpheme breakdown for hello' }),
      );

      expect(defaultAllowed).toBe(true);
      expect(focusSpy).not.toHaveBeenCalled();
    });

    it('does not reopen the popover when showMorphology is toggled off and back on', async () => {
      const { rerender } = render(
        <AnalysisStoreProvider analysisLanguage="und">
          <TokenChip {...requiredProps()} showMorphology />
        </AnalysisStoreProvider>,
      );
      await userEvent.click(
        screen.getByRole('button', { name: 'Define morpheme breakdown for hello' }),
      );
      expect(screen.getByTestId('morpheme-popover')).toBeInTheDocument();
      // Toggling morphology off unmounts the popover tree; the open state must not survive and
      // resurrect the popover when morphology comes back.
      rerender(
        <AnalysisStoreProvider analysisLanguage="und">
          <TokenChip {...requiredProps()} showMorphology={false} />
        </AnalysisStoreProvider>,
      );
      rerender(
        <AnalysisStoreProvider analysisLanguage="und">
          <TokenChip {...requiredProps()} showMorphology />
        </AnalysisStoreProvider>,
      );
      expect(screen.queryByTestId('morpheme-popover')).not.toBeInTheDocument();
    });

    it('closes the popover when the chip becomes disabled', async () => {
      const { rerender } = render(
        <AnalysisStoreProvider analysisLanguage="und">
          <TokenChip {...requiredProps()} showMorphology />
        </AnalysisStoreProvider>,
      );
      await userEvent.click(
        screen.getByRole('button', { name: 'Define morpheme breakdown for hello' }),
      );
      expect(screen.getByTestId('morpheme-popover')).toBeInTheDocument();
      // The popover content renders on `popoverOpen` alone, not gated on `disabled`; a chip whose
      // popover is open while it transitions to disabled would otherwise stay editable.
      rerender(
        <AnalysisStoreProvider analysisLanguage="und">
          <TokenChip {...requiredProps()} showMorphology disabled />
        </AnalysisStoreProvider>,
      );
      expect(screen.queryByTestId('morpheme-popover')).not.toBeInTheDocument();
    });

    it('closes the popover via onClose', async () => {
      render(
        <AnalysisStoreProvider analysisLanguage="und">
          <TokenChip {...requiredProps()} showMorphology />
        </AnalysisStoreProvider>,
      );
      await userEvent.click(
        screen.getByRole('button', { name: 'Define morpheme breakdown for hello' }),
      );
      expect(screen.getByTestId('morpheme-popover')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'mock-close' }));
      expect(screen.queryByTestId('morpheme-popover')).not.toBeInTheDocument();
    });
  });
});
