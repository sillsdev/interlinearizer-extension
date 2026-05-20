/** @file Unit tests for components/GlossStore.tsx. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  GlossStoreProvider,
  useAllGlosses,
  useGloss,
  useGlossDispatch,
} from '../../components/GlossStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Renders a component that displays the gloss for a single token, used to assert on `useGloss`.
 *
 * @param tokenId - Token id to subscribe to.
 * @returns JSX element suitable for passing to `render`.
 */
function GlossReader({ tokenId }: Readonly<{ tokenId: string }>) {
  const gloss = useGloss(tokenId);
  return <span data-testid="gloss">{gloss}</span>;
}

/**
 * Renders a component that displays all glosses as JSON, used to assert on `useAllGlosses`.
 *
 * @returns JSX element suitable for passing to `render`.
 */
function AllGlossesReader() {
  const glosses = useAllGlosses();
  return <span data-testid="all-glosses">{JSON.stringify(glosses)}</span>;
}

/**
 * Renders a component that calls `useGlossDispatch` without a provider, used to assert the hook
 * throws outside a {@link GlossStoreProvider}.
 *
 * @returns Nothing — only mounted to trigger the throw.
 */
function DispatchUser() {
  useGlossDispatch();
  return undefined;
}

/**
 * Renders a button that calls `useGlossDispatch` to write a gloss, used to test dispatch.
 *
 * @param props.tokenId - Token id to write.
 * @param props.value - Gloss value to write.
 * @returns JSX element suitable for passing to `render`.
 */
function GlossWriter({ tokenId, value }: Readonly<{ tokenId: string; value: string }>) {
  const dispatch = useGlossDispatch();
  return (
    <button onClick={() => dispatch(tokenId, value)} type="button">
      write
    </button>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useGloss', () => {
  it('returns an empty string for an unknown token', () => {
    render(
      <GlossStoreProvider>
        <GlossReader tokenId="tok-1" />
      </GlossStoreProvider>,
    );
    expect(screen.getByTestId('gloss')).toHaveTextContent('');
  });

  it('returns the seeded value for a token in initialGlosses', () => {
    render(
      <GlossStoreProvider initialGlosses={{ 'tok-1': 'hello' }}>
        <GlossReader tokenId="tok-1" />
      </GlossStoreProvider>,
    );
    expect(screen.getByTestId('gloss')).toHaveTextContent('hello');
  });

  it('updates when the subscribed token changes', async () => {
    render(
      <GlossStoreProvider>
        <GlossReader tokenId="tok-1" />
        <GlossWriter tokenId="tok-1" value="world" />
      </GlossStoreProvider>,
    );
    expect(screen.getByTestId('gloss')).toHaveTextContent('');
    await userEvent.click(screen.getByRole('button', { name: 'write' }));
    expect(screen.getByTestId('gloss')).toHaveTextContent('world');
  });

  it('does not update when a different token changes', async () => {
    let renderCount = 0;

    function CountingGlossReader({ tokenId }: Readonly<{ tokenId: string }>) {
      renderCount += 1;
      const gloss = useGloss(tokenId);
      return <span data-testid="gloss">{gloss}</span>;
    }

    render(
      <GlossStoreProvider>
        <CountingGlossReader tokenId="tok-1" />
        <GlossWriter tokenId="tok-2" value="other" />
      </GlossStoreProvider>,
    );
    const initialRenderCount = renderCount;
    await userEvent.click(screen.getByRole('button', { name: 'write' }));
    expect(renderCount).toBe(initialRenderCount);
  });

  it('throws when called outside a GlossStoreProvider', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<GlossReader tokenId="tok-1" />)).toThrow(
      'useGloss must be used inside a GlossStoreProvider',
    );
  });
});

describe('useAllGlosses', () => {
  it('returns an empty object when no glosses have been set', () => {
    render(
      <GlossStoreProvider>
        <AllGlossesReader />
      </GlossStoreProvider>,
    );
    expect(screen.getByTestId('all-glosses')).toHaveTextContent('{}');
  });

  it('returns seeded glosses from initialGlosses', () => {
    render(
      <GlossStoreProvider initialGlosses={{ 'tok-1': 'hi' }}>
        <AllGlossesReader />
      </GlossStoreProvider>,
    );
    expect(screen.getByTestId('all-glosses')).toHaveTextContent(JSON.stringify({ 'tok-1': 'hi' }));
  });

  it('updates when any token changes', async () => {
    render(
      <GlossStoreProvider>
        <AllGlossesReader />
        <GlossWriter tokenId="tok-1" value="world" />
      </GlossStoreProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'write' }));
    expect(screen.getByTestId('all-glosses')).toHaveTextContent(
      JSON.stringify({ 'tok-1': 'world' }),
    );
  });

  it('throws when called outside a GlossStoreProvider', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<AllGlossesReader />)).toThrow(
      'useAllGlosses must be used inside a GlossStoreProvider',
    );
  });
});

describe('useGlossDispatch', () => {
  it('calls the onGlossChange spy with tokenId and value', async () => {
    const spy = jest.fn();
    render(
      <GlossStoreProvider onGlossChange={spy}>
        <GlossWriter tokenId="tok-1" value="hi" />
      </GlossStoreProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'write' }));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('tok-1', 'hi');
  });

  it('throws when called outside a GlossStoreProvider', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<DispatchUser />)).toThrow(
      'useGlossDispatch must be used inside a GlossStoreProvider',
    );
  });
});
