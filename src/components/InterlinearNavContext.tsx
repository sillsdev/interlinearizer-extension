import type { UseWebViewScrollGroupScrRefHook } from '@papi/core';
import type { SerializedVerseRef } from '@sillsdev/scripture';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { RECENTER_FADE_MS } from './recenter-fade';

/**
 * The cross-book fade clock. A book change unmounts {@link Interlinearizer} (the loader swaps to a
 * `Loading…` placeholder while the new book's USJ is fetched), so the segment list's and strip's
 * own recenter fade — which lives inside that subtree — cannot span the gap. This clock lives in
 * the provider, above the unmount, so it can drive a loader-level curtain across the whole load.
 *
 * - `idle` — no cross-book transition in flight; the curtain is fully visible (opacity 1).
 * - `out` — a book change was detected; the curtain is fading to opacity 0 and is held there through
 *   the load and the new book's first-mount settle.
 * - `in` — the new book reported settled ({@link InterlinearNav.reportSettled}); the curtain is fading
 *   back to opacity 1, after which it returns to `idle`.
 */
export type FadePhase = 'idle' | 'out' | 'in';

/**
 * Where a navigation originated, classified _at the call site_ rather than reverse-engineered after
 * the fact:
 *
 * - `internal` — the user acted within the views (a segment/token click in the list, or strip arrow
 *   nav). The target is already on screen, so the segment window must _not_ fade/rebuild for it.
 * - `external` — the reference changed from outside the views (Paratext verse selector, scroll
 *   group). The target may be anywhere, so the window fades and recenters.
 *
 * Defaults to `external` when omitted: an unclassified `navigate` is treated as the conservative
 * fading case, so a missing annotation can never silently suppress a needed recenter.
 */
export type NavOrigin = 'internal' | 'external';

/**
 * Normalizes a chapter-level reference (verse 0, as the scripture controls emit for a chapter
 * selection) to the chapter's first verse. The host echoes navigations back through this same
 * mapping ({@link InterlinearNavProvider}'s `liveScrRef`), so applying it everywhere a reference is
 * keyed or compared keeps the stamped-at-click identity and the delivered identity in lockstep.
 *
 * @param ref - The reference to normalize.
 * @returns `ref` unchanged, or a copy with `verseNum` 0 mapped to 1.
 */
export function normalizeScrRef(ref: SerializedVerseRef): SerializedVerseRef {
  return ref.verseNum === 0 ? { ...ref, verseNum: 1 } : ref;
}

/**
 * Builds a stable string key identifying the verse a reference names. Used to match an internal
 * navigation against the `liveScrRef` the host later delivers, so the segment window can tell an
 * internally-originated change apart from an external one. Keys the {@link normalizeScrRef}-mapped
 * reference so a stamp and the later delivered (already-normalized) reference can never diverge on
 * the verse-0 boundary.
 *
 * @param ref - The scripture reference to key.
 * @returns A `book:chapter:verse` string uniquely identifying the verse.
 */
export function verseKey(ref: SerializedVerseRef): string {
  const normalized = normalizeScrRef(ref);
  return `${normalized.book}:${normalized.chapterNum}:${normalized.verseNum}`;
}

/**
 * The single navigation surface for the Interlinearizer WebView. Owns the scripture reference, the
 * scroll-group linkage, the cross-book fade clock, and the internal/external classification of each
 * navigation that were previously read and written by the loader, `Interlinearizer`, and the
 * segment window on independent clocks. Hoisting them here lets every consumer read and mutate
 * navigation through one source of truth.
 */
export interface InterlinearNav {
  /**
   * `rawScrRef` straight from the host scroll-group hook, verbatim. Drives the editable
   * book/chapter nav controls so a chapter selection (verse 0) is reflected exactly as the user
   * entered it.
   */
  rawScrRef: SerializedVerseRef;
  /**
   * `rawScrRef` with a chapter-level (verse 0) reference normalized to verse 1. Selecting a chapter
   * in the scripture controls yields `verseNum: 0`, which names the chapter rather than a verse —
   * no segment has verse 0, so the active-verse lookup, the `isActive` highlight, and the
   * continuous strip's focus resolution would all miss, leaving the list parked on the book's first
   * phrase with nothing highlighted. Mapping verse 0 to the chapter's first verse makes every
   * downstream consumer resolve the intended verse.
   */
  liveScrRef: SerializedVerseRef;
  /**
   * Sets the scripture reference, writing through to the host scroll-group ref, and records the
   * navigation's {@link NavOrigin}. An `internal` origin marks the target verse so the segment
   * window skips its recenter fade (the target is already on screen); `external` (the default)
   * leaves it to fade. Replaces the old pattern of stamping a shared `internalNavRef` and
   * reverse-engineering the origin by string comparison.
   *
   * @param newScrRef - The reference to navigate to.
   * @param origin - Where the navigation came from; defaults to `external`.
   */
  navigate: (newScrRef: SerializedVerseRef, origin?: NavOrigin) => void;
  /**
   * Consumes a pending internal-navigation marker for `ref`: returns `true` (and clears the marker)
   * when the most recent {@link navigate} to this verse was `internal`, else `false`. The segment
   * window calls this when an anchor change arrives to decide whether to fade. Consuming clears the
   * marker so a later _external_ navigation to the same verse still fades.
   *
   * @param ref - The reference whose pending classification to consume.
   * @returns `true` if the navigation to `ref` was internal (skip the fade), else `false`.
   */
  consumeInternalNav: (ref: SerializedVerseRef) => boolean;
  /** The currently active scroll-group ID (`undefined` = unlinked). */
  scrollGroupId: number | undefined;
  /** Changes the active scroll group. */
  setScrollGroupId: (scrollGroupId: number | undefined) => void;
  /**
   * Current phase of the cross-book fade clock. Drives the loader-level curtain opacity so a book
   * change fades out, holds through the load and first-mount settle, then fades back in. See
   * {@link FadePhase}.
   */
  fadePhase: FadePhase;
  /**
   * Reports that the view has finished settling on the current book (active verse snapped into
   * place, layout stabilized). Lifts the cross-book curtain: transitions the clock from `out` to
   * `in`. No-op unless a cross-book fade is awaiting settle, so an unrelated settle (e.g. a
   * same-book recenter, or a remount that wasn't a book change) can't lift a curtain that isn't
   * down — or start one that never began.
   */
  reportSettled: () => void;
  /**
   * Aborts an in-flight cross-book fade and reveals the content immediately. Called by the loader
   * when the new book fails to load, so the error is shown rather than left hidden behind a curtain
   * that will never receive a settle.
   */
  cancelFade: () => void;
}

/**
 * React context carrying the {@link InterlinearNav} surface. Undefined outside a provider so
 * {@link useInterlinearNav} can throw a clear error rather than handing back a silently-empty
 * object.
 */
const InterlinearNavContext = createContext<InterlinearNav | undefined>(undefined);

/**
 * Provides the {@link InterlinearNav} surface to the subtree. Calls the host scroll-group hook
 * internally so the PAPI ref remains the ultimate owner of the shared reference — the context
 * writes through it rather than shadowing it, keeping other scroll-group consumers in sync.
 *
 * @param props - Component props.
 * @param props.useWebViewScrollGroupScrRef - The PAPI hook exposing the shared scroll-group
 *   reference and its setter; injected by the host (not imported) so it can be stubbed in tests.
 * @param props.children - The subtree that consumes navigation through {@link useInterlinearNav}.
 * @returns The provider wrapping `children`.
 */
export function InterlinearNavProvider({
  useWebViewScrollGroupScrRef,
  children,
}: Readonly<{
  useWebViewScrollGroupScrRef: UseWebViewScrollGroupScrRefHook;
  children: ReactNode;
}>) {
  const [rawScrRef, setScrRef, scrollGroupId, setScrollGroupId] = useWebViewScrollGroupScrRef();

  const liveScrRef = useMemo(() => normalizeScrRef(rawScrRef), [rawScrRef]);

  /**
   * Verse keys of internal navigations still awaiting their host round-trip. A `navigate(ref,
   * 'internal')` adds `verseKey(ref)`; `consumeInternalNav` removes it on match. A set (not a
   * single value) handles rapid successive internal clicks: if two verses are clicked before the
   * host delivers the first `liveScrRef`, both keys stay pending so neither delivery is misread as
   * external.
   */
  const pendingInternalNavRef = useRef<Set<string>>(new Set());

  const navigate = useCallback(
    (newScrRef: SerializedVerseRef, origin: NavOrigin = 'external') => {
      if (origin === 'internal') pendingInternalNavRef.current.add(verseKey(newScrRef));
      setScrRef(newScrRef);
    },
    [setScrRef],
  );

  const consumeInternalNav = useCallback((ref: SerializedVerseRef) => {
    const key = verseKey(ref);
    if (!pendingInternalNavRef.current.has(key)) return false;
    pendingInternalNavRef.current.delete(key);
    return true;
  }, []);

  const [fadePhase, setFadePhase] = useState<FadePhase>('idle');

  /**
   * Book code the curtain currently shows fully faded-in. A book change is detected by comparing
   * `liveScrRef.book` against this; `reportSettled` advances it to the new book once the view has
   * laid out. Seeded to the book at mount so the initial load shows no fade.
   */
  const displayedBookRef = useRef<string>(liveScrRef.book);

  /**
   * `true` between detecting a book change and the view reporting settled. Gates `reportSettled` so
   * only a settle that actually closes an in-flight cross-book fade lifts the curtain.
   */
  const awaitingSettleRef = useRef(false);

  /** Handle of the in-flight fade-in→idle timer, or `undefined` when none is pending. */
  const fadeInTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Detect a cross-book navigation *during render* and start the fade-out synchronously, so the
  // curtain drops in the same commit the book ref changes — never a paint later (an effect-driven
  // fade-out would let the mounted views render one frame against the new book's ref before the
  // curtain covers them). Setting state during render is the guarded React pattern: `awaitingSettle`
  // flips true so this fires once per book change, and `setFadePhase` is batched into this commit.
  if (liveScrRef.book !== displayedBookRef.current && !awaitingSettleRef.current) {
    awaitingSettleRef.current = true;
    setFadePhase('out');
  }

  const reportSettled = useCallback(() => {
    if (!awaitingSettleRef.current) return;
    awaitingSettleRef.current = false;
    displayedBookRef.current = liveScrRef.book;
    setFadePhase('in');
    if (fadeInTimeoutRef.current !== undefined) clearTimeout(fadeInTimeoutRef.current);
    fadeInTimeoutRef.current = setTimeout(() => {
      fadeInTimeoutRef.current = undefined;
      setFadePhase('idle');
    }, RECENTER_FADE_MS);
  }, [liveScrRef.book]);

  const cancelFade = useCallback(() => {
    if (fadeInTimeoutRef.current !== undefined) {
      clearTimeout(fadeInTimeoutRef.current);
      fadeInTimeoutRef.current = undefined;
    }
    awaitingSettleRef.current = false;
    displayedBookRef.current = liveScrRef.book;
    setFadePhase('idle');
  }, [liveScrRef.book]);

  // Clear any pending fade-in timer on unmount so a deferred state update doesn't run on a torn-down
  // tree.
  useEffect(
    () => () => {
      if (fadeInTimeoutRef.current !== undefined) clearTimeout(fadeInTimeoutRef.current);
    },
    [],
  );

  const value = useMemo<InterlinearNav>(
    () => ({
      rawScrRef,
      liveScrRef,
      navigate,
      consumeInternalNav,
      scrollGroupId,
      setScrollGroupId,
      fadePhase,
      reportSettled,
      cancelFade,
    }),
    [
      rawScrRef,
      liveScrRef,
      navigate,
      consumeInternalNav,
      scrollGroupId,
      setScrollGroupId,
      fadePhase,
      reportSettled,
      cancelFade,
    ],
  );

  return <InterlinearNavContext.Provider value={value}>{children}</InterlinearNavContext.Provider>;
}

/**
 * Reads the {@link InterlinearNav} surface from the nearest {@link InterlinearNavProvider}.
 *
 * @returns The navigation surface.
 * @throws {Error} When called outside an {@link InterlinearNavProvider}.
 */
export function useInterlinearNav(): InterlinearNav {
  const nav = useContext(InterlinearNavContext);
  if (!nav) {
    throw new Error('useInterlinearNav must be used within an InterlinearNavProvider');
  }
  return nav;
}
