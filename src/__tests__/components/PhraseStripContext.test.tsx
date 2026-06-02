/** @file Unit tests for components/PhraseStripContext.tsx. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react';
import { PhraseStripProvider, usePhraseStripContext } from '../../components/PhraseStripContext';
import { makePhraseStripContext } from '../test-helpers';

/**
 * Test consumer that reads the strip context and renders one of its values so the test can assert
 * the provided value reached the consumer.
 *
 * @returns A span containing the resolved `editPhraseSegmentId`.
 */
function Consumer() {
  const { editPhraseSegmentId } = usePhraseStripContext();
  return <span data-testid="seg">{editPhraseSegmentId ?? 'none'}</span>;
}

describe('PhraseStripContext', () => {
  it('provides the context value to consumers below the provider', () => {
    render(
      <PhraseStripProvider value={makePhraseStripContext({ editPhraseSegmentId: 'seg-7' })}>
        <Consumer />
      </PhraseStripProvider>,
    );
    expect(screen.getByTestId('seg')).toHaveTextContent('seg-7');
  });

  it('throws when used outside a provider', () => {
    // Silence the expected React error boundary console noise for the thrown render.
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Consumer />)).toThrow(
      'usePhraseStripContext must be used within a PhraseStripProvider',
    );
    spy.mockRestore();
  });
});
