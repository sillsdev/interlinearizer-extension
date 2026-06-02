/**
 * @file Test helpers used to build type-safe mocks without type assertions. Provides a minimal
 *   ExecutionActivationContext that satisfies @papi/core types, a `useWebViewState` hook stub for
 *   component tests, and shared Book and analysis fixtures.
 */
import type { SerializedVerseRef } from '@sillsdev/scripture';
import type { ExecutionActivationContext } from '@papi/core';
import type { Book, PhraseAnalysisLink } from 'interlinearizer';
import { UnsubscriberAsyncList } from 'platform-bible-utils';
import type { PhraseStripContextValue } from '../components/PhraseStripContext';

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
 * @param seed - Optional map of key → initial value. When a key is present in `seed` the slot is
 *   pre-populated with that value instead of using the hook's `defaultValue` argument.
 * @returns A hook function with the signature `(key, defaultValue) => [value, setter, reset]` where
 *   `value` is the current stored value for `key` (initially `defaultValue` or the seeded value),
 *   `setter` updates it, and `reset` removes the slot so the next call re-initializes from
 *   `defaultValue`.
 */
export function makeWebViewState(seed: Record<string, unknown> = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const slots = new Map<string, StateSlot<any>>();
  return <T>(key: string, defaultValue: T): [T, (v: T) => void, () => void] => {
    let slot: StateSlot<T> | undefined = slots.get(key);
    if (slot === undefined) {
      // eslint-disable-next-line no-type-assertion/no-type-assertion
      let stored: T = Object.hasOwn(seed, key) ? (seed[key] as T) : defaultValue;
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

/**
 * Builds a {@link PhraseStripContextValue} for component tests, with no-op callbacks and empty
 * lookups by default. Tests that consume strip context wrap their subject in `PhraseStripProvider`
 * with this value (overriding only the fields they assert on).
 *
 * @param overrides - Partial context fields to override the defaults.
 * @returns A complete `PhraseStripContextValue`.
 */
export function makePhraseStripContext(
  overrides: Partial<PhraseStripContextValue> = {},
): PhraseStripContextValue {
  return {
    phraseMode: { kind: 'view' },
    setPhraseMode: () => {},
    editPhraseTokens: undefined,
    editPhraseSegmentId: undefined,
    tokenSegmentMap: new Map(),
    tokenDocOrder: new Map(),
    onHoverPhrase: () => {},
    onHoverCandidateTokens: () => {},
    onHoverSplitFreeTokens: () => {},
    ...overrides,
  };
}

/** Genesis 1:1 serialized verse ref — shared across tests that need a default scroll position. */
export const defaultScrRef: SerializedVerseRef = { book: 'GEN', chapterNum: 1, verseNum: 1 };

/** Pre-built Book with one GEN 1:1 segment and a single word token. */
export const GEN_1_1_BOOK: Book = {
  id: 'GEN',
  bookRef: 'GEN',
  textVersion: 'v1',
  segments: [
    {
      id: 'GEN 1:1',
      startRef: { book: 'GEN', chapter: 1, verse: 1 },
      endRef: { book: 'GEN', chapter: 1, verse: 1 },
      baselineText: 'In the beginning.',
      tokens: [
        {
          ref: 'GEN 1:1:0',
          surfaceText: 'In',
          writingSystem: 'en',
          type: 'word',
          charStart: 0,
          charEnd: 2,
        },
      ],
    },
  ],
};

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

/**
 * Builds an approved `PhraseAnalysisLink` fixture for unit tests.
 *
 * @param phraseId - The analysis id for both the link and its corresponding `PhraseAnalysis`.
 * @param tokenRefs - Token refs to include.
 * @param surfaceTexts - Surface text for each token, parallel to `tokenRefs`. Defaults to the ref
 *   string when omitted, which is only appropriate when drift detection is not under test.
 * @returns A `PhraseAnalysisLink` with `status: 'approved'`.
 */
export function makePhraseLink(
  phraseId: string,
  tokenRefs: string[],
  surfaceTexts?: string[],
): PhraseAnalysisLink {
  return {
    analysisId: phraseId,
    status: 'approved',
    tokens: tokenRefs.map((ref, i) => ({
      tokenRef: ref,
      surfaceText: surfaceTexts?.[i] ?? ref,
    })),
  };
}
