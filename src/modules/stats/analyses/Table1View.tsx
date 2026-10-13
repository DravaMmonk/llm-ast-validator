/** Table 1 — baseline characteristics, overall and by group, with tests. */

import { useMemo, useState } from "react";

import { buildTable1, isGroupingColumn } from "../../../../shared/workbench/analysis";
import { PaneBody } from "../../../shared-console/src";
import { ColumnSelect, Field, formatP } from "../../../workstation/ui";
import { type AnalysisProps, ConfigBar, ResultActions } from "../common";
import { VariablePicker } from "../VariablePicker";

function defaultVariables(ctx: AnalysisProps["ctx"]): string[] {
  return ctx.frame.columns
    .filter((column) => column.error === null && !["id", "time", "event"].includes(column.role))
    .map((column) => column.name)
    .slice(0, 16);
}

export function Table1View({ ctx }: AnalysisProps) {
  const { frame, selection } = ctx;
  const [group, setGroup] = useState<string | null>(() => frame.columns.find((column) => column.role === "group" && isGroupingColumn(column))?.name ?? null);
  const [variables, setVariables] = useState<string[]>(() => defaultVariables(ctx));
  const table = useMemo(() => buildTable1(frame, selection.rows, variables, group), [frame, selection.rows, variables, group]);

  const columns = ["Characteristic", `Overall (n = ${table.total.toLocaleString("en-US")})`, ...table.groupLevels.map((level, index) => `${level} (n = ${table.groupCounts[index].toLocaleString("en-US")})`), ...(group ? ["p-value"] : []), "Missing"];
  const reportRows = table.rows.map((row) => [
    row.indent ? `  ${row.label}` : row.label,
    row.overall,
    ...row.groups,
    ...(group ? [row.p === null ? "" : formatP(row.p)] : []),
    row.indent ? "" : row.missing,
  ]);
  const groupLabel = group ? frame.columns.find((column) => column.name === group)?.label ?? group : null;
  const significant = table.rows.filter((row) => row.p !== null && row.p < 0.05).map((row) => row.label.split(",")[0]);
  const summary = group
    ? `Baseline characteristics of ${table.total.toLocaleString("en-US")} participants${selection.cohort ? ` in the cohort “${selection.cohort.title}”` : ""} are shown overall and by ${groupLabel} (${table.groupLevels.map((level, i) => `${level}: n = ${table.groupCounts[i].toLocaleString("en-US")}`).join("; ")}). ${
        significant.length ? `Groups differed (p < 0.05) in ${significant.join(", ")}.` : "No characteristic differed between groups at p < 0.05."
      }`
    : `Baseline characteristics of ${table.total.toLocaleString("en-US")} participants${selection.cohort ? ` in the cohort “${selection.cohort.title}”` : ""}.`;

  return (
    <>
      <ConfigBar>
        <Field label="Stratify by" htmlFor="t1-group">
          <ColumnSelect id="t1-group" frame={frame} value={group} onChange={setGroup} allowNone noneLabel="— overall only —" filter={(column) => isGroupingColumn(column, selection.rows)} filterKey={`t1:${selection.cohort?.id ?? "all"}`} ariaLabel="Stratify by" />
        </Field>
        <Field label="Variables">
          <VariablePicker frame={frame} value={variables} onChange={setVariables} label="Variables" />
        </Field>
      </ConfigBar>
      <PaneBody>
        <ResultActions
          ctx={ctx}
          title={`Table 1 · ${selection.cohort ? selection.cohort.title : frame.name}${group ? ` by ${frame.columns.find((c) => c.name === group)?.label ?? group}` : ""}`}
          summary={summary}
          table={{ columns, rows: reportRows }}
          extra={{ analysis: "table1", stratified_by: group }}
        />
        <div className="px-[11px] py-2.5">
          <div className="ui-scroll overflow-x-auto rounded-md border border-border-2">
            <table className="w-full border-collapse">
              <caption className="sr-only">Table 1</caption>
              <thead>
                <tr>
                  {columns.map((title, index) => (
                    <th
                      key={title}
                      scope="col"
                      className="sticky top-0 whitespace-nowrap border-b border-border bg-card-2 px-2.5 py-1.5 text-cap font-semibold uppercase tracking-[0.06em] text-muted-fg"
                      style={{ textAlign: index === 0 ? "left" : "right" }}
                    >
                      {title}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, index) => (
                  <tr key={index} className="hover:bg-muted">
                    <td className={`border-b border-border-2 py-1.5 pr-2.5 text-body ${row.indent ? "pl-6 text-muted-fg" : "pl-2.5 font-medium text-fg"}`}>{row.label}</td>
                    <td className="ui-mono whitespace-nowrap border-b border-border-2 px-2.5 py-1.5 text-right text-body text-fg">{row.overall}</td>
                    {row.groups.map((cell, g) => (
                      <td key={g} className="ui-mono whitespace-nowrap border-b border-border-2 px-2.5 py-1.5 text-right text-body text-fg">
                        {cell}
                      </td>
                    ))}
                    {group && (
                      <td
                        className="ui-mono whitespace-nowrap border-b border-border-2 px-2.5 py-1.5 text-right text-body"
                        style={{ color: row.p !== null && row.p < 0.05 ? "var(--primary)" : "var(--fg)", fontWeight: row.p !== null && row.p < 0.05 ? 600 : 400 }}
                        title={row.test ?? undefined}
                      >
                        {row.p === null ? "" : formatP(row.p)}
                      </td>
                    )}
                    <td className="ui-mono whitespace-nowrap border-b border-border-2 px-2.5 py-1.5 text-right text-body text-muted-fg">{row.indent ? "" : row.missing || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="m-0 mt-2 pl-4 text-cap leading-relaxed text-muted-fg">
            {table.footnotes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      </PaneBody>
    </>
  );
}
