/*
 * Text measurement by estimate. SVG layout here must be deterministic (and
 * work in jsdom), so widths come from average glyph advances rather than
 * getComputedTextLength(). Inter ≈ 0.56em per glyph, JetBrains Mono 0.6em.
 */

const NARROW = /[ilIjtf.,:;'|!()[\]1]/;
const WIDE = /[mwMWGOQD@%]/;

export function estimateTextWidth(text: string, fontSize: number, mono = false): number {
  if (mono) return text.length * fontSize * 0.6;
  let em = 0;
  for (const ch of text) em += NARROW.test(ch) ? 0.32 : WIDE.test(ch) ? 0.82 : ch === " " ? 0.28 : 0.56;
  return em * fontSize;
}

/** Cut `text` to fit `maxWidth`, appending an ellipsis when cut. */
export function truncateText(text: string, maxWidth: number, fontSize: number, mono = false): string {
  if (estimateTextWidth(text, fontSize, mono) <= maxWidth) return text;
  const chars = Array.from(text);
  let lo = 0;
  let hi = chars.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const candidate = chars.slice(0, mid).join("").trimEnd() + "…";
    if (estimateTextWidth(candidate, fontSize, mono) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo === 0 ? "…" : chars.slice(0, lo).join("").trimEnd() + "…";
}

/** Word-wrap into at most `maxLines` lines; the last line is ellipsized if text remains. */
export function wrapText(text: string, maxWidth: number, fontSize: number, maxLines = 2): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  let i = 0;
  for (; i < words.length; i++) {
    const next = current ? `${current} ${words[i]}` : words[i];
    if (estimateTextWidth(next, fontSize) <= maxWidth || !current) {
      current = next;
      continue;
    }
    lines.push(current);
    current = words[i];
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && current) {
    lines.push(current);
    current = "";
    i = words.length;
  }
  const overflow = i < words.length;
  const out = lines.slice(0, maxLines).map((l) => truncateText(l, maxWidth, fontSize));
  if (overflow && out.length) {
    const last = out.length - 1;
    out[last] = truncateText(`${out[last].replace(/…$/, "")} ${words.slice(i).join(" ")}`, maxWidth, fontSize);
  }
  return out;
}
