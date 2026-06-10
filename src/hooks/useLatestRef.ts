import type { RefObject } from 'react';
import { useRef } from 'react';

/**
 * Mirrors a value into a ref whose `.current` always holds the latest render's value, reassigned on
 * every render (before effects run). Lets a `useCallback`/effect read the current value through the
 * ref without listing it as a dependency, so the callback keeps a stable identity even when the
 * value changes identity each render — the PAPI host, for instance, hands `scrRef` back as a fresh
 * object on many renders, and closing over it directly would churn the identity of any callback
 * that reads it. Reading through the ref decouples that churn.
 *
 * @param value - The value to mirror; the returned ref's `.current` is set to it on every render.
 * @returns A stable ref object whose `.current` tracks the latest `value`.
 */
export default function useLatestRef<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
