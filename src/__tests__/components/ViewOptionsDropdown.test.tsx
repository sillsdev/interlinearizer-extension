/** @file Unit tests for components/ViewOptionsDropdown.tsx. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { useLocalizedStrings } from '@papi/frontend/react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ViewOptionsDropdown from '../../components/controls/ViewOptionsDropdown';

beforeEach(() => {
  // Restore key-as-value behaviour cleared by resetMocks: true.
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

  it('renders labels from useLocalizedStrings for all three toggles', async () => {
    render(<ViewOptionsDropdown {...DEFAULT_PROPS} />);
    await userEvent.click(screen.getByTestId('view-options-button'));

    // The papi-frontend-react mock returns each key as its own label value.
    expect(screen.getByText('%interlinearizer_viewOption_continuousScroll%')).toBeInTheDocument();
    expect(
      screen.getByText('%interlinearizer_viewOption_hideInactiveLinkButtons%'),
    ).toBeInTheDocument();
    expect(screen.getByText('%interlinearizer_viewOption_simplifyPhrases%')).toBeInTheDocument();
  });

  describe('continuous scroll toggle', () => {
    it('reflects the checked value', async () => {
      render(<ViewOptionsDropdown {...DEFAULT_PROPS} continuousScroll />);
      await userEvent.click(screen.getByTestId('view-options-button'));

      const checkboxes = screen.getAllByRole('checkbox');
      expect(checkboxes[0]).toBeChecked();
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

      const checkboxes = screen.getAllByRole('checkbox');
      await userEvent.click(checkboxes[0]);

      expect(onContinuousScrollChange).toHaveBeenCalledWith(true);
    });

    it('does not call onContinuousScrollChange when continuousScrollDisabled is true', async () => {
      const onContinuousScrollChange = jest.fn();
      render(
        <ViewOptionsDropdown
          {...DEFAULT_PROPS}
          continuousScrollDisabled
          onContinuousScrollChange={onContinuousScrollChange}
        />,
      );
      await userEvent.click(screen.getByTestId('view-options-button'));

      const checkboxes = screen.getAllByRole('checkbox');
      await userEvent.click(checkboxes[0]);

      expect(onContinuousScrollChange).not.toHaveBeenCalled();
    });
  });

  describe('hide inactive link buttons toggle', () => {
    it('reflects the checked value', async () => {
      render(<ViewOptionsDropdown {...DEFAULT_PROPS} hideInactiveLinkButtons />);
      await userEvent.click(screen.getByTestId('view-options-button'));

      const checkboxes = screen.getAllByRole('checkbox');
      expect(checkboxes[1]).toBeChecked();
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

      const checkboxes = screen.getAllByRole('checkbox');
      await userEvent.click(checkboxes[1]);

      expect(onHideInactiveLinkButtonsChange).toHaveBeenCalledWith(true);
    });
  });

  describe('dim inactive segments toggle', () => {
    it('reflects the checked value', async () => {
      render(<ViewOptionsDropdown {...DEFAULT_PROPS} simplifyPhrases />);
      await userEvent.click(screen.getByTestId('view-options-button'));

      const checkboxes = screen.getAllByRole('checkbox');
      expect(checkboxes[2]).toBeChecked();
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

      const checkboxes = screen.getAllByRole('checkbox');
      await userEvent.click(checkboxes[2]);

      expect(onSimplifyPhrasesChange).toHaveBeenCalledWith(true);
    });
  });
});
