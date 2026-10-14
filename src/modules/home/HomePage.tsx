/**
 * Overview — the launchpad. It answers three questions for a returning or
 * first-time researcher: what data am I working with, what should I do next,
 * and where is everything.
 */

import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CheckCircle2, Circle, Database, FlaskConical } from "lucide-react";

import type { CohortPayload, ReportItemPayload, ScorePayload } from "../../../shared/workbench/documents";
import { Chip, Meter, Page, Pane, PaneBody, capSm, pillBtn, primaryBtn, toast } from "../../shared-console/src";
import { errorMessage, wbApi } from "../../workstation/api";
import { queryKeys, useActiveDataset, useDocuments } from "../../workstation/data";
import { MODULES } from "../../workstation/modules";
import { LogoMark } from "../../workstation/Shell";
import { Callout } from "../../workstation/ui";
import { PublicCatalog } from "./PublicCatalog";

export function HomePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { summary, datasets, datasetId, setDatasetId, isLoading, isError, error } = useActiveDataset();
  const samples = useQuery({ queryKey: queryKeys.samples, queryFn: wbApi.listSamples, staleTime: Infinity });
  const cohorts = useDocuments<CohortPayload>("cohort", datasetId, Boolean(datasetId));
  const scores = useDocuments<ScorePayload>("score", datasetId, Boolean(datasetId));
  const report = useDocuments<ReportItemPayload>("report_item");

  const loadSample = useMutation({
    mutationFn: (key: string) => wbApi.createSample(key),
    onSuccess: async ({ dataset }) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.datasets() });
      setDatasetId(dataset.id);
      toast(`Loaded · ${dataset.name}`);
    },
    onError: (failure) => toast(`Could not load the sample: ${errorMessage(failure)}`),
  });

  const steps = [
    { done: datasets.length > 0, label: "Load a dataset", hint: "A synthetic sample, a public dataset, or your own CSV.", to: "/data" },
    { done: (cohorts.data?.documents.length ?? 0) > 0, label: "Snap together a cohort", hint: "Inclusion and exclusion criteria as puzzle pieces.", to: "/cohorts" },
    { done: (scores.data?.documents.length ?? 0) > 0, label: "Forge a score", hint: "Build a formula from blocks and check its AUC.", to: "/forge" },
    { done: (report.data?.documents.length ?? 0) > 0, label: "Pin a result", hint: "Run an analysis and pin it to the report.", to: "/stats" },
  ];
  const doneCount = steps.filter((step) => step.done).length;
  const loadedKeys = new Set(datasets.filter((dataset) => dataset.source === "sample").map((dataset) => dataset.sample_key));

  return (
    <Page>
      <Pane>
        <PaneBody>
          <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-4 px-5 py-5 mobile:px-3">
            <header className="flex items-center gap-3">
              <LogoMark size={36} />
              <div className="min-w-0">
                <h2 className="m-0 text-[19px] font-semibold tracking-[-0.01em] text-fg-strong">MedLab research workstation</h2>
                <p className="m-0 mt-0.5 text-ui text-muted-fg">
                  Build cohorts and scores from puzzle pieces, run the statistics, and keep every result with its provenance.
                </p>
              </div>
            </header>

            {isError && (
              <Callout tone="bad">
                The local API is not responding — {errorMessage(error)} Start it with <code className="ui-mono">make up</code>.
              </Callout>
            )}

            <div className="grid grid-cols-[1.2fr_1fr] gap-3 mobile:grid-cols-1">
              <section className="rounded-[10px] border border-border bg-card p-3.5" aria-labelledby="home-dataset">
                <div className="flex items-center gap-2">
                  <Database size={15} className="text-muted-fg" aria-hidden />
                  <h3 id="home-dataset" className={`${capSm} m-0`}>
                    Active dataset
                  </h3>
                </div>
                {isLoading ? (
                  <p className="text-ui text-muted-fg">Loading…</p>
                ) : summary ? (
                  <div className="mt-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-md font-semibold text-fg-strong">{summary.name}</span>
                      {summary.source === "sample" && <Chip label="synthetic" color="var(--warn)" />}
                      {summary.source === "public" && <Chip label="public data" color="var(--info)" />}
                    </div>
                    <div className="ui-mono mt-1 text-label text-muted-fg">
                      {summary.row_count.toLocaleString("en-US")} rows · {summary.column_count} columns
                      {summary.derived_count > 0 ? ` + ${summary.derived_count} derived` : ""} · hash {summary.content_hash.slice(0, 10)}
                    </div>
                    {summary.description && (
                      <p className="mb-0 mt-2 line-clamp-3 text-body leading-relaxed text-muted-fg">{summary.description}</p>
                    )}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button type="button" className={primaryBtn} onClick={() => navigate("/data")}>
                        Open in Data Studio
                      </button>
                      <button type="button" className={pillBtn} onClick={() => navigate("/stats")}>
                        Analyse
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2">
                    <p className="m-0 text-ui text-muted-fg">No dataset yet. Load a synthetic sample below, or import your own CSV.</p>
                    <button type="button" className={`${primaryBtn} mt-3`} onClick={() => navigate("/data")}>
                      Import a CSV
                    </button>
                  </div>
                )}
              </section>

              <section className="rounded-[10px] border border-border bg-card p-3.5" aria-labelledby="home-start">
                <div className="flex items-center gap-2">
                  <h3 id="home-start" className={`${capSm} m-0 flex-1`}>
                    First steps
                  </h3>
                  <span className="ui-mono text-label text-muted-fg">
                    {doneCount}/{steps.length}
                  </span>
                </div>
                <div className="mt-2">
                  <Meter pct={(doneCount / steps.length) * 100} />
                </div>
                <ol className="m-0 mt-2 list-none p-0">
                  {steps.map((step) => (
                    <li key={step.label}>
                      <Link
                        to={step.to}
                        className="flex items-start gap-2 rounded-md px-1.5 py-1.5 no-underline hover:bg-muted"
                      >
                        {step.done ? (
                          <CheckCircle2 size={15} className="mt-px flex-none" style={{ color: "var(--risk-low)" }} aria-label="done" />
                        ) : (
                          <Circle size={15} className="mt-px flex-none text-muted-fg" aria-label="to do" />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className={`block text-ui font-medium ${step.done ? "text-muted-fg line-through" : "text-fg"}`}>{step.label}</span>
                          <span className="block text-cap text-muted-fg">{step.hint}</span>
                        </span>
                        <ArrowRight size={13} className="mt-1 flex-none text-muted-fg" aria-hidden />
                      </Link>
                    </li>
                  ))}
                </ol>
              </section>
            </div>

            <section aria-labelledby="home-samples">
              <div className="mb-2 flex items-center gap-2">
                <FlaskConical size={14} className="text-muted-fg" aria-hidden />
                <h3 id="home-samples" className={`${capSm} m-0`}>
                  Synthetic sample datasets
                </h3>
                <span className="text-cap text-muted-fg">— generated, reproducible, never real patients</span>
              </div>
              <div className="grid grid-cols-3 gap-3 mobile:grid-cols-1">
                {(samples.data?.samples ?? []).map((sample) => {
                  const loaded = loadedKeys.has(sample.key);
                  return (
                    <article key={sample.key} className="flex flex-col rounded-[10px] border border-border bg-card p-3">
                      <div className="text-ui font-semibold text-fg-strong">{sample.name}</div>
                      <div className="ui-mono mt-0.5 text-fine text-muted-fg">{sample.rows.toLocaleString("en-US")} rows</div>
                      <p className="mb-2 mt-1.5 line-clamp-3 text-body leading-relaxed text-muted-fg">{sample.description}</p>
                      <div className="mb-3 flex flex-wrap gap-1">
                        {sample.highlights.map((highlight) => (
                          <Chip key={highlight} label={highlight} color="var(--info)" />
                        ))}
                      </div>
                      <button
                        type="button"
                        className={`${loaded ? pillBtn : primaryBtn} mt-auto self-start`}
                        disabled={loadSample.isPending}
                        onClick={() => {
                          const existing = datasets.find((dataset) => dataset.source === "sample" && dataset.sample_key === sample.key);
                          if (existing) {
                            setDatasetId(existing.id);
                            toast(`Active dataset · ${existing.name}`);
                          } else loadSample.mutate(sample.key);
                        }}
                      >
                        {loaded ? (datasets.find((d) => d.source === "sample" && d.sample_key === sample.key)?.id === datasetId ? "Active" : "Use this dataset") : loadSample.isPending && loadSample.variables === sample.key ? "Loading…" : "Load sample"}
                      </button>
                    </article>
                  );
                })}
              </div>
            </section>

            <PublicCatalog />

            <section aria-labelledby="home-modules">
              <h3 id="home-modules" className={`${capSm} m-0 mb-2`}>
                Modules
              </h3>
              <div className="grid grid-cols-3 gap-3 mobile:grid-cols-1">
                {MODULES.filter((entry) => entry.id !== "home").map((entry) => {
                  const Icon = entry.icon;
                  return (
                    <Link
                      key={entry.id}
                      to={entry.path}
                      className="group flex gap-3 rounded-[10px] border border-border bg-card p-3 no-underline hover:border-primary"
                    >
                      <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-primary-soft text-primary">
                        <Icon size={16} aria-hidden />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-ui font-semibold text-fg-strong">{entry.label}</span>
                        <span className="mt-0.5 block text-body leading-snug text-muted-fg">{entry.summary}</span>
                      </span>
                    </Link>
                  );
                })}
              </div>
            </section>

            <p className="m-0 pb-2 text-cap leading-relaxed text-muted-fg">
              For research and education. Results are exploratory and do not replace clinical judgement or a statistician's review.
              Data stays on this machine: the workstation talks only to its local API.
            </p>
          </div>
        </PaneBody>
      </Pane>
    </Page>
  );
}
