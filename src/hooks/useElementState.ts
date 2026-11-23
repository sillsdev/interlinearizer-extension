import { useCallback, useState } from 'react';

/**
 * Holds in state, rather than in a ref, the element that a ref callback attaches, so an effect that
 * needs the element re-runs once it mounts, and again when it is replaced or removed.
 *
 * @returns The attached element, `undefined` before it mounts, and the ref callback to attach it
 *   with, whose identity is stable.
 */
export default function useElementState<T extends Element = HTMLElement>(): [
  T | undefined,
  (el: T | null) => void,
] {
  const [el, setEl] = useState<T | undefined>(undefined);
  const ref = useCallback((next: T | null) => setEl(next ?? undefined), []);
  return [el, ref];
}
