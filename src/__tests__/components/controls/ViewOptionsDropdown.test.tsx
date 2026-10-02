/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ViewOptionsDropdown from '../../../components/controls/ViewOptionsDropdown';
import { mockKeyAsValueLocalizedStrings } from '../test-helpers';

beforeEach(() => {
  mockKeyAsValueLocalizedStrings();
});

const DEFAULT_PROPS = {
  continuousScroll: false,
  onContinuousScrollChange: jest.fn(),
  showMorphology: false,
  onShowMorphologyChange: jest.fn(),
  showFreeTranslation: false,
  onShowFreeTranslationChange: jest.fn(),
};

describe('ViewOptionsDropdown', () => {
  it('renders a gear button that is not expanded by default', () => {
    render(<ViewOptionsDropdown {...DEFAULT_PROPS} />);

    const button = screen.getByTestId('view-options-button');
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('view-options-panel')).not.toBeInTheDocument();
  });

  it('names the gear button on hover while the panel is closed', () => {
    // The tooltip text rides the Tooltip component; the mock projects it onto the trigger as `title`.
    mockKeyAsValueLocalizedStrings({ '%interlinearizer_viewOptions_label%': 'View options' });
    render(<ViewOptionsDropdown {...DEFAULT_PROPS} />);

    expect(screen.getByTestId('view-options-button')).toHaveAttribute('title', 'View options');
  });

  it('drops the gear tooltip while the panel is open', async () => {
    // The panel it opened is already on screen, so a tooltip naming it would only overlap that.
    mockKeyAsValueLocalizedStrings({ '%interlinearizer_viewOptions_label%': 'View options' });
    render(<ViewOptionsDropdown {...DEFAULT_PROPS} />);

    await userEvent.click(screen.getByTestId('view-options-button'));

    expect(screen.getByTestId('view-options-button')).not.toHaveAttribute('title');
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
});
