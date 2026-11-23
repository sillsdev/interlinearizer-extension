import { useEffect } from 'react';
import useLatestRef from './useLatestRef';

/** Arguments for {@link useSentinelExtend}. */
export interface UseSentinelExtendArgs<E extends string> {
  /**
   * The scrolling element the sentinels are watched inside, or a ref to it. A ref is read when the
   * observer subscribes, after React has attached every ref, the root's included.
   */
  root: HTMLElement | undefined | Readonly<{ current: HTMLElement | null | undefined }>;
  /**
   * Each edge of the window paired with its sentinel element, `undefined` until it mounts. The same
   * edges on every render.
   */
  sentinels: readonly (readonly [E, HTMLElement | undefined])[];
  /** Distance in pixels beyond the root's box at which a sentinel arms. */
  margin: number;
  /**
   * Called with each edge whose sentinel is reported within reach. Read at delivery, so its
   * identity may change freely. `undefined` unsubscribes.
   */
  onReach: ((edge: E) => void) | undefined;
  /**
   * Values whose change re-subscribes the observer. The same length on every render.
   *
   * An `IntersectionObserver` reports only intersection _transitions_. After an extend the sentinel
   * nodes are unchanged and may still sit inside the arming margin, where a stale observer stays
   * silent however far the reader scrolls. A fresh observer re-delivers the initial state, so the
   * window extends again until the sentinel leaves the margin. That loop ends because a delivery
   * that cannot grow the window changes none of these keys.
   */
  resubscribeKeys: readonly unknown[];
}

/**
 * Watches a scroll window's edge sentinels and reports each edge that comes within reach, so the
 * window can extend there before the reader arrives.
 */
export default function useSentinelExtend<E extends string>({
  root,
  sentinels,
  margin,
  onReach,
  resubscribeKeys,
}: UseSentinelExtendArgs<E>): void {
  const onReachRef = useLatestRef(onReach);
  const isEnabled = onReach !== undefined;
  const sentinelEls = sentinels.map(([, el]) => el);

  useEffect(() => {
    const rootEl = root !== undefined && 'current' in root ? root.current : root;
    const edges = new Map<Element, E>();
    sentinels.forEach(([edge, el]) => {
      if (el) edges.set(el, edge);
    });
    if (!rootEl || edges.size === 0 || !isEnabled) return undefined;
    // An observer can deliver entries it queued before it was disconnected. Those were measured
    // against a window since replaced, so only the current subscription reports.
    let isSubscribed = true;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!isSubscribed) return;
        const reached = new Set<E>();
        entries.forEach((entry) => {
          const edge = edges.get(entry.target);
          /* v8 ignore next -- every observed sentinel is registered in the edge map */
          if (entry.isIntersecting && edge !== undefined) reached.add(edge);
        });
        reached.forEach((edge) => onReachRef.current?.(edge));
      },
      { root: rootEl, rootMargin: `${margin}px`, threshold: 0 },
    );
    edges.forEach((_edge, el) => observer.observe(el));
    return () => {
      isSubscribed = false;
      observer.disconnect();
    };
    // The sentinels and keys are spread in, each caller passing the same number every render, so the
    // observer re-subscribes on a change to any one of them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, margin, isEnabled, onReachRef, ...sentinelEls, ...resubscribeKeys]);
}
