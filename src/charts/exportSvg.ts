/*
 * Standalone SVG / PNG export. Charts paint with CSS variables and classes, so
 * a raw clone would render blank or black outside the app. The clone gets:
 *   1. every var(--x) in attributes/inline styles resolved against <html>
 *      (so the active light/dark theme is baked in), and
 *   2. the browser's computed paint/text properties inlined per element
 *      (covers class-based fonts and color-mix() fills),
 *   3. a background rect in the card color.
 */

const PAINT_PROPS = [
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-opacity",
  "stroke-width",
  "stroke-dasharray",
  "opacity",
  "stop-color",
  "font-family",
  "font-size",
  "font-weight",
  "letter-spacing",
  "paint-order",
] as const;

const VAR_RE = /var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/g;

/** Replace var(--x[, fallback]) with the value from the root's computed style (repeat for nested vars). */
export function resolveCssVars(value: string, root: Element = document.documentElement): string {
  const cs = getComputedStyle(root);
  let out = value;
  for (let pass = 0; pass < 5 && out.includes("var("); pass++) {
    out = out.replace(VAR_RE, (_m, name: string, fallback?: string) => cs.getPropertyValue(name).trim() || (fallback ?? "").trim());
  }
  return out;
}

const COLOR_PROPS = new Set(["fill", "stroke", "stop-color"]);
const MODERN_COLOR = /oklab|oklch|color\(|color-mix|\blab\(|\blch\(/;
const rgbCache = new Map<string, string>();
let probe: CanvasRenderingContext2D | null | undefined;

/**
 * Normalise CSS Color 4 values (oklab(), color-mix(), color()) to rgb()/rgba()
 * so the exported file renders in tools that only know sRGB syntax.
 */
function toRgb(color: string): string {
  if (!MODERN_COLOR.test(color)) return color;
  const hit = rgbCache.get(color);
  if (hit) return hit;
  if (probe === undefined) {
    try {
      probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    } catch {
      probe = null;
    }
  }
  if (!probe) return color;
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = "#000";
  probe.fillStyle = color;
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
  const out = a === 255 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
  rgbCache.set(color, out);
  return out;
}

/** Clone `svg` with theme colors and computed styles inlined. */
export function inlineSvg(svg: SVGSVGElement): SVGSVGElement {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const src = [svg, ...Array.from(svg.querySelectorAll("*"))];
  const dst = [clone, ...Array.from(clone.querySelectorAll("*"))];

  dst.forEach((el, i) => {
    for (const attr of Array.from(el.attributes)) {
      if (attr.value.includes("var(")) el.setAttribute(attr.name, resolveCssVars(attr.value));
    }
    const orig = src[i];
    if (!orig || typeof getComputedStyle !== "function") return;
    const cs = getComputedStyle(orig);
    const decl: string[] = [];
    for (const p of PAINT_PROPS) {
      const v = cs.getPropertyValue(p);
      if (v && !v.includes("var(")) decl.push(`${p}:${COLOR_PROPS.has(p) ? toRgb(v) : v}`);
    }
    for (const p of COLOR_PROPS) {
      if (MODERN_COLOR.test(el.getAttribute(p) ?? "")) el.removeAttribute(p);
    }
    // Computed values supersede the authored inline style (which may hold color-mix()).
    if (decl.length) el.setAttribute("style", decl.join(";"));
    el.removeAttribute("class");
    el.removeAttribute("tabindex");
  });

  const w = Number(svg.getAttribute("width")) || svg.getBoundingClientRect().width;
  const h = Number(svg.getAttribute("height")) || svg.getBoundingClientRect().height;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(w));
  clone.setAttribute("height", String(h));
  const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  bg.setAttribute("width", "100%");
  bg.setAttribute("height", "100%");
  bg.setAttribute("fill", resolveCssVars("var(--card)") || "white");
  const titleEl = clone.querySelector("title");
  clone.insertBefore(bg, titleEl ? titleEl.nextSibling : clone.firstChild);
  return clone;
}

export function serializeSvg(svg: SVGSVGElement): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(inlineSvg(svg))}`;
}

function triggerDownload(href: string, filename: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

const withExt = (name: string, ext: string) => (name.toLowerCase().endsWith(`.${ext}`) ? name : `${name}.${ext}`);

export function downloadSvg(svg: SVGSVGElement, filename: string): void {
  const url = URL.createObjectURL(new Blob([serializeSvg(svg)], { type: "image/svg+xml;charset=utf-8" }));
  triggerDownload(url, withExt(filename, "svg"));
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadPng(svg: SVGSVGElement, filename: string, scale = 2): Promise<void> {
  const clone = inlineSvg(svg);
  const w = Number(clone.getAttribute("width")) || 600;
  const h = Number(clone.getAttribute("height")) || 300;
  const url = URL.createObjectURL(
    new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml;charset=utf-8" }),
  );
  return new Promise<void>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error("Canvas 2D context unavailable"));
        return;
      }
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("PNG encoding failed"));
          return;
        }
        const pngUrl = URL.createObjectURL(blob);
        triggerDownload(pngUrl, withExt(filename, "png"));
        setTimeout(() => URL.revokeObjectURL(pngUrl), 0);
        resolve();
      }, "image/png");
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not rasterize SVG"));
    };
    img.src = url;
  });
}
