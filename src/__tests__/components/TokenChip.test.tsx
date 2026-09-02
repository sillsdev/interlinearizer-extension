/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AssignmentStatus, Token, TokenSnapshot } from 'interlinearizer';
import { TooltipProvider } from 'platform-bible-react';
import * as AnalysisStore from '../../components/AnalysisStore';
import { AnalysisStoreProvider } from '../../components/AnalysisStore';
import { InertTokenChip, TokenChip } from '../../components/TokenChip';
import { emptyAnalysis } from '../../types/empty-factories';
import { setMockAnalysisReadOnly } from '../analysis-store-read-only-mock';
import { FIXTURE_STAMPS, makePunctToken, makeWordToken } from '../test-helpers';
import { mockKeyAsValueLocalizedStrings } from './test-helpers';

jest.mock('../../components/AnalysisStore');

beforeEach(() => {
  mockKeyAsValueLocalizedStrings();
});
jest.mock('../../components/MorphemeEditor', () => ({
  /** Stub popover exposing buttons that drive onSave, onClose, and onReset. */
  MorphemeBreakdownPopover({
    onSave,
    onClose,
    onReset,
    needsResetConfirm,
  }: Readonly<{
    onSave: (v: string) => void;
    onClose: () => void;
    onReset?: () => void;
    needsResetConfirm?: boolean;
  }>) {
    return (
      <div data-testid="morpheme-popover" data-needs-reset-confirm={needsResetConfirm}>
        <button onClick={() => onSave('hel -lo')} type="button">
          mock-save
        </button>
        <button onClick={() => onSave('   ')} type="button">
          mock-save-empty
        </button>
        <button onClick={onClose} type="button">
          mock-close
        </button>
        {onReset && (
          <button onClick={onReset} type="button">
            mock-reset
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
   */
  MorphemeBox({
    onEditBreakdown,
    onGlossFocus,
    disabled,
    popoverOpen,
  }: Readonly<{
    onEditBreakdown: () => void;
    onGlossFocus: () => void;
    disabled: boolean;
    popoverOpen: boolean;
  }>) {
    return (
      <div data-morpheme-box-open={popoverOpen} data-testid="morpheme-box">
        <button disabled={disabled} onClick={onEditBreakdown} type="button">
          mock-edit-breakdown
        </button>
        <input aria-label="mock-morpheme-gloss" onFocus={onGlossFocus} />
      </div>
    );
  },
}));

const WORD_TOKEN = makeWordToken('GEN 1:1:0', 'hello');

/**
 * Minimal required props for {@link TokenChip}. Spread into render calls so tests only need to
 * override what they actually care about.
 */
function requiredProps(): {
  token: Token & { type: 'word' };
  onFocus: () => void;
  removeLabelTemplate: string;
} {
  return {
    token: WORD_TOKEN,
    onFocus: jest.fn(),
    // Always supplied by the strip, so every render gets it; it surfaces only with onRemove.
    removeLabelTemplate: '%interlinearizer_tokenChip_removeFromPhrase%',
  };
}

const PUNCT_TOKEN = makePunctToken('GEN 1:1:p', '.', 5);

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
    expect(
      screen.getByRole('textbox', { name: '%interlinearizer_tokenChip_glossLabel%' }),
    ).toBeInTheDocument();
  });

  it('shows the current gloss value from the store', () => {
    const initialAnalysis = {
      tokenAnalyses: [
        { ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'hello', gloss: { und: 'in' } },
      ],
      tokenAnalysisLinks: [
        {
          ...FIXTURE_STAMPS,
          analysisId: 'ta-1',
          status: 'approved',
          token: { tokenRef: 'GEN 1:1:0', surfaceText: 'hello' },
        } satisfies {
          analysisId: string;
          createdAt: string;
          updatedAt: string;
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
    expect(
      screen.getByRole('textbox', { name: '%interlinearizer_tokenChip_glossLabel%' }),
    ).toHaveValue('in');
  });

  it('shows an empty string in the input when no gloss has been set', () => {
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <TokenChip {...requiredProps()} />
      </AnalysisStoreProvider>,
    );
    expect(
      screen.getByRole('textbox', { name: '%interlinearizer_tokenChip_glossLabel%' }),
    ).toHaveValue('');
  });

  it('calls the store onGlossChange spy once on blur with the final value', async () => {
    const spy = jest.fn();
    render(
      <AnalysisStoreProvider analysisLanguage="und" onGlossChange={spy}>
        <TokenChip {...requiredProps()} />
      </AnalysisStoreProvider>,
    );
    await userEvent.type(
      screen.getByRole('textbox', { name: '%interlinearizer_tokenChip_glossLabel%' }),
      'in',
    );
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
    await userEvent.click(
      screen.getByRole('textbox', { name: '%interlinearizer_tokenChip_glossLabel%' }),
    );
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
    await userEvent.click(
      screen.getByRole('textbox', { name: '%interlinearizer_tokenChip_glossLabel%' }),
    );
    expect(handleFocus).toHaveBeenCalledTimes(1);
  });

  it('does not call onFocus when disabled', async () => {
    const handleFocus = jest.fn();
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <TokenChip {...requiredProps()} disabled onFocus={handleFocus} />
      </AnalysisStoreProvider>,
    );
    await userEvent.click(
      screen.getByRole('textbox', { name: '%interlinearizer_tokenChip_glossLabel%' }),
    );
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
    expect(
      screen.getByRole('textbox', { name: '%interlinearizer_tokenChip_glossLabel%' }),
    ).toHaveFocus();
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
    fireEvent.mouseDown(
      screen.getByRole('textbox', { name: '%interlinearizer_tokenChip_glossLabel%' }),
    );

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
        <TooltipProvider>
          <TokenChip {...requiredProps()} onRemove={jest.fn()} />
        </TooltipProvider>
      </AnalysisStoreProvider>,
    );
    expect(
      screen.getByRole('button', { name: '%interlinearizer_tokenChip_removeFromPhrase%' }),
    ).toBeInTheDocument();
  });

  it('names the removal on hover over the remove button', () => {
    // The tooltip text rides the Tooltip component; the mock projects it onto the trigger as
    // `title`. The template quotes the token so the word reads as distinct from the surrounding
    // wording.
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <TooltipProvider>
          <TokenChip
            {...requiredProps()}
            removeLabelTemplate='Remove "{token}" from phrase'
            onRemove={jest.fn()}
          />
        </TooltipProvider>
      </AnalysisStoreProvider>,
    );
    expect(screen.getByRole('button', { name: 'Remove "hello" from phrase' })).toHaveAttribute(
      'title',
      'Remove "hello" from phrase',
    );
  });

  it('does not render remove button when onRemove is not provided', () => {
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <TokenChip {...requiredProps()} />
      </AnalysisStoreProvider>,
    );
    expect(
      screen.queryByRole('button', { name: '%interlinearizer_tokenChip_removeFromPhrase%' }),
    ).not.toBeInTheDocument();
  });

  it('calls onRemove when the remove button is clicked', async () => {
    const onRemove = jest.fn();
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <TooltipProvider>
          <TokenChip {...requiredProps()} onRemove={onRemove} />
        </TooltipProvider>
      </AnalysisStoreProvider>,
    );
    await userEvent.click(
      screen.getByRole('button', { name: '%interlinearizer_tokenChip_removeFromPhrase%' }),
    );
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('applies destructive border on the remove button when hovered', async () => {
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <TooltipProvider>
          <TokenChip {...requiredProps()} onRemove={jest.fn()} />
        </TooltipProvider>
      </AnalysisStoreProvider>,
    );
    const removeBtn = screen.getByRole('button', {
      name: '%interlinearizer_tokenChip_removeFromPhrase%',
    });
    await userEvent.hover(removeBtn);
    expect(removeBtn.className).toContain('tw:border-destructive');
  });

  it('removes destructive border when pointer leaves the remove button', async () => {
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <TooltipProvider>
          <TokenChip {...requiredProps()} onRemove={jest.fn()} />
        </TooltipProvider>
      </AnalysisStoreProvider>,
    );
    const removeBtn = screen.getByRole('button', {
      name: '%interlinearizer_tokenChip_removeFromPhrase%',
    });
    await userEvent.hover(removeBtn);
    await userEvent.unhover(removeBtn);
    expect(removeBtn.className).not.toContain('tw:border-destructive');
  });

  it('clears remove-hover state when onRemove changes from a function to undefined', async () => {
    const onRemove = jest.fn();
    const { rerender } = render(
      <AnalysisStoreProvider analysisLanguage="und">
        <TooltipProvider>
          <TokenChip {...requiredProps()} onRemove={onRemove} />
        </TooltipProvider>
      </AnalysisStoreProvider>,
    );
    await userEvent.hover(
      screen.getByRole('button', { name: '%interlinearizer_tokenChip_removeFromPhrase%' }),
    );
    rerender(
      <AnalysisStoreProvider analysisLanguage="und">
        <TooltipProvider>
          <TokenChip {...requiredProps()} onRemove={undefined} />
        </TooltipProvider>
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
        screen.queryByRole('button', { name: '%interlinearizer_tokenChip_defineMorphemes%' }),
      ).not.toBeInTheDocument();
    });

    it('renders a "define" button when showMorphology is true and no morphemes exist', () => {
      render(
        <AnalysisStoreProvider analysisLanguage="und">
          <TokenChip {...requiredProps()} showMorphology />
        </AnalysisStoreProvider>,
      );
      expect(
        screen.getByRole('button', { name: '%interlinearizer_tokenChip_defineMorphemes%' }),
      ).toBeInTheDocument();
    });

    // jsdom does no layout, so these assert the structure that gives an unanalyzed slot an analyzed
    // one's height rather than the height itself.
    it('gives the unanalyzed morphology slot the shared box metrics', () => {
      render(
        <AnalysisStoreProvider analysisLanguage="und">
          <TokenChip {...requiredProps()} showMorphology />
        </AnalysisStoreProvider>,
      );
      const spacer = screen.getByTestId('morphology-slot-spacer');
      expect(spacer.parentElement).toHaveClass('tw:morphology-slot');
    });

    it('reserves a second row in the unanalyzed morphology slot', () => {
      render(
        <AnalysisStoreProvider analysisLanguage="und">
          <TokenChip {...requiredProps()} showMorphology />
        </AnalysisStoreProvider>,
      );
      expect(screen.getByTestId('morphology-slot-spacer')).toBeInTheDocument();
    });

    it('hides the reserved second row from assistive tech', () => {
      render(
        <AnalysisStoreProvider analysisLanguage="und">
          <TokenChip {...requiredProps()} showMorphology />
        </AnalysisStoreProvider>,
      );
      expect(screen.getByTestId('morphology-slot-spacer')).toHaveAttribute('aria-hidden', 'true');
    });

    it('shows surface text on the define button for unanalyzed tokens', () => {
      render(
        <AnalysisStoreProvider analysisLanguage="und">
          <TokenChip {...requiredProps()} showMorphology />
        </AnalysisStoreProvider>,
      );
      const btn = screen.getByRole('button', {
        name: '%interlinearizer_tokenChip_defineMorphemes%',
      });
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
        screen.getByRole('button', { name: '%interlinearizer_tokenChip_defineMorphemes%' }),
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
        screen.getByRole('button', { name: '%interlinearizer_tokenChip_defineMorphemes%' }),
      );
      expect(screen.queryByTestId('morpheme-popover')).not.toBeInTheDocument();
    });

    it('reports the token as focused when the define button opens the popover', async () => {
      // The trigger is a button, so neither it nor the label's mouse-down handler moves focus into
      // the chip; without an explicit report the editor would open over a token the view still
      // treats as unfocused.
      const handleFocus = jest.fn();
      render(
        <AnalysisStoreProvider analysisLanguage="und">
          <TokenChip {...requiredProps()} showMorphology onFocus={handleFocus} />
        </AnalysisStoreProvider>,
      );
      await userEvent.click(
        screen.getByRole('button', { name: '%interlinearizer_tokenChip_defineMorphemes%' }),
      );
      expect(handleFocus).toHaveBeenCalledTimes(1);
    });

    it('does not report focus from the define button when disabled', async () => {
      const handleFocus = jest.fn();
      render(
        <AnalysisStoreProvider analysisLanguage="und">
          <TokenChip {...requiredProps()} showMorphology disabled onFocus={handleFocus} />
        </AnalysisStoreProvider>,
      );
      await userEvent.click(
        screen.getByRole('button', { name: '%interlinearizer_tokenChip_defineMorphemes%' }),
      );
      expect(handleFocus).not.toHaveBeenCalled();
    });

    it('renders the morpheme box instead of the define button when morphemes exist', () => {
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
        screen.queryByRole('button', { name: '%interlinearizer_tokenChip_defineMorphemes%' }),
      ).not.toBeInTheDocument();
    });

    it('marks the morpheme box active while the popover is open', async () => {
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

    it('reports the token as focused when the box opens the editor on an analyzed token', async () => {
      jest
        .spyOn(AnalysisStore, 'useMorphemes')
        .mockReturnValue([{ id: 'm-1', form: 'hel', writingSystem: 'und' }]);
      const handleFocus = jest.fn();
      render(
        <AnalysisStoreProvider analysisLanguage="und">
          <TokenChip {...requiredProps()} showMorphology onFocus={handleFocus} />
        </AnalysisStoreProvider>,
      );
      await userEvent.click(screen.getByRole('button', { name: 'mock-edit-breakdown' }));
      expect(handleFocus).toHaveBeenCalledTimes(1);
    });

    it('reports the token as focused when a morpheme gloss input is focused', async () => {
      // The morpheme glosses are gloss fields of this same token, so focusing one must move the
      // view's focus exactly as focusing the chip's own gloss input does.
      jest
        .spyOn(AnalysisStore, 'useMorphemes')
        .mockReturnValue([{ id: 'm-1', form: 'hel', writingSystem: 'und' }]);
      const handleFocus = jest.fn();
      render(
        <AnalysisStoreProvider analysisLanguage="und">
          <TokenChip {...requiredProps()} showMorphology onFocus={handleFocus} />
        </AnalysisStoreProvider>,
      );
      await userEvent.click(screen.getByRole('textbox', { name: 'mock-morpheme-gloss' }));
      expect(handleFocus).toHaveBeenCalledTimes(1);
    });

    it('dispatches morpheme breakdown when saving from the popover', async () => {
      const mockDispatch = jest.fn();
      jest.spyOn(AnalysisStore, 'useMorphemeBreakdownDispatch').mockReturnValue(mockDispatch);

      render(
        <AnalysisStoreProvider analysisLanguage="und">
          <TokenChip {...requiredProps()} showMorphology />
        </AnalysisStoreProvider>,
      );
      await userEvent.click(
        screen.getByRole('button', { name: '%interlinearizer_tokenChip_defineMorphemes%' }),
      );
      await userEvent.click(screen.getByRole('button', { name: 'mock-save' }));
      expect(mockDispatch).toHaveBeenCalledWith('GEN 1:1:0', 'hello', ['hel', '-lo'], 'en');
    });

    it('does not dispatch when the popover saves only whitespace', async () => {
      const mockDispatch = jest.fn();
      jest.spyOn(AnalysisStore, 'useMorphemeBreakdownDispatch').mockReturnValue(mockDispatch);

      render(
        <AnalysisStoreProvider analysisLanguage="und">
          <TokenChip {...requiredProps()} showMorphology />
        </AnalysisStoreProvider>,
      );
      await userEvent.click(
        screen.getByRole('button', { name: '%interlinearizer_tokenChip_defineMorphemes%' }),
      );
      await userEvent.click(screen.getByRole('button', { name: 'mock-save-empty' }));
      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it('dispatches morpheme deletion when the popover reset is clicked', async () => {
      const mockDispatch = jest.fn();
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
      await userEvent.click(screen.getByRole('button', { name: 'mock-reset' }));
      expect(mockDispatch).toHaveBeenCalledWith('GEN 1:1:0');
    });

    it('passes no onReset to the popover when the token has no breakdown', async () => {
      render(
        <AnalysisStoreProvider analysisLanguage="und">
          <TokenChip {...requiredProps()} showMorphology />
        </AnalysisStoreProvider>,
      );
      await userEvent.click(
        screen.getByRole('button', { name: '%interlinearizer_tokenChip_defineMorphemes%' }),
      );
      expect(screen.getByTestId('morpheme-popover')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'mock-reset' })).not.toBeInTheDocument();
    });

    it('tells the popover to confirm when a reset would lose glosses', async () => {
      jest.spyOn(AnalysisStore, 'useMorphemeResetLosesGlosses').mockReturnValue(true);

      render(
        <AnalysisStoreProvider analysisLanguage="und">
          <TokenChip {...requiredProps()} showMorphology />
        </AnalysisStoreProvider>,
      );
      await userEvent.click(
        screen.getByRole('button', { name: '%interlinearizer_tokenChip_defineMorphemes%' }),
      );
      expect(screen.getByTestId('morpheme-popover')).toHaveAttribute(
        'data-needs-reset-confirm',
        'true',
      );
    });

    it('tells the popover not to confirm when a reset would lose nothing', async () => {
      jest.spyOn(AnalysisStore, 'useMorphemeResetLosesGlosses').mockReturnValue(false);

      render(
        <AnalysisStoreProvider analysisLanguage="und">
          <TokenChip {...requiredProps()} showMorphology />
        </AnalysisStoreProvider>,
      );
      await userEvent.click(
        screen.getByRole('button', { name: '%interlinearizer_tokenChip_defineMorphemes%' }),
      );
      expect(screen.getByTestId('morpheme-popover')).toHaveAttribute(
        'data-needs-reset-confirm',
        'false',
      );
    });

    it('focuses the main gloss input on a surface-text mouse-down when the box precedes it', () => {
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

      expect(
        screen.getByRole('textbox', { name: '%interlinearizer_tokenChip_glossLabel%' }),
      ).toHaveFocus();
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
        screen.getByRole('button', { name: '%interlinearizer_tokenChip_defineMorphemes%' }),
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
        screen.getByRole('button', { name: '%interlinearizer_tokenChip_defineMorphemes%' }),
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
        screen.getByRole('button', { name: '%interlinearizer_tokenChip_defineMorphemes%' }),
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
        screen.getByRole('button', { name: '%interlinearizer_tokenChip_defineMorphemes%' }),
      );
      expect(screen.getByTestId('morpheme-popover')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'mock-close' }));
      expect(screen.queryByTestId('morpheme-popover')).not.toBeInTheDocument();
    });
  });
});

describe('TokenChip read-only', () => {
  beforeEach(() => {
    setMockAnalysisReadOnly(false);
  });

  const APPROVED_ANALYSIS = {
    ...emptyAnalysis(),
    tokenAnalyses: [{ ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'hello', gloss: { und: 'in' } }],
    tokenAnalysisLinks: [
      {
        ...FIXTURE_STAMPS,
        analysisId: 'ta-1',
        status: 'approved',
        token: { tokenRef: 'GEN 1:1:0', surfaceText: 'hello' },
      } satisfies {
        analysisId: string;
        createdAt: string;
        updatedAt: string;
        status: AssignmentStatus;
        token: TokenSnapshot;
      },
    ],
  };

  it('renders the committed gloss as plain text instead of an input', () => {
    setMockAnalysisReadOnly(true);
    render(
      <AnalysisStoreProvider initialAnalysis={APPROVED_ANALYSIS} analysisLanguage="und">
        <TokenChip {...requiredProps()} />
      </AnalysisStoreProvider>,
    );

    expect(screen.getByTestId('readonly-gloss')).toHaveTextContent('in');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('hides the morphology editing affordances for an unanalyzed token', () => {
    setMockAnalysisReadOnly(true);
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <TokenChip {...requiredProps()} showMorphology />
      </AnalysisStoreProvider>,
    );

    expect(screen.queryByTestId('morpheme-box')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '%interlinearizer_tokenChip_defineMorphemes%' }),
    ).not.toBeInTheDocument();
  });

  // jsdom does no layout, so the two slot-structure tests below assert the markup that keeps an
  // unanalyzed token's gloss on its analyzed neighbors' line rather than the height itself.
  it('keeps a slot of the shared box metrics for an unanalyzed token', () => {
    setMockAnalysisReadOnly(true);
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <TokenChip {...requiredProps()} showMorphology />
      </AnalysisStoreProvider>,
    );

    expect(screen.getByTestId('readonly-morphology-slot-spacer').parentElement).toHaveClass(
      'tw:morphology-slot',
    );
  });

  it('hides the unanalyzed token slot from assistive tech', () => {
    setMockAnalysisReadOnly(true);
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <TokenChip {...requiredProps()} showMorphology />
      </AnalysisStoreProvider>,
    );

    expect(screen.getByTestId('readonly-morphology-slot-spacer').parentElement).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });

  it('omits the unanalyzed token slot when showMorphology is off', () => {
    setMockAnalysisReadOnly(true);
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <TokenChip {...requiredProps()} showMorphology={false} />
      </AnalysisStoreProvider>,
    );

    expect(screen.queryByTestId('readonly-morphology-slot-spacer')).not.toBeInTheDocument();
  });

  it('omits the unanalyzed token slot when the token has morphemes', () => {
    setMockAnalysisReadOnly(true);
    jest
      .spyOn(AnalysisStore, 'useMorphemes')
      .mockReturnValue([{ id: 'm-1', form: 'hel', writingSystem: 'und' }]);
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <TokenChip {...requiredProps()} showMorphology />
      </AnalysisStoreProvider>,
    );

    expect(screen.queryByTestId('readonly-morphology-slot-spacer')).not.toBeInTheDocument();
  });
});
