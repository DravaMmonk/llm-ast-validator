/**
 * Study Design — plan before you analyse: a PICO question assembled from
 * synonym pieces (which writes the PubMed and ClinicalTrials.gov searches),
 * sample size and power with a live power curve, and the matching reporting
 * checklist to track as the manuscript takes shape. A study plan is saved as a
 * document so it can be reopened and pinned to the report.
 */

import { useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Save, X } from "lucide-react";

import { CHECKLISTS, checklistItemCount, findChecklist } from "../../../shared/workbench/checklists";
import type { StudyPayload, WorkbenchDocument } from "../../../shared/workbench/documents";
import {
  EMPTY_PICO,
  PICO_LABELS,
  type Pico,
  type PicoKey,
  type SearchFilters,
  type TermField,
  buildPubmedQuery,
  clinicalTrialsUrl,
  pubmedUrl,
  structuredQuestion,
} from "../../../shared/workbench/pico";
import {
  powerTwoMeans,
  powerTwoProportions,
  sampleSizeCorrelation,
  sampleSizeOneProportion,
  sampleSizeTwoMeans,
  sampleSizeTwoProportions,
} from "../../../shared/stats";
import { ChartActions, LineChart } from "../../charts";
import {
  LoadingState,
  Meter,
  Page,
  Pane,
  PaneBody,
  PaneHeader,
  TabBar,
  checkboxCls,
  inputCls,
  inputSmCls,
  primaryBtn,
  selectSmCls,
  textareaCls,
  toast,
} from "../../shared-console/src";
import { errorMessage, wbApi } from "../../workstation/api";
import { markClean, useGuard, useUnsavedChanges } from "../../workstation/guard";
import { invalidateDocuments, useDocuments, usePinToReport } from "../../workstation/data";
import { Callout, CopyButton, Field, PinButton, Section, StatTile, pct } from "../../workstation/ui";

type Tool = "pico" | "sample-size" | "checklist";

/** Change detection key; plain JSON tolerates a cleared (NaN) number field. */
const planKey = (value: unknown) => JSON.stringify(value);
type SizeKind = "two-means" | "two-proportions" | "one-proportion" | "correlation";
type Status = "yes" | "partial" | "no" | "na";

interface Plan {
  pico: Pico;
  filters: SearchFilters;
  includeComparison: boolean;
  size: { kind: SizeKind; delta: number; sd: number; p1: number; p2: number; p: number; margin: number; r: number; alpha: number; power: number; ratio: number; dropout: number };
  checklist: { key: string; status: Record<string, Status>; where: Record<string, string> };
  notes: string;
}

const DEFAULT_PLAN: Plan = {
  pico: EMPTY_PICO,
  filters: { humans: true, english: false, design: "", yearFrom: null },
  includeComparison: false,
  size: { kind: "two-means", delta: 5, sd: 12, p1: 0.2, p2: 0.12, p: 0.3, margin: 0.05, r: 0.3, alpha: 0.05, power: 0.8, ratio: 1, dropout: 0.1 },
  checklist: { key: "consort-2025", status: {}, where: {} },
  notes: "",
};

/** Merges a stored payload over the defaults so older plans keep working. */
function toPlan(payload: StudyPayload | undefined): Plan {
  const raw = (payload ?? {}) as Partial<Plan>;
  return {
    pico: { ...DEFAULT_PLAN.pico, ...(raw.pico ?? {}) },
    filters: { ...DEFAULT_PLAN.filters, ...(raw.filters ?? {}) },
    includeComparison: raw.includeComparison ?? false,
    size: Object.fromEntries(
      Object.entries({ ...DEFAULT_PLAN.size, ...(raw.size ?? {}) }).map(([key, value]) =>
        // Stored JSON turns a cleared field (NaN) into null; fall back to the default.
        [key, key === "kind" ? value : typeof value === "number" ? value : DEFAULT_PLAN.size[key as keyof Plan["size"]]],
      ),
    ) as Plan["size"],
    checklist: { ...DEFAULT_PLAN.checklist, ...(raw.checklist ?? {}) },
    notes: raw.notes ?? "",
  };
}

export default function StudyDesign() {
  const { tool = "pico" } = useParams<{ tool: Tool }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const studies = useDocuments<StudyPayload>("study");
  // The open plan lives in the URL (?plan=…) so it survives reloads and can be linked.
  const [params, setParams] = useSearchParams();
  const openId = params.get("plan");
  const setOpenId = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set("plan", id);
    else next.delete("plan");
    setParams(next);
  };
  const saved = (studies.data?.documents ?? []).find((doc) => doc.id === openId) ?? null;
  if (openId && studies.isLoading) {
    return (
      <Page>
        <Pane>
          <PaneBody>
            <LoadingState label="Loading study plan…" />
          </PaneBody>
        </Pane>
      </Page>
    );
  }
  return (
    <StudyWorkspace
      key={saved?.id ?? "new"}
      tool={tool as Tool}
      saved={saved}
      studies={studies.data?.documents ?? []}
      onOpen={setOpenId}
      onTool={(next) => navigate(`/design/${next}${openId ? `?plan=${openId}` : ""}`)}
      onSaved={async (doc) => {
        await invalidateDocuments(queryClient, "study");
        markClean();
        setOpenId(doc.id);
      }}
    />
  );
}

function StudyWorkspace({
  tool,
  saved,
  studies,
  onOpen,
  onTool,
  onSaved,
}: {
  tool: Tool;
  saved: WorkbenchDocument<StudyPayload> | null;
  studies: WorkbenchDocument<StudyPayload>[];
  onOpen: (id: string | null) => void;
  onTool: (tool: Tool) => void;
  onSaved: (doc: WorkbenchDocument<StudyPayload>) => Promise<void>;
}) {
  const [title, setTitle] = useState(saved?.title ?? "Untitled study plan");
  const [plan, setPlan] = useState<Plan>(() => toPlan(saved?.payload));
  const [baseline, setBaseline] = useState(() => planKey({ title: saved?.title ?? "Untitled study plan", plan: toPlan(saved?.payload) }));
  const dirty = planKey({ title, plan }) !== baseline;
  useUnsavedChanges(dirty, `The study plan “${title || "Untitled study plan"}”`);
  const guard = useGuard();
  const update = (patch: Partial<Plan>) => setPlan((current) => ({ ...current, ...patch }));

  const save = useMutation({
    mutationFn: () =>
      saved
        ? wbApi.patchDocument<StudyPayload>(saved.id, { title: title.trim() || "Untitled study plan", payload: plan as unknown as StudyPayload })
        : wbApi.createDocument<StudyPayload>({ kind: "study", title: title.trim() || "Untitled study plan", payload: plan as unknown as StudyPayload }),
    onSuccess: async (doc) => {
      setBaseline(planKey({ title: doc.title, plan }));
      toast(`Saved study plan · ${doc.title}`);
      await onSaved(doc);
    },
    onError: (error) => toast(`Not saved: ${errorMessage(error)}`),
  });

  return (
    <Page>
      <Pane>
        <PaneHeader label="Study plan">
          <select
            aria-label="Open a saved study plan"
            className={`${selectSmCls} max-w-[220px]`}
            value={saved?.id ?? ""}
            onChange={(event) => {
              const target = event.target.value || null;
              guard(() => onOpen(target));
            }}
          >
            <option value="">{saved ? "＋ New plan" : "New (unsaved)"}</option>
            {studies.map((study) => (
              <option key={study.id} value={study.id}>
                {study.title}
              </option>
            ))}
          </select>
          {dirty && <span className="ui-mono text-fine" style={{ color: "var(--warn)" }}>unsaved</span>}
          <button type="button" className={`${primaryBtn} flex items-center gap-1`} disabled={save.isPending || (!dirty && Boolean(saved))} onClick={() => save.mutate()}>
            <Save size={13} aria-hidden /> {save.isPending ? "Saving…" : "Save plan"}
          </button>
        </PaneHeader>
        <div className="flex flex-none items-center gap-2 border-b border-border-2 px-[11px] py-1.5">
          <input aria-label="Study plan title" className={`${inputSmCls} h-7 w-[360px] font-sans text-ui`} value={title} maxLength={160} onChange={(event) => setTitle(event.target.value)} />
        </div>
        <TabBar
          value={tool}
          onChange={onTool}
          grow={false}
          options={[
            { v: "pico", label: "PICO & search" },
            { v: "sample-size", label: "Sample size & power" },
            { v: "checklist", label: "Reporting checklist" },
          ]}
        />
        {tool === "sample-size" ? (
          <SampleSize plan={plan} update={update} title={title} />
        ) : tool === "checklist" ? (
          <ChecklistTool plan={plan} update={update} title={title} />
        ) : (
          <PicoTool plan={plan} update={update} title={title} />
        )}
      </Pane>
    </Page>
  );
}

/* ------------------------------------------------------------------ */
/* PICO                                                                */
/* ------------------------------------------------------------------ */

const FIELD_LABEL: Record<TermField, string> = { tiab: "title/abstract", mesh: "MeSH", all: "all fields" };
const FIELD_ORDER: TermField[] = ["tiab", "mesh", "all"];

function PicoTool({ plan, update, title }: { plan: Plan; update: (patch: Partial<Plan>) => void; title: string }) {
  const pin = usePinToReport();
  const query = buildPubmedQuery(plan.pico, plan.filters, plan.includeComparison);
  const question = structuredQuestion(plan.pico);
  const setTerms = (key: PicoKey, terms: Pico[PicoKey]) => update({ pico: { ...plan.pico, [key]: terms } });
  return (
    <PaneBody>
      <div className="mx-auto w-full max-w-[1080px] px-4 py-4">
        <h2 className="m-0 text-[17px] font-semibold text-fg-strong">Build the question from pieces</h2>
        <p className="m-0 mt-1 text-ui text-muted-fg">
          Add synonyms to each element. Synonyms are joined with OR, elements with AND — the structure of a systematic search.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3 mobile:grid-cols-1">
          {(Object.keys(PICO_LABELS) as PicoKey[]).map((key) => (
            <PicoSlot key={key} slot={key} terms={plan.pico[key]} onChange={(terms) => setTerms(key, terms)} />
          ))}
        </div>
        <div className="mt-3 max-w-[380px]">
          <Field label="Time frame (optional)" htmlFor="pico-time">
            <input id="pico-time" className={`${inputCls} w-full`} value={plan.pico.timeframe} placeholder="e.g. 12 months" onChange={(event) => update({ pico: { ...plan.pico, timeframe: event.target.value } })} />
          </Field>
        </div>

        <Section title="Structured question" className="mt-4 rounded-[10px] border border-border">
          <p className="m-0 text-md leading-relaxed text-fg">{question || <span className="text-muted-fg">Add at least a population, an intervention, or an outcome.</span>}</p>
        </Section>

        <Section title="PubMed search" className="mt-3 rounded-[10px] border border-border">
          <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-label text-fg">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" className={checkboxCls} checked={plan.filters.humans} onChange={(event) => update({ filters: { ...plan.filters, humans: event.target.checked } })} />
              Humans
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" className={checkboxCls} checked={plan.filters.english} onChange={(event) => update({ filters: { ...plan.filters, english: event.target.checked } })} />
              English
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" className={checkboxCls} checked={plan.includeComparison} onChange={(event) => update({ includeComparison: event.target.checked })} />
              Include comparison terms
            </label>
            <label className="flex items-center gap-1.5">
              Study type
              <select className={selectSmCls} value={plan.filters.design} onChange={(event) => update({ filters: { ...plan.filters, design: event.target.value as SearchFilters["design"] } })}>
                <option value="">any</option>
                <option value="rct">randomised trials</option>
                <option value="systematic_review">systematic reviews</option>
                <option value="cohort">cohort studies</option>
              </select>
            </label>
            <label className="flex items-center gap-1.5">
              From year
              <input
                className={`${inputSmCls} ui-num w-[70px]`}
                inputMode="numeric"
                value={plan.filters.yearFrom ?? ""}
                onChange={(event) => {
                  const year = Number(event.target.value);
                  update({ filters: { ...plan.filters, yearFrom: event.target.value === "" || !Number.isInteger(year) ? null : Math.min(Math.max(year, 1800), 2100) } });
                }}
              />
            </label>
          </div>
          <pre className="ui-mono m-0 whitespace-pre-wrap break-words rounded-md border border-border-2 bg-card-2 px-2.5 py-2 text-label leading-relaxed text-fg">{query || "—"}</pre>
          <div className="mt-2 flex flex-wrap gap-2">
            <CopyButton text={query} label="Copy query" />
            <a
              className={`${primaryBtn} inline-flex items-center gap-1 no-underline ${query ? "" : "pointer-events-none opacity-40"}`}
              href={query ? pubmedUrl(query) : undefined}
              target="_blank"
              rel="noreferrer noopener"
              aria-disabled={!query}
            >
              Search PubMed <ExternalLink size={12} aria-hidden />
            </a>
            <a
              className={`h-7 rounded-md border border-border bg-card px-3 text-ui font-medium leading-7 text-fg no-underline hover:bg-muted ${query ? "" : "pointer-events-none opacity-40"}`}
              href={query ? clinicalTrialsUrl(plan.pico) : undefined}
              target="_blank"
              rel="noreferrer noopener"
              aria-disabled={!query}
            >
              ClinicalTrials.gov ↗
            </a>
            <PinButton
              busy={pin.isPending}
              disabled={!question}
              onClick={() =>
                pin.mutate({
                  title: `Research question · ${title}`,
                  datasetId: null,
                  payload: {
                    module: "design",
                    summary: question,
                    table: {
                      columns: ["Element", "Terms"],
                      rows: [
                        ...(Object.keys(PICO_LABELS) as PicoKey[]).map((key) => [PICO_LABELS[key].label, plan.pico[key].map((term) => term.text).join("; ")]),
                        ["PubMed query", query],
                      ],
                    },
                    chart: null,
                    provenance: { generated_at: new Date().toISOString() },
                    notes: "",
                  },
                })
              }
            />
          </div>
          <p className="m-0 mt-2 text-cap leading-relaxed text-muted-fg">
            Links open PubMed and ClinicalTrials.gov in a new tab with this query; nothing else leaves the workstation. Refine with a librarian for a systematic review.
          </p>
        </Section>
      </div>
    </PaneBody>
  );
}

function PicoSlot({ slot, terms, onChange }: { slot: PicoKey; terms: Pico[PicoKey]; onChange: (terms: Pico[PicoKey]) => void }) {
  const [draft, setDraft] = useState("");
  const meta = PICO_LABELS[slot];
  const add = () => {
    const text = draft.trim();
    if (!text || terms.some((term) => term.text.toLowerCase() === text.toLowerCase())) {
      setDraft("");
      return;
    }
    onChange([...terms, { text: text.slice(0, 120), field: "tiab" }]);
    setDraft("");
  };
  return (
    <div className="rounded-[10px] border border-border bg-card p-3">
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 flex-none items-center justify-center rounded-md bg-primary text-ui font-bold text-primary-fg">{meta.letter}</span>
        <span className="text-ui font-semibold text-fg-strong">{meta.label}</span>
      </div>
      <div className="mt-2 flex min-h-[30px] flex-wrap gap-1.5">
        {terms.map((term, index) => (
          <span key={term.text} className="inline-flex items-center gap-1 rounded-full border border-border bg-card-2 py-0.5 pl-2 pr-1 text-label text-fg">
            {index > 0 && <span className="ui-mono text-nano text-muted-fg">OR</span>}
            {term.text}
            <button
              type="button"
              className="cursor-pointer rounded-full border-0 bg-muted px-1.5 text-nano font-semibold uppercase text-muted-fg hover:text-fg"
              title="Change the search field"
              aria-label={`Search field for “${term.text}”: ${FIELD_LABEL[term.field]}. Activate to change.`}
              onClick={() => onChange(terms.map((entry, i) => (i === index ? { ...entry, field: FIELD_ORDER[(FIELD_ORDER.indexOf(entry.field) + 1) % FIELD_ORDER.length] } : entry)))}
            >
              {FIELD_LABEL[term.field]}
            </button>
            <button type="button" className="flex cursor-pointer items-center border-0 bg-transparent p-0.5 text-muted-fg hover:text-fg" aria-label={`Remove ${term.text}`} onClick={() => onChange(terms.filter((_, i) => i !== index))}>
              <X size={11} />
            </button>
          </span>
        ))}
      </div>
      <input
        className={`${inputCls} mt-2 w-full`}
        placeholder={`${meta.hint} — Enter to add`}
        aria-label={`Add a term to ${meta.label}`}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === ",") {
            event.preventDefault();
            add();
          } else if (event.key === "Backspace" && draft === "" && terms.length) {
            onChange(terms.slice(0, -1));
          }
        }}
        onBlur={add}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sample size                                                         */
/* ------------------------------------------------------------------ */

function NumberField({ label, value, onChange, step, hint, id }: { label: string; value: number; onChange: (v: number) => void; step?: number; hint?: string; id: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <input
        id={id}
        type="number"
        step={step}
        className={`${inputSmCls} ui-num h-8 text-ui`}
        value={draft ?? String(value)}
        onChange={(event) => {
          setDraft(event.target.value);
          const parsed = Number(event.target.value);
          // An empty or invalid field is reported as NaN so no stale result is shown.
          onChange(event.target.value.trim() !== "" && Number.isFinite(parsed) ? parsed : Number.NaN);
        }}
        onBlur={() => {
          if (Number.isFinite(value)) setDraft(null);
        }}
      />
    </Field>
  );
}

function SampleSize({ plan, update, title }: { plan: Plan; update: (patch: Partial<Plan>) => void; title: string }) {
  const s = plan.size;
  const set = (patch: Partial<Plan["size"]>) => update({ size: { ...s, ...patch } });
  const ref = useRef<SVGSVGElement>(null);
  const pin = usePinToReport();

  const result = useMemo(() => {
    const needed: [string, number][] =
      s.kind === "two-means"
        ? [["difference to detect", s.delta], ["standard deviation", s.sd], ["ratio", s.ratio]]
        : s.kind === "two-proportions"
          ? [["control proportion", s.p1], ["intervention proportion", s.p2], ["ratio", s.ratio]]
          : s.kind === "one-proportion"
            ? [["expected proportion", s.p], ["margin of error", s.margin]]
            : [["correlation", s.r]];
    const blank = [...needed, ["alpha", s.alpha] as [string, number]].find(([, value]) => !Number.isFinite(value));
    if (blank) return { ok: null, error: `Enter the ${blank[0]}.` };
    try {
      if (s.kind === "two-means") return { ok: sampleSizeTwoMeans({ delta: s.delta, sd: s.sd, alpha: s.alpha, power: s.power, ratio: s.ratio }), error: null };
      if (s.kind === "two-proportions") return { ok: sampleSizeTwoProportions({ p1: s.p1, p2: s.p2, alpha: s.alpha, power: s.power, ratio: s.ratio }), error: null };
      if (s.kind === "one-proportion") return { ok: sampleSizeOneProportion({ p: s.p, margin: s.margin, alpha: s.alpha }), error: null };
      return { ok: sampleSizeCorrelation({ r: s.r, alpha: s.alpha, power: s.power }), error: null };
    } catch (error) {
      return { ok: null, error: error instanceof Error ? error.message : "Invalid inputs." };
    }
  }, [s]);

  const curve = useMemo(() => {
    if (!result.ok || (s.kind !== "two-means" && s.kind !== "two-proportions")) return null;
    const target = result.ok.n1;
    const max = Math.max(10, Math.ceil(target * 2));
    const points: { x: number; y: number }[] = [];
    for (let i = 0; i <= 60; i += 1) {
      const n1 = Math.max(2, Math.round((max * i) / 60));
      try {
        const power =
          s.kind === "two-means"
            ? powerTwoMeans({ n1, delta: s.delta, sd: s.sd, alpha: s.alpha, ratio: s.ratio }).power
            : powerTwoProportions({ n1, p1: s.p1, p2: s.p2, alpha: s.alpha, ratio: s.ratio }).power;
        points.push({ x: n1, y: power });
      } catch {
        /* skip invalid points */
      }
    }
    return { points, target };
  }, [result.ok, s]);

  const inflated = result.ok ? Math.ceil(result.ok.total / (1 - Math.min(Math.max(s.dropout, 0), 0.9))) : null;
  const sentence = result.ok
    ? s.kind === "two-means"
      ? `To detect a difference of ${s.delta} (SD ${s.sd}) with ${pct(s.power, 0)} power at two-sided α = ${s.alpha}, ${result.ok.n1} participants per group are needed${s.ratio !== 1 ? ` (${result.ok.n1} and ${result.ok.n2} at a ${s.ratio}:1 ratio)` : ""} — ${result.ok.total} in total, or ${inflated} allowing for ${pct(s.dropout, 0)} dropout.`
      : s.kind === "two-proportions"
        ? `To detect a change in proportion from ${pct(s.p1, 1)} to ${pct(s.p2, 1)} with ${pct(s.power, 0)} power at two-sided α = ${s.alpha}, ${result.ok.n1} participants per group are needed — ${result.ok.total} in total, or ${inflated} allowing for ${pct(s.dropout, 0)} dropout.`
        : s.kind === "one-proportion"
          ? `To estimate a proportion of about ${pct(s.p, 0)} within ±${pct(s.margin, 1)} (${pct(1 - s.alpha, 0)} confidence), ${result.ok.total} participants are needed, or ${inflated} allowing for ${pct(s.dropout, 0)} non-response.`
          : `To detect a correlation of r = ${s.r} with ${pct(s.power, 0)} power at two-sided α = ${s.alpha}, ${result.ok.total} participants are needed (${inflated} allowing for ${pct(s.dropout, 0)} dropout).`
    : "";

  return (
    <PaneBody>
      <div className="mx-auto grid w-full max-w-[1080px] grid-cols-[320px_1fr] gap-5 px-4 py-4 mobile:grid-cols-1">
        <div className="flex flex-col gap-2.5">
          <Field label="Design">
            <select className={`${selectSmCls} h-8 text-ui`} value={s.kind} onChange={(event) => set({ kind: event.target.value as SizeKind })} aria-label="Sample size design">
              <option value="two-means">Compare two means (t-test)</option>
              <option value="two-proportions">Compare two proportions</option>
              <option value="one-proportion">Estimate one proportion (precision)</option>
              <option value="correlation">Detect a correlation</option>
            </select>
          </Field>
          {s.kind === "two-means" && (
            <>
              <NumberField id="ss-delta" label="Difference to detect" value={s.delta} onChange={(delta) => set({ delta })} hint="The smallest clinically important difference." />
              <NumberField id="ss-sd" label="Standard deviation" value={s.sd} onChange={(sd) => set({ sd })} hint="From a pilot or the literature." />
            </>
          )}
          {s.kind === "two-proportions" && (
            <>
              <NumberField id="ss-p1" label="Proportion, control" value={s.p1} step={0.01} onChange={(p1) => set({ p1 })} />
              <NumberField id="ss-p2" label="Proportion, intervention" value={s.p2} step={0.01} onChange={(p2) => set({ p2 })} />
            </>
          )}
          {s.kind === "one-proportion" && (
            <>
              <NumberField id="ss-p" label="Expected proportion" value={s.p} step={0.01} onChange={(p) => set({ p })} />
              <NumberField id="ss-margin" label="Margin of error (±)" value={s.margin} step={0.01} onChange={(margin) => set({ margin })} />
            </>
          )}
          {s.kind === "correlation" && <NumberField id="ss-r" label="Correlation to detect" value={s.r} step={0.05} onChange={(r) => set({ r })} />}
          <NumberField id="ss-alpha" label="Alpha (two-sided)" value={s.alpha} step={0.01} onChange={(alpha) => set({ alpha })} />
          {s.kind !== "one-proportion" && (
            <Field label={`Power · ${pct(s.power, 0)}`} htmlFor="ss-power">
              <input id="ss-power" type="range" min={0.5} max={0.99} step={0.01} value={s.power} onChange={(event) => set({ power: Number(event.target.value) })} className="accent-[var(--primary)]" />
            </Field>
          )}
          {(s.kind === "two-means" || s.kind === "two-proportions") && (
            <NumberField id="ss-ratio" label="Allocation ratio (group 2 : group 1)" value={s.ratio} step={0.5} onChange={(ratio) => set({ ratio })} />
          )}
          <Field label={`Expected dropout · ${pct(s.dropout, 0)}`} htmlFor="ss-dropout">
            <input id="ss-dropout" type="range" min={0} max={0.5} step={0.01} value={s.dropout} onChange={(event) => set({ dropout: Number(event.target.value) })} className="accent-[var(--primary)]" />
          </Field>
        </div>
        <div>
          {result.error ? (
            <Callout tone="bad">{result.error}</Callout>
          ) : result.ok ? (
            <>
              <div className="grid grid-cols-3 gap-2">
                <StatTile label={s.kind === "one-proportion" || s.kind === "correlation" ? "Required n" : "Per group"} value={s.kind === "one-proportion" || s.kind === "correlation" ? result.ok.total : `${result.ok.n1}${result.ok.n2 && result.ok.n2 !== result.ok.n1 ? ` / ${result.ok.n2}` : ""}`} tone="var(--primary)" />
                <StatTile label="Total" value={result.ok.total.toLocaleString("en-US")} sub={result.ok.achievedPower !== null ? `achieved power ${pct(result.ok.achievedPower, 1)}` : undefined} />
                <StatTile label="With dropout" value={inflated?.toLocaleString("en-US") ?? "—"} sub={`÷ (1 − ${pct(s.dropout, 0)})`} />
              </div>
              <p className="mb-0 mt-3 rounded-md border border-border-2 bg-card-2 px-2.5 py-2 text-body leading-relaxed text-fg">{sentence}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <CopyButton text={sentence} label="Copy for protocol" />
                <PinButton
                  busy={pin.isPending}
                  onClick={() =>
                    pin.mutate({
                      title: `Sample size · ${title}`,
                      datasetId: null,
                      payload: { module: "design", summary: sentence, table: null, chart: curve ? { type: "power", data: curve.points } : null, provenance: { method: s.kind, generated_at: new Date().toISOString() }, notes: "" },
                    })
                  }
                />
              </div>
              {curve && (
                <div className="mt-4">
                  <LineChart
                    ref={ref}
                    title="Power curve"
                    height={260}
                    series={[{ label: "Power", points: curve.points }]}
                    xLabel="Participants per group (group 1)"
                    yLabel="Power"
                    yDomain={[0, 1]}
                    hLines={[{ y: s.power, label: `target ${pct(s.power, 0)}` }]}
                    vLines={[{ x: curve.target, label: `n = ${curve.target}` }]}
                    legend={false}
                    actions={<ChartActions svgRef={ref} filename="power-curve" />}
                  />
                </div>
              )}
              <p className="m-0 mt-3 text-cap leading-relaxed text-muted-fg">
                Two means: noncentral-t, matches R power.t.test. Two proportions: normal approximation, matches R power.prop.test. Clustered, non-inferiority, and survival designs need dedicated methods.
              </p>
            </>
          ) : null}
        </div>
      </div>
    </PaneBody>
  );
}

/* ------------------------------------------------------------------ */
/* Checklist                                                           */
/* ------------------------------------------------------------------ */

const STATUS: { v: Status; label: string; color: string }[] = [
  { v: "yes", label: "Done", color: "var(--risk-low)" },
  { v: "partial", label: "Partly", color: "var(--warn)" },
  { v: "no", label: "Missing", color: "var(--bad)" },
  { v: "na", label: "N/A", color: "var(--muted-fg)" },
];

function ChecklistTool({ plan, update, title }: { plan: Plan; update: (patch: Partial<Plan>) => void; title: string }) {
  const pin = usePinToReport();
  const checklist = findChecklist(plan.checklist.key) ?? CHECKLISTS[0];
  const total = checklistItemCount(checklist);
  const ids = checklist.sections.flatMap((section) => section.items.map((item) => item.id));
  const done = ids.filter((id) => plan.checklist.status[id] === "yes" || plan.checklist.status[id] === "na").length;
  const setStatus = (id: string, status: Status) => {
    // Clicking the active status again clears it.
    const next = { ...plan.checklist.status };
    if (next[id] === status) delete next[id];
    else next[id] = status;
    update({ checklist: { ...plan.checklist, status: next } });
  };
  return (
    <PaneBody>
      <div className="mx-auto w-full max-w-[980px] px-4 py-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Guideline" htmlFor="checklist-key" className="w-[260px]">
            <select
              id="checklist-key"
              className={`${selectSmCls} h-8 text-ui`}
              value={checklist.key}
              onChange={(event) => update({ checklist: { key: event.target.value, status: {}, where: {} } })}
            >
              {CHECKLISTS.map((entry) => (
                <option key={entry.key} value={entry.key}>
                  {entry.name} — {entry.scope}
                </option>
              ))}
            </select>
          </Field>
          <div className="min-w-[220px] flex-1">
            <div className="flex justify-between text-label text-muted-fg">
              <span>{done} of {total} items addressed</span>
              <span className="ui-mono">{Math.round((done / total) * 100)}%</span>
            </div>
            <div className="mt-1">
              <Meter pct={(done / total) * 100} />
            </div>
          </div>
          <PinButton
            busy={pin.isPending}
            onClick={() =>
              pin.mutate({
                title: `${checklist.name} checklist · ${title}`,
                datasetId: null,
                payload: {
                  module: "design",
                  summary: `${checklist.name}: ${done} of ${total} items addressed.`,
                  table: {
                    columns: ["Item", "Description", "Status", "Where"],
                    rows: checklist.sections.flatMap((section) =>
                      section.items.map((item) => [item.id, item.label, STATUS.find((s) => s.v === plan.checklist.status[item.id])?.label ?? "—", plan.checklist.where[item.id] ?? ""]),
                    ),
                  },
                  chart: null,
                  provenance: { guideline: checklist.name, doi: checklist.doi },
                  notes: "",
                },
              })
            }
          />
        </div>
        <p className="m-0 mt-2 text-cap leading-relaxed text-muted-fg">
          Item labels are short paraphrases for tracking only — read the official checklist for the full wording:{" "}
          <a href={checklist.officialUrl} target="_blank" rel="noreferrer noopener" className="text-primary underline underline-offset-2">
            {checklist.officialUrl.replace(/^https?:\/\//, "")}
          </a>{" "}
          · {checklist.citation}{" "}
          <a href={`https://doi.org/${checklist.doi}`} target="_blank" rel="noreferrer noopener" className="text-primary underline underline-offset-2">
            doi:{checklist.doi}
          </a>
        </p>
        {checklist.sections.map((section) => (
          <section key={section.title} className="mt-4">
            <h3 className="m-0 mb-1.5 text-cap font-semibold uppercase tracking-[0.06em] text-muted-fg">{section.title}</h3>
            <div className="overflow-hidden rounded-md border border-border-2">
              {section.items.map((item) => {
                const status = plan.checklist.status[item.id];
                return (
                  <div key={item.id} className="flex items-center gap-2 border-b border-border-2 px-2.5 py-1.5 last:border-b-0 hover:bg-muted mobile:flex-wrap">
                    <span className="ui-mono w-[34px] flex-none text-label font-semibold text-muted-fg">{item.id}</span>
                    <span className="min-w-0 flex-1 text-body text-fg" style={{ textDecoration: status === "na" ? "line-through" : undefined, opacity: status === "na" ? 0.6 : 1 }}>
                      {item.label}
                    </span>
                    <input
                      aria-label={`Where item ${item.id} is reported`}
                      className={`${inputSmCls} w-[110px] font-sans`}
                      placeholder="p. / section"
                      value={plan.checklist.where[item.id] ?? ""}
                      onChange={(event) => update({ checklist: { ...plan.checklist, where: { ...plan.checklist.where, [item.id]: event.target.value.slice(0, 60) } } })}
                    />
                    <div className="flex flex-none gap-1" role="group" aria-label={`Status of item ${item.id}`}>
                      {STATUS.map((option) => (
                        <button
                          key={option.v}
                          type="button"
                          aria-pressed={status === option.v}
                          onClick={() => setStatus(item.id, option.v)}
                          className="h-6 cursor-pointer rounded-full border px-2 text-tag font-semibold uppercase tracking-[0.05em]"
                          style={{
                            borderColor: status === option.v ? option.color : "var(--border-2)",
                            color: status === option.v ? option.color : "var(--muted-fg)",
                            background: status === option.v ? `color-mix(in srgb, ${option.color} 14%, transparent)` : "var(--card)",
                          }}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
        <Section title="Notes" className="mt-4 rounded-md border border-border-2">
          <textarea aria-label="Study notes" className={`${textareaCls} h-[80px]`} value={plan.notes} onChange={(event) => update({ notes: event.target.value })} />
        </Section>
      </div>
    </PaneBody>
  );
}

