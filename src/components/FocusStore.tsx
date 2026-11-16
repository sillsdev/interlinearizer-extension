import { logger } from '@papi/frontend';
import type { SerializedVerseRef } from '@sillsdev/scripture';
import type { ScriptureRef, Segment } from 'interlinearizer';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';
import type { ReactNode } from 'react';
import useLatestRef from '../hooks/useLatestRef';
import type { OutlineSegment, SegmentPages } from '../types/segment-pages';
import { isWordToken } from '../types/type-guards';
import { outlineRangeOf, type PageIndexes } from '../utils/page-indexes';
import { perfMark, perfMarksEnabled } from '../utils/perf-marks';
import { isSameVerse, segmentContainsVerse, toSerializedVerseRef } from '../utils/verse-ref';
import { useInterlinearNav, verseKey } from './InterlinearNavContext';

/**
 * Where a focus change came from, recorded _at the call site_ rather than reconstructed by the
 * consumers reacting to it. Each consumer maps origin to behavior itself, and the mappings
 * deliberately disagree: a move is already on screen for the view that made it and a jump for the
 * other.
 *
 * - `seed` — no user act: the initial resolution of the active verse, or a view naming its own first
 *   token when nothing resolved.
 * - `strip` — the continuous strip's arrow step, phrase click, or phrase-mode entry.
 * - `list` — a click or focus inside the segment list.
 * - `reseed` — focus following the reference rather than driving it, when a navigation lands
 *   somewhere the focused token cannot stay.
 * - `request` — a focus asked for from outside the views, claimed by the book that resolves it.
 */
export type FocusOrigin = 'seed' | 'strip' | 'list' | 'reseed' | 'request';

/** The focused word token together with the origin of the write that put it there. */
export type Focus = Readonly<{
  /** Token ref of the focused word token, or `undefined` when nothing is focused. */
  tokenRef: string | undefined;
  /** Where the write that set {@link Focus.tokenRef} came from. */
  origin: FocusOrigin;
}>;

/**
 * Holds the focused token outside React so an event-time reader can take the current value without
 * subscribing, and a subscriber re-renders only for focus.
 */
export interface FocusStore {
  /** The focus as of now, including writes made earlier in the current event. */
  getFocus: () => Focus;
  /**
   * Registers `onFocusChange` for every write that changes the focused token.
   *
   * @returns The unsubscribe function.
   */
  subscribe: (onFocusChange: () => void) => () => void;
  /**
   * Sets the focused token and its origin. A write naming the token already focused is dropped, so
   * a reseed or a claim resolving to the standing focus wakes nobody.
   *
   * The origin therefore never moves while the token ref holds still.
   */
  write: (tokenRef: string | undefined, origin: FocusOrigin) => void;
}

/** Options for {@link FocusActions.selectSegment}. */
export type SelectSegmentOptions = Readonly<{
  /**
   * Whether the token stands in for its whole segment rather than naming a clicked token, so that a
   * focus already in that segment stays where the reader left it.
   */
  anchor?: boolean;
}>;

/** The write paths that own how focus moves; identities are stable for the provider's lifetime. */
export interface FocusActions {
  /**
   * Focuses `tokenRef` and, when it lives in a different verse than the active one, navigates there
   * as an _internal_ navigation, so the segment window tracks along without a recenter fade. A
   * verse-0 segment (a chapter superscription) navigates like any other verse.
   *
   * Never navigates when the token's book differs from the active reference's book. Mid cross-book
   * navigation the reference names the new book while the mounted book still holds this token, and
   * echoing that stale verse would overwrite the new reference.
   */
  focusToken: (tokenRef: string, origin: FocusOrigin) => void;
  /**
   * Updates the active scripture reference and, when `tokenRef` names a clicked token rather than a
   * whole segment, focuses it. Skips the write to PAPI when the clicked verse is already the
   * current one, avoiding a gratuitous echo round-trip. A verse-0 segment (a chapter
   * superscription) writes like any other verse. An `anchor` call whose segment already holds the
   * focus moves neither the reference nor the focus.
   */
  selectSegment: (ref: ScriptureRef, tokenRef?: string, options?: SelectSegmentOptions) => void;
}

/** What {@link FocusStoreProvider} carries; stable, so reading it never re-renders a consumer. */
type FocusContextValue = Readonly<{
  store: FocusStore;
  actions: FocusActions;
}>;

/**
 * React context carrying the focus surface. Undefined outside a provider so the hooks can throw a
 * clear error rather than handing back a silently-empty object.
 */
const FocusContext = createContext<FocusContextValue | undefined>(undefined);

/**
 * Returns the ref of the first word token in `segment`, or `undefined` when the segment has none.
 * The resolution behind every focus that follows the active verse rather than a click.
 *
 * @param segment - The segment to read, or `undefined` when no active segment is resolved.
 */
function firstWordTokenRefOf(segment: Segment | undefined): string | undefined {
  return segment?.tokens.find(isWordToken)?.ref;
}

function isReaderChoice(origin: FocusOrigin): boolean {
  return origin !== 'seed' && origin !== 'reseed';
}

/** Builds a store seeded with `tokenRef` from `seedOrigin`, a `seed` when omitted. */
export function createFocusStore(
  tokenRef: string | undefined,
  seedOrigin: FocusOrigin = 'seed',
): FocusStore {
  let focus: Focus = { tokenRef, origin: seedOrigin };
  const listeners = new Set<() => void>();
  return {
    getFocus: () => focus,
    subscribe: (onFocusChange) => {
      listeners.add(onFocusChange);
      return () => {
        listeners.delete(onFocusChange);
      };
    },
    write: (nextTokenRef, origin) => {
      perfMark('focus-write', { moved: nextTokenRef !== focus.tokenRef });
      if (nextTokenRef === focus.tokenRef) return;
      focus = { tokenRef: nextTokenRef, origin };
      listeners.forEach((listener) => listener());
    },
  };
}

/** Props for {@link FocusStoreProvider}. */
type FocusStoreProviderProps = Readonly<{
  /** The store the subtree reads focus from. */
  store: FocusStore;
  /** The write paths the subtree calls to move focus. */
  actions: FocusActions;
  /** The subtree that reads and moves focus. */
  children: ReactNode;
}>;

/**
 * Publishes an already-built store and action set to the subtree, so a view can be mounted over a
 * store driven directly rather than one resolved from a book and a reference.
 */
export function FocusStoreProvider({ store, actions, children }: FocusStoreProviderProps) {
  const value = useMemo<FocusContextValue>(() => ({ store, actions }), [store, actions]);
  return (
    <FocusContext.Provider value={value}>
      {children}
      {perfMarksEnabled() && <FocusRenderProbe />}
    </FocusContext.Provider>
  );
}

/** Marks each commit that renders a focus move, so a timing can end once the moved focus shows. */
function FocusRenderProbe() {
  const { tokenRef } = useFocus();
  const mountedRef = useRef(false);
  useLayoutEffect(() => {
    if (mountedRef.current) perfMark('focus-render');
    mountedRef.current = true;
  }, [tokenRef]);
  return undefined;
}

/** The lookups that {@link FocusProvider} resolves a focus against. */
export type FocusIndexes = Pick<
  PageIndexes,
  'segmentById' | 'tokenSegmentMap' | 'wordTokenByRef'
> & {
  /** Every segment of the outline, by id. */
  outlineSegmentById: ReadonlyMap<
    string,
    Pick<OutlineSegment, 'startRef' | 'verseStarts' | 'heading'>
  >;
};

/** Props for {@link FocusProvider}. */
type FocusProviderProps = Readonly<{
  /** The pages of the book that the focused token must resolve within. */
  pages: SegmentPages;
  /**
   * Current scripture reference, already resolved by the loader to a verse some segment of the book
   * contains whenever the chapter has segments.
   */
  scrRef: SerializedVerseRef;
  /** The lookups over the pages loaded, built again as more load. */
  indexes: FocusIndexes;
  /** The views that read and move focus. */
  children: ReactNode;
}>;

/**
 * Owns the focused word token for one mounted book, and resolves it against the book and the active
 * verse in one ordered rule set, so no two rules can race on which reseed wins.
 *
 * Seeded so focus is never `undefined` while the active verse has a word token: an undefined focus
 * disables every link button, since the active-segment test reads the focused segment. A request or
 * a reseed whose segment has yet to load waits for its page.
 */
export function FocusProvider({ pages, scrRef, indexes, children }: FocusProviderProps) {
  const { navigate, consumeFocusRequest, peekFocusRequest, focusRequestCount, publishedFocus } =
    useInterlinearNav();
  const { segmentById, tokenSegmentMap, wordTokenByRef, outlineSegmentById } = indexes;

  /**
   * The outline index of the segment that owns the active verse: the first in document order whose
   * verse range contains it. Containment rather than an exact start-verse match, so a verse
   * absorbed into a multi-verse segment — or named by a later portion of a split verse — still
   * resolves to the segment holding its text.
   *
   * Finds nothing while the reference names a book the mounted pages are not, which is the state a
   * cross-book navigation passes through before the new book's pages arrive.
   */
  const activeIndex = () => pages.outline.findIndex((seg) => segmentContainsVerse(seg, scrRef));

  /**
   * The first word token of the segment owning the active verse; `'unloaded'` while that segment's
   * page has yet to load.
   */
  const activeSeed = (): string | undefined | 'unloaded' => {
    const index = activeIndex();
    if (index === -1) return undefined;
    const segment = pages.segmentAt(index);
    return segment ? firstWordTokenRefOf(segment) : 'unloaded';
  };

  /** The word token a request names, or the first word token of the segment it names. */
  const requestedToken = (requested: string) =>
    wordTokenByRef.has(requested) ? requested : firstWordTokenRefOf(segmentById.get(requested));

  /** Whether the segment that a request names has yet to load. */
  const awaitsPage = (requested: string) => {
    const range = outlineRangeOf(pages.outline, requested);
    return range !== undefined && pages.segmentAt(range.start) === undefined;
  };

  const storeRef = useRef<FocusStore | undefined>(undefined);
  /** Whether a reseed is waiting for the active verse's page to load. */
  const reseedPendingRef = useRef(false);
  if (storeRef.current === undefined) {
    // Seeded from a pending request so the views mount already framing it; the claim follows.
    const requested = peekFocusRequest(pages.bookRef);
    const target = requested === undefined ? undefined : requestedToken(requested);
    const seed = activeSeed();
    /* v8 ignore next -- the pages publish once the active verse's page has loaded */
    if (seed === 'unloaded') reseedPendingRef.current = true;
    storeRef.current =
      target !== undefined
        ? createFocusStore(target, 'request')
        : createFocusStore(seed === 'unloaded' ? undefined : seed);
  }
  const store = storeRef.current;

  // Tracked beside the store, whose origin holds still while the token does: clicking the word the
  // view focused itself makes it the reader's choice without moving focus.
  const chosenRef = useRef(isReaderChoice(store.getFocus().origin));
  const publishFocus = useCallback(
    () => publishedFocus.publish(chosenRef.current ? store.getFocus().tokenRef : undefined),
    [publishedFocus, store],
  );
  const markChosen = useCallback(() => {
    chosenRef.current = true;
    publishFocus();
  }, [publishFocus]);

  // Mirrored so the actions below keep one identity for the provider's lifetime: a focus handler
  // passed to a memoized child must not churn when the book's indexes are rebuilt.
  const navigateRef = useLatestRef(navigate);
  const scrRefRef = useLatestRef(scrRef);
  const outlineSegmentByIdRef = useLatestRef(outlineSegmentById);
  const tokenSegmentMapRef = useLatestRef(tokenSegmentMap);

  const actions = useMemo<FocusActions>(
    () => ({
      focusToken: (tokenRef, origin) => {
        store.write(tokenRef, origin);
        if (isReaderChoice(origin)) markChosen();
        const segId = tokenSegmentMapRef.current.get(tokenRef);
        /* v8 ignore next 2 -- tokenRef always resolves to a segment in the mounted book */
        const seg = segId === undefined ? undefined : outlineSegmentByIdRef.current.get(segId);
        if (!seg) return;
        const { current } = scrRefRef;
        if (seg.startRef.book !== current.book) return;
        // Containment check (not exact start-verse match): focusing another token of the segment
        // that already holds the active verse must not renavigate to the segment's start verse.
        if (segmentContainsVerse(seg, current)) return;
        navigateRef.current(toSerializedVerseRef(seg.startRef), 'internal');
      },
      selectSegment: (ref, tokenRef, options) => {
        if (options?.anchor && tokenRef) {
          const focused = store.getFocus().tokenRef;
          const segIdOf = (token: string) => tokenSegmentMapRef.current.get(token);
          if (focused !== undefined && segIdOf(focused) === segIdOf(tokenRef)) {
            markChosen();
            return;
          }
        }
        const { current } = scrRefRef;
        if (!isSameVerse(ref, current)) {
          navigateRef.current(toSerializedVerseRef(ref), 'internal');
        }
        if (tokenRef) {
          store.write(tokenRef, 'list');
          markChosen();
        }
      },
    }),
    [store, markChosen, navigateRef, scrRefRef, outlineSegmentByIdRef, tokenSegmentMapRef],
  );

  /**
   * The inputs the resolution below classifies on, as of its last run. Compared rather than taken
   * from the dependency list, because the rules test a moved book and a moved verse differently.
   */
  const prevInputsRef = useRef({ pages, verse: verseKey(scrRef) });

  // Resolve focus against the book and the active verse, in priority order: an outside request
  // outranks both reseeds. Runs after commit rather than during render, so a claim is never made in
  // a render React may discard.
  useEffect(() => {
    const prev = prevInputsRef.current;
    const verse = verseKey(scrRef);
    // Refreshed up front so no early return leaves an input stale for a later comparison.
    prevInputsRef.current = { pages, verse };

    /** Focuses the active verse's first word token, or waits for its page to load. */
    const reseed = () => {
      const seed = activeSeed();
      reseedPendingRef.current = seed === 'unloaded';
      if (seed !== 'unloaded') store.write(seed, 'reseed');
    };

    // Attempted on every run rather than only when the count moves, since a request can name the
    // verse already on screen, a book that had yet to load, or a segment whose page had yet to.
    // Claiming clears it, so a run that finds nothing left is a no-op.
    const requested = peekFocusRequest(pages.bookRef);
    if (requested !== undefined) {
      const target = requestedToken(requested);
      if (target !== undefined) {
        consumeFocusRequest(pages.bookRef);
        reseedPendingRef.current = false;
        store.write(target, 'request');
        // A write naming the focused token moves nothing, so the claim itself marks the choice.
        markChosen();
        return;
      }
      // Once its page has loaded, a request that still matches nothing is dropped rather than held:
      // a request outliving the load it was made for would fire on an unrelated navigation. Logged
      // because the drop is otherwise invisible.
      if (!awaitsPage(requested)) {
        consumeFocusRequest(pages.bookRef);
        logger.warn(`Interlinearizer: focus request "${requested}" matched no word token`);
      }
    }

    const { tokenRef: current } = store.getFocus();
    const resolvesInBook = current !== undefined && wordTokenByRef.has(current);

    // Token refs survive re-segmentation, so a boundary edit keeps a still-resolving focus rather
    // than snapping back to the active verse's first word. Kept focus falls through to the verse
    // rule, which a re-tokenization arriving alongside a navigation still has to answer.
    if (pages !== prev.pages && !resolvesInBook) {
      reseed();
      return;
    }

    // Skip when the focused token's *own* segment already contains the new verse: the change came
    // from a click or a strip step here, and reseeding would clobber the deliberate focus. Testing
    // that segment rather than the active segment's id is what lets a click on a non-first portion
    // of a split verse stay put.
    if (verse !== prev.verse) {
      const focusedSegId = current ? tokenSegmentMap.get(current) : undefined;
      const focusedSeg = focusedSegId ? outlineSegmentById.get(focusedSegId) : undefined;
      if (focusedSeg && segmentContainsVerse(focusedSeg, scrRef)) {
        reseedPendingRef.current = false;
        return;
      }
      reseed();
      return;
    }

    if (reseedPendingRef.current) reseed();
    // activeSeed and the request resolvers close over the inputs already listed; consumeFocusRequest
    // and peekFocusRequest are read only as resolvers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages, indexes, scrRef.book, scrRef.chapterNum, scrRef.verseNum, focusRequestCount]);

  // Withdrawn on unmount, so a surface beside the view never acts on a token of a book since left.
  useEffect(() => {
    publishFocus();
    const unsubscribe = store.subscribe(() => {
      chosenRef.current = isReaderChoice(store.getFocus().origin);
      publishFocus();
    });
    return () => {
      unsubscribe();
      publishedFocus.publish(undefined);
    };
  }, [publishFocus, publishedFocus, store]);

  return (
    <FocusStoreProvider store={store} actions={actions}>
      {children}
    </FocusStoreProvider>
  );
}

/** Reads the nearest provider's focus surface, or throws when there is none. */
function useFocusContext(hookName: string): FocusContextValue {
  const context = useContext(FocusContext);
  if (!context) throw new Error(`${hookName} must be used within a FocusProvider`);
  return context;
}

/**
 * Subscribes to the focused token: the caller re-renders on every focus move and on nothing else.
 *
 * @throws {Error} When called outside a {@link FocusProvider}.
 */
export function useFocus(): Focus {
  const { store } = useFocusContext('useFocus');
  return useSyncExternalStore(store.subscribe, store.getFocus);
}

/**
 * Returns a stable getter for the focus as of the call, for event-time reads that must not
 * subscribe the caller to focus moves.
 *
 * @throws {Error} When called outside a {@link FocusProvider}.
 */
export function useFocusGetter(): () => Focus {
  const { store } = useFocusContext('useFocusGetter');
  return store.getFocus;
}

/**
 * Returns the focus write paths. Never re-renders the caller.
 *
 * @throws {Error} When called outside a {@link FocusProvider}.
 */
export function useFocusActions(): FocusActions {
  return useFocusContext('useFocusActions').actions;
}
