/**
 * The public dataset catalogue on the Overview: real, de-identified research
 * data that the local API downloads from the official source on request,
 * verifies against a pinned SHA-256, and stores only on this machine.
 */

import { useMemo, useState } from "react";
import { ExternalLink, Globe, ShieldCheck } from "lucide-react";

import { PUBLIC_DATASETS, PUBLIC_DOMAINS, type PublicDataset, type PublicDomain } from "../../../shared/workbench/publicDatasets";
import { Chip, capSm, pillBtn, primaryBtn, toast } from "../../shared-console/src";
import { errorMessage } from "../../workstation/api";
import { useActiveDataset, useAddPublicDataset } from "../../workstation/data";
import { Callout, CopyButton } from "../../workstation/ui";

type Filter = "All" | PublicDomain;

export function PublicCatalog() {
  const { datasets, datasetId, setDatasetId } = useActiveDataset();
  const add = useAddPublicDataset();
  const [filter, setFilter] = useState<Filter>("All");
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const dataset of PUBLIC_DATASETS) map.set(dataset.domain, (map.get(dataset.domain) ?? 0) + 1);
    return map;
  }, []);
  const visible = filter === "All" ? PUBLIC_DATASETS : PUBLIC_DATASETS.filter((dataset) => dataset.domain === filter);
  const added = (key: string) => datasets.find((dataset) => dataset.source === "public" && dataset.sample_key === key);

  const run = (entry: PublicDataset) => {
    const existing = added(entry.key);
    if (existing) {
      setDatasetId(existing.id);
      toast(`Active dataset · ${existing.name}`);
      return;
    }
    setFailure(null);
    add.mutate(entry.key, { onError: (error) => setFailure({ key: entry.key, message: errorMessage(error) }) });
  };

  return (
    <section aria-labelledby="home-public">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <Globe size={14} className="text-muted-fg" aria-hidden />
        <h3 id="home-public" className={`${capSm} m-0`}>
          Public research datasets
        </h3>
        <span className="text-cap text-muted-fg">— {PUBLIC_DATASETS.length} real, de-identified datasets from published studies</span>
      </div>
      <p className="m-0 mb-2 flex items-start gap-1.5 text-cap leading-relaxed text-muted-fg">
        <ShieldCheck size={13} className="mt-px flex-none" aria-hidden />
        <span>
          Adding one downloads it from the official source (UCI Machine Learning Repository or an R package via Rdatasets), checks it against a pinned SHA-256
          and a column contract, and stores it only in this machine’s local database. Please cite the source when you publish.
        </span>
      </p>
      <div className="mb-2.5 flex flex-wrap gap-1.5" role="group" aria-label="Filter by field">
        {(["All", ...PUBLIC_DOMAINS] as Filter[]).map((domain) => (
          <button
            key={domain}
            type="button"
            aria-pressed={filter === domain}
            onClick={() => setFilter(domain)}
            className={`h-6 rounded-full border px-2.5 text-label font-medium ${
              filter === domain ? "border-primary bg-primary-soft text-primary" : "border-border bg-card text-muted-fg hover:text-fg"
            }`}
          >
            {domain} <span className="ui-mono text-fine">{domain === "All" ? PUBLIC_DATASETS.length : counts.get(domain)}</span>
          </button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-3 mobile:grid-cols-1">
        {visible.map((entry) => {
          const existing = added(entry.key);
          const busy = add.isPending && add.variables === entry.key;
          return (
            <article key={entry.key} className="flex flex-col rounded-[10px] border border-border bg-card p-3" aria-labelledby={`public-${entry.key}`}>
              <div id={`public-${entry.key}`} className="text-ui font-semibold text-fg-strong">
                {entry.name}
              </div>
              <div className="ui-mono mt-0.5 text-fine text-muted-fg">
                {entry.rows.toLocaleString("en-US")} rows · {entry.columns.length} columns · {entry.domain}
              </div>
              <div className="mt-1 text-cap font-medium text-fg">{entry.design}</div>
              <p className="mb-2 mt-1 line-clamp-3 text-body leading-relaxed text-muted-fg" title={entry.description}>
                {entry.summary}
              </p>
              <div className="mb-2 flex flex-wrap gap-1">
                {entry.topics.map((topic) => (
                  <Chip key={topic} label={topic} color="var(--info)" />
                ))}
              </div>
              <div className="mb-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-cap text-muted-fg">
                <a href={entry.license.url} target="_blank" rel="noreferrer noopener" className="text-muted-fg underline" title={entry.license.name}>
                  {entry.license.spdx}
                </a>
                <span aria-hidden>·</span>
                <a href={entry.source.page} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-0.5 text-muted-fg underline">
                  Source <ExternalLink size={10} aria-hidden />
                </a>
                <span aria-hidden>·</span>
                <details className="group">
                  <summary className="cursor-pointer underline">Cite</summary>
                  <div className="mt-1 rounded-md border border-border-2 bg-card-2 p-2 text-cap leading-relaxed text-fg">
                    {entry.citation}
                    {entry.reference && <div className="mt-1 text-muted-fg">Study: {entry.reference}</div>}
                    <div className="mt-1">
                      <CopyButton text={entry.citation} label="Copy citation" />
                    </div>
                  </div>
                </details>
              </div>
              {failure?.key === entry.key && (
                <Callout tone="bad" className="mb-2">
                  {failure.message}
                </Callout>
              )}
              <button
                type="button"
                className={`${existing ? pillBtn : primaryBtn} mt-auto self-start`}
                disabled={add.isPending}
                onClick={() => run(entry)}
                aria-label={existing ? `Use ${entry.name}` : `Download and add ${entry.name}`}
              >
                {existing
                  ? existing.id === datasetId
                    ? "Active"
                    : "Use this dataset"
                  : busy
                    ? "Downloading and verifying…"
                    : failure?.key === entry.key
                      ? "Try again"
                      : "Download and add"}
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
