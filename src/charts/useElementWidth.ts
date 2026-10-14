import { useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";

/** Width used when the element cannot be measured (jsdom, SSR, display:none). */
export const FALLBACK_WIDTH = 600;

/**
 * Tracks an element's content width with ResizeObserver. Falls back to
 * FALLBACK_WIDTH when ResizeObserver is unavailable or the element measures 0.
 */
export function useElementWidth<T extends HTMLElement = HTMLDivElement>(
  fallback = FALLBACK_WIDTH,
): [RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = Math.floor(el.getBoundingClientRect().width);
      if (w > 0) setWidth((prev) => (prev === w ? prev : w));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return [ref, width];
}
