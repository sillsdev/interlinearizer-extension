import { useEffect, useState } from 'react';
import type { RefObject } from 'react';

/**
 * How wide, in pixels, the element the ref'd one sits in currently is, kept current as that
 * container resizes, and `undefined` before anything has been laid out.
 *
 * For an element sizing itself against the room its siblings are left: the width that governs is
 * the container's rather than its own, and having been placed in that container rather than
 * rendering it, it has no ref of its own to measure.
 */
export default function useContainerWidth(ref: RefObject<HTMLElement | null>): number | undefined {
  const [containerWidth, setContainerWidth] = useState<number | undefined>(undefined);

  useEffect(() => {
    const container = ref.current?.parentElement;
    /* v8 ignore next -- the ref is attached by the very render that mounts this effect */
    if (!container) return undefined;

    const measure = () => {
      setContainerWidth(container.clientWidth > 0 ? container.clientWidth : undefined);
    };
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [ref]);

  return containerWidth;
}
