/**
 * The puzzle-piece library rail: dataset columns, operator pieces, values, and
 * optional templates. Click inserts (into the selected piece's free socket when
 * one fits), drag places a piece yourself. Search force-expands every group.
 * A hover card previews each piece, and for columns shows a quick profile —
 * the range, missingness, and category values you need to write a criterion.
 */

import { memo, useEffect, useMemo, useRef, useState } from "react";

import type { Frame, FrameColumn } from "../../shared/workbench/dataset";
import { kindValueType } from "../../shared/workbench/dataset";
import { Dot, MasterListGroup, MasterListSearch, Pane, PaneHeader } from "../shared-console/src";
import { KindBadge } from "../workstation/ui";
import { quickProfile } from "../workstation/profile";
import { BLOCK, type BlockState } from "./wbAdapter";
import { HUE, columnHue, hueColor } from "./wbBlocks";
import { DRAG_MIME } from "./useWbCanvas";

export interface PieceEntry {
  id: string;
  label: string;
  tag: string;
  detail: string;
  hue: number;
  state: BlockState;
  column?: FrameColumn;
}

export interface PieceGroup {
  key: string;
  label: string;
  entries: PieceEntry[];
}

const piece = (id: string, label: string, tag: string, detail: string, hue: number, state: BlockState): PieceEntry => ({
  id,
  label,
  tag,
  detail,
  hue,
  state,
});

export function columnPiece(column: FrameColumn): PieceEntry {
  const type = kindValueType(column.kind);
  return {
    id: `col:${column.name}`,
    label: column.name,
    tag: column.unit || (column.kind === "numeric" ? "#" : column.kind === "boolean" ? "yes/no" : "text"),
    detail: column.label !== column.name ? column.label : column.description,
    hue: columnHue(type),
    state: { type: BLOCK.col, extraState: { name: column.name, valueType: type } },
    column,
  };
}

export const STEP_PIECES: PieceEntry[] = [
  piece("step:include", "Include rows where…", "＋", "Keeps only rows where the condition is yes.", HUE.include, {
    type: BLOCK.step,
    fields: { KIND: "include", LABEL: "", MISSING: "drop" },
  }),
  piece("step:exclude", "Exclude rows where…", "－", "Removes rows where the condition is yes.", HUE.exclude, {
    type: BLOCK.step,
    fields: { KIND: "exclude", LABEL: "", MISSING: "drop" },
  }),
];

export const CONDITION_PIECES: PieceEntry[] = [
  piece("compare", "Compare numbers", "< ≥", "a < b, a ≥ b, a = b … — yes/no.", HUE.compare, { type: BLOCK.compare, fields: { OP: "ge" } }),
  piece("between", "Between", "a–b", "Inclusive range check: low ≤ value ≤ high.", HUE.compare, { type: BLOCK.between }),
  piece("equals", "Is / is not", "is", "Tests a text or yes/no value against another.", HUE.compare, { type: BLOCK.equals, fields: { OP: "eq" } }),
  piece("one_of", "Is one of", "∈", "Text membership in a comma-separated list.", HUE.compare, { type: BLOCK.oneOf, fields: { LIST: "a, b" } }),
  piece("and", "And / or", "∧ ∨", "Combine two conditions.", HUE.logic, { type: BLOCK.logic, fields: { OP: "and" } }),
  piece("not", "Not", "¬", "Negate a condition.", HUE.logic, { type: BLOCK.not }),
  piece("missing", "Is missing", "∅", "Yes when the value is missing.", HUE.missing, { type: BLOCK.missing }),
];

export const MATH_PIECES: PieceEntry[] = [
  piece("arith", "Arithmetic", "+ − × ÷ ^", "Add, subtract, multiply, divide, power.", HUE.arith, { type: BLOCK.arith, fields: { OP: "add" } }),
  piece("fn1", "Function", "ln √", "abs, √, ln, log₁₀, exp, floor, ceil, negate.", HUE.fn, { type: BLOCK.fn1, fields: { OP: "ln" } }),
  piece("fn2", "Min / max / round", "min", "Smaller or larger of two numbers, or rounding.", HUE.fn, { type: BLOCK.fn2, fields: { OP: "max" } }),
  piece("clamp", "Clamp", "[ ]", "Limit a value to a range.", HUE.fn, { type: BLOCK.clamp }),
  piece("if", "If / then / else", "?:", "Pick between two values — the building block of points scores.", HUE.condition, { type: BLOCK.if }),
  piece("coalesce", "Fallback", "??", "Use a second value when the first is missing.", HUE.missing, { type: BLOCK.coalesce }),
  piece("valid_if", "Valid only if", "|", "Keep a value only where a condition holds; missing elsewhere.", HUE.missing, { type: BLOCK.validIf }),
];

export const VALUE_PIECES: PieceEntry[] = [
  piece("num", "Number", "1.0", "A numeric constant — a weight, a threshold, points.", HUE.number, { type: BLOCK.num, fields: { VALUE: 0 } }),
  piece("text", "Text", "“a”", "A category value, e.g. F or current.", HUE.text, { type: BLOCK.text, fields: { VALUE: "" } }),
  piece("bool", "Yes / no", "✓", "A yes/no constant.", HUE.boolean, { type: BLOCK.bool, fields: { VALUE: "TRUE" } }),
];

export function columnGroups(frame: Frame | null): PieceGroup[] {
  if (!frame) return [];
  const usable = frame.columns.filter((column) => column.error === null && column.role !== "id");
  const groups: PieceGroup[] = [
    { key: "num", label: "Numeric columns", entries: usable.filter((c) => c.kind === "numeric").map(columnPiece) },
    { key: "cat", label: "Categorical columns", entries: usable.filter((c) => c.kind === "categorical").map(columnPiece) },
    { key: "bool", label: "Yes/no columns", entries: usable.filter((c) => c.kind === "boolean").map(columnPiece) },
  ];
  return groups.filter((group) => group.entries.length > 0);
}

export const PieceLibrary = memo(function PieceLibrary({
  groups,
  onInsert,
  disabled = false,
  footer,
  width = 248,
}: {
  groups: PieceGroup[];
  onInsert: (entry: PieceEntry) => void;
  disabled?: boolean;
  footer?: string;
  width?: number;
}) {
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [hover, setHover] = useState<{ entry: PieceEntry; top: number; left: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);

  const searching = search.trim() !== "";
  const visible = useMemo(() => {
    if (!searching) return groups;
    const needle = search.trim().toLowerCase();
    return groups
      .map((group) => ({
        ...group,
        entries: group.entries.filter((entry) => `${entry.label} ${entry.detail} ${entry.tag}`.toLowerCase().includes(needle)),
      }))
      .filter((group) => group.entries.length > 0);
  }, [groups, search, searching]);

  const show = (entry: PieceEntry, element: HTMLElement) => {
    clearTimeout(timer.current);
    const rect = element.getBoundingClientRect();
    timer.current = setTimeout(
      () => setHover({ entry, top: Math.max(8, Math.min(rect.top - 4, window.innerHeight - 220)), left: rect.right + 10 }),
      220,
    );
  };
  const hide = () => {
    clearTimeout(timer.current);
    setHover(null);
  };

  return (
    <Pane w={width} side="r" className="relative">
      <PaneHeader label="Pieces" />
      <div className="flex flex-none border-b border-border-2 px-[11px] py-2">
        <MasterListSearch value={search} onChange={setSearch} placeholder="Search columns and pieces…" />
      </div>
      <div className="ui-scroll min-h-0 flex-1 overflow-y-auto pb-3" onScroll={hide}>
        {visible.map((group) => {
          const closed = !searching && Boolean(collapsed[group.key]);
          return (
            <MasterListGroup
              key={group.key}
              label={group.label}
              count={group.entries.length}
              color={group.entries[0] ? hueColor(group.entries[0].hue) : undefined}
              open={!closed}
              onOpenChange={(open) => {
                if (!searching) setCollapsed((current) => ({ ...current, [group.key]: !open }));
              }}
            >
              {group.entries.map((entry) => (
                <div
                  key={entry.id}
                  role="button"
                  tabIndex={disabled ? -1 : 0}
                  aria-disabled={disabled}
                  aria-label={`Insert ${entry.label}`}
                  draggable={!disabled}
                  onDragStart={(event) => {
                    hide();
                    event.dataTransfer.setData(DRAG_MIME, JSON.stringify(entry.state));
                    event.dataTransfer.effectAllowed = "copy";
                  }}
                  onClick={() => !disabled && onInsert(entry)}
                  onKeyDown={(event) => {
                    if (!disabled && (event.key === "Enter" || event.key === " ")) {
                      event.preventDefault();
                      onInsert(entry);
                    }
                  }}
                  onMouseEnter={(event) => show(entry, event.currentTarget)}
                  onMouseLeave={hide}
                  onFocus={(event) => show(entry, event.currentTarget)}
                  onBlur={hide}
                  className={`flex items-center gap-1.5 border-b border-border-2 px-[11px] py-1.5 outline-offset-[-2px] ${
                    disabled ? "opacity-50" : "cursor-grab hover:bg-muted"
                  }`}
                >
                  {entry.column ? <KindBadge kind={entry.column.kind} derived={entry.column.derived} /> : <Dot color={hueColor(entry.hue)} />}
                  <span className={`min-w-0 flex-1 truncate text-body font-medium text-fg ${entry.column ? "ui-mono text-label" : ""}`}>
                    {entry.label}
                  </span>
                  <span className="ui-mono max-w-[64px] flex-none truncate text-cap text-muted-fg">{entry.tag}</span>
                </div>
              ))}
            </MasterListGroup>
          );
        })}
        {visible.length === 0 && (
          <div className="px-3 py-8 text-center text-ui text-muted-fg">
            {groups.length === 0 ? "No pieces available." : `No matches for “${search}”.`}
          </div>
        )}
      </div>
      <div className="flex-none border-t border-border bg-card-2 px-3 py-[6px] text-cap leading-snug text-muted-fg">
        {footer ?? "Click to insert into the selected piece · drag to place"}
      </div>
      {hover && <HoverCard entry={hover.entry} top={hover.top} left={hover.left} />}
    </Pane>
  );
});

function HoverCard({ entry, top, left }: { entry: PieceEntry; top: number; left: number }) {
  const profile = useMemo(() => (entry.column ? quickProfile(entry.column) : null), [entry.column]);
  return (
    <div
      className="pointer-events-none fixed z-50 w-[260px] rounded-[10px] border border-border bg-card p-3 shadow-[0_12px_32px_rgba(0,0,0,0.14)]"
      style={{ top, left }}
    >
      <div className="flex items-center gap-1.5">
        <Dot color={hueColor(entry.hue)} size={10} />
        <span className="min-w-0 flex-1 truncate text-emph font-semibold text-fg">{entry.label}</span>
        <span className="ui-mono flex-none text-cap text-muted-fg">{entry.tag}</span>
      </div>
      {entry.detail && <p className="mb-0 mt-1.5 text-body leading-snug text-muted-fg">{entry.detail}</p>}
      {profile && (
        <div className="ui-mono mt-2 space-y-0.5 rounded-md border border-border-2 bg-card-2 px-2 py-1.5 text-fine text-fg">
          {profile.lines.map((line) => (
            <div key={line[0]} className="flex justify-between gap-2">
              <span className="text-muted-fg">{line[0]}</span>
              <span className="truncate">{line[1]}</span>
            </div>
          ))}
        </div>
      )}
      <div className="mt-2 border-t border-border pt-2 text-dense text-muted-fg">
        <b className="font-semibold text-fg">Click</b> to insert · <b className="font-semibold text-fg">drag</b> to place
      </div>
    </div>
  );
}

export { columnHue };
