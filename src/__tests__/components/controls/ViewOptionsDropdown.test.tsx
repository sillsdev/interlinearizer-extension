/** @file Unit tests for components/ViewOptionsDropdown.tsx. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { useLocalizedStrings } from '@papi/frontend/react';
import { render, screen } from '@testing-library/react';
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
  showMorphology: false,
  onShowMorphologyChange: jest.fn(),
  showFreeTranslation: false,
  onShowFreeTranslationChange: jest.fn(),
  showVerseGutter: false,
  onShowVerseGutterChange: jest.fn(),
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

  it('renders labels from useLocalizedStrings for every toggle', async () => {
    render(<ViewOptionsDropdown {...DEFAULT_PROPS} />);
    await userEvent.click(screen.getByTestId('view-options-button'));

    // The mock returns each key as its own label, so each toggle's key surfaces as visible text.
    expect(screen.getByText('%interlinearizer_viewOption_continuousScroll%')).toBeInTheDocument();
    expect(screen.getByText('%interlinearizer_viewOption_showMorphology%')).toBeInTheDocument();
    expect(
      screen.getByText('%interlinearizer_viewOption_showFreeTranslation%'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('%interlinearizer_viewOption_hideInactiveLinkButtons%'),
    ).toBeInTheDocument();
    expect(screen.getByText('%interlinearizer_viewOption_simplifyPhrases%')).toBeInTheDocument();
    expect(screen.getByText('%interlinearizer_viewOption_showVerseGutter%')).toBeInTheDocument();
    expect(screen.getByText('%interlinearizer_viewOption_showSuggestions%')).toBeInTheDocument();
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

  describe('show verse gutter toggle', () => {
    it('reflects the checked value', async () => {
      render(<ViewOptionsDropdown {...DEFAULT_PROPS} showVerseGutter />);
      await userEvent.click(screen.getByTestId('view-options-button'));

      expect(screen.getByRole('checkbox', { name: /verseGutter/i })).toBeChecked();
    });

    it('calls onShowVerseGutterChange when toggled', async () => {
      const onShowVerseGutterChange = jest.fn();
      render(
        <ViewOptionsDropdown
          {...DEFAULT_PROPS}
          showVerseGutter={false}
          onShowVerseGutterChange={onShowVerseGutterChange}
        />,
      );
      await userEvent.click(screen.getByTestId('view-options-button'));

      await userEvent.click(screen.getByRole('checkbox', { name: /verseGutter/i }));

      expect(onShowVerseGutterChange).toHaveBeenCalledWith(true);
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
