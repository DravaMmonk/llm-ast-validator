/**
 * Evidence Report — every pinned result in one ordered document, each with the
 * provenance needed to reproduce it (dataset, content hash, cohort, rows,
 * formula, time). Reorder, annotate, remove, and export as Markdown or as a
 * self-contained HTML file with the charts embedded.
 */

import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Download, FileCode2, Trash2 } from "lucide-react";

import type { ReportItemPayload, WorkbenchDocument } from "../../../shared/workbench/documents";
import { inlineSvg, serializeSvg } from "../../charts";
import {
  Chip,
  ConfirmDialog,
  EmptyState,
  LoadingState,
  Page,
  Pane,
  PaneBody,
  PaneHeader,
  ghostBtn,
  pillBtn,
  primaryBtn,
  textareaCls,
  toast,
} from "../../shared-console/src";
import { errorMessage, wbApi } from "../../workstation/api";
import { invalidateDocuments, useDocuments } from "../../workstation/data";
import { MODULES } from "../../workstation/modules";
import { downloadText, safeFilename } from "../../workstation/exportCsv";
import { usePreference } from "../../workstation/preferences";
import { Callout, ResultTable } from "../../workstation/ui";
import { tableToMarkdown } from "../stats/common";
import { ReportChart } from "./ReportChart";

type Item = WorkbenchDocument<ReportItemPayload>;

const MODULE_LABEL: Record<string, string> = {
  stats: "Statistics",
  cohort: "Cohort",
  forge: "Score Forge",
  diagnostic: "Diagnostic",
  design: "Study design",
};

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function reportMarkdown(title: string, items: Item[]): string {
  const lines = [`# ${title}`, "", `_Generated ${new Date().toLocaleString()} by the MedLab research workstation. Results are exploratory unless stated otherwise._`, ""];
  items.forEach((item, index) => {
    lines.push(`## ${index + 1}. ${item.title}`, "");
    if (item.payload.summary) lines.push(item.payload.summary, "");
    if (item.payload.table) lines.push(tableToMarkdown(item.payload.table), "");
    if (item.payload.notes) lines.push(`> ${item.payload.notes.replace(/\n/g, "\n> ")}`, "");
    const provenance = Object.entries(item.payload.provenance ?? {})
      .filter(([, value]) => value !== null && value !== "")
      .map(([key, value]) => `${key}: ${value}`);
    if (provenance.length) lines.push(`<sub>Provenance — ${provenance.join(" · ")}</sub>`, "");
  });
  return lines.join("\n");
}

export default function ReportPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const items = useDocuments<ReportItemPayload>("report_item");
  const list = items.data?.documents ?? [];
  const [title, setTitle] = usePreference<string>("report-title", "Evidence report");
  const [confirmRemove, setConfirmRemove] = useState<Item | null>(null);
  const chartRefs = useRef(new Map<string, SVGSVGElement | null>());

  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Parameters<typeof wbApi.patchDocument>[1] }) => wbApi.patchDocument(id, body),
    onSuccess: () => invalidateDocuments(queryClient, "report_item"),
    onError: (error) => toast(`Not saved: ${errorMessage(error)}`),
  });

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= list.length) return;
    // Swap positions; equal positions (legacy) are spread apart first.
    const a = list[index];
    const b = list[target];
    const posA = a.position === b.position ? a.position + delta * 0.5 : b.position;
    patch.mutate({ id: a.id, body: { position: posA } });
    patch.mutate({ id: b.id, body: { position: a.position } });
  };

  const exportHtml = () => {
    const sections = list
      .map((item, index) => {
        const svg = chartRefs.current.get(item.id);
        const chart = svg ? serializeSvg(inlineSvg(svg)) : "";
        const table = item.payload.table
          ? `<table><thead><tr>${item.payload.table.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr></thead><tbody>${item.payload.table.rows
              .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(String(cell ?? ""))}</td>`).join("")}</tr>`)
              .join("")}</tbody></table>`
          : "";
        const provenance = Object.entries(item.payload.provenance ?? {})
          .filter(([, value]) => value !== null && value !== "")
          .map(([key, value]) => `${escapeHtml(key)}: ${escapeHtml(String(value))}`)
          .join(" · ");
        return `<section><h2>${index + 1}. ${escapeHtml(item.title)}</h2>${item.payload.summary ? `<p>${escapeHtml(item.payload.summary)}</p>` : ""}${chart ? `<figure>${chart}</figure>` : ""}${table}${
          item.payload.notes ? `<blockquote>${escapeHtml(item.payload.notes)}</blockquote>` : ""
        }${provenance ? `<p class="prov">${provenance}</p>` : ""}</section>`;
      })
      .join("\n");
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><style>
body{font:15px/1.55 Inter,system-ui,sans-serif;color:#1d1d22;max-width:880px;margin:40px auto;padding:0 16px;background:#fff}
h1{font-size:26px;margin:0 0 4px}h2{font-size:18px;margin:36px 0 8px;border-top:1px solid #e3e3e6;padding-top:20px}
.meta,.prov{color:#6b6b74;font-size:12px}table{border-collapse:collapse;width:100%;font-size:13px;margin:10px 0}
th,td{border-bottom:1px solid #e6e6ea;padding:5px 8px;text-align:right}th:first-child,td:first-child{text-align:left}
th{background:#f6f6f8;font-weight:600}figure{margin:12px 0}svg{max-width:100%;height:auto}blockquote{border-left:3px solid #ccc;margin:8px 0;padding:2px 12px;color:#444}
</style></head><body><h1>${escapeHtml(title)}</h1><p class="meta">Generated ${escapeHtml(new Date().toLocaleString())} by the MedLab research workstation. Results are exploratory unless stated otherwise.</p>${sections}</body></html>`;
    downloadText(`${safeFilename(title)}.html`, html, "text/html");
  };

  return (
    <Page>
      <Pane>
        <PaneHeader label="Evidence report" count={list.length}>
          <button type="button" className={`${pillBtn} flex items-center gap-1`} disabled={list.length === 0} onClick={() => downloadText(`${safeFilename(title)}.md`, reportMarkdown(title, list), "text/markdown")}>
            <Download size={13} aria-hidden /> Markdown
          </button>
          <button type="button" className={`${primaryBtn} flex items-center gap-1`} disabled={list.length === 0} onClick={exportHtml}>
            <FileCode2 size={13} aria-hidden /> Export HTML
          </button>
        </PaneHeader>
        <PaneBody>
          {items.isLoading ? (
            <LoadingState />
          ) : items.isError ? (
            <EmptyState title="Could not load the report" hint={errorMessage(items.error)} />
          ) : list.length === 0 ? (
            <EmptyState
              title="Nothing pinned yet"
              hint="Run an analysis — Table 1, a regression, a ROC curve, a cohort flow — and press “Pin to report”. Pinned results collect here with their provenance."
              action={
                <button type="button" className={primaryBtn} onClick={() => navigate("/stats")}>
                  Open Statistics
                </button>
              }
            />
          ) : (
            <div className="mx-auto w-full max-w-[920px] px-5 py-5">
              <input
                aria-label="Report title"
                className="w-full border-0 bg-transparent p-0 text-[24px] font-semibold tracking-[-0.01em] text-fg-strong outline-none"
                value={title}
                maxLength={160}
                onChange={(event) => setTitle(event.target.value)}
              />
              <p className="m-0 mt-1 text-body text-muted-fg">
                {list.length} pinned result{list.length === 1 ? "" : "s"} · reorder with the arrows · exports keep the order and provenance.
              </p>
              {list.map((item, index) => (
                <ReportItemCard
                  key={item.id}
                  item={item}
                  index={index}
                  last={index === list.length - 1}
                  onMove={(delta) => move(index, delta)}
                  onRemove={() => setConfirmRemove(item)}
                  onNotes={(notes) => patch.mutate({ id: item.id, body: { payload: { ...item.payload, notes } } })}
                  chartRef={(svg) => chartRefs.current.set(item.id, svg)}
                  busy={patch.isPending}
                />
              ))}
            </div>
          )}
        </PaneBody>
      </Pane>
      {confirmRemove && (
        <ConfirmDialog
          title="Remove from the report?"
          message={`“${confirmRemove.title}” is archived, not deleted — it stops appearing here and in exports.`}
          confirmLabel="Remove"
          danger
          onConfirm={() => {
            patch.mutate({ id: confirmRemove.id, body: { status: "archived" } });
            setConfirmRemove(null);
            toast("Removed from report");
          }}
          onClose={() => setConfirmRemove(null)}
        />
      )}
    </Page>
  );
}

function ReportItemCard({
  item,
  index,
  last,
  onMove,
  onRemove,
  onNotes,
  chartRef,
  busy,
}: {
  item: Item;
  index: number;
  last: boolean;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
  onNotes: (notes: string) => void;
  chartRef: (svg: SVGSVGElement | null) => void;
  busy: boolean;
}) {
  const [notes, setNotes] = useState(item.payload.notes ?? "");
  const [showProvenance, setShowProvenance] = useState(false);
  const moduleEntry = MODULES.find((entry) => entry.id === item.payload.module);
  const provenance = useMemo(() => Object.entries(item.payload.provenance ?? {}).filter(([, value]) => value !== null && value !== ""), [item.payload.provenance]);
  return (
    <article className="mt-5 rounded-[12px] border border-border bg-card" aria-labelledby={`report-${item.id}`}>
      <header className="flex items-center gap-2 border-b border-border-2 px-3.5 py-2">
        <span className="ui-mono text-label font-semibold text-muted-fg">{index + 1}</span>
        <h2 id={`report-${item.id}`} className="m-0 min-w-0 flex-1 truncate text-md font-semibold text-fg-strong">
          {item.title}
        </h2>
        <Chip label={MODULE_LABEL[item.payload.module] ?? moduleEntry?.label ?? item.payload.module} color="var(--info)" />
        <span className="ui-mono text-fine text-muted-fg">{new Date(item.created_at).toLocaleString()}</span>
        <button type="button" className={ghostBtn} disabled={index === 0 || busy} onClick={() => onMove(-1)} aria-label="Move up">
          <ArrowUp size={12} />
        </button>
        <button type="button" className={ghostBtn} disabled={last || busy} onClick={() => onMove(1)} aria-label="Move down">
          <ArrowDown size={12} />
        </button>
        <button type="button" className={ghostBtn} onClick={onRemove} aria-label="Remove from report">
          <Trash2 size={12} />
        </button>
      </header>
      <div className="flex flex-col gap-3 px-3.5 py-3">
        {item.payload.summary && <p className="m-0 text-ui leading-relaxed text-fg">{item.payload.summary}</p>}
        {item.payload.chart && <ReportChart ref={chartRef} type={item.payload.chart.type} data={item.payload.chart.data} title={item.title} />}
        {item.payload.table && (
          <ResultTable
            columns={item.payload.table.columns}
            rows={item.payload.table.rows.map((row) => row.map((cell) => (cell === null ? "" : String(cell))))}
            dense
          />
        )}
        <textarea
          aria-label={`Notes for ${item.title}`}
          className={`${textareaCls} h-[54px]`}
          placeholder="Interpretation, caveats, next steps…"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          onBlur={() => notes !== (item.payload.notes ?? "") && onNotes(notes)}
        />
        {provenance.length > 0 && (
          <div>
            <button type="button" className="flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-cap font-semibold uppercase tracking-[0.06em] text-muted-fg" onClick={() => setShowProvenance(!showProvenance)} aria-expanded={showProvenance}>
              {showProvenance ? <ChevronDown size={12} aria-hidden /> : <ChevronRight size={12} aria-hidden />} Provenance
            </button>
            {showProvenance && (
              <dl className="ui-mono m-0 mt-1.5 grid grid-cols-[160px_1fr] gap-x-3 gap-y-0.5 text-fine">
                {provenance.map(([key, value]) => (
                  <div key={key} className="contents">
                    <dt className="text-muted-fg">{key}</dt>
                    <dd className="m-0 break-all text-fg">{String(value)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        )}
        {item.payload.module === "forge" ? (
          <Callout tone="info">Exploratory unless validated on independent data.</Callout>
        ) : null}
      </div>
    </article>
  );
}
