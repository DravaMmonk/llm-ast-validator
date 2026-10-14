# Workstation architecture

This document extends the original plan
([docs/superpowers/plans](superpowers/plans)) with the research workstation that now
surrounds the AI Formula Lab. It is the plan revision the original Section 6.3
asked for before any visible component beyond the session page could be added:
the workstation's components live under `src/workstation`, `src/blocks` and
`src/modules`, and compose the frozen console kit (`src/shared-console`) without
modifying it — `npm run verify:shared-ui` still passes unchanged.

## Layers

```text
shared/stats        dependency-free statistics, tested against R 4.5
shared/workbench    expression kernel, dataset contract, cohorts, documents,
                    calculators, analysis helpers, PICO, checklists, samples
server/             Hono API on 127.0.0.1 + SQLite (migration 0003_workbench)
src/charts          SVG chart kit on the console tokens (light/dark, export)
src/blocks          Blockly puzzle pieces, adapters, canvas hook, editor
src/workstation     shell, command palette, data hooks, shared UI helpers
src/modules/*       one folder per module
```

Everything under `shared/` is pure TypeScript with no React, Blockly or SQLite
imports, so the browser previews with exactly the code the server validates with.

## Expression kernel (`shared/workbench/expr.ts`)

- Nodes: `num`, `text`, `bool`, `col`, `call(op, args)`; 32 operators in one table
  (`OPS`) that defines arity, parameter types (`T` binds polymorphic arguments),
  text form, and evaluation.
- `parseExprJson` validates untrusted JSON structurally (limits: 400 nodes, depth
  40); `checkExpr` type-checks against a dataset schema; `compileExpr` turns a tree
  into a row closure for fast column evaluation.
- Missing data: every operator propagates `null` unless defined over it
  (`is_missing`, `coalesce`, `valid_if`, Kleene `and`/`or`); undefined arithmetic
  yields `null`, never `NaN`/`Infinity`.
- `exprText.ts` is the text twin (precedence-climbing parser, minimal-parenthesis
  printer); a property test round-trips random trees by canonical hash.
- `exprLatex.ts` renders full and partial trees for the live preview.

## Datasets and documents

- `wb_datasets` stores columns as JSON arrays plus **derived columns as formulas**;
  `buildFrame` recomputes them in order on load. A derived column that stops
  type-checking (e.g. after a kind conversion) stays visible with its error.
- Source columns are `numeric`, `categorical` or `boolean` (yes/no). Import reads
  yes/no, true/false and — only when both halves appear — y/n and t/f spellings
  as yes/no, case-insensitively; 0/1 numbers stay numeric. Values are never
  rewritten silently: a kind conversion reports how many values became missing,
  and merging case variants (`merge_case`, e.g. `male`/`MALE` → `Male`) is an
  explicit request, because case can be meaningful (genotypes `Aa`/`aa`).
- Content hashes (`hashColumns`) give every result reproducible provenance; any
  change to stored values (conversion or merge) produces a new hash.
- `wb_documents` stores cohorts, scores, study plans and report items. Payloads
  holding formulas are validated by the kernel; free-form payloads are bounded in
  size and depth. Nothing is hard-deleted.

## Public datasets (`shared/workbench/publicDatasets.ts`, `publicImport.ts`, `server/publicSource.ts`)

- The catalogue is metadata only: source URL (UCI or Rdatasets — the only hosts
  the downloader accepts), pinned SHA-256 and size, licence, citation, and a
  column contract (`from` header or `#index` → name, label, unit, role, codes).
- `POST /api/workbench/datasets/public {key}` downloads with a 30 s timeout and
  a size cap, refuses a digest mismatch (`PUBLIC_SOURCE_CHANGED`, 502), an
  unreachable source (`PUBLIC_SOURCE_UNAVAILABLE`) or a format the contract does
  not expect (`PUBLIC_CONTRACT_FAILED`), and stores the result with
  `source = 'public'` and the key in `sample_key`. A second request reuses the
  active copy; concurrent requests share one download.
- `applyPublicContract` is strict: header and column count, row count, numbers,
  and every coded value must match; codes may map a source token to missing.
- Migration 0004 rebuilds `wb_datasets` to allow the new source. The runner
  turns foreign keys off for migrations that declare
  `-- migrate: foreign-keys-off` and checks `foreign_key_check` before commit.
- `npm run verify:public-datasets` re-downloads every source and applies its
  contract (counts only in the output). Tests and the browser suite use
  synthetic stand-ins; real rows never enter Git, fixtures or artifacts.

## Cohort accounting (`shared/workbench/cohort.ts`)

Steps apply in order to the rows still present. Include steps keep rows whose
criterion is yes; exclude steps remove rows whose criterion is yes. A missing
criterion follows the step's explicit `on_missing` policy and is counted
separately, so the flow diagram can always say why a row left.

## Statistical engine (`shared/stats`)

Distributions, descriptive statistics, t / Mann–Whitney / ANOVA / Kruskal–Wallis /
χ² / Fisher, effect sizes with CIs, Pearson / Spearman, linear and logistic
regression, Kaplan–Meier, log-rank, Cox (Breslow), ROC with DeLong CI, diagnostic
2×2 metrics, and sample size / power. Each test file records the R call that
produced its expected values. Deliberate differences from R (e.g. collinear
predictors raise `SINGULAR_MATRIX` instead of being silently dropped) are
documented in the source.

## Testing

- `shared/**` and `server/**`: Vitest (node) — kernel, parser fuzzing, datasets,
  cohorts, calculators (primary-source worked examples), routes.
- `src/**`: Vitest (jsdom) — charts, puzzle adapter round trips, calculator
  mapping, UI components.
- `e2e/`: Playwright — the Formula Lab loop and the workstation workflow (sample →
  import → derived variable → cohort → statistics → calculator → Score Forge →
  report), each asserting zero console errors, plus regression tests for type
  drift and unsaved-change protection.
- `e2e/accessibility.spec.ts`: axe-core WCAG 2.1 A/AA scans of every module in
  both themes; serious or critical violations fail the run. The light theme
  overrides a few frozen token values in `src/index.css` to reach 4.5:1 text
  contrast.
