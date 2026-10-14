/**
 * Shared scaffolding for every analysis: the data context, the result frame
 * with its narrative and pin action, and small formatting helpers.
 */

import type { ReactNode } from "react";

import type { Frame } from "../../../shared/workbench/dataset";
import type { ReportTable } from "../../../shared/workbench/documents";
import { type RowSelection, provenanceOf, usePinToReport } from "../../workstation/data";
import { Callout, CopyButton, PinButton } from "../../workstation/ui";

export interface AnalysisContext {
  frame: Frame;
  selection: RowSelection;
}

/** A column's human label for titles and pinned results; falls back to its name. */
export function labelOf(frame: Frame, name: string | null): string {
  if (name === null) return "";
  return frame.columns.find((column) => column.name === name)?.label || name;
}

export interface AnalysisProps {
  ctx: AnalysisContext;
}

/** Narrative + actions footer shared by every analysis. */
export function ResultActions({
  ctx,
  title,
  module = "stats",
  summary,
  table,
  chart,
  extra,
}: {
  ctx: AnalysisContext;
  title: string;
  module?: string;
  summary: string;
  table?: ReportTable | null;
  chart?: { type: string; data: unknown } | null;
  extra?: Record<string, string | number | null>;
}) {
  const pin = usePinToReport();
  // Every pinned result names the cohort it ran on, so the report reads on its own.
  const cohort = ctx.selection.cohort?.title;
  const pinTitle = cohort && !title.includes(cohort) ? `${title} · ${cohort}` : title;
  return (
    <div className="border-b border-border-2 px-[11px] py-2.5">
      <div className="mb-1 text-cap font-semibold uppercase tracking-[0.06em] text-muted-fg">Results, in words</div>
      <p className="m-0 rounded-md border border-border-2 bg-card-2 px-2.5 py-2 text-body leading-relaxed text-fg">{summary}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <CopyButton text={summary} label="Copy text" />
        {table && <CopyButton text={tableToMarkdown(table)} label="Copy table" />}
        <PinButton
          busy={pin.isPending}
          onClick={() =>
            pin.mutate({
              title: pinTitle,
              datasetId: ctx.frame.datasetId,
              payload: {
                module,
                summary,
                table: table ?? null,
                chart: chart ?? null,
                provenance: { ...provenanceOf(ctx.frame, ctx.selection), ...(extra ?? {}) },
                notes: "",
              },
            })
          }
        />
      </div>
    </div>
  );
}

export function tableToMarkdown(table: ReportTable): string {
  const escape = (cell: string | number | null) => String(cell ?? "").replace(/\|/g, "\\|");
  return [
    `| ${table.columns.map(escape).join(" | ")} |`,
    `| ${table.columns.map((_, index) => (index === 0 ? "---" : "---:")).join(" | ")} |`,
    ...table.rows.map((row) => `| ${row.map(escape).join(" | ")} |`),
  ].join("\n");
}

/** A config row above results. */
export function ConfigBar({ children }: { children: ReactNode }) {
  return <div className="grid flex-none grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2.5 border-b border-border-2 bg-card-2 px-[11px] py-2.5">{children}</div>;
}

export function AnalysisError({ error }: { error: unknown }) {
  return (
    <div className="px-[11px] py-3">
      <Callout tone="bad">{error instanceof Error ? error.message : "The analysis could not be computed."}</Callout>
    </div>
  );
}

/** Runs a computation and captures a thrown StatsError as a value. */
export function attempt<T>(work: () => T): { value: T; error: null } | { value: null; error: unknown } {
  try {
    return { value: work(), error: null };
  } catch (error) {
    return { value: null, error };
  }
}

export function plural(n: number, word: string): string {
  return `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;
}
