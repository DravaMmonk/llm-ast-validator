import { render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Histogram, inlineSvg, resolveCssVars } from "./index";

afterEach(() => {
  document.documentElement.style.removeProperty("--card");
  document.documentElement.style.removeProperty("--chart-1");
});

describe("exportSvg", () => {
  it("resolves CSS variables against <html>", () => {
    document.documentElement.style.setProperty("--chart-1", "#2a78d6");
    expect(resolveCssVars("var(--chart-1)")).toBe("#2a78d6");
    expect(resolveCssVars("var(--missing, red)")).toBe("red");
  });

  it("produces a standalone clone with no var() references and a background", () => {
    document.documentElement.style.setProperty("--card", "#ffffff");
    document.documentElement.style.setProperty("--chart-1", "#2a78d6");
    const { container } = render(<Histogram title="Export me" bins={[{ x0: 0, x1: 1, count: 3 }, { x0: 1, x1: 2, count: 5 }]} />);
    const svg = container.querySelector("svg") as SVGSVGElement;
    const clone = inlineSvg(svg);
    expect(clone.getAttribute("xmlns")).toBe("http://www.w3.org/2000/svg");
    expect(clone.outerHTML).not.toMatch(/var\(--chart-1\)/);
    expect(clone.outerHTML).toContain("#2a78d6");
    expect(clone.querySelector("rect")?.getAttribute("fill")).toBe("#ffffff");
    expect(svg.outerHTML).toContain("var(--chart-1)");
  });
});
