/** @file Unit tests for components/AltHeldContext.tsx. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react';
import { AltHeldProvider, useAltHeldValue } from '../../components/AltHeldContext';

/**
 * Renders the current Alt-held value from context as a testable string.
 *
 * @returns A span containing the current Alt-held value stringified.
 */
function AltHeldProbe() {
  const altHeld = useAltHeldValue();
  return <span data-testid="probe">{String(altHeld)}</span>;
}

describe('AltHeldContext', () => {
  it('delivers the provided value to consumers', () => {
    render(
      <AltHeldProvider value>
        <AltHeldProbe />
      </AltHeldProvider>,
    );
    expect(screen.getByTestId('probe')).toHaveTextContent('true');
  });

  it('defaults to false for a consumer rendered without a provider', () => {
    render(<AltHeldProbe />);
    expect(screen.getByTestId('probe')).toHaveTextContent('false');
  });
});
