/**
 * Data Studio — import, profile, and curate datasets.
 *
 * Master rail of datasets; the centre shows column profiles, the raw grid, or
 * derived variables; the right inspector edits one column's metadata, type and
 * analysis role. Nothing here mutates source values except an explicit kind
 * conversion or case merge, each previewed and confirmed first.
 */

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, Download, Pencil, Plus, Trash2, Upload } from "lucide-react";

import {
  COLUMN_KINDS,
  COLUMN_ROLES,
  type ColumnKind,
  type ColumnRole,
  type DatasetSummary,
  type DerivedColumn,
  type Frame,
  type FrameColumn,
  type StoredColumn,
  caseVariants,
  convertColumnKind,
} from "../../../shared/workbench/dataset";
import { printExpr } from "../../../shared/workbench/exprText";
import {
  Chip,
  ConfirmDialog,
  EmptyState,
  KV,
  LoadingState,
  MasterListItem,
  MasterListPane,
  MasterListSearch,
  Page,
  Pane,
  PaneBody,
  PaneFooter,
  PaneHeader,
  TabBar,
  capSm,
  ghostBtn,
  inputCls,
  matchesMasterListSearch,
  pillBtn,
  primaryBtn,
  selectSmCls,
  softBtn,
  textareaCls,
  toast,
} from "../../shared-console/src";
import { useQuery } from "@tanstack/react-query";
import { errorMessage, wbApi } from "../../workstation/api";
import { queryKeys, useActiveDataset, useDatasetDetail, useFrame } from "../../workstation/data";
import { downloadText, frameToCsv, safeFilename } from "../../workstation/exportCsv";
import { profileColumn, type ColumnProfile } from "../../workstation/profile";
import { Callout, Field, KindBadge, Section, StatTile, fmt, plural } from "../../workstation/ui";
import { DataGrid } from "./DataGrid";
import { DerivedDialog } from "./DerivedDialog";
import { ImportDialog } from "./ImportDialog";

type View = "columns" | "grid" | "derived";

export default function DataStudio() {
  const queryClient = useQueryClient();
  const { datasetId, datasets, setDatasetId, isLoading } = useActiveDataset();
  const [rail, setRail] = useState<"active" | "archived">("active");
  const [search, setSearch] = useState("");
  const [importing, setImporting] = useState(false);
  const archived = useQuery({
    queryKey: queryKeys.datasets("archived"),
    queryFn: () => wbApi.listDatasets("archived"),
    enabled: rail === "archived",
  });

  const restore = useMutation({
    mutationFn: (id: string) => wbApi.patchDataset(id, { status: "active" }),
    onSuccess: async ({ dataset }) => {
      await queryClient.invalidateQueries({ queryKey: ["wb-datasets"] });
      setDatasetId(dataset.id);
      setRail("active");
      toast(`Restored · ${dataset.name}`);
    },
  });

  const list = rail === "active" ? datasets : archived.data?.datasets ?? [];
  const filtered = list.filter((dataset) => matchesMasterListSearch(search, dataset.name, dataset.description));

  return (
    <Page>
      <MasterListPane
        label="Datasets"
        count={datasets.length}
        actions={
          <button type="button" className={`${ghostBtn} gap-1`} onClick={() => setImporting(true)} aria-label="Import a dataset">
            <Upload size={12} aria-hidden /> <span className="text-label">Import</span>
          </button>
        }
        tabs={
          <TabBar
            value={rail}
            onChange={setRail}
            options={[
              { v: "active", label: "Active" },
              { v: "archived", label: "Archived" },
            ]}
          />
        }
        toolbar={<MasterListSearch value={search} onChange={setSearch} placeholder="Search datasets…" />}
        footer={<span>Stored locally · never uploaded elsewhere</span>}
      >
        {isLoading && <LoadingState />}
        {!isLoading && filtered.length === 0 && (
          <EmptyState
            title={rail === "active" ? "No datasets" : "Nothing archived"}
            hint={rail === "active" ? "Import a CSV or load a synthetic sample from the Overview." : undefined}
            action={
              rail === "active" ? (
                <button type="button" className={primaryBtn} onClick={() => setImporting(true)}>
                  Import CSV
                </button>
              ) : undefined
            }
          />
        )}
        {filtered.map((dataset) =>
          rail === "active" ? (
            <MasterListItem
              key={dataset.id}
              active={dataset.id === datasetId}
              primary={dataset.name}
              tooltip={`${dataset.row_count} rows · ${dataset.column_count} columns`}
              onClick={() => setDatasetId(dataset.id)}
            />
          ) : (
            <div key={dataset.id} className="flex items-center gap-2 border-b border-border-2 px-[11px] py-1.5">
              <span className="min-w-0 flex-1 truncate text-body text-muted-fg">{dataset.name}</span>
              <button type="button" className={`${ghostBtn} gap-1`} onClick={() => restore.mutate(dataset.id)} disabled={restore.isPending}>
                <ArchiveRestore size={12} aria-hidden /> <span className="text-label">Restore</span>
              </button>
            </div>
          ),
        )}
      </MasterListPane>

      {datasetId ? (
        <DatasetWorkspace key={datasetId} datasetId={datasetId} summary={datasets.find((d) => d.id === datasetId) ?? null} />
      ) : (
        <Pane>
          <PaneHeader label="Dataset" />
          <PaneBody>
            <EmptyState
              title="Bring your data"
              hint="Import a CSV/TSV export, or load one of the synthetic sample datasets from the Overview page to explore every module."
              action={
                <button type="button" className={primaryBtn} onClick={() => setImporting(true)}>
                  Import CSV
                </button>
              }
            />
          </PaneBody>
        </Pane>
      )}

      {importing && (
        <ImportDialog
          onClose={() => setImporting(false)}
          onImported={(id) => {
            setImporting(false);
            setDatasetId(id);
          }}
        />
      )}
    </Page>
  );
}

function DatasetWorkspace({ datasetId, summary }: { datasetId: string; summary: DatasetSummary | null }) {
  const queryClient = useQueryClient();
  const detail = useDatasetDetail(datasetId);
  const { frame, isLoading, error } = useFrame(datasetId);
  const [view, setView] = useState<View>("columns");
  const [selected, setSelected] = useState<string | null>(null);
  const [derivedDialog, setDerivedDialog] = useState<{ editing: DerivedColumn | null } | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [removing, setRemoving] = useState<DerivedColumn | null>(null);

  useEffect(() => {
    if (frame && (!selected || !frame.columns.some((column) => column.name === selected))) {
      setSelected(frame.columns.find((column) => column.role !== "id")?.name ?? frame.columns[0]?.name ?? null);
    }
  }, [frame, selected]);

  const removeDerived = useMutation({
    mutationFn: (entry: DerivedColumn) =>
      wbApi.patchDataset(datasetId, { derived: (detail.data?.derived ?? []).filter((item) => item.name !== entry.name) }),
    onSuccess: async (_, entry) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.dataset(datasetId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.datasets() }),
      ]);
      toast(`Removed derived variable · ${entry.name}`);
    },
    onError: (error) => toast(`Not removed: ${errorMessage(error)}`),
  });

  const archive = useMutation({
    mutationFn: () => wbApi.patchDataset(datasetId, { status: "archived" }),
    onSuccess: async ({ dataset }) => {
      await queryClient.invalidateQueries({ queryKey: ["wb-datasets"] });
      toast(`Archived · ${dataset.name}`);
    },
  });

  const allRows = useMemo(() => (frame ? Array.from({ length: frame.rowCount }, (_, i) => i) : []), [frame]);
  // Counting missing cells walks every value; do it once per frame, not per render.
  const missingCells = useMemo(() => {
    if (!frame) return 0;
    let missing = 0;
    for (const column of frame.columns) for (const value of column.values) if (value === null) missing += 1;
    return missing;
  }, [frame]);

  if (isLoading || !frame) {
    return (
      <Pane>
        <PaneHeader label="Dataset" />
        <PaneBody>{error ? <EmptyState title="Could not load the dataset" hint={errorMessage(error)} /> : <LoadingState label="Loading dataset…" />}</PaneBody>
      </Pane>
    );
  }

  const column = frame.columns.find((entry) => entry.name === selected) ?? null;
  const totalCells = frame.rowCount * frame.columns.length;

  return (
    <>
      <Pane>
        <PaneHeader label={frame.name}>
          {summary?.source === "sample" && <Chip label="synthetic" color="var(--warn)" />}
          <span className="ui-mono text-fine text-muted-fg">hash {frame.contentHash.slice(0, 10)}</span>
          <button
            type="button"
            className={`${ghostBtn} gap-1`}
            onClick={() => downloadText(`${safeFilename(frame.name)}.csv`, frameToCsv(frame))}
            title="Download every row with source and derived columns"
          >
            <Download size={12} aria-hidden /> <span className="text-label">CSV</span>
          </button>
          <button type="button" className={`${ghostBtn} gap-1`} onClick={() => setConfirmArchive(true)} aria-label="Archive dataset">
            <Archive size={12} aria-hidden /> <span className="text-label">Archive</span>
          </button>
        </PaneHeader>
        <div className="grid flex-none grid-cols-4 gap-2 border-b border-border-2 px-[11px] py-2.5">
          <StatTile label="Rows" value={frame.rowCount.toLocaleString("en-US")} />
          <StatTile label="Columns" value={frame.columns.length} sub={`${frame.columns.filter((c) => c.derived).length} derived`} />
          <StatTile
            label="Missing"
            value={`${totalCells ? ((missingCells / totalCells) * 100).toFixed(1) : "0"}%`}
            sub={`${missingCells.toLocaleString("en-US")} of ${totalCells.toLocaleString("en-US")}`}
          />
          <StatTile
            label="Roles set"
            value={frame.columns.filter((c) => c.role !== "none").length}
            sub={
              frame.columns
                .filter((c) => c.role !== "none")
                .map((c) => COLUMN_ROLES.find((role) => role.v === c.role)?.label.toLowerCase())
                .filter((label, index, all) => label && all.indexOf(label) === index)
                .join(" · ") || "none yet — set them in the inspector"
            }
          />
        </div>
        <TabBar
          value={view}
          onChange={setView}
          grow={false}
          options={[
            { v: "columns", label: "Column profiles" },
            { v: "grid", label: `Data grid · ${frame.rowCount.toLocaleString("en-US")}` },
            { v: "derived", label: `Derived variables · ${detail.data?.derived.length ?? 0}` },
          ]}
        />
        {view === "columns" && <ColumnsView frame={frame} selected={selected} onSelect={setSelected} />}
        {view === "grid" && <DataGrid frame={frame} rows={allRows} selectedColumn={selected} onSelectColumn={setSelected} />}
        {view === "derived" && (
          <DerivedView
            frame={frame}
            derived={detail.data?.derived ?? []}
            onNew={() => setDerivedDialog({ editing: null })}
            onEdit={(entry) => setDerivedDialog({ editing: entry })}
            onRemove={setRemoving}
          />
        )}
        <PaneFooter>
          <span>Double-click a grid header to inspect · roles pre-fill the analysis modules</span>
        </PaneFooter>
      </Pane>

      <Pane w={300} side="l">
        <PaneHeader label="Column" />
        {column ? (
          <ColumnInspector key={column.name} frame={frame} column={column} derived={detail.data?.derived ?? []} onEditDerived={(entry) => setDerivedDialog({ editing: entry })} />
        ) : (
          <PaneBody>
            <EmptyState title="No column selected" />
          </PaneBody>
        )}
      </Pane>

      {derivedDialog && (
        <DerivedDialog
          frame={frame}
          derived={detail.data?.derived ?? []}
          editing={derivedDialog.editing}
          onClose={() => setDerivedDialog(null)}
        />
      )}
      {removing && (
        <ConfirmDialog
          title={`Remove “${removing.name}”?`}
          message="The formula is removed from this dataset. Source data are untouched, and variables that used it will show an error until they are edited."
          confirmLabel="Remove"
          danger
          busy={removeDerived.isPending}
          onConfirm={() => {
            removeDerived.mutate(removing);
            setRemoving(null);
          }}
          onClose={() => setRemoving(null)}
        />
      )}
      {confirmArchive && (
        <ConfirmDialog
          title="Archive this dataset?"
          message="It leaves the active list but is never deleted. Cohorts, scores and report items that reference it are kept, and you can restore it from the Archived tab."
          confirmLabel="Archive"
          busy={archive.isPending}
          onConfirm={() => {
            setConfirmArchive(false);
            archive.mutate();
          }}
          onClose={() => setConfirmArchive(false)}
        />
      )}
    </>
  );
}

/** Tiny inline histogram / frequency bars for a profile row. */
function MiniBars({ counts, color }: { counts: number[]; color: string }) {
  const max = Math.max(1, ...counts);
  const width = 96;
  const height = 22;
  const bar = width / Math.max(counts.length, 1);
  return (
    <svg width={width} height={height} className="flex-none" aria-hidden>
      {counts.map((count, index) => {
        const h = count === 0 ? 0 : Math.max(1.5, (count / max) * (height - 2));
        return <rect key={index} x={index * bar + 0.5} y={height - h} width={Math.max(bar - 1, 1)} height={h} rx={1} fill={color} />;
      })}
    </svg>
  );
}

function ColumnsView({ frame, selected, onSelect }: { frame: Frame; selected: string | null; onSelect: (name: string) => void }) {
  const [filter, setFilter] = useState("");
  const profiles = useMemo(() => new Map(frame.columns.map((column) => [column.name, profileColumn(column)])), [frame]);
  const visible = frame.columns.filter((column) => matchesMasterListSearch(filter, column.name, column.label, column.unit));
  return (
    <>
      <div className="flex flex-none items-center gap-2 border-b border-border-2 px-[11px] py-2">
        <input
          className={`${inputCls} w-[260px]`}
          placeholder="Filter columns…"
          aria-label="Filter columns"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
        <span className="ui-mono text-fine text-muted-fg">
          {visible.length}/{frame.columns.length}
        </span>
      </div>
      <PaneBody>
        <div className="overflow-x-auto" role="region" aria-label="Column profiles" tabIndex={0}>
        <table className="w-full min-w-[540px] border-collapse">
          <thead>
            <tr>
              {["Column", "Missing", "Summary", "Distribution"].map((title, index) => (
                <th
                  key={title}
                  scope="col"
                  className={`sticky top-0 z-[1] border-b border-border-2 bg-card px-2.5 py-1.5 ${capSm}`}
                  style={{ textAlign: index === 1 ? "right" : "left" }}
                >
                  {title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((column) => {
              const profile = profiles.get(column.name)!;
              const missingShare = profile.n + profile.missing === 0 ? 0 : profile.missing / (profile.n + profile.missing);
              const typeLabel =
                column.kind === "numeric" ? (profile.kind === "numeric" && profile.binary ? "binary 0/1" : "numeric") : column.kind === "boolean" ? "yes/no" : "categorical";
              return (
                <tr
                  key={column.name}
                  onClick={() => onSelect(column.name)}
                  className="cursor-pointer hover:bg-muted"
                  style={selected === column.name ? { background: "var(--muted)", boxShadow: "inset 3px 0 0 var(--primary)" } : undefined}
                  aria-selected={selected === column.name}
                >
                  <td className="max-w-[230px] border-b border-border-2 px-2.5 py-1.5">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <KindBadge kind={column.kind} derived={column.derived} />
                      <span className="ui-mono min-w-0 truncate text-label font-semibold text-fg">{column.name}</span>
                      {column.role !== "none" && <Chip label={COLUMN_ROLES.find((role) => role.v === column.role)?.label ?? column.role} color="var(--primary)" />}
                    </div>
                    <div className="truncate pl-7 text-cap text-muted-fg">
                      {typeLabel}
                      {column.label !== column.name ? ` · ${column.label}` : ""}
                      {column.unit ? ` · ${column.unit}` : ""}
                    </div>
                    {column.error && <div className="pl-7 text-cap" style={{ color: "var(--bad)" }}>⚠ {column.error}</div>}
                  </td>
                  <td className="ui-mono whitespace-nowrap border-b border-border-2 px-2.5 py-1.5 text-right">
                    <div className="text-body" style={{ color: missingShare > 0.2 ? "var(--bad)" : missingShare > 0 ? "var(--warn)" : "var(--muted-fg)" }}>
                      {(missingShare * 100).toFixed(1)}%
                    </div>
                    <div className="text-cap text-muted-fg">{profile.missing.toLocaleString("en-US")} missing</div>
                  </td>
                  <td className="ui-mono max-w-[240px] border-b border-border-2 px-2.5 py-1.5 text-label text-fg">
                    <ProfileSummary profile={profile} />
                  </td>
                  <td className="border-b border-border-2 px-2.5 py-1">
                    {profile.kind === "numeric" ? (
                      <MiniBars counts={profile.bins.map((bin) => bin.count)} color="var(--info)" />
                    ) : (
                      <MiniBars counts={profile.levels.slice(0, 12).map((level) => level.count)} color="var(--accent2)" />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </PaneBody>
    </>
  );
}

function ProfileSummary({ profile }: { profile: ColumnProfile }) {
  if (profile.kind === "numeric") {
    const s = profile.summary;
    if (profile.n === 0) return <span className="text-muted-fg">no values</span>;
    if (profile.binary) return <span>{fmt((s.mean ?? 0) * 100, 3)}% = 1</span>;
    return (
      <span className="block truncate" title={`median ${fmt(s.median)} · IQR ${fmt(s.q1)}–${fmt(s.q3)} · range ${fmt(s.min)}–${fmt(s.max)}`}>
        {fmt(s.mean)} ± {fmt(s.sd)} <span className="text-muted-fg">[{fmt(s.min)}, {fmt(s.max)}]</span>
      </span>
    );
  }
  if (profile.levels.length === 0) return <span className="text-muted-fg">no values</span>;
  return (
    <span className="block truncate" title={profile.levels.map((level) => `${level.value} ${level.count}`).join(", ")}>
      {profile.unique} levels · {profile.levels.slice(0, 3).map((level) => `${level.value} ${Math.round(level.proportion * 100)}%`).join(", ")}
    </span>
  );
}

function DerivedView({
  frame,
  derived,
  onNew,
  onEdit,
  onRemove,
}: {
  frame: Frame;
  derived: DerivedColumn[];
  onNew: () => void;
  onEdit: (entry: DerivedColumn) => void;
  onRemove: (entry: DerivedColumn) => void;
}) {
  return (
    <PaneBody>
      <div className="flex items-center gap-2 border-b border-border-2 px-[11px] py-2">
        <p className="m-0 flex-1 text-body text-muted-fg">
          Derived variables are stored as formulas and recomputed from the source columns, so they always stay reproducible.
        </p>
        <button type="button" className={`${primaryBtn} flex items-center gap-1`} onClick={onNew}>
          <Plus size={13} aria-hidden /> New variable
        </button>
      </div>
      {derived.length === 0 ? (
        <EmptyState
          title="No derived variables yet"
          hint="Snap together a formula — BMI from height and weight, an eGFR, an age band — or apply a clinical calculator to this dataset."
        />
      ) : (
        derived.map((entry) => {
          const column = frame.columns.find((c) => c.name === entry.name);
          return (
            <div key={entry.name} className="flex items-start gap-2 border-b border-border-2 px-[11px] py-2">
              {column && <KindBadge kind={column.kind} derived />}
              <div className="min-w-0 flex-1">
                <div className="ui-mono text-label font-semibold text-fg">{entry.name}</div>
                <div className="ui-mono mt-0.5 break-all text-label text-muted-fg">= {printExpr(entry.expr)}</div>
                {column?.error && <div className="mt-0.5 text-cap" style={{ color: "var(--bad)" }}>⚠ {column.error}</div>}
              </div>
              <button type="button" className={`${ghostBtn} gap-1`} onClick={() => onEdit(entry)}>
                <Pencil size={11} aria-hidden /> <span className="text-label">Edit</span>
              </button>
              <button type="button" className={`${ghostBtn} gap-1`} onClick={() => onRemove(entry)} aria-label={`Remove ${entry.name}`}>
                <Trash2 size={11} aria-hidden /> <span className="text-label">Remove</span>
              </button>
            </div>
          );
        })
      )}
    </PaneBody>
  );
}

function ColumnInspector({
  frame,
  column,
  derived,
  onEditDerived,
}: {
  frame: Frame;
  column: FrameColumn;
  derived: DerivedColumn[];
  onEditDerived: (entry: DerivedColumn) => void;
}) {
  const queryClient = useQueryClient();
  const profile = useMemo(() => profileColumn(column), [column]);
  const [label, setLabel] = useState(column.label === column.name ? "" : column.label);
  const [unit, setUnit] = useState(column.unit);
  const [description, setDescription] = useState(column.description);
  const [confirmKind, setConfirmKind] = useState<ColumnKind | null>(null);
  const [confirmMerge, setConfirmMerge] = useState(false);
  const variants = useMemo(() => (!column.derived && column.kind === "categorical" ? caseVariants(column.values) : []), [column]);
  // Exactly how many present values a conversion would turn missing, shown before confirming.
  const conversionLoss = useMemo(() => {
    if (!confirmKind || column.derived) return 0;
    return convertColumnKind({ ...column, kind: column.kind, values: column.values } as StoredColumn, confirmKind).lost;
  }, [confirmKind, column]);

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.dataset(frame.datasetId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.datasets() }),
    ]);

  const patchSource = useMutation({
    mutationFn: (patch: { label?: string; unit?: string; role?: ColumnRole; description?: string; kind?: ColumnKind; merge_case?: true }) =>
      wbApi.patchDataset(frame.datasetId, { columns: [{ name: column.name, ...patch }] }),
    onSuccess: async (response, patch) => {
      await invalidate();
      const lost = response.conversion_losses[column.name] ?? 0;
      if (patch.merge_case) toast(`Merged · ${plural(response.case_merges[column.name] ?? 0, "value")} respelled`);
      else if (patch.kind) toast(lost === 0 ? "Converted · no values were lost" : `Converted · ${plural(lost, "value")} became missing`);
      else toast(`Saved · ${column.name}`);
    },
    onError: (error) => toast(`Not saved: ${errorMessage(error)}`),
  });

  const patchDerived = useMutation({
    mutationFn: (patch: Partial<DerivedColumn>) =>
      wbApi.patchDataset(frame.datasetId, {
        derived: derived.map((entry) => (entry.name === column.name ? { ...entry, ...patch } : entry)),
      }),
    onSuccess: async () => {
      await invalidate();
      toast(`Saved · ${column.name}`);
    },
    onError: (error) => toast(`Not saved: ${errorMessage(error)}`),
  });

  const save = (patch: { label?: string; unit?: string; role?: ColumnRole; description?: string }) => {
    if (column.derived) patchDerived.mutate(patch);
    else patchSource.mutate(patch);
  };
  const busy = patchSource.isPending || patchDerived.isPending;
  const dirty =
    (label.trim() || column.name) !== column.label || unit.trim() !== column.unit || description.trim() !== column.description;
  const derivedEntry = derived.find((entry) => entry.name === column.name) ?? null;

  return (
    <PaneBody>
      <Section title={<span className="ui-mono normal-case tracking-normal">{column.name}</span>}>
        <div className="flex flex-wrap items-center gap-1.5">
          <KindBadge kind={column.kind} derived={column.derived} />
          <span className="text-body text-muted-fg">
            {column.derived ? "Derived by formula" : "Source column"} · {profile.n.toLocaleString("en-US")} present ·{" "}
            {profile.missing.toLocaleString("en-US")} missing
          </span>
        </div>
        {derivedEntry && (
          <div className="mt-2 rounded-md border border-border-2 bg-card-2 px-2 py-1.5">
            <div className="ui-mono break-all text-label text-fg">= {printExpr(derivedEntry.expr)}</div>
            <button type="button" className={`${ghostBtn} mt-1.5 gap-1`} onClick={() => onEditDerived(derivedEntry)}>
              <Pencil size={11} aria-hidden /> <span className="text-label">Edit formula</span>
            </button>
          </div>
        )}
      </Section>

      <Section title="Profile">
        {profile.kind === "numeric" ? (
          <div className="flex flex-col gap-1">
            <KV k="Mean ± SD" v={`${fmt(profile.summary.mean)} ± ${fmt(profile.summary.sd)}`} flat />
            <KV k="Median [IQR]" v={`${fmt(profile.summary.median)} [${fmt(profile.summary.q1)}, ${fmt(profile.summary.q3)}]`} flat />
            <KV k="Range" v={`${fmt(profile.summary.min)} – ${fmt(profile.summary.max)}`} flat />
            <KV k="Distinct values" v={profile.unique.toLocaleString("en-US")} flat />
            <KV k="Skewness" v={fmt(profile.summary.skewness)} flat />
            <div className="mt-1.5">
              <MiniHistogram bins={profile.bins} />
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {profile.levels.slice(0, 12).map((level) => (
              <div key={level.value} className="flex items-center gap-2 text-label">
                <span className="ui-mono w-[90px] flex-none truncate text-fg" title={level.value}>
                  {level.value}
                </span>
                <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full" style={{ width: `${level.proportion * 100}%`, background: "var(--accent2)" }} />
                </div>
                <span className="ui-mono w-[74px] flex-none text-right text-muted-fg">
                  {level.count} · {(level.proportion * 100).toFixed(0)}%
                </span>
              </div>
            ))}
            {profile.levels.length > 12 && <div className="text-cap text-muted-fg">+ {profile.levels.length - 12} more levels</div>}
          </div>
        )}
      </Section>

      <Section title="Analysis role">
        <select
          aria-label="Analysis role"
          className={`${selectSmCls} h-7 w-full text-body`}
          value={column.role}
          disabled={busy}
          onChange={(event) => save({ role: event.target.value as ColumnRole })}
        >
          {COLUMN_ROLES.map((role) => (
            <option key={role.v} value={role.v}>
              {role.label} — {role.hint}
            </option>
          ))}
        </select>
      </Section>

      <Section title="Metadata">
        <div className="flex flex-col gap-2">
          <Field label="Label" htmlFor="col-label">
            <input id="col-label" className={`${inputCls} w-full`} value={label} placeholder={column.name} onChange={(event) => setLabel(event.target.value)} />
          </Field>
          <Field label="Unit" htmlFor="col-unit">
            <input id="col-unit" className={`${inputCls} w-full`} value={unit} placeholder="e.g. mmol/L" onChange={(event) => setUnit(event.target.value)} />
          </Field>
          <Field label="Description" htmlFor="col-description">
            <textarea id="col-description" className={`${textareaCls} h-[64px]`} value={description} onChange={(event) => setDescription(event.target.value)} />
          </Field>
          <button
            type="button"
            className={`${softBtn} self-start`}
            disabled={!dirty || busy}
            onClick={() => save({ label: label.trim() || column.name, unit: unit.trim(), description: description.trim() })}
          >
            Save metadata
          </button>
        </div>
      </Section>

      {!column.derived && (
        <Section title="Type">
          <p className="m-0 mb-2 text-body leading-relaxed text-muted-fg">{KIND_HELP[column.kind]}</p>
          <div className="flex flex-wrap gap-1.5">
            {COLUMN_KINDS.filter((kind) => kind !== column.kind).map((kind) => (
              <button key={kind} type="button" className={pillBtn} disabled={busy} onClick={() => setConfirmKind(kind)}>
                Convert to {KIND_NAME[kind]}
              </button>
            ))}
          </div>
        </Section>
      )}

      {variants.length > 0 && (
        <Section title="Spelling">
          <Callout tone="warn">
            {plural(variants.length, "value")} {variants.length === 1 ? "is" : "are"} spelled with different letter case:{" "}
            <span className="ui-mono">
              {variants
                .slice(0, 3)
                .map((group) => group.variants.join(" / "))
                .join("; ")}
              {variants.length > 3 ? "; …" : ""}
            </span>
            . Analyses treat each spelling as its own group.
          </Callout>
          <button type="button" className={`${pillBtn} mt-2`} disabled={busy} onClick={() => setConfirmMerge(true)}>
            Merge case variants
          </button>
        </Section>
      )}

      {confirmMerge && (
        <ConfirmDialog
          title={`Merge case variants in “${column.name}”?`}
          message={`Each group is rewritten to its most common spelling: ${variants
            .slice(0, 4)
            .map((group) => `${group.variants.filter((variant) => variant !== group.canonical).join(", ")} → ${group.canonical}`)
            .join("; ")}${variants.length > 4 ? "; …" : ""}. Only do this if the spellings mean the same thing (genotypes such as Aa / aa do not). The dataset content hash changes.`}
          confirmLabel="Merge"
          busy={busy}
          onConfirm={() => {
            patchSource.mutate({ merge_case: true });
            setConfirmMerge(false);
          }}
          onClose={() => setConfirmMerge(false)}
        />
      )}

      {confirmKind && (
        <ConfirmDialog
          title={`Convert “${column.name}” to ${KIND_NAME[confirmKind]}?`}
          message={`${
            conversionLoss > 0
              ? `${plural(conversionLoss, "present value")} cannot be read as ${KIND_NAME[confirmKind]} and will become missing.`
              : "Every present value converts without loss."
          } The dataset content hash changes, so analyses pinned earlier keep their old provenance.`}
          confirmLabel="Convert"
          danger={conversionLoss > 0}
          busy={busy}
          onConfirm={() => {
            patchSource.mutate({ kind: confirmKind });
            setConfirmKind(null);
          }}
          onClose={() => setConfirmKind(null)}
        />
      )}
      {column.error && (
        <div className="px-[11px] py-2">
          <Callout tone="bad">{column.error}</Callout>
        </div>
      )}
    </PaneBody>
  );
}

const KIND_NAME: Record<ColumnKind, string> = { numeric: "numeric", categorical: "categorical", boolean: "yes/no" };
const KIND_HELP: Record<ColumnKind, string> = {
  numeric: "Numbers. Convert to categorical for coded groups (1/2/3), or to yes/no for a 0/1 flag.",
  categorical: "Text categories. Convert to numeric to read them as numbers, or to yes/no for yes/no, y/n or true/false spellings.",
  boolean: "Yes/no values. Convert to numeric for 1/0, or to categorical for the words “yes” and “no”.",
};

function MiniHistogram({ bins }: { bins: { x0: number; x1: number; count: number }[] }) {
  if (bins.length === 0) return null;
  const max = Math.max(1, ...bins.map((bin) => bin.count));
  return (
    <div>
      <div className="flex h-[70px] items-end gap-px">
        {bins.map((bin, index) => (
          <div
            key={index}
            className="min-w-0 flex-1 rounded-t-[2px]"
            title={`${fmt(bin.x0)} – ${fmt(bin.x1)}: ${bin.count}`}
            style={{ height: `${(bin.count / max) * 100}%`, minHeight: bin.count > 0 ? 2 : 0, background: "var(--info)" }}
          />
        ))}
      </div>
      <div className="ui-mono mt-0.5 flex justify-between text-nano text-muted-fg">
        <span>{fmt(bins[0].x0)}</span>
        <span>{fmt(bins[bins.length - 1].x1)}</span>
      </div>
    </div>
  );
}
