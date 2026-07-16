/** Live KaTeX rendering shared by the authoring canvas and read-only formula views. */

import { useEffect, useRef } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

export function FormulaPreview({
  latex,
  variant = "bar",
}: {
  latex: string;
  variant?: "bar" | "card";
}) {
  const ref = useRef<HTMLDivElement>(null);

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
  }, [latex]);

  return (
    <div
      className={
        variant === "card"
          ? "ui-scroll flex min-h-[46px] items-center overflow-x-auto rounded-md border border-border-2 bg-card-2 px-2 py-1.5"
          : "ui-scroll flex min-h-[42px] flex-none items-center justify-center overflow-x-auto border-b border-border bg-card-2 px-3 py-1.5"
      }
      aria-label="LaTeX formula preview"
    >
      <div
        ref={ref}
        className={variant === "card" ? "w-max min-w-full text-center text-md text-fg" : "text-center text-md text-fg"}
      />
    </div>
  );
}
