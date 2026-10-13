/**
 * Workstation composition helpers over the frozen console kit. These are
 * arrangements of kit recipes (captions, inputs, buttons, tokens) that several
 * modules share — not a second design language.
 */

import { useMemo, useState, type ReactNode } from "react";
import { Check, CircleAlert, Copy, Info, Pin, TriangleAlert } from "lucide-react";

import type { Frame, FrameColumn, FrameKind } from "../../shared/workbench/dataset";
import { capSm, ghostBtn, selectSmCls, softBtn } from "../shared-console/src";

/** A labelled form row: caption above, control below, optional hint. */
export function Field({
  label,
  hint,
  children,
  htmlFor,
  className = "",
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  htmlFor?: string;
  className?: string;
}) {
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${className}`}>
      <label htmlFor={htmlFor} className={capSm}>
        {label}
      </label>
      {children}
      {hint && <span className="text-cap leading-snug text-muted-fg">{hint}</span>}
    </div>
  );
}

/** A titled block inside a pane body. */
export function Section({
  title,
  actions,
  children,
  className = "",
}: {
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`border-b border-border-2 px-[11px] py-2.5 ${className}`}>
      <div className="mb-1.5 flex min-h-[22px] items-center gap-2">
        <h3 className={`${capSm} m-0 min-w-0 flex-1 truncate`}>{title}</h3>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** A compact statistic tile: caption, mono value, optional sub-line. */
export function StatTile({
  label,
  value,
  sub,
  tone,
  title,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: string;
  title?: string;
}) {
  return (
    <div className="min-w-0 rounded-md border border-border-2 bg-card-2 px-2.5 py-1.5" title={title}>
      <div className="truncate text-cap font-semibold uppercase tracking-[0.06em] text-muted-fg">{label}</div>
      <div className="ui-mono truncate text-[15px] font-semibold" style={{ color: tone ?? "var(--fg-strong)" }}>
        {value}
      </div>
      {sub != null && <div className="ui-mono truncate text-fine text-muted-fg">{sub}</div>}
    </div>
  );
}

type CalloutTone = "info" | "warn" | "bad" | "ok";
const CALLOUT: Record<CalloutTone, { color: string; Icon: typeof Info }> = {
  info: { color: "var(--info)", Icon: Info },
  warn: { color: "var(--warn)", Icon: TriangleAlert },
  bad: { color: "var(--bad)", Icon: CircleAlert },
  ok: { color: "var(--risk-low)", Icon: Check },
};

/** Inline tinted notice — explanations, assumption warnings, errors. */
export function Callout({ tone = "info", children, className = "" }: { tone?: CalloutTone; children: ReactNode; className?: string }) {
  const { color, Icon } = CALLOUT[tone];
  return (
    <div
      role={tone === "bad" ? "alert" : "note"}
      className={`flex gap-2 rounded-md border px-2.5 py-2 text-body leading-relaxed text-fg ${className}`}
      style={{ borderColor: `color-mix(in srgb, ${color} 35%, transparent)`, background: `color-mix(in srgb, ${color} 8%, transparent)` }}
    >
      <Icon size={14} className="mt-[2px] flex-none" style={{ color }} aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** Copies text, confirming with a checkmark. */
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={`${ghostBtn} gap-1`}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(
          () => {
            setDone(true);
            window.setTimeout(() => setDone(false), 1400);
          },
          () => setDone(false),
        );
      }}
    >
      {done ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />}
      <span className="text-label">{done ? "Copied" : label}</span>
    </button>
  );
}

export function PinButton({ onClick, busy, disabled }: { onClick: () => void; busy?: boolean; disabled?: boolean }) {
  return (
    <button type="button" className={`${softBtn} flex items-center gap-1.5`} onClick={onClick} disabled={busy || disabled}>
      <Pin size={13} aria-hidden />
      {busy ? "Pinning…" : "Pin to report"}
    </button>
  );
}

const KIND_GLYPH: Record<FrameKind, string> = { numeric: "#", categorical: "Aa", boolean: "◐" };
const KIND_COLOR: Record<FrameKind, string> = {
  numeric: "var(--info)",
  categorical: "var(--accent2)",
  boolean: "var(--warn)",
};

/** A tiny type glyph for a column kind: # numbers, Aa text, ◐ yes/no. */
export function KindBadge({ kind, derived = false }: { kind: FrameKind; derived?: boolean }) {
  return (
    <span
      className="ui-mono inline-flex h-4 min-w-[22px] flex-none items-center justify-center rounded-[4px] px-1 text-nano font-semibold"
      style={{ color: KIND_COLOR[kind], background: `color-mix(in srgb, ${KIND_COLOR[kind]} 13%, transparent)` }}
      title={`${kind === "numeric" ? "Numeric" : kind === "categorical" ? "Categorical" : "Yes/no"}${derived ? " · derived by formula" : ""}`}
    >
      {derived ? "ƒ" : ""}
      {KIND_GLYPH[kind]}
    </span>
  );
}

export function kindColor(kind: FrameKind): string {
  return KIND_COLOR[kind];
}

/** Column picker over a frame, filtered by kind and role. */
export function ColumnSelect({
  frame,
  value,
  onChange,
  kinds,
  allowNone = false,
  noneLabel = "— none —",
  filter,
  ariaLabel,
  id,
  className = "",
  filterKey,
}: {
  frame: Frame;
  value: string | null;
  onChange: (name: string | null) => void;
  kinds?: FrameKind[];
  allowNone?: boolean;
  noneLabel?: string;
  filter?: (column: FrameColumn) => boolean;
  /** Stable identity for `filter`; when given, options recompute only when it changes. */
  filterKey?: string;
  ariaLabel: string;
  id?: string;
  className?: string;
}) {
  // Filters can scan whole columns (e.g. counting levels), so the option list is computed
  // once per frame; callers' filters are expected to depend only on what they close over.
  const kindsKey = kinds?.join(",") ?? "";
  // eslint-disable-next-line react-hooks/exhaustive-deps -- filter identity changes every render by design
  const options = useMemo(
    () =>
      frame.columns.filter(
        (column) => column.error === null && column.role !== "id" && (!kinds || kinds.includes(column.kind)) && (!filter || filter(column)),
      ),
    [frame, kindsKey, filterKey ?? filter],
  );
  const missing = value !== null && !options.some((column) => column.name === value);
  return (
    <select
      id={id}
      aria-label={ariaLabel}
      className={`${selectSmCls} h-7 min-w-0 text-body ${className}`}
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value === "" ? null : event.target.value)}
    >
      {(allowNone || value === null) && <option value="">{allowNone ? noneLabel : "Choose a column…"}</option>}
      {missing && <option value={value!}>{value} (unavailable)</option>}
      {options.map((column) => (
        <option key={column.name} value={column.name}>
          {column.label !== column.name ? `${column.label} · ${column.name}` : column.name}
          {column.unit ? ` (${column.unit})` : ""}
        </option>
      ))}
    </select>
  );
}

/** Formats a number for tables: fixed significant digits, mono-friendly. */
export function fmt(value: number | null | undefined, digits = 3): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  const abs = Math.abs(value);
  if (abs >= 1e6 || abs < 1e-4) return value.toExponential(2);
  if (Number.isInteger(value) && abs < 1e6) return value.toLocaleString("en-US");
  const decimals = Math.max(0, digits - Math.floor(Math.log10(abs)) - 1);
  return value.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: Math.min(decimals, 6) });
}

/** Fixed decimals, for estimates and CIs that should line up. */
export function fixed(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toFixed(decimals);
}

/** APA-style p-value: p < .001 or p = .034. */
export function formatP(p: number | null | undefined): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return "—";
  if (p < 0.001) return "<0.001";
  return p.toFixed(3);
}

export function pct(value: number | null | undefined, decimals = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  // Never round a small non-zero share down to a misleading 0.0%.
  const floor = 10 ** -decimals;
  if (value > 0 && value * 100 < floor) return `<${floor.toFixed(decimals)}%`;
  if (value < 1 && value * 100 > 100 - floor) return `>${(100 - floor).toFixed(decimals)}%`;
  return `${(value * 100).toFixed(decimals)}%`;
}

/** A simple mono data table with sticky headers for result blocks. */
export function ResultTable({
  columns,
  rows,
  align,
  caption,
  dense = false,
}: {
  columns: string[];
  rows: ReactNode[][];
  align?: ("left" | "right" | "center")[];
  caption?: string;
  dense?: boolean;
}) {
  return (
    <div className="ui-scroll overflow-x-auto rounded-md border border-border-2">
      <table className="w-full border-collapse">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((column, index) => (
              <th
                key={index}
                scope="col"
                className={`sticky top-0 border-b border-border-2 bg-card-2 px-2.5 ${dense ? "py-1" : "py-1.5"} ${capSm} whitespace-nowrap`}
                style={{ textAlign: align?.[index] ?? (index === 0 ? "left" : "right") }}
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className="hover:bg-muted">
              {row.map((cell, c) => (
                <td
                  key={c}
                  className={`border-b border-border-2 px-2.5 ${dense ? "py-1" : "py-1.5"} text-body text-fg ${c === 0 ? "" : "ui-mono"} whitespace-nowrap`}
                  style={{ textAlign: align?.[c] ?? (c === 0 ? "left" : "right") }}
                >
                  {/* Whole numbers (counts) get thousands separators; formatted strings pass through. */}
                  {typeof cell === "number" && Number.isInteger(cell) ? cell.toLocaleString("en-US") : cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Wraps a module body that requires an active dataset. */
export function needsDatasetHint(): string {
  return "Load one of the synthetic sample datasets or import a CSV in Data Studio to get started.";
}

/** “1 row”, “3 rows” — counts with a properly pluralised noun. */
export function plural(count: number, noun: string, pluralNoun = `${noun}s`): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? noun : pluralNoun}`;
}
