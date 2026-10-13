/** Live KaTeX rendering shared by the authoring canvas and read-only formula views. */

import { useEffect, useRef, useState } from "react";
import katex from "katex";
import { Maximize2 } from "lucide-react";
import "katex/dist/katex.min.css";

import { Modal } from "../shared-console/src";

/** Smallest scale a long formula shrinks to before it scrolls instead. */
const MIN_FIT = 0.6;

export function FormulaPreview({
  latex,
  variant = "bar",
  fit: shrink = true,
}: {
  latex: string;
  variant?: "bar" | "card";
  /** Shrink a wide formula to fit (default). The full-view dialog turns this off. */
  fit?: boolean;
}) {
  const outer = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);
  const [fullView, setFullView] = useState(false);

  useEffect(() => {
    if (!ref.current) return;
    try {
      katex.render(latex || "\\square", ref.current, {
        displayMode: true,
        throwOnError: false,
      });
    } catch {
      ref.current.textContent = "";
    }
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fit reads the refs it needs
  }, [latex]);

  // Shrink a formula that is wider than its box, down to MIN_FIT, then let it scroll.
  // The scale is computed from the natural (unscaled) width, so re-running it
  // after its own font-size change settles instead of oscillating.
  function fit() {
    const box = outer.current;
    const content = ref.current;
    if (!box || !content) return;
    if (!shrink) {
      content.style.fontSize = "";
      return;
    }
    const available = box.clientWidth - 24;
    if (available <= 0) return;
    const current = parseFloat(content.style.fontSize) || 1;
    const natural = content.scrollWidth / current;
    const scale = natural > available ? Math.max(MIN_FIT, available / natural) : 1;
    if (Math.abs(scale - current) > 0.005) content.style.fontSize = scale === 1 ? "" : `${scale}em`;
    // Still too wide at the smallest scale: it scrolls, so offer a full-size view.
    setOverflows(natural * scale > available + 1);
  }

  useEffect(() => {
    if (typeof ResizeObserver === "undefined" || !outer.current || !ref.current) return;
    // Refit when the box resizes or the formula itself changes size (KaTeX's
    // fonts load lazily and widen it after the first paint). Fitting in the
    // next frame keeps a fit-induced resize out of the observer callback.
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => fit());
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(outer.current);
    observer.observe(ref.current);
    const fonts = typeof document !== "undefined" ? document.fonts : undefined;
    fonts?.addEventListener?.("loadingdone", schedule);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      fonts?.removeEventListener?.("loadingdone", schedule);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-once observer
  }, []);

  return (
    <div className={`relative ${variant === "bar" ? "flex-none" : ""}`}>
      <div
        ref={outer}
        className={
          variant === "card"
            ? "ui-scroll flex min-h-[46px] items-center overflow-x-auto rounded-md border border-border-2 bg-card-2 px-2 py-1.5"
            : // "safe center" keeps a too-wide formula scrollable from its left edge.
              "ui-scroll flex min-h-[42px] flex-none items-center overflow-x-auto border-b border-border bg-card-2 px-3 py-1.5 [justify-content:safe_center]"
        }
        role="figure"
        aria-label="Formula preview"
        // Long formulas scroll horizontally; the region must be reachable by keyboard.
        tabIndex={0}
      >
        <div
          ref={ref}
          className={
            variant === "card"
              ? "w-max min-w-full text-center text-md text-fg"
              : "w-max text-center text-md text-fg"
          }
        />
      </div>
      {overflows && (
        <button
          type="button"
          className="absolute right-1.5 top-1.5 inline-flex h-6 items-center gap-1 rounded-md border border-border bg-card px-1.5 text-cap font-medium text-muted-fg hover:bg-muted hover:text-fg"
          onClick={() => setFullView(true)}
          title="The formula is wider than this box — open it at full size"
        >
          <Maximize2 size={11} aria-hidden /> Full view
        </button>
      )}
      {fullView && (
        <Modal title="Formula" onClose={() => setFullView(false)} w={1100}>
          <div className="mt-3">
            <FormulaPreview latex={latex} variant="card" fit={false} />
          </div>
        </Modal>
      )}
    </div>
  );
}
