/**
 * ⌘K command palette — keyboard-first navigation across modules, datasets,
 * saved work, and a few global actions. Arrow keys move, Enter runs, Escape
 * closes (through the kit's shared overlay stack).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Calculator as CalculatorIcon, Compass, CornerDownLeft, Database, FileText, Globe, Keyboard, ListFilter, Moon, Puzzle, Sigma, Sun } from "lucide-react";

import { CALCULATORS } from "../../shared/workbench/calculators";
import { PUBLIC_DATASETS } from "../../shared/workbench/publicDatasets";
import type { LucideIcon } from "lucide-react";

import { Kbd, Modal, inputCls, toast } from "../shared-console/src";
import { errorMessage, wbApi } from "./api";
import { queryKeys, useActiveDataset, useDocuments } from "./data";
import { MODULES } from "./modules";
import { useGuard } from "./guard";
import { useTheme } from "./preferences";

interface Command {
  id: string;
  label: string;
  hint: string;
  section: string;
  icon: LucideIcon;
  keywords: string;
  run: () => void;
}

/** Subsequence match with a bonus for word starts and contiguous runs. */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.trim().toLowerCase();
  if (q === "") return 0;
  const t = text.toLowerCase();
  let score = 0;
  let ti = 0;
  let run = 0;
  for (const char of q) {
    if (char === " ") continue;
    const found = t.indexOf(char, ti);
    if (found === -1) return null;
    const wordStart = found === 0 || /[\s\-_/·(]/.test(t[found - 1]);
    run = found === ti ? run + 1 : 0;
    score += 1 + (wordStart ? 3 : 0) + run * 2 - Math.min(found - ti, 6) * 0.2;
    ti = found + 1;
  }
  return score;
}

export function CommandPalette({ onClose, onShowShortcuts }: { onClose: () => void; onShowShortcuts?: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [theme, setTheme] = useTheme();
  const guard = useGuard();
  const { datasets, datasetId, setDatasetId } = useActiveDataset();
  const cohorts = useDocuments<unknown>("cohort", datasetId, Boolean(datasetId));
  const scores = useDocuments<unknown>("score", datasetId, Boolean(datasetId));
  const plans = useDocuments<unknown>("study");
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const commands = useMemo<Command[]>(() => {
    const go = (path: string) => () => {
      navigate(path);
      onClose();
    };
    const list: Command[] = MODULES.map((entry) => ({
      id: `module:${entry.id}`,
      label: entry.label,
      hint: entry.summary,
      section: "Modules",
      icon: entry.icon,
      keywords: entry.keywords,
      run: go(entry.path),
    }));
    const deep: [string, string, string, string][] = [
      ["/stats/finder", "Test finder", "Statistics", "which test choose method wizard"],
      ["/stats/table1", "Table 1", "Statistics", "baseline characteristics descriptive"],
      ["/stats/compare", "Compare groups", "Statistics", "t-test mann whitney anova kruskal chi-square fisher odds ratio"],
      ["/stats/paired", "Paired change", "Statistics", "paired t-test before after"],
      ["/stats/correlation", "Correlation matrix", "Statistics", "pearson spearman heatmap scatter"],
      ["/stats/regression?model=linear", "Linear regression", "Statistics", "ols multiple regression"],
      ["/stats/regression?model=logistic", "Logistic regression", "Statistics", "odds ratio glm binary"],
      ["/stats/regression?model=cox", "Cox regression", "Statistics", "hazard ratio proportional hazards"],
      ["/stats/survival", "Kaplan–Meier survival", "Statistics", "kaplan meier log-rank survival curve"],
      ["/diagnostic/two-by-two", "2×2 diagnostic accuracy", "Diagnostic Lab", "sensitivity specificity ppv npv likelihood ratio"],
      ["/diagnostic/roc", "ROC explorer", "Diagnostic Lab", "roc auc delong threshold"],
      ["/diagnostic/fagan", "Fagan nomogram", "Diagnostic Lab", "bayes pre-test post-test"],
      ["/diagnostic/frequencies", "Natural frequencies", "Diagnostic Lab", "icon array pictograph risk communication"],
      ["/design/pico", "PICO & PubMed search", "Study Design", "pubmed query mesh question"],
      ["/design/sample-size", "Sample size & power", "Study Design", "power calculation n"],
      ["/design/checklist", "Reporting checklist", "Study Design", "consort strobe stard tripod prisma spirit"],
    ];
    for (const [path, label, hint, keywords] of deep) {
      list.push({ id: `deep:${path}`, label, hint, section: "Analyses & tools", icon: Sigma, keywords, run: go(path) });
    }
    for (const calc of CALCULATORS) {
      list.push({
        id: `calc:${calc.key}`,
        label: calc.name,
        hint: `Calculator · ${calc.category}`,
        section: "Calculators",
        icon: CalculatorIcon,
        keywords: `${calc.short} ${calc.summary}`,
        run: go(`/calculators/${calc.key}`),
      });
    }
    for (const doc of plans.data?.documents ?? []) {
      list.push({
        id: `plan:${doc.id}`,
        label: `Open study plan: ${doc.title}`,
        hint: "Study Design",
        section: "Saved work",
        icon: Compass,
        keywords: "plan protocol",
        run: go(`/design/pico?plan=${doc.id}`),
      });
    }
    for (const dataset of datasets) {
      list.push({
        id: `dataset:${dataset.id}`,
        label: `Use dataset: ${dataset.name}`,
        hint: `${dataset.row_count.toLocaleString("en-US")} rows${dataset.id === datasetId ? " · active" : ""}`,
        section: "Datasets",
        icon: Database,
        keywords: "switch active dataset",
        run: () => {
          setDatasetId(dataset.id);
          onClose();
        },
      });
    }
    for (const entry of PUBLIC_DATASETS) {
      if (datasets.some((dataset) => dataset.source === "public" && dataset.sample_key === entry.key)) continue;
      list.push({
        id: `public:${entry.key}`,
        label: `Add public dataset: ${entry.name}`,
        hint: `${entry.domain} · ${entry.rows.toLocaleString("en-US")} rows · ${entry.license.spdx}`,
        section: "Public datasets",
        icon: Globe,
        keywords: `${entry.domain} ${entry.design} ${entry.topics.join(" ")} ${entry.summary} download import`,
        // `execute` closes the palette and runs this through the unsaved-changes guard.
        run: () => {
          toast(`Downloading · ${entry.name}…`);
          void wbApi.createPublicDataset(entry.key).then(
            async ({ dataset }) => {
              await queryClient.invalidateQueries({ queryKey: queryKeys.datasets() });
              setDatasetId(dataset.id);
              toast(`Added · ${dataset.name} · ${dataset.row_count.toLocaleString("en-US")} rows, verified`);
            },
            (error) => toast(`Could not add ${entry.name}: ${errorMessage(error)}`),
          );
        },
      });
    }
    for (const doc of cohorts.data?.documents ?? []) {
      list.push({
        id: `cohort:${doc.id}`,
        label: `Open cohort: ${doc.title}`,
        hint: "Cohort Builder",
        section: "Saved work",
        icon: ListFilter,
        keywords: "cohort criteria",
        run: go(`/cohorts/${doc.id}`),
      });
    }
    for (const doc of scores.data?.documents ?? []) {
      list.push({
        id: `score:${doc.id}`,
        label: `Open score: ${doc.title}`,
        hint: "Score Forge",
        section: "Saved work",
        icon: Puzzle,
        keywords: "score formula",
        run: go(`/forge/${doc.id}`),
      });
    }
    list.push(
      {
        id: "action:theme",
        label: theme === "dark" ? "Switch to light theme" : "Switch to dark theme",
        hint: "Appearance",
        section: "Actions",
        icon: theme === "dark" ? Sun : Moon,
        keywords: "theme dark light mode appearance",
        run: () => {
          setTheme(theme === "dark" ? "light" : "dark");
          onClose();
        },
      },
      {
        id: "action:sample",
        label: "Load the synthetic cardiometabolic cohort",
        hint: "Adds a demo dataset (synthetic)",
        section: "Actions",
        icon: Database,
        keywords: "sample demo example data",
        run: () => {
          void wbApi.createSample("cardiometabolic").then(async ({ dataset }) => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.datasets() });
            setDatasetId(dataset.id);
          });
          onClose();
        },
      },
      {
        id: "action:shortcuts",
        label: "Keyboard shortcuts",
        hint: "Press ? anywhere",
        section: "Actions",
        icon: Keyboard,
        keywords: "keys hotkeys help",
        run: () => {
          onClose();
          onShowShortcuts?.();
        },
      },
      {
        id: "action:report",
        label: "Export the evidence report",
        hint: "Evidence Report",
        section: "Actions",
        icon: FileText,
        keywords: "export markdown html report",
        run: go("/report"),
      },
    );
    return list;
  }, [datasets, datasetId, cohorts.data, scores.data, plans.data, theme, navigate, onClose, onShowShortcuts, setDatasetId, setTheme, queryClient]);

  const results = useMemo(() => {
    if (query.trim() === "") return commands.filter((command) => command.section !== "Calculators" && command.section !== "Analyses & tools");
    return commands
      .map((command) => ({
        command,
        score: Math.max(fuzzyScore(query, command.label) ?? -1, (fuzzyScore(query, command.keywords) ?? -1) * 0.6),
      }))
      .filter((entry) => entry.score >= 0)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.command);
  }, [commands, query]);

  useEffect(() => setCursor(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  // Everything except the theme toggle may leave the current editor.
  const execute = (command: Command) => {
    if (command.id === "action:theme" || command.id === "action:shortcuts") command.run();
    else {
      onClose();
      guard(command.run);
    }
  };

  let lastSection = "";
  return (
    <Modal title="Command palette" onClose={onClose} w={560}>
      <input
        autoFocus
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setCursor((value) => Math.min(value + 1, results.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setCursor((value) => Math.max(value - 1, 0));
          } else if (event.key === "Enter") {
            event.preventDefault();
            const command = results[cursor];
            if (command) execute(command);
          }
        }}
        placeholder="Type a module, dataset, cohort, or action…"
        aria-label="Command"
        aria-controls="command-results"
        aria-activedescendant={results[cursor] ? `command-${cursor}` : undefined}
        className={`${inputCls} mt-3 h-9 w-full text-md`}
      />
      <div id="command-results" role="listbox" ref={listRef} className="ui-scroll mt-2 max-h-[52vh] overflow-y-auto">
        {results.length === 0 && <div className="px-2 py-6 text-center text-ui text-muted-fg">No matches.</div>}
        {results.map((command, index) => {
          const Icon = command.icon;
          const header = command.section !== lastSection ? command.section : null;
          lastSection = command.section;
          return (
            <div key={command.id}>
              {header && <div className="px-2 pb-1 pt-2.5 text-cap font-semibold uppercase tracking-[0.06em] text-muted-fg">{header}</div>}
              <button
                type="button"
                id={`command-${index}`}
                role="option"
                aria-selected={index === cursor}
                data-index={index}
                onMouseMove={() => setCursor(index)}
                onClick={() => execute(command)}
                className="flex w-full cursor-pointer items-center gap-2.5 rounded-md border-0 px-2 py-1.5 text-left"
                style={{ background: index === cursor ? "var(--muted)" : "transparent" }}
              >
                <Icon size={15} className="flex-none text-muted-fg" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-ui font-medium text-fg">{command.label}</span>
                  <span className="block truncate text-cap text-muted-fg">{command.hint}</span>
                </span>
                {index === cursor && <CornerDownLeft size={13} className="flex-none text-muted-fg" aria-hidden />}
              </button>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex gap-3 border-t border-border-2 pt-2 text-cap text-muted-fg">
        <span>
          <Kbd>↑</Kbd> <Kbd>↓</Kbd> move
        </span>
        <span>
          <Kbd>↵</Kbd> open
        </span>
        <span>
          <Kbd>esc</Kbd> close
        </span>
      </div>
    </Modal>
  );
}
