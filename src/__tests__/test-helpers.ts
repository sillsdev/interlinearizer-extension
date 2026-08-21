import type { SerializedVerseRef } from '@sillsdev/scripture';
import type { ExecutionActivationContext, UseWebViewScrollGroupScrRefHook } from '@papi/core';
import type { Book, InterlinearProject, PhraseAnalysisLink, Segment, Token } from 'interlinearizer';
import { UnsubscriberAsyncList } from 'platform-bible-utils';
import { tokenizeBook } from 'parsers/papi/bookTokenizer';
import type { RawBook } from 'parsers/papi/usjBookExtractor';
import {
  TOKEN_CHIP_LABEL_KEYS,
  type PhraseStripContextValue,
} from '../components/PhraseStripContext';
import { emptyAnalysis } from '../types/empty-factories';
import { CURRENT_MODEL_VERSION } from '../types/model-version';
import type { InterlinearProjectSummary } from '../types/interlinear-project-summary';

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
    hideInactiveLinkButtons: false,
    simplifyPhrases: false,
    showMorphology: false,
    activeSegmentId: undefined,
    crossSegmentLinkTooltip: '',
    linkTokensLabel: '',
    unlinkTokensLabel: '',
    phraseGlossLabel: '',
    phraseEditLabel: '',
    phraseUnlinkLabel: '',
    removeTokenFromPhraseTemplate: '',
    boundaryMergeLabel: '',
    boundaryMergeAltHint: '',
    boundarySplitLabel: '',
    glossPlaceholder: '',
    tokenChipLabels: TOKEN_CHIP_LABEL_KEYS,
    skipLinkTransition: false,
    ...overrides,
  };
}

/**
 * Fixed creation / modification stamps for analysis fixtures whose timestamps are not under test.
 * Analysis payloads and links both require the pair, and spreading one constant keeps a literal
 * date out of every fixture; overriding after the spread pins a specific time where a test does
 * assert on one.
 */
export const FIXTURE_STAMPS = {
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

/** Genesis 1:1 serialized verse ref — shared across tests that need a default scroll position. */
export const defaultScrRef: SerializedVerseRef = { book: 'GEN', chapterNum: 1, verseNum: 1 };

/**
 * Tuple shape returned by the PAPI scroll-group hook (`useWebViewScrollGroupScrRef`). Aliased from
 * the platform hook's own return type so it tracks the tuple's arity (e.g. the trailing
 * `sourceProjectId` added by the host) rather than restating — and drifting from — it.
 */
export type ScrollGroupTuple = ReturnType<UseWebViewScrollGroupScrRefHook>;

/**
 * Builds a `useWebViewScrollGroupScrRef` host-hook stub returning the given tuple parts. Every
 * parameter defaults to the common case so a test overrides only what it asserts on.
 *
 * @param ref - The scripture reference the stub reports; defaults to {@link defaultScrRef}.
 * @param setScrRef - The reference setter; defaults to a no-op.
 * @param scrollGroupId - The active scroll-group id; defaults to `undefined` (unlinked).
 * @param setScrollGroupId - The scroll-group setter; defaults to a no-op.
 * @param sourceProjectId - The scroll group's source project id; defaults to `undefined`.
 */
export function makeScrollGroupHook(
  ref: SerializedVerseRef = defaultScrRef,
  setScrRef: (r: SerializedVerseRef) => void = () => {},
  scrollGroupId: number | undefined = undefined,
  setScrollGroupId: (id: number | undefined) => void = () => {},
  sourceProjectId: string | undefined = undefined,
): () => ScrollGroupTuple {
  return () => [ref, setScrRef, scrollGroupId, setScrollGroupId, sourceProjectId];
}

/** Pre-built Book with one GEN 1:1 segment and a single word token. */
export const GEN_1_1_BOOK: Book = {
  id: 'GEN',
  bookRef: 'GEN',
  textVersion: 'v1',
  segments: [makeSegment('GEN 1:1', 'In the beginning.', [makeWordToken('GEN 1:1:0', 'In')])],
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
 */
export function createTestActivationContext(): ExecutionActivationContext {
  return {
    name: 'interlinearizer-test',
    executionToken: mockExecutionToken,
    elevatedPrivileges: mockElevatedPrivileges,
    registrations: new UnsubscriberAsyncList('test'),
  };
}

/** Builds an {@link InterlinearProjectSummary} fixture with stable defaults. */
export function makeProjectSummary(
  overrides: Partial<InterlinearProjectSummary> = {},
): InterlinearProjectSummary {
  return {
    id: 'proj-uuid',
    createdAt: '2026-01-15T10:30:00.000Z',
    updatedAt: '2026-01-15T10:30:00.000Z',
    sourceProjectId: 'src-proj',
    analysisLanguages: ['en'],
    ...overrides,
  };
}

/**
 * Builds a one-verse `Segment` from a verse sid — `"<book> <chapter>:<verse>"`, e.g. `"GEN 1:1"` —
 * which supplies the segment's id, both of its refs, and the single verse start such a segment
 * carries, so fixtures state only the baseline text and tokens they assert on.
 *
 * Only that one-verse shape is on offer: both refs stay pinned to the sid's own verse and never
 * carry a `charIndex`. A segment spanning several verses, or the continuation piece of a split,
 * builds itself as a literal instead.
 *
 * @throws If the sid names anything but a single verse; a split piece's three-part sid would
 *   otherwise lose its trailing index and yield a segment describing the whole verse.
 */
export function makeSegment(sid: string, baselineText: string, tokens: Token[]): Segment {
  const [book, chapterVerse] = sid.split(' ');
  const parts = chapterVerse?.split(':') ?? [];
  if (parts.length !== 2)
    throw new Error(`makeSegment takes a "<BOOK> <chapter>:<verse>" sid; got "${sid}"`);
  const [chapter, verse] = parts.map(Number);
  const ref = { book, chapter, verse };
  return {
    id: sid,
    startRef: ref,
    endRef: { ...ref },
    baselineText,
    tokens,
    verseStarts: [{ charStart: 0, number: String(verse), chapter }],
  };
}

/** One verse of a book fixture. */
type VerseSpec = {
  sid: string;
  text: string;
  /** Verbatim label the verse renders as; defaults to the verse portion of the sid. */
  number?: string;
};

/**
 * Builds a `RawBook` fixture from a terse verse list, taking its book code from the first verse's
 * sid (or GEN when the list is empty) so call sites state only the sid and text they care about.
 */
export function makeRawBook(verses: VerseSpec[]): RawBook {
  return {
    bookCode: verses[0]?.sid.split(' ')[0] ?? 'GEN',
    writingSystem: 'en',
    contentHash: 'abc123',
    verses: verses.map(({ sid, text, number }) => ({
      sid,
      text,
      number: number ?? sid.slice(sid.lastIndexOf(':') + 1),
    })),
  };
}

/**
 * Builds a tokenized `Book` from a terse verse list, one segment per verse — the segmentation a
 * book carries before any boundary edits.
 */
export function makeVerseBook(verses: VerseSpec[]): Book {
  return tokenizeBook(makeRawBook(verses));
}

/**
 * Builds a minimal `InterlinearProject` test fixture with stable defaults used across command
 * tests.
 */
export function makeStubProject(id = 'proj-id'): InterlinearProject {
  return {
    id,
    modelVersion: CURRENT_MODEL_VERSION,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    sourceProjectId: 'src-project',
    analysisLanguages: ['en'],
    analysis: emptyAnalysis(),
  };
}

/**
 * Builds a minimal word token for use in component tests. Called without a surface text, it reuses
 * the ref as one, which is appropriate for tests that only need a syntactically valid token and do
 * not assert on surface text independently. The end offset is derived from the start one and the
 * surface text, so the token satisfies the `baselineText.slice(charStart, charEnd) === surfaceText`
 * invariant; a fixture that builds a real baseline passes the token's offset within it.
 */
export function makeWordToken(
  ref: string,
  surfaceText = ref,
  charStart = 0,
): Token & { type: 'word' } {
  return {
    ref,
    surfaceText,
    writingSystem: 'en',
    type: 'word',
    charStart,
    charEnd: charStart + surfaceText.length,
  };
}

/**
 * Builds a minimal punctuation token, defaulting to a full stop for the fixtures where the specific
 * mark does not matter. The end offset is derived as it is for a word token.
 */
export function makePunctToken(
  ref: string,
  surfaceText = '.',
  charStart = 0,
): Token & { type: 'punctuation' } {
  return {
    ref,
    surfaceText,
    writingSystem: 'en',
    type: 'punctuation',
    charStart,
    charEnd: charStart + surfaceText.length,
  };
}

/**
 * Builds an approved `PhraseAnalysisLink` fixture for unit tests.
 *
 * @param phraseId - Doubles as the link's `analysisId`, so tests can address the phrase by one id.
 * @param tokenRefs - The linked token refs, in phrase order.
 * @param surfaceTexts - Surface text for each token, parallel to `tokenRefs`. Defaults to the ref
 *   string when omitted, which is only appropriate when drift detection is not under test.
 */
export function makePhraseLink(
  phraseId: string,
  tokenRefs: string[],
  surfaceTexts?: string[],
): PhraseAnalysisLink {
  return {
    ...FIXTURE_STAMPS,
    analysisId: phraseId,
    status: 'approved',
    tokens: tokenRefs.map((ref, i) => ({
      tokenRef: ref,
      surfaceText: surfaceTexts?.[i] ?? ref,
    })),
  };
}

/**
 * Reports the host as macOS to the user-agent check behind the platform's `isMacOs`, so a test can
 * assert the Mac wording of a keyboard hint.
 */
export function pretendMacOs(): void {
  jest
    .spyOn(window.navigator, 'userAgent', 'get')
    .mockReturnValue('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
}
