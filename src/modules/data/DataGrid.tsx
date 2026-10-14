/**
 * Virtualized data grid: only the visible rows render, so 100k rows scroll
 * smoothly. Click a header to sort (asc → desc → original order); missing
 * values always sort last and show as a muted dot.
 */

import { useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp } from "lucide-react";

import type { Frame, FrameColumn } from "../../../shared/workbench/dataset";
import { displayValue } from "../../../shared/workbench/dataset";
import type { Value } from "../../../shared/workbench/expr";
import { KindBadge } from "../../workstation/ui";

const ROW_HEIGHT = 26;
const INDEX_WIDTH = 64;

function columnWidth(column: FrameColumn): number {
  const base = Math.max(column.name.length * 7.4 + 44, column.kind === "numeric" ? 84 : 110);
  return Math.min(Math.round(base), 240);
}

const collator = new Intl.Collator("en", { numeric: true });

function compare(a: Value, b: Value): number {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return collator.compare(displayValue(a), displayValue(b));
}

export function DataGrid({
  frame,
  rows,
  selectedColumn,
  onSelectColumn,
}: {
  frame: Frame;
  rows: number[];
  selectedColumn: string | null;
  onSelectColumn: (name: string) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [sort, setSort] = useState<{ column: string; dir: 1 | -1 } | null>(null);
  const columns = frame.columns;
  const widths = useMemo(() => columns.map(columnWidth), [columns]);
  const totalWidth = INDEX_WIDTH + widths.reduce((sum, width) => sum + width, 0);

  const order = useMemo(() => {
    if (!sort) return rows;
    const column = columns.find((entry) => entry.name === sort.column);
    if (!column) return rows;
    return [...rows].sort((a, b) => {
      const va = column.values[a];
      const vb = column.values[b];
      if (va === null || vb === null) return compare(va, vb);
      return compare(va, vb) * sort.dir || a - b;
    });
  }, [rows, sort, columns]);

  const virtualizer = useVirtualizer({
    count: order.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  const cycleSort = (name: string) => {
    setSort((current) =>
      !current || current.column !== name ? { column: name, dir: 1 } : current.dir === 1 ? { column: name, dir: -1 } : null,
    );
  };

  return (
    <div ref={scroller} className="ui-scroll min-h-0 flex-1 overflow-auto" role="grid" aria-rowcount={order.length + 1} aria-colcount={columns.length + 1}>
      <div style={{ width: totalWidth, minWidth: "100%" }}>
        <div role="row" className="sticky top-0 z-[2] flex border-b border-border bg-card" style={{ height: 34 }}>
          <div className="ui-mono sticky left-0 z-[3] flex flex-none items-center justify-end border-r border-border-2 bg-card px-2 text-cap text-muted-fg" style={{ width: INDEX_WIDTH }}>
            #
          </div>
          {columns.map((column, index) => {
            const active = sort?.column === column.name;
            return (
              <button
                key={column.name}
                type="button"
                role="columnheader"
                aria-sort={active ? (sort!.dir === 1 ? "ascending" : "descending") : "none"}
                onClick={() => cycleSort(column.name)}
                onDoubleClick={() => onSelectColumn(column.name)}
                title={`${column.label}${column.unit ? ` (${column.unit})` : ""} — click to sort, double-click to inspect`}
                className="flex flex-none cursor-pointer items-center gap-1 border-0 border-r border-border-2 bg-transparent px-2 text-left hover:bg-muted"
                style={{
                  width: widths[index],
                  boxShadow: selectedColumn === column.name ? "inset 0 -2px 0 var(--primary)" : undefined,
                }}
              >
                <KindBadge kind={column.kind} derived={column.derived} />
                <span className="ui-mono min-w-0 flex-1 truncate text-label font-semibold text-fg">{column.name}</span>
                {active && (sort!.dir === 1 ? <ArrowUp size={11} aria-hidden /> : <ArrowDown size={11} aria-hidden />)}
              </button>
            );
          })}
        </div>
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((item) => {
            const row = order[item.index];
            return (
              <div
                key={item.key}
                role="row"
                className="absolute left-0 flex border-b border-border-2 hover:bg-muted"
                style={{ top: item.start, height: ROW_HEIGHT, width: totalWidth, minWidth: "100%" }}
              >
                <div className="ui-mono sticky left-0 flex flex-none items-center justify-end border-r border-border-2 bg-card-2 px-2 text-fine text-muted-fg" style={{ width: INDEX_WIDTH }}>
                  {row + 1}
                </div>
                {columns.map((column, index) => {
                  const value = column.values[row];
                  return (
                    <div
                      key={column.name}
                      role="gridcell"
                      className={`ui-mono flex flex-none items-center truncate border-r border-border-2 px-2 text-label ${value === null ? "text-muted-fg" : "text-fg"}`}
                      style={{ width: widths[index], justifyContent: column.kind === "numeric" ? "flex-end" : "flex-start" }}
                    >
                      <span className="truncate">{value === null ? "·" : displayValue(value)}</span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
