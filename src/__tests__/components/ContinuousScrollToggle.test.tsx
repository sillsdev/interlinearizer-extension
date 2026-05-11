/** @file Unit tests for components/ContinuousScrollToggle.tsx. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ContinuousScrollToggle from '../../components/ContinuousScrollToggle';

describe('ContinuousScrollToggle', () => {
  it('renders with a label', async () => {
    render(
      <ContinuousScrollToggle checked label="Continuous Scroll" onCheckedChange={jest.fn()} />,
    );
    const checkbox = screen.getByRole('checkbox');
    const label = screen.getByText('Continuous Scroll');

    expect(label).toBeInTheDocument();
    expect(label).toHaveAttribute('for', checkbox.id);
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
