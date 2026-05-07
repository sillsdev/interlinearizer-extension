/** @file Unit tests for components/ContinuousScrollToggle.tsx. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { useLocalizedStrings } from '@papi/frontend/react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ContinuousScrollToggle from '../../components/ContinuousScrollToggle';

describe('ContinuousScrollToggle', () => {
  beforeEach(() => {
    jest
      .mocked(useLocalizedStrings)
      .mockReturnValue([
        { '%interlinearizer_continuousScrollToggle%': 'Continuous Scroll' },
        false,
      ]);
  });

  it('calls onCheckedChange when toggled', async () => {
    const onCheckedChange = jest.fn();
    render(<ContinuousScrollToggle checked onCheckedChange={onCheckedChange} />);
    const checkbox = screen.getByRole('checkbox');

    expect(checkbox).toBeChecked();
    await userEvent.click(checkbox);

    expect(onCheckedChange).toHaveBeenCalledWith(false);
  });
});
