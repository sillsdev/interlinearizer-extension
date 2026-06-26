/** @file Unit tests for components/ViewOptionsDropdown.tsx. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { useLocalizedStrings } from '@papi/frontend/react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ViewOptionsDropdown from '../../../components/controls/ViewOptionsDropdown';

beforeEach(() => {
  // Restore key-as-value behavior cleared by resetMocks: true.
  jest
    .mocked(useLocalizedStrings)
    .mockImplementation((keys: readonly string[]) => [
      Object.fromEntries(keys.map((k) => [k, k])),
      false,
    ]);
});

/** Default props with all toggles off and no-op callbacks. */
const DEFAULT_PROPS = {
  continuousScroll: false,
  onContinuousScrollChange: jest.fn(),
  hideInactiveLinkButtons: false,
  onHideInactiveLinkButtonsChange: jest.fn(),
  simplifyPhrases: false,
  onSimplifyPhrasesChange: jest.fn(),
  chapterLabelInVerse: false,
  onChapterLabelInVerseChange: jest.fn(),
  showMorphology: false,
  onShowMorphologyChange: jest.fn(),
  showFreeTranslation: false,
  onShowFreeTranslationChange: jest.fn(),
  showSuggestions: false,
  onShowSuggestionsChange: jest.fn(),
};

describe('ViewOptionsDropdown', () => {
  it('renders a gear button that is not expanded by default', () => {
    render(<ViewOptionsDropdown {...DEFAULT_PROPS} />);

    const button = screen.getByTestId('view-options-button');
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('view-options-panel')).not.toBeInTheDocument();
  });

  it('opens the panel when the gear button is clicked', async () => {
    render(<ViewOptionsDropdown {...DEFAULT_PROPS} />);

    await userEvent.click(screen.getByTestId('view-options-button'));

    expect(screen.getByTestId('view-options-panel')).toBeInTheDocument();
    expect(screen.getByTestId('view-options-button')).toHaveAttribute('aria-expanded', 'true');
  });

  it('closes the panel when the gear button is clicked again', async () => {
    render(<ViewOptionsDropdown {...DEFAULT_PROPS} />);

    await userEvent.click(screen.getByTestId('view-options-button'));
    await userEvent.click(screen.getByTestId('view-options-button'));

    expect(screen.queryByTestId('view-options-panel')).not.toBeInTheDocument();
  });

  it('closes the panel when the backdrop is clicked', async () => {
    render(<ViewOptionsDropdown {...DEFAULT_PROPS} />);

    await userEvent.click(screen.getByTestId('view-options-button'));
    // The backdrop is the fixed overlay beneath the panel.
    const backdrop = document.querySelector('[aria-hidden="true"]');
    if (backdrop instanceof HTMLElement) await userEvent.click(backdrop);

    expect(screen.queryByTestId('view-options-panel')).not.toBeInTheDocument();
  });

  it('renders labels from useLocalizedStrings for all six toggles', async () => {
    render(<ViewOptionsDropdown {...DEFAULT_PROPS} />);
    await userEvent.click(screen.getByTestId('view-options-button'));

    // The mock returns each key as its own label value, so every toggle's
    // localization key must surface as visible text — one assertion per toggle.
    expect(screen.getByText('%interlinearizer_viewOption_continuousScroll%')).toBeInTheDocument();
    expect(screen.getByText('%interlinearizer_viewOption_showMorphology%')).toBeInTheDocument();
    expect(
      screen.getByText('%interlinearizer_viewOption_showFreeTranslation%'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('%interlinearizer_viewOption_hideInactiveLinkButtons%'),
    ).toBeInTheDocument();
    expect(screen.getByText('%interlinearizer_viewOption_simplifyPhrases%')).toBeInTheDocument();
    expect(
      screen.getByText('%interlinearizer_viewOption_chapterLabelInVerse%'),
    ).toBeInTheDocument();
    expect(screen.getByText('%interlinearizer_viewOption_showSuggestions%')).toBeInTheDocument();
  });

  describe('panel positioning', () => {
    it('repositions the panel when the window resizes while open', async () => {
      let bottom = 30;
      let right = 200;
      jest.spyOn(HTMLButtonElement.prototype, 'getBoundingClientRect').mockImplementation(() => {
        const rect = { top: 10, bottom, left: 100, right, width: 100, height: 20, x: 100, y: 10 };
        return { ...rect, toJSON: () => rect };
      });
      Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true });

      render(<ViewOptionsDropdown {...DEFAULT_PROPS} />);
      await userEvent.click(screen.getByTestId('view-options-button'));

      const panel = screen.getByTestId('view-options-panel');
      expect(panel).toHaveStyle({ top: '34px', right: '800px' });

      // Simulate a layout shift, then fire resize: the panel should re-anchor to the button.
      bottom = 50;
      right = 300;
      act(() => {
        window.dispatchEvent(new Event('resize'));
      });

      expect(panel).toHaveStyle({ top: '54px', right: '700px' });
    });

    it('removes the resize listener when the panel closes', async () => {
      const removeSpy = jest.spyOn(window, 'removeEventListener');

      render(<ViewOptionsDropdown {...DEFAULT_PROPS} />);
      await userEvent.click(screen.getByTestId('view-options-button'));
      await userEvent.click(screen.getByTestId('view-options-button'));

      expect(removeSpy).toHaveBeenCalledWith('resize', expect.any(Function));
    });
  });

  describe('continuous scroll toggle', () => {
    it('reflects the checked value', async () => {
      render(<ViewOptionsDropdown {...DEFAULT_PROPS} continuousScroll />);
      await userEvent.click(screen.getByTestId('view-options-button'));

      expect(screen.getByRole('checkbox', { name: /continuousScroll/i })).toBeChecked();
    });

    it('calls onContinuousScrollChange when toggled', async () => {
      const onContinuousScrollChange = jest.fn();
      render(
        <ViewOptionsDropdown
          {...DEFAULT_PROPS}
          continuousScroll={false}
          onContinuousScrollChange={onContinuousScrollChange}
        />,
      );
      await userEvent.click(screen.getByTestId('view-options-button'));

      await userEvent.click(screen.getByRole('checkbox', { name: /continuousScroll/i }));

      expect(onContinuousScrollChange).toHaveBeenCalledWith(true);
    });
  });

  describe('show morphology toggle', () => {
    it('reflects the checked value', async () => {
      render(<ViewOptionsDropdown {...DEFAULT_PROPS} showMorphology />);
      await userEvent.click(screen.getByTestId('view-options-button'));

      expect(screen.getByRole('checkbox', { name: /morphology/i })).toBeChecked();
    });

    it('calls onShowMorphologyChange when toggled', async () => {
      const onShowMorphologyChange = jest.fn();
      render(
        <ViewOptionsDropdown
          {...DEFAULT_PROPS}
          showMorphology={false}
          onShowMorphologyChange={onShowMorphologyChange}
        />,
      );
      await userEvent.click(screen.getByTestId('view-options-button'));

      await userEvent.click(screen.getByRole('checkbox', { name: /morphology/i }));

      expect(onShowMorphologyChange).toHaveBeenCalledWith(true);
    });
  });

  describe('show free translation toggle', () => {
    it('reflects the checked value', async () => {
      render(<ViewOptionsDropdown {...DEFAULT_PROPS} showFreeTranslation />);
      await userEvent.click(screen.getByTestId('view-options-button'));

      expect(screen.getByRole('checkbox', { name: /freeTranslation/i })).toBeChecked();
    });

    it('calls onShowFreeTranslationChange when toggled', async () => {
      const onShowFreeTranslationChange = jest.fn();
      render(
        <ViewOptionsDropdown
          {...DEFAULT_PROPS}
          showFreeTranslation={false}
          onShowFreeTranslationChange={onShowFreeTranslationChange}
        />,
      );
      await userEvent.click(screen.getByTestId('view-options-button'));

      await userEvent.click(screen.getByRole('checkbox', { name: /freeTranslation/i }));

      expect(onShowFreeTranslationChange).toHaveBeenCalledWith(true);
    });
  });

  describe('hide inactive link buttons toggle', () => {
    it('reflects the checked value', async () => {
      render(<ViewOptionsDropdown {...DEFAULT_PROPS} hideInactiveLinkButtons />);
      await userEvent.click(screen.getByTestId('view-options-button'));

      expect(screen.getByRole('checkbox', { name: /hideInactiveLinkButtons/i })).toBeChecked();
    });

    it('calls onHideInactiveLinkButtonsChange when toggled', async () => {
      const onHideInactiveLinkButtonsChange = jest.fn();
      render(
        <ViewOptionsDropdown
          {...DEFAULT_PROPS}
          hideInactiveLinkButtons={false}
          onHideInactiveLinkButtonsChange={onHideInactiveLinkButtonsChange}
        />,
      );
      await userEvent.click(screen.getByTestId('view-options-button'));

      await userEvent.click(screen.getByRole('checkbox', { name: /hideInactiveLinkButtons/i }));

      expect(onHideInactiveLinkButtonsChange).toHaveBeenCalledWith(true);
    });
  });

  describe('simplify phrases toggle', () => {
    it('reflects the checked value', async () => {
      render(<ViewOptionsDropdown {...DEFAULT_PROPS} simplifyPhrases />);
      await userEvent.click(screen.getByTestId('view-options-button'));

      expect(screen.getByRole('checkbox', { name: /simplifyPhrases/i })).toBeChecked();
    });

    it('calls onSimplifyPhrasesChange when toggled', async () => {
      const onSimplifyPhrasesChange = jest.fn();
      render(
        <ViewOptionsDropdown
          {...DEFAULT_PROPS}
          simplifyPhrases={false}
          onSimplifyPhrasesChange={onSimplifyPhrasesChange}
        />,
      );
      await userEvent.click(screen.getByTestId('view-options-button'));

      await userEvent.click(screen.getByRole('checkbox', { name: /simplifyPhrases/i }));

      expect(onSimplifyPhrasesChange).toHaveBeenCalledWith(true);
    });
  });

  describe('chapter label in verse toggle', () => {
    it('reflects the checked value', async () => {
      render(<ViewOptionsDropdown {...DEFAULT_PROPS} chapterLabelInVerse />);
      await userEvent.click(screen.getByTestId('view-options-button'));

      expect(screen.getByRole('checkbox', { name: /chapterLabelInVerse/i })).toBeChecked();
    });

    it('calls onChapterLabelInVerseChange when toggled', async () => {
      const onChapterLabelInVerseChange = jest.fn();
      render(
        <ViewOptionsDropdown
          {...DEFAULT_PROPS}
          chapterLabelInVerse={false}
          onChapterLabelInVerseChange={onChapterLabelInVerseChange}
        />,
      );
      await userEvent.click(screen.getByTestId('view-options-button'));

      await userEvent.click(screen.getByRole('checkbox', { name: /chapterLabelInVerse/i }));

      expect(onChapterLabelInVerseChange).toHaveBeenCalledWith(true);
    });
  });

  describe('show suggestions toggle', () => {
    it('reflects the checked value', async () => {
      render(<ViewOptionsDropdown {...DEFAULT_PROPS} showSuggestions />);
      await userEvent.click(screen.getByTestId('view-options-button'));

      expect(screen.getByRole('checkbox', { name: /showSuggestions/i })).toBeChecked();
    });

    it('calls onShowSuggestionsChange when toggled', async () => {
      const onShowSuggestionsChange = jest.fn();
      render(
        <ViewOptionsDropdown
          {...DEFAULT_PROPS}
          showSuggestions={false}
          onShowSuggestionsChange={onShowSuggestionsChange}
        />,
      );
      await userEvent.click(screen.getByTestId('view-options-button'));

      await userEvent.click(screen.getByRole('checkbox', { name: /showSuggestions/i }));

      expect(onShowSuggestionsChange).toHaveBeenCalledWith(true);
    });
  });
});
