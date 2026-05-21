/**
 * @file Test helpers used to build type-safe mocks without type assertions. Provides a minimal
 *   ExecutionActivationContext that satisfies @papi/core types, and a `useWebViewState` hook stub
 *   for component tests.
 */
import type { ExecutionActivationContext } from '@papi/core';
import { UnsubscriberAsyncList } from 'platform-bible-utils';

/** Minimal execution token-shaped object for tests (structural match for ExecutionToken). */
const mockExecutionToken: {
  type: 'extension';
  name: string;
  nonce: string;
  getHash: () => string;
} = {
  type: 'extension',
  name: 'interlinearizer-test',
  nonce: 'test-nonce',
  getHash: (): string => 'test-hash',
};

/** Typed read/write pair stored per key in {@link makeWebViewState}. */
type StateSlot<T> = { get: () => T; set: (v: T) => void };

/**
 * Returns a `useWebViewState` hook stub that stores values in typed per-key closures so state
 * persists across re-renders within the same test without requiring any type assertions.
 *
 * @returns A hook function with the signature `(key, defaultValue) => [value, setter, reset]` where
 *   `value` is the current stored value for `key` (initially `defaultValue`), `setter` updates it,
 *   and `reset` removes the slot so the next call re-initializes from `defaultValue`.
 */
export function makeWebViewState() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const slots = new Map<string, StateSlot<any>>();
  return <T,>(key: string, defaultValue: T): [T, (v: T) => void, () => void] => {
    let slot: StateSlot<T> | undefined = slots.get(key);
    if (slot === undefined) {
      let stored = defaultValue;
      slot = {
        get: () => stored,
        set: (v) => {
          stored = v;
        },
      };
      slots.set(key, slot);
    }
    const resolvedSlot = slot;
    return [
      resolvedSlot.get(),
      (v: T) => resolvedSlot.set(v),
      () => {
        slots.delete(key);
      },
    ];
  };
}

/** Minimal elevated privileges for tests (all properties optional per papi type). */
const mockElevatedPrivileges = {
  createProcess: undefined,
  manageExtensions: undefined,
  handleUri: undefined,
};

/**
 * Builds a minimal ExecutionActivationContext for unit testing activate(). Uses
 * UnsubscriberAsyncList from the platform-bible-utils Jest mock.
 *
 * @returns Context that satisfies ExecutionActivationContext for tests that only use
 *   registrations.add
 */
export function createTestActivationContext(): ExecutionActivationContext {
  return {
    name: 'interlinearizer-test',
    executionToken: mockExecutionToken,
    elevatedPrivileges: mockElevatedPrivileges,
    registrations: new UnsubscriberAsyncList('test'),
  };
}
