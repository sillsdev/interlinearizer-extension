import { logger } from '@papi/frontend';
import type { SerializedVerseRef } from '@sillsdev/scripture';
import type { Book, ScriptureRef, Segment, Token } from 'interlinearizer';
import { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import useLatestRef from '../hooks/useLatestRef';
import { isWordToken } from '../types/type-guards';
import { isSameVerse, segmentContainsVerse, toSerializedVerseRef } from '../utils/verse-ref';
import { useInterlinearNav, verseKey } from './InterlinearNavContext';

/**
 * Where a focus change came from, recorded _at the call site_ rather than reconstructed by the
 * consumers reacting to it. Every consumer maps origin to behavior itself, and the mappings
 * deliberately disagree — a click in the segment list is `list`, which the list treats as its own
 * doing and the strip treats as a jump it still has to travel:
 *
 * - `seed` — no user act: the initial resolution of the active verse, or the strip naming its first
 *   token when nothing resolved. The view is static or invisible, so the move is instant.
 * - `strip` — the continuous strip emitted it (arrow step, phrase click, phrase-mode entry). The one
 *   origin the strip animates through rather than fading over, since it owns the scroll and the
 *   target is already on screen.
 * - `list` — a click or focus inside the segment list. Already on screen for the list; a jump the
 *   strip has to fade for.
 * - `reseed` — focus following the reference rather than driving it, when an external navigation
 *   lands somewhere the focused token cannot stay.
 * - `request` — a focus asked for from outside the views and claimed by the book that resolves it.
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
   * a reseed or a claim that resolves to the standing focus wakes nobody — and so the origin never
   * moves while the token ref holds still, which is what lets a reader treat the origin as the
   * classification of the change it is already reacting to.
   */
  write: (tokenRef: string | undefined, origin: FocusOrigin) => void;
}

/** The write paths that own how focus moves; identities are stable for the provider's lifetime. */
export interface FocusActions {
  /**
   * Focuses `tokenRef` and, when it lives in a different verse than the active one, navigates
   * there. The single explicit focus-move operation behind strip arrow nav and phrase clicks: it
   * sets the focused token and pushes the verse change as an _internal_ navigation (so the segment
   * window tracks along without a recenter fade). A verse-0 segment (a chapter superscription)
   * navigates like any other verse.
   *
   * Never navigates when the focused token's book differs from the active reference's book: during
   * an external book change the reference can briefly name the new book while the mounted book (and
   * this token) still belong to the previous one, and echoing that stale verse would overwrite the
   * new reference.
   */
  focusToken: (tokenRef: string, origin: FocusOrigin) => void;
  /**
   * Updates the active scripture reference (when the verse actually changed) and, when a specific
   * token was clicked, focuses that token. Skips the write to PAPI when the clicked verse matches
   * the current one, avoiding a gratuitous echo round-trip. A verse-0 segment (a chapter
   * superscription) writes like any other verse.
   *
   * @param ref - The verse coordinate that was selected.
   * @param tokenRef - The token that was clicked; omitted when the whole segment was selected.
   */
  selectSegment: (ref: ScriptureRef, tokenRef?: string) => void;
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

/** Builds a store seeded with `tokenRef` as a {@link FocusOrigin} `seed`. */
export function createFocusStore(tokenRef: string | undefined): FocusStore {
  let focus: Focus = { tokenRef, origin: 'seed' };
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
 * Publishes an already-built store and action set to the subtree. Separate from
 * {@link FocusProvider} so a view can be exercised against a store driven directly, without the book
 * indexes and navigation surface the real provider resolves focus from.
 */
export function FocusStoreProvider({ store, actions, children }: FocusStoreProviderProps) {
  const value = useMemo<FocusContextValue>(() => ({ store, actions }), [store, actions]);
  return <FocusContext.Provider value={value}>{children}</FocusContext.Provider>;
}

/** Props for {@link FocusProvider}. */
type FocusProviderProps = Readonly<{
  /** Tokenized book the focused token must resolve within. */
  book: Book;
  /**
   * Current scripture reference. Resolved by the loader to a verse contained in some segment of
   * `book` (when the chapter has segments), so the active segment behind a reseed is normally
   * found.
   */
  scrRef: SerializedVerseRef;
  /** Maps every segment id to its segment; resolves the focused token's own verse range. */
  segmentById: ReadonlyMap<string, Segment>;
  /** Maps every token ref to the id of the segment that contains it. */
  tokenSegmentMap: ReadonlyMap<string, string>;
  /** Maps every word token ref to the token; decides whether this book can hold a given focus. */
  wordTokenByRef: ReadonlyMap<string, Token & { type: 'word' }>;
  /** The views that read and move focus. */
  children: ReactNode;
}>;

/**
 * Owns the focused word token for one mounted book, and resolves it against the book and the active
 * verse in one ordered rule set, so no two rules can race on which reseed wins.
 *
 * Seeded so focus is never `undefined` while the active verse has a word token: an undefined focus
 * disables every link button, since the active-segment test reads the focused segment.
 */
export function FocusProvider({
  book,
  scrRef,
  segmentById,
  tokenSegmentMap,
  wordTokenByRef,
  children,
}: FocusProviderProps) {
  // `navigate` writes the reference (classifying internal vs external at the call site), and
  // `consumeFocusRequest` / `focusRequestCount` collect a token focus asked for from outside the
  // views.
  const { navigate, consumeFocusRequest, focusRequestCount } = useInterlinearNav();

  /**
   * Finds the book segment that owns the active verse: the first segment in document order whose
   * verse range contains it. Containment (rather than an exact start-verse match) matters after
   * boundary edits — a verse absorbed into a multi-verse segment, or named by a later portion of a
   * split verse, still resolves to the segment that holds its text. The containment test also
   * matches the book, so during a cross-book navigation (where the reference names the new book
   * before its data loads, leaving `book` still the previous one) this finds nothing rather than
   * resolving to the wrong book's verse.
   */
  const findActiveSegment = () => book.segments.find((seg) => segmentContainsVerse(seg, scrRef));

  const storeRef = useRef<FocusStore | undefined>(undefined);
  if (storeRef.current === undefined) {
    storeRef.current = createFocusStore(firstWordTokenRefOf(findActiveSegment()));
  }
  const store = storeRef.current;

  // Mirrored so the actions below keep one identity for the provider's lifetime: a focus handler
  // passed to a memoized child must not churn when the book's indexes are rebuilt.
  const navigateRef = useLatestRef(navigate);
  const scrRefRef = useLatestRef(scrRef);
  const segmentByIdRef = useLatestRef(segmentById);
  const tokenSegmentMapRef = useLatestRef(tokenSegmentMap);

  const actions = useMemo<FocusActions>(
    () => ({
      focusToken: (tokenRef, origin) => {
        store.write(tokenRef, origin);
        const segId = tokenSegmentMapRef.current.get(tokenRef);
        /* v8 ignore next 2 -- tokenRef always resolves to a segment in the mounted book */
        const seg = segId === undefined ? undefined : segmentByIdRef.current.get(segId);
        if (!seg) return;
        const { current } = scrRefRef;
        if (seg.startRef.book !== current.book) return;
        // Containment check (not exact start-verse match): focusing another token of the segment
        // that already holds the active verse must not renavigate to the segment's start verse.
        if (segmentContainsVerse(seg, current)) return;
        navigateRef.current(toSerializedVerseRef(seg.startRef), 'internal');
      },
      selectSegment: (ref, tokenRef) => {
        const { current } = scrRefRef;
        if (!isSameVerse(ref, current)) {
          navigateRef.current(toSerializedVerseRef(ref), 'internal');
        }
        if (tokenRef) store.write(tokenRef, 'list');
      },
    }),
    [store, navigateRef, scrRefRef, segmentByIdRef, tokenSegmentMapRef],
  );

  /**
   * The inputs the resolution below classifies on, as of its last run. Compared rather than
   * consumed from the dependency list because the rules need to know _which_ input moved: a book
   * that no longer holds the focused token and a verse the focused segment no longer covers reseed
   * on different tests.
   */
  const prevInputsRef = useRef({ book, verse: verseKey(scrRef) });

  // Resolve focus against the book and the active verse, in priority order. Ordering the rules
  // inside one effect is what makes the precedence explicit: an outside request outranks both
  // reseeds, and reordering hooks cannot change that. Runs after commit rather than during render
  // so a claim is never made in a render React may discard.
  useEffect(() => {
    const prev = prevInputsRef.current;
    const verse = verseKey(scrRef);
    // Refreshed up front so no early return leaves an input stale for a later comparison.
    prevInputsRef.current = { book, verse };

    // Attempted on every run, not only when the count moves: the count is the only signal when a
    // request names the verse already on screen, and the book the only one when it named a book
    // that had yet to load. Claiming clears the request, so a run that finds nothing left is a
    // no-op. A ref this book cannot resolve is dropped rather than held for a later attempt: one
    // that outlived the load it was made for would fire on an unrelated navigation, long after the
    // click that raised it. Logged because the drop is otherwise invisible.
    const requested = consumeFocusRequest(book.bookRef);
    if (requested !== undefined) {
      if (wordTokenByRef.has(requested)) {
        store.write(requested, 'request');
        return;
      }
      logger.warn(`Interlinearizer: focus request "${requested}" matched no word token`);
    }

    const { tokenRef: current } = store.getFocus();
    const resolvesInBook = current !== undefined && wordTokenByRef.has(current);

    // A boundary edit (merge/split) produces a fresh book too, but token refs survive
    // re-segmentation, so a still-resolving focus is kept rather than snapped back to the active
    // verse's first word — and left to the verse rule below, which a re-tokenization arriving
    // alongside a navigation still has to answer.
    if (book !== prev.book && !resolvesInBook) {
      store.write(firstWordTokenRefOf(findActiveSegment()), 'reseed');
      return;
    }

    // Skip when the focused token's *own* segment already contains the new verse — that means the
    // change came from a token click or strip nav here, and reseeding would clobber the
    // deliberately-focused token. Testing the focused token's own segment (not the active segment's
    // id) is what lets a click on a non-first portion of a split verse stay put instead of being
    // reseeded to the verse's first portion.
    if (verse !== prev.verse) {
      const focusedSegId = current ? tokenSegmentMap.get(current) : undefined;
      const focusedSeg = focusedSegId ? segmentById.get(focusedSegId) : undefined;
      if (focusedSeg && segmentContainsVerse(focusedSeg, scrRef)) return;
      /* v8 ignore next -- the active segment is always found when the book includes the verse */
      store.write(firstWordTokenRefOf(findActiveSegment()), 'reseed');
    }
    // findActiveSegment closes over the reactive inputs already listed; the lookup maps and
    // consumeFocusRequest are read only as resolvers, and listing them would re-run the rules on
    // a phrase edit that moved no focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book, scrRef.book, scrRef.chapterNum, scrRef.verseNum, focusRequestCount]);

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
 * Returns a stable getter for the focus as of the moment it is called, for event-time reads that
 * must not subscribe the caller to focus moves.
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
