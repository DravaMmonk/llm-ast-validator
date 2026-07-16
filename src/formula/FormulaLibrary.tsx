/**
 * Left library rail for the formula canvas, modeled on the reference feature
 * builder's LibraryPanel: search, collapsible category groups (search
 * force-expands), category colour dots that match the canvas blocks,
 * click-to-insert, drag-to-place, and an instant hover info card. A footer
 * strip spells out the interactions.
 *
 * Domain composition over the shared kit and the diabetes catalog — it adds no
 * new design primitive.
 */

import { memo, useEffect, useMemo, useRef, useState } from "react";

import { Dot, MasterListGroup, MasterListSearch, Pane, PaneHeader } from "../shared-console/src";
import { type CatalogEntry, catalogGroups, categoryColor } from "./diabetesCatalog";

export const FormulaLibrary = memo(function FormulaLibrary({
  onInsert,
  disabled = false,
}: {
  onInsert: (entry: CatalogEntry) => void;
  /** No version on the canvas yet — rows render but explain instead of insert. */
  disabled?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // Instant hover info card — replaces the sluggish native title tooltip.
  const [hover, setHover] = useState<{ entry: CatalogEntry; top: number; left: number } | null>(null);
  const hoverT = useRef<ReturnType<typeof setTimeout>>();
  const showCard = (entry: CatalogEntry, el: HTMLElement) => {
    clearTimeout(hoverT.current);
    const rect = el.getBoundingClientRect();
    hoverT.current = setTimeout(
      () => setHover({ entry, top: Math.max(8, Math.min(rect.top - 4, window.innerHeight - 170)), left: rect.right + 10 }),
      200,
    );
  };
  const hideCard = () => {
    clearTimeout(hoverT.current);
    setHover(null);
  };
  useEffect(() => () => clearTimeout(hoverT.current), []);

  const searching = search.trim().length > 0;
  const groups = useMemo(() => {
    const all = catalogGroups();
    if (!searching) return all;
    const needle = search.trim().toLowerCase();
    return all
      .map((group) => ({
        ...group,
        entries: group.entries.filter((entry) =>
          `${entry.id} ${entry.label} ${entry.detail} ${entry.tag}`.toLowerCase().includes(needle),
        ),
      }))
      .filter((group) => group.entries.length > 0);
  }, [search, searching]);

  return (
    <Pane w={236} side="r" className="relative">
      <PaneHeader label="Library" />
      <div className="flex flex-none border-b border-border-2 px-[11px] py-2">
        <MasterListSearch value={search} onChange={setSearch} placeholder="Search signals, operators…" />
      </div>

      <div className="ui-scroll min-h-0 flex-1 overflow-y-auto pb-3" onScroll={hideCard}>
        {groups.map((group) => {
          const closed = !searching && !!collapsed[group.key];
          return (
            <MasterListGroup
              key={group.key}
              label={group.label}
              count={group.entries.length}
              color={categoryColor(group.entries[0]?.category ?? "signal")}
              open={!closed}
              onOpenChange={(open) => {
                if (!searching) setCollapsed((current) => ({ ...current, [group.key]: !open }));
              }}
            >
              {!closed &&
                group.entries.map((entry) => (
                  <div
                    key={entry.id}
                    draggable={!disabled}
                    onDragStart={(event) => {
                      hideCard();
                      event.dataTransfer.setData("application/json", JSON.stringify(entry.insert));
                      event.dataTransfer.effectAllowed = "copy";
                    }}
                    onClick={() => !disabled && onInsert(entry)}
                    onMouseEnter={(event) => showCard(entry, event.currentTarget)}
                    onMouseLeave={hideCard}
                    className={`flex items-center gap-1.5 border-b border-border-2 px-[11px] py-1.5 ${
                      disabled ? "opacity-50" : "cursor-grab hover:bg-muted"
                    }`}
                  >
                    <Dot color={categoryColor(entry.category)} />
                    <span className="min-w-0 flex-1 truncate text-body font-medium text-fg">{entry.label}</span>
                    <span className="ui-mono flex-none text-cap text-muted-fg">{entry.tag}</span>
                  </div>
                ))}
            </MasterListGroup>
          );
        })}
        {groups.length === 0 && (
          <div className="px-3 py-8 text-center">
            <div className="text-ui text-muted-fg">No matches for “{search}”.</div>
            <button
              type="button"
              onClick={() => setSearch("")}
              className="mt-2.5 h-6 cursor-pointer rounded-md border border-border bg-card px-2.5 text-label font-medium text-fg hover:bg-muted"
            >
              Clear search
            </button>
          </div>
        )}
      </div>

      {/* interaction hint strip */}
      <div className="flex-none border-t border-border bg-card-2 px-3 py-[6px] text-cap leading-snug text-muted-fg">
        {disabled ? "Select an admitted candidate to start editing" : "Click to insert · drag to place on the canvas"}
      </div>

      {/* hover info card — fixed, floats over the canvas next to the row */}
      {hover && (
        <div
          className="pointer-events-none fixed z-50 w-[240px] rounded-[10px] border border-border bg-card p-3 shadow-[0_12px_32px_rgba(0,0,0,0.14)]"
          style={{ top: hover.top, left: hover.left }}
        >
          <div className="flex items-center gap-1.5">
            <Dot color={categoryColor(hover.entry.category)} size={10} />
            <span className="min-w-0 flex-1 truncate text-emph font-semibold text-fg">{hover.entry.label}</span>
            <span className="ui-mono flex-none text-cap text-muted-fg">{hover.entry.tag}</span>
          </div>
          {hover.entry.id !== hover.entry.label && (
            <div className="ui-mono mt-0.5 truncate text-cap text-muted-fg">{hover.entry.id}</div>
          )}
          <div className="ui-mono mt-1.5 overflow-hidden rounded-md border border-border-2 bg-card-2 px-2 py-1.5 text-center text-label text-fg">
            {hover.entry.snippet}
          </div>
          <p className="mb-0 mt-1.5 text-body leading-snug text-muted-fg">{hover.entry.detail}</p>
          {!disabled && (
            <div className="mt-2 border-t border-border pt-2 text-dense text-muted-fg">
              <b className="font-semibold text-fg">Click</b> to insert · <b className="font-semibold text-fg">drag</b> to
              place it yourself
            </div>
          )}
        </div>
      )}
    </Pane>
  );
});
