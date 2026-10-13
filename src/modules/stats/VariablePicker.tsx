/** Multi-select of frame columns in a popover, with search and select all / none. */

import { useState } from "react";
import { ChevronDown } from "lucide-react";

import type { Frame, FrameColumn } from "../../../shared/workbench/dataset";
import { Popover, inputCls, matchesMasterListSearch } from "../../shared-console/src";
import { KindBadge } from "../../workstation/ui";

export function VariablePicker({
  frame,
  value,
  onChange,
  filter,
  label,
  max,
}: {
  frame: Frame;
  value: string[];
  onChange: (names: string[]) => void;
  filter?: (column: FrameColumn) => boolean;
  label: string;
  max?: number;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const options = frame.columns.filter((column) => column.error === null && column.role !== "id" && (!filter || filter(column)));
  const visible = options.filter((column) => matchesMasterListSearch(search, column.name, column.label));
  const toggle = (name: string) => {
    if (value.includes(name)) onChange(value.filter((entry) => entry !== name));
    else if (!max || value.length < max) onChange([...value, name]);
  };
  const summary = value.length === 0 ? "None selected" : value.length <= 2 ? value.join(", ") : `${value.slice(0, 2).join(", ")} +${value.length - 2}`;
  return (
    <div className="relative">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex h-7 w-full cursor-pointer items-center gap-1 rounded-md border border-border-2 bg-card px-1.5 text-left text-body text-fg"
      >
        <span className="min-w-0 flex-1 truncate">{summary}</span>
        <span className="ui-mono flex-none text-fine text-muted-fg">{value.length}</span>
        <ChevronDown size={12} className="flex-none text-muted-fg" aria-hidden />
      </button>
      {open && (
        <Popover onClose={() => setOpen(false)} className="left-0 top-[calc(100%+4px)] w-[300px] p-2">
          <input className={`${inputCls} w-full`} autoFocus placeholder="Search variables…" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search variables" />
          <div className="mt-1.5 flex gap-2 text-label">
            <button type="button" className="cursor-pointer border-0 bg-transparent p-0 text-primary" onClick={() => onChange(max ? options.slice(0, max).map((c) => c.name) : options.map((c) => c.name))}>
              Select all
            </button>
            <button type="button" className="cursor-pointer border-0 bg-transparent p-0 text-muted-fg" onClick={() => onChange([])}>
              Clear
            </button>
            {max && <span className="ml-auto text-muted-fg">max {max}</span>}
          </div>
          <div role="listbox" aria-multiselectable className="ui-scroll mt-1.5 max-h-[280px] overflow-y-auto">
            {visible.map((column) => (
              <label key={column.name} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-muted">
                <input type="checkbox" className="h-3.5 w-3.5 accent-[var(--primary)]" checked={value.includes(column.name)} onChange={() => toggle(column.name)} />
                <KindBadge kind={column.kind} derived={column.derived} />
                <span className="ui-mono min-w-0 flex-1 truncate text-label text-fg">{column.name}</span>
              </label>
            ))}
          </div>
        </Popover>
      )}
    </div>
  );
}
