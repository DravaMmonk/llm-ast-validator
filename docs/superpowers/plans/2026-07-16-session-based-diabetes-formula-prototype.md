# Session-Based Diabetes Formula Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` (recommended) or
> `superpowers:executing-plans` to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local, auditable loop from a natural-language requirement to
versioned candidate formula ASTs, human Blockly review, and comparison with an
observed incident-diabetes cohort.

**Architecture:** Keep the existing React prototype and deterministic AST kernel,
add one lightweight TypeScript API with SQLite persistence, and adapt the approved
shared operation-panel components without forking their visual contract. Generation,
validation, versioning, evaluation, and decisions are durable server-side records.

**Tech Stack:** React 18, Vite, TypeScript, Vitest, Hono, `better-sqlite3`, Blockly,
ExcelJS for the one-off workbook importer, and Playwright for the final browser
smoke path.

---

- **Status:** implemented; shared-UI redistribution gate passed
- **Scope:** prototype only
- **Authority:** this document defines the next implementation sequence
- **Code changes in this planning pass:** none

## 1. Objective

Build one small but real research loop:

```text
session
  -> natural-language requirement
  -> multiple candidate formula ASTs
  -> deterministic validation
  -> human review and Blockly editing
  -> immutable candidate version
  -> evaluation against a local longitudinal diabetes cohort
  -> aggregate comparison and row-level disagreement review
  -> explicit accept or reject decision
```

The result remains a local prototype. It is not a clinical prediction product,
not a general experiment platform, and not a multi-user service.

## 2. Locked Product Boundary

### In scope

1. A Codex-like session page with a persistent session list.
2. Natural-language generation of several candidate formula ASTs.
3. Deterministic schema, vocabulary, type, and execution validation.
4. Human selection, review, Blockly modification, and version save.
5. Evaluation of each exact candidate version against a local database whose
   rows contain observed incident-diabetes outcomes during follow-up.
6. Candidate-level metrics and row-level disagreement inspection.
7. Persistence across browser and application restarts.

### Explicitly out of scope

- user accounts, organizations, permissions, or multi-tenancy;
- PostgreSQL, Redis, Celery, distributed workers, WebSockets, or microservices;
- cloud deployment, remote dataset storage, or automatic synchronization;
- a general-purpose chat agent or tool-calling runtime;
- arbitrary SQL authored by a model;
- model training, formula-coefficient fitting, or automatic formula promotion;
- time-to-event or survival modeling in the first prototype;
- clinical diagnosis, treatment advice, or claims of external validity;
- a new design system, mobile redesign, or dashboard-card layout;
- lifecycle governance beyond local candidate versions and review decisions.

## 3. Product Decisions

### 3.1 Session is the working aggregate

A session owns:

- its title and current natural-language requirement;
- all session turns and candidate lineages;
- the currently selected candidate version;
- human review decisions;
- evaluation runs and visible result state.

A session may contain more than one generation turn. A new prompt does not erase
earlier candidates. The page shows the latest turn by default and retains earlier
turns in the session history.

### 3.2 Candidate and version are separate identities

A candidate is one model proposal lineage. A candidate version is one immutable
AST snapshot within that lineage.

- Generated output creates version 1.
- Deterministic repair creates a child version with source `repair`.
- A Blockly save creates a child version with source `blockly`.
- Generated and repair versions retain their exact raw JSON content even when
  admission fails; only an admitted canonical AST is loadable or evaluable.
- Editing never overwrites the generated or previously reviewed AST.
- Evaluation and review decisions always reference one exact candidate version.

### 3.3 Evaluation informs, but does not make, the decision

Any structurally valid candidate version may be evaluated. Acceptance requires
one completed evaluation of that exact version against the current dataset
version; rejection may happen earlier. Evaluation never automatically accepts a
formula.

If an accepted version is edited, the new child version returns to `pending`.
The old decision and old evaluation remain attached to the old version.

If a dataset version is superseded, its decisions remain historical but display
`stale_dataset`. The same formula must be re-evaluated against the new current
dataset and receive a new decision before it is current again.

### 3.4 Formula output is a score, not automatically a probability

Candidate formulas emit one finite numeric score per cohort row. Unless a
formula contract explicitly defines a calibrated probability, the UI must not
label the value as a probability and must not display `score - outcome` as a
meaningful error.

Comparison with the observed outcome uses:

- threshold-free ranking metrics;
- a threshold and direction selected only on the calibration split;
- classification outcomes on an interactive review split;
- row labels `true positive`, `true negative`, `false positive`, and
  `false negative`.

## 4. Current Baseline and Required Cutover

The current application is a browser-only Vite/React demo:

- session, run, selection, and decision state are transient React state;
- generation and deterministic evaluation execute in the browser;
- only one in-memory synthetic evidence context exists;
- no HTTP API, database, cohort table, Blockly editor, or persistent version
  chain exists in the public prototype.

The cutover must move business state and cohort execution behind a local API.
The deterministic AST kernel remains shared and authoritative; the browser must
not become the persistence or cohort-query authority.

### 4.1 Non-LLM gaps this plan closes

| Gap | Prototype completion condition |
| --- | --- |
| Session continuity | Sessions, turns, selection, versions, decisions, and results survive restart. |
| Candidate audit | Every generated and repaired payload has immutable lineage and diagnostics. |
| Human modification | One shared Blockly workspace round-trips admitted AST 1.0 formulas and saves child versions. |
| Dataset readiness | A checksum/schema-gated public cohort is reproducibly imported with provenance and fixed splits. |
| Evaluation truth | The server evaluates exact AST/dataset versions with a hidden outcome label and deterministic threshold policy. |
| Difference review | Aggregate metrics and row-level TP/TN/FP/FN evidence are queryable for each candidate version. |
| Human decision | Acceptance binds the exact version and completed evaluation; rejection remains explicit and durable. |
| Operability | One startup path, migrations, interrupted-run recovery, bounded errors, and public-hygiene checks work. |

The deterministic demonstration provider is sufficient to build and verify all
of these gaps. A real LLM adapter is deliberately the final replaceable edge, not
a prerequisite for completing the business loop.

## 5. Lightweight Runtime Architecture

Use one application backend process and one SQLite file. Vite remains a separate
development-only process; the built demo is served by the backend.

```text
Vite React UI
    |
    | JSON over /api
    v
single local API process
    |- session and candidate services
    |- generator adapter boundary
    |- deterministic AST admission
    |- in-process evaluation runner
    `- SQLite: var/research.db
```

### Runtime choices

- **API:** Hono with TypeScript.
- **Database:** `better-sqlite3` with hand-written, numbered SQL migrations.
- **Validation:** shared TypeScript contracts plus the deterministic AST kernel.
- **Development:** Vite proxies `/api` to the local API process.
- **Production demo:** the same API process serves the built frontend.
- **Background work:** one FIFO in-process runner with generation concurrency 1
  and evaluation concurrency 1; no external queue.
- **Startup:** one `make up` command starts API and frontend development servers.
- **Network boundary:** bind the API to `127.0.0.1` by default, accept only the
  local frontend origin, and cap JSON request bodies at 100 KiB.

The backend may be reorganized freely around these boundaries. No ORM or
repository abstraction is required for the prototype. SQL belongs in a small
data-access layer; route handlers must not scatter SQL across the server.
The store files are concrete functions over one injected SQLite connection, not
generic repositories, a dependency-injection container, or a plugin framework.

The evaluator walks an already admitted AST through the closed operator registry
and iterates cohort rows from SQLite. It must never compile model content with
`eval`, `Function`, a shell, SQL fragments, or other dynamic-code facilities.

### In-process work behavior

Generation and evaluation use persisted run states:

```text
pending -> running -> completed
                   `-> failed
```

The API inserts the run before starting work. Evaluation rows are written in a
transaction and become visible only when the run is complete. On startup, stale
`pending` or `running` rows are marked `failed` with `APP_RESTARTED`; the user may
retry.

This gives visible failure and retry behavior without introducing a queue.

## 6. Shared Frontend Preservation Contract

The operation workspace keeps the approved shared console component source and
interaction vocabulary unchanged. New business behavior must be composed around
those components through adapters and page-level state.

### 6.1 Frozen shared surface

The implementation must reuse, without local visual forks:

- `Page`, `Pane`, `PaneHeader`, `PaneBody`, and `PaneFooter`;
- `MasterListPane`, `MasterListSearch`, `MasterListGroup`,
  `MasterListItem`, and the shared master-list width;
- `TabBar`, `SegTabs`, `StatusPill`, `Chip`, shared buttons, inputs, selects,
  textareas, overlays, loading states, and empty states;
- the existing `LibraryPanel`, `CommandPalette`, `FormulaPreview`, and `FxBar`
  component APIs, plus the established version-menu interaction pattern;
- the three-region formula workspace composition: library rail, Blockly canvas,
  and right inspector;
- the existing canvas toolbar, validation strip, drag-and-drop, undo/redo,
  tidy, quick insert, and formula-text round trip.

Do not add a second button vocabulary, panel anatomy, status-color table,
master-list implementation, modal, toast system, or responsive strategy.

### 6.2 Domain adapters are not shared visual components

Pose/video-specific registries and preview behavior must not be carried into the
diabetes prototype merely to preserve source shape. The following are domain
logic and require small diabetes-specific adapters:

- signal and operator catalog data;
- Blockly block definitions for cohort variables and numeric operators;
- AST-to-block and block-to-AST conversion;
- expression parsing and rendering for the diabetes operator vocabulary;
- formula result and cohort evidence projection.

The adapter must produce the data structures expected by the frozen shared UI.
If a mismatch can be solved in the adapter, the shared component must not be
changed.

### 6.3 Only three new visible components are authorized

1. **SessionRail** — Codex-like session creation, search, selection, rename,
   and archive.
2. **GenerationReviewPanel** — prompt submission, session-turn status,
   candidate selection, validation diagnostics, and lineage summary.
3. **CohortEvaluationPanel** — candidate metrics, error filters, and row-level
   comparison with observed outcomes.

`SessionPage` is page composition, not a new design primitive. All other needs
must first be expressed with existing shared components.

### 6.4 Layout rule

The desktop layout is:

```text
+---------------+----------------------------------------------------------+
| Session rail  | Session header                                           |
|               +----------------------------------------------------------+
|               | Generation review panel                                  |
|               +-------------+---------------------------+----------------+
|               | Library     | Blockly + formula bar     | Inspector      |
|               |             |                           | Formula/Results|
+---------------+-------------+---------------------------+----------------+
```

- The session rail is the only new permanent column.
- The generation panel is collapsible after candidates exist.
- The right inspector uses one shared `TabBar`: `Formula` renders the existing
  AST/validation presentation; `Cohort results` renders
  `CohortEvaluationPanel`. The pose/video inspector implementation is not reused.
- Candidate selection loads the selected version into the existing Blockly
  canvas; it does not open another editor.
- Desktop panes do not auto-collapse on browser zoom. The module receives a
  horizontal minimum width and the session rail may be manually collapsed.
- No new cards, hero section, global dashboard, or duplicate candidate drawer.

### 6.5 Public-source gate

Before shared source is introduced into the public repository, prove that it may
be redistributed under the repository license. Any bundle without explicit
redistribution terms, or with private brand and source metadata, is not an allowed
public artifact. The public project must not contain private repository paths,
private employer/client/customer/internal-product names, non-public API clients,
subject data, or internal comments. Required third-party attribution, dataset
citation, copyright, LICENSE, and NOTICE material must remain intact.

This project consumes a neutral extraction authorized by its sole copyright
holder for public redistribution under the repository MIT license. The
`shared-ui-provenance.json` record contains:

- the copyright-holder authorization basis and public redistribution scope;
- the MIT SPDX identifier and compatibility conclusion with this project's MIT
  license;
- LICENSE/NOTICE paths, required attribution, and each file's SHA-256;
- the frozen component file allowlist and each file's SHA-256.

CI rejects a missing public redistribution authorization, a non-passing Gate 0,
missing required LICENSE/NOTICE files, unmet attribution, and frozen-file drift.
It also scans all transitive lockfile dependencies.
If consumed as a package, pin exact lockfile integrity; if consumed as an
extraction, verify every manifest hash.

`npm run verify:shared-ui` also enforces the visible-component allowlist, rejects
new CSS selectors that enter frozen component DOM below the session/page-level
containers, and runs fixed-viewport/zoom DOM, interaction, and screenshot
regressions. During these six batches, any fourth visible component or additional
layout region requires a plan revision and explicit approval first. Business
adapters and page composition remain outside the frozen file hashes; shared
component cleanup is a separate project.

## 7. Diabetes Formula Contract

### 7.1 Input signals

The first operator catalog is intentionally small. It exposes only these
numeric, materialized baseline columns from the selected public longitudinal
dataset:

- `age`;
- `bmi`;
- `systolic_bp` and `diastolic_bp`;
- `baseline_fasting_plasma_glucose`;
- `triglycerides`;
- `hdl_cholesterol`, `ldl_cholesterol`, and `total_cholesterol`.

The outcome label and follow-up duration are not authorable signals.
`incident_diabetes` is held back by the evaluation service and cannot appear in
a candidate AST. `followup_fasting_plasma_glucose` and follow-up duration are
also evaluator-only. The AST executor receives a newly constructed allowlisted
predictor projection containing exactly the signals above, never a complete
database row.

### 7.2 Initial operator vocabulary

Support only the operations needed for interpretable numeric formulas:

| Operator | Arity | Deterministic semantics |
| --- | ---: | --- |
| numeric literal | 0 | finite value in `[-1_000_000, 1_000_000]` |
| signal reference | 0 | one Section 7.1 scalar value |
| add, subtract, multiply | 2 | ordinary finite arithmetic |
| protected divide | 2 | return `0` when `abs(denominator) < 1e-12` |
| absolute value | 1 | `abs(value)` |
| protected natural log | 1 | `log(max(value, 1e-12))` |
| minimum, maximum | 2 | numeric minimum or maximum |
| clamp | 3 | clamp value to lower/upper bounds; reject lower greater than upper |

Every operator has one registry record containing id, arity, input type, output
type, evaluator, Blockly metadata, text syntax, and display metadata. The UI,
validator, Blockly adapter, and server evaluator must consume the same registry.
The registry exports a semantic `registry_version` and a SHA-256 over its
canonical operator/signal contract; changing evaluator semantics requires a new
version.

### 7.3 Admission requirements

A candidate version is evaluable only when:

- its document matches the current AST schema version;
- every field, node type, signal, and operator is declared;
- arity and numeric types are valid;
- node count is at most 128 and depth is at most 16;
- the AST does not reference the outcome label;
- one deterministic smoke row produces a finite numeric value;
- protected operations report their fallback behavior explicitly.

### 7.4 Canonical formula and text contract

The AST is the authority. Hash admitted ASTs as SHA-256 over RFC 8785 canonical
JSON after validation; reject non-finite numbers and normalize negative zero to
zero before hashing.

The formula bar supports decimal literals, the exact Section 7.1 signal ids,
parentheses, left-associative `+`, `-`, `*`, `/`, and functions `abs`, `plog`,
`min`, `max`, and `clamp`. Parentheses/functions bind first, then multiply/divide,
then add/subtract. `/` maps only to protected divide and `plog` maps only to the
protected natural log. Parse/print/Blockly round trips compare canonical AST
hashes, not whitespace or display labels.

## 8. Local Dataset Contract

### 8.1 Source and storage

Use the de-identified Rich Healthcare longitudinal cohort from the authoritative
[Dryad dataset record](https://doi.org/10.5061/dryad.ft8750v). The record contains
211,833 adults free of diabetes at baseline, an observed incident-diabetes label,
and a median follow-up of 3.1 years. The prototype treats this as an observed
follow-up outcome, not as a fixed three-year risk endpoint.

- Raw source files remain outside Git under `data/raw/`.
- The repository does not auto-download or redistribute the workbook. The user
  downloads it from the DOI record and places it at the documented path before
  real-cohort setup; absence produces `DATASET_SOURCE_MISSING` with instructions.
- The expected source filename is `RC Health Care Data-20180820.xlsx`; the
  [Dryad file id is `78961`](https://datadryad.org/api/v2/files/78961) and its
  repository-reported MD5 is
  `b468cc3704b11ba1bd21532451fe2856`. The preparation command refuses an
  unexpected filename, digest, or workbook schema.
- The preparation command verifies both that reported MD5 and a repository-pinned
  SHA-256 captured during controlled source onboarding.
- Preprocessing is deterministic and writes the admitted rows to SQLite.
- The database records source DOI/URL, checksum, preprocessing version,
  inclusion policy, outcome definition, row count, and split seed.
- The source manifest maps raw baseline FPG to
  `baseline_fasting_plasma_glucose`, raw final-visit FPG to the evaluator-only
  `followup_fasting_plasma_glucose`, and the source diabetes column to
  `incident_diabetes`. It rejects an unknown or ambiguous FPG mapping.
- Validate the source outcome contract: the source diabetes field is binary and
  every follow-up FPG `>= 7.00 mmol/L` is positive; a positive below that cutoff
  remains valid because the published definition also includes self-report.
  Record the source totals `211,833 rows / 4,174 events`, then record complete-case
  and per-split row, event, and prevalence counts after local filtering.
- No names, emails, addresses, site-local identifiers, or free text are stored.
- The source manifest pins `CC0-1.0`, the
  [Dryad reuse guide](https://datadryad.org/help/guides/reuse), the
  [terms URL](https://datadryad.org/terms), access date `2026-07-16`, dataset/file
  version and checksums, and Dryad's recommended dataset citation. Raw and derived
  row-level files remain excluded from Git even though redistribution is permitted.

### 8.2 Fixed split

Use the deterministic inclusion policy `mvp_complete_case_v1`: retain only rows
with a binary incident-diabetes outcome, positive follow-up duration, and finite
values for every signal listed in Section 7.1. Record exclusion counts by reason.
This keeps every candidate on the same evaluation population.

Persist one label-stratified split per dataset version using the deterministic
internal split key plus seed `diabetes-prototype-v1`:

- 70% calibration, used only to select score direction and decision threshold;
- 30% interactive review, used for displayed metrics and row-level differences.

The importer refuses to publish a dataset version unless both splits contain at
least one observed-positive and one observed-negative row.

The review split never chooses the threshold. Because a human may inspect review
outcomes and then edit or regenerate a formula, its metrics are explicitly
exploratory and must not be described as held-out performance, external
validation, or a generalization estimate.
The binary outcome intentionally ignores varying censoring time; the UI and
report must state this limitation, and the prototype must not make survival-risk
or fixed-horizon claims.

### 8.3 Threshold rule

Evaluate both score directions on the calibration split. `higher` predicts
positive when `score >= threshold`; `lower` predicts positive when
`score <= threshold`. For each direction, enumerate every distinct prediction
partition, including all-positive and all-negative sentinels and tied-score
groups, then select the pair with maximum Youden's J
(`sensitivity + specificity - 1`). Break ties by lower false-positive rate, then
higher sensitivity, then ascending numeric threshold, then the `higher` direction.
Freeze that direction and threshold before computing any review metric.
This versioned calibration policy is the prototype's only fitted parameter; it
does not train or alter formula coefficients.

If any calibration or review row produces an unavailable or non-finite score,
the entire candidate evaluation fails with `NON_FINITE_SCORE`; it stores no
partial metrics or row classifications and cannot support acceptance. The first
prototype therefore needs only TP/TN/FP/FN row classes and never hides a low-
coverage formula behind a smaller denominator.

### 8.4 Row-level result

For the interactive review split, each completed evaluation stores:

- anonymized row key;
- raw formula score;
- direction-normalized score percentile within the review split;
- derived predicted label using the calibration-selected threshold;
- observed incident-diabetes outcome during follow-up;
- error class;
- the minimal admitted input fields used to explain the row.

The importer creates two separate identities:

- an internal deterministic split key: SHA-256 of the dataset file SHA-256,
  canonical normalized predictor/outcome/follow-up payload, and duplicate ordinal;
- a local random display UUID stored as the API-visible row key.

Neither identity copies or directly hashes a source subject id or workbook row
number. The internal split key never leaves the database; source ids, source row
numbers, and split keys never appear in APIs, logs, errors, screenshots, or
exports. Identical source content therefore recreates the same split population
while public-facing row keys remain unlinkable to source identifiers.

### 8.5 Candidate-level result

The minimum displayed metrics are:

- AUROC;
- average precision;
- sensitivity and specificity at the calibration-selected threshold;
- positive and negative predictive value;
- confusion-matrix counts;
- median score for observed-positive and observed-negative rows;
- calibration and review row counts, with confirmed 100% finite-output coverage.

AUROC and average precision use direction-normalized raw review scores.
Sensitivity, specificity, predictive values, and confusion counts use the frozen
calibration threshold. Show review N, observed-positive count, and prevalence next
to average precision and predictive values so their denominator is explicit.

Calibration metrics are shown only if a later formula contract declares a
probability output. They are not part of the first prototype.

### 8.6 Public artifact boundary

Real cohort row values exist only in the ignored local SQLite database and the
active local browser response. Logs, error bodies, fixtures, snapshots,
screenshots, recordings, documents, npm packages, source maps, build artifacts,
and CI artifacts must contain synthetic rows only. The release audit fails even
when raw or derived files were force-staged with `git add -f`; ignore rules are
not treated as a security control.

## 9. SQLite Data Model

Use text UUIDs, UTC ISO timestamps, foreign keys, and JSON text for bounded
payloads. Enable WAL mode, foreign-key enforcement, and a 5-second busy timeout.

### `sessions`

| Column | Purpose |
| --- | --- |
| `id` | Stable session identity |
| `title` | User-editable session title |
| `current_requirement` | Latest natural-language prompt |
| `status` | `active` or `archived` |
| `selected_candidate_version_id` | Current workspace selection |
| `created_at`, `updated_at` | Session ordering |

### `session_turns`

| Column | Purpose |
| --- | --- |
| `id`, `session_id`, `ordinal` | Turn identity, owner, and session order |
| `requirement_json` | Exact normalized request |
| `provider`, `model`, `prompt_version` | Generator provenance |
| `provider_response_json`, `response_hash` | Bounded raw envelope, including non-object content; nullable on transport failure |
| `status`, `error_json` | Durable execution outcome |
| `started_at`, `finished_at` | Timing |

### `candidates`

| Column | Purpose |
| --- | --- |
| `id`, `turn_id` | Candidate ownership; session derives through the turn |
| `proposal_id`, `ordinal` | Provider proposal identity and order |
| `created_at` | Stable ordering |

### `candidate_versions`

| Column | Purpose |
| --- | --- |
| `id`, `candidate_id` | Version identity and lineage owner |
| `parent_version_id`, `version_no` | Append-only chain |
| `source` | `generated`, `repair`, or `blockly` |
| `content_json` | Exact immutable provider or Blockly payload |
| `ast_json`, `ast_hash`, `ast_schema_version` | Canonical admitted formula; nullable when blocked |
| `registry_version`, `registry_hash`, `validator_version` | Admission semantics |
| `admission_state`, `validation_json` | `admitted` or `blocked`, plus the complete report |
| `explanation`, `assumptions_json`, `note` | Attempt/version review context outside the AST |
| `created_at` | Stable ordering |

### `review_decisions`

| Column | Purpose |
| --- | --- |
| `id`, `candidate_version_id` | Decision identity and exact target |
| `decision_no` | Append order within the candidate version |
| `decision` | `accepted` or `rejected` |
| `evaluation_run_id` | Completed evidence run; required for acceptance |
| `note`, `decided_at` | Human reason and time |

The latest decision is effective; earlier decisions remain visible. This avoids
mutating a historical decision while keeping the prototype simple.

### `dataset_versions`

Stores source provenance, checksum, preprocessing version, outcome definition,
column contract, split seed, counts, `current`/`superseded` status, and creation
time. A partial unique index permits only one current dataset version.

### `cohort_rows`

Stores `dataset_version_id`, internal split key, opaque display row key, fixed
split, admitted numeric predictor columns, evaluator-only follow-up fields, and
the observed binary outcome. Store accessors expose separate predictor and
evaluator projections so a complete row cannot reach the AST interpreter.

### `evaluation_runs`

Stores candidate-version id, dataset-version id, run state, score direction,
calibration-selected threshold, threshold-policy version, calibration summary,
exploratory review-metric JSON, registry hash, evaluator version, metric-policy
version, evaluated-row counts, error JSON, and timestamps.

### `evaluation_rows`

Stores evaluation-run id, opaque row key, formula score, percentile, predicted
label, observed label, error class, and explanation-input JSON. Calibration scores
are used to freeze the threshold and then discarded.

Unique constraints prevent duplicate version numbers and duplicate evaluation
rows. Specifically enforce `(session_id, ordinal)` for turns,
`(turn_id, proposal_id)` and `(turn_id, ordinal)` for candidates,
`(candidate_id, version_no)` for versions,
`(candidate_version_id, decision_no)` for decisions,
`(dataset_version_id, split_key)` and `(dataset_version_id, row_key)` for cohort
rows, and `(evaluation_run_id, row_key)` for evaluation rows. An evaluation run
is immutable after completion.

Service transactions verify that a candidate belongs to its turn's session, a
parent version belongs to the same candidate, a selected version belongs to the
target session, and a decision/evaluation version matches its route/session.
Migration tests cover every uniqueness and ownership violation.

## 10. Minimal HTTP API

### Runtime readiness

```text
GET    /api/health
GET    /api/dataset-versions/current
```

The dataset endpoint returns metadata and counts, never cohort rows. Evaluation
creation returns `409 DATASET_NOT_PREPARED` when no current dataset exists.
Every non-2xx response uses `{ "error": { "code", "message", "details" } }`;
production responses never expose stack traces, SQL, local paths, provider
credentials, or unrelated raw provider payloads.

### Sessions

```text
GET    /api/sessions
POST   /api/sessions
GET    /api/sessions/:sessionId
PATCH  /api/sessions/:sessionId
```

`PATCH` supports title, archive state, and selected candidate version only. Hard
delete is not required.

`GET /api/sessions/:sessionId` returns the session plus ordered turns, candidate
lineages, versions, validation summaries, decisions, and evaluation summaries.
It never embeds evaluation rows; those remain paginated under the run endpoint.
The service verifies that any selected version belongs to a candidate under the
same session.

### Generation and candidates

```text
POST   /api/sessions/:sessionId/turns
GET    /api/session-turns/:turnId
GET    /api/candidates/:candidateId
POST   /api/candidates/:candidateId/versions
POST   /api/candidate-versions/:versionId/decisions
```

The generation endpoint creates one persisted session turn and returns `202`
with its id before calling the generator. The turn endpoint returns all candidate
lineages after completion, not only the first passing proposal. While work is
pending or running, the browser polls that endpoint no faster than once per
second; no WebSocket is introduced.

The request contains a trimmed UTF-8 `requirement` of 1-4,000 characters and a
`candidate_count` from 2 to 5, defaulting to 3. The server always adds the closed
signal/operator vocabulary, AST 1.0 schema, numeric-score output, and safety
limits to the provider request; the browser cannot weaken those constraints.
The provider envelope is capped at 512 KiB. Oversized output fails with
`PROVIDER_RESPONSE_TOO_LARGE` while retaining only byte length and SHA-256, not a
truncated pseudo-candidate.

The version endpoint accepts a Blockly-produced AST, validates it on the server,
and appends a `blockly` version. The browser cannot submit a validation result as
authority.

An `accepted` decision request must include a completed `evaluation_run_id` whose
candidate version matches the route version and whose dataset version is current.
A `rejected` decision may omit evaluation evidence. Conflicts return `409` and
never append a partial decision.

### Evaluation

```text
POST   /api/sessions/:sessionId/evaluation-runs
GET    /api/evaluation-runs/:runId
GET    /api/evaluation-runs/:runId/rows
```

The creation request accepts one to five saved candidate-version ids from the
same session, returns `202` with one run id per version, and creates one
independent evaluation run per version. A failure in one formula does not roll
back the completed results of another formula.

The row endpoint supports only bounded filters and pagination:

```text
error_class=disagreement|true_positive|true_negative|false_positive|false_negative
observed_label=0|1
sort=score_asc|score_desc|percentile_asc|percentile_desc
limit<=200
cursor=<opaque>
```

It does not accept raw SQL or arbitrary column expressions.

## 11. Frontend Behavior

### 11.1 Session page

- Opening the application loads the latest active session.
- `New session` creates and selects an empty persisted session.
- The first submitted requirement supplies an initial generated title; the user
  may rename it. The server derives it deterministically from the first 60
  normalized characters; no separate model call exists.
- Selecting a session restores its latest session turn, selected candidate
  version, Blockly formula, decision, and evaluation state.
- Archiving removes a session from the default list but does not delete it.

The session rail uses the shared master-list primitives. It must not introduce a
chat transcript panel or general message model.

### 11.2 Generation review

- The prompt composer submits one requirement and requested candidate count.
- The panel shows `pending`, `running`, `completed`, or `failed`.
- Candidate rows show proposal lineage, current version, admission state, first
  blocking diagnostic, evaluation status, and review decision.
- Selecting an admitted version loads it into Blockly; selecting a blocked
  generation/repair version shows its raw content and diagnostics without loading
  the canvas.
- Generated explanations and assumptions are displayed beside the candidate,
  never embedded into the AST.
- Retry creates a new session turn; it does not rewrite the failed turn.

### 11.3 Blockly editing

- The shared library/canvas/formula-bar interaction remains unchanged.
- The diabetes adapter supplies the signal and operator catalog.
- Loading a candidate resets the Blockly dirty baseline to that exact version.
- A canvas change marks the workspace dirty but does not alter the database.
- `Save version` validates server-side and appends a `blockly` child version.
- Switching candidate/session while dirty uses the existing unsaved-change
  confirmation pattern.

### 11.4 Cohort evaluation

- `Run cohort evaluation` always targets the selected saved version.
- An unsaved Blockly draft cannot be evaluated.
- The results tab shows dataset version and candidate version prominently.
- The top section shows the minimum aggregate metrics and confusion matrix.
- The same header shows review N/prevalence, score direction, `>=` or `<=`
  comparator, calibration threshold, and exploratory-review label.
- The row table defaults to disagreements and can switch between all four error
  classes.
- Selecting a row shows only its admitted formula inputs, formula score,
  direction-normalized percentile, comparator/threshold, predicted label, and
  observed outcome.
- TP/TN/FP/FN tooltips expand to formula-positive/negative versus
  observed-positive/negative during available follow-up; `true negative` never
  implies permanent freedom from diabetes.
- The UI says `observed outcome`, not `ground-truth diagnosis`.
- Evaluation failure remains visible and retryable.
- When the dataset is superseded, prior metrics and decisions remain visible with
  `stale_dataset`; current acceptance requires a new evaluation and decision.

### 11.5 Human decision

- Accept and reject are enabled only for a saved, structurally valid version.
- Accept requires a completed evaluation of that exact candidate version against
  the current dataset version; rejection may occur before evaluation.
- A decision note is optional in the prototype but always supported.
- Acceptance records the exact candidate version and does not copy or mutate it.

## 12. Transaction and Failure Boundaries

1. **Create session:** one transaction.
2. **Persist generation result:** candidate lineages and all generated/repair
   versions are inserted atomically after bounded provider output normalization.
3. **Save Blockly version:** validate first, then insert the version and update
   session selection in one transaction.
4. **Decision:** append the decision and update session selection in one
   transaction.
5. **Evaluation:** create run, compute outside the write transaction, then insert
   all row results and mark complete in one transaction.
6. **Dataset load:** stage into temporary tables, verify counts/checksum, then
   mark the prior version `superseded` and publish the new `current` version
   atomically.

No API endpoint may partially create candidates, versions, or completed
evaluation results.

## 13. Planned File Structure

The implementation should converge on this shape without moving files merely
for aesthetics:

```text
server/
  app.ts
  index.ts
  db/
    connection.ts
    migrate.ts
    migrations/0001_initial.sql
    migrations/0002_cohort_evaluation.sql
    stores/
      sessions.ts
      candidates.ts
      datasets.ts
      evaluations.ts
      decisions.ts
  generation/
    generator.ts
    openaiGenerator.ts
  jobs/
    inProcessRunner.ts
  routes/
    health.ts
    sessions.ts
    sessionTurns.ts
    candidates.ts
    datasets.ts
    evaluations.ts
    decisions.ts
  services/
    generationService.ts
    evaluationService.ts
    datasetService.ts
    decisionService.ts
    recoveryService.ts

shared/
  contracts.ts
  ast/
    core.ts
    registry.ts

src/
  session/
    SessionPage.tsx
    SessionRail.tsx
    GenerationReviewPanel.tsx
    CohortEvaluationPanel.tsx
  formula/
    diabetesCatalog.ts
    diabetesBlocklyAdapter.ts
    diabetesExpressionAdapter.ts
  test/
    setup.ts
  shared-console/             # present only for a licensed frozen extraction

scripts/
  audit-public-release.ts
  prepare-cohort.ts
  verify-shared-ui.ts

data/
  README.md
  source-manifest.json        # provenance and expected digests; no row data
  raw/                        # ignored source dataset

e2e/
  closed-loop.spec.ts

playwright.config.ts
shared-ui-provenance.json     # only after Gate 0 passes
tsconfig.server.json
vitest.config.ts
var/                          # ignored local runtime state
```

Contracts imported by both browser and server live under `shared/`. The server
must not import React or Blockly. The frontend must not import SQLite code.

### 13.1 Current-file disposition

The implementation changes responsibility without preserving obsolete wrappers:

| Current file | Planned disposition |
| --- | --- |
| `src/core.ts` | Move the AST 1.0 kernel into `shared/ast/core.ts`; retain one authoritative implementation. |
| `src/generation.ts` | Split provider contracts and orchestration into `server/generation/` and `server/services/generationService.ts`; delete the browser executor after cutover. |
| `src/demo.ts` | Keep only deterministic fixtures, relocated beside the tests or demonstration provider that owns them. |
| `src/App.tsx` | Reduce to application bootstrap and `SessionPage` composition. |
| `src/index.css` | Retain global tokens; add only rules required to place the session rail, generation panel, and results tab. Do not restyle operation-panel leaves. |

No compatibility wrapper keeps browser persistence or browser cohort execution
alive after the corresponding server route is complete.

## 14. Implementation Batches

Each batch ends with one focused English commit and a runnable state.

### Gate 0 — Shared UI redistribution admission

This is a release and implementation precondition, not a new product batch. The
sole copyright holder has authorized the neutral extraction for public
redistribution under MIT, and the gate is now `PASS`.

- [x] Obtain written redistribution authorization covering the neutral extraction.
- [x] Produce the Section 6.5 provenance record, frozen file/component allowlist,
  LICENSE/NOTICE copies, integrity hashes, and MIT compatibility record.
- [x] Compile a minimal import smoke test against the current React/TypeScript
  versions and run license, private-source, DOM, interaction, CSS-scope, and
  screenshot checks.
- [x] Record `PASS` with the admitted artifact identity. A missing license,
  unknown origin, failed hash, or failed compatibility check is `BLOCKED`, not a
  warning.

Batch 1 may proceed while this gate is resolved. Batches 2 and 4 must not copy,
wrap, or imitate the shared UI until Gate 0 is `PASS`.

### Batch 1 — Persisted session spine

**Files:**

- Modify: `package.json`, `package-lock.json`, `vite.config.ts`, `Makefile`,
  `.gitignore`, `tsconfig.json`
- Create: `tsconfig.server.json`, `vitest.config.ts`
- Create: `shared/contracts.ts`
- Create: `server/app.ts`, `server/index.ts`
- Create: `server/db/connection.ts`, `server/db/migrate.ts`
- Create: `server/db/stores/sessions.ts`
- Create: `server/db/migrations/0001_initial.sql`
- Create: `server/routes/health.ts`, `server/routes/sessions.ts`
- Test: `server/db/migrate.test.ts`, `server/routes/sessions.test.ts`

**Execution steps:**

- [ ] **Step 1:** Add failing migration tests that create a temporary database,
  run migrations twice, and assert the `sessions`, `session_turns`, `candidates`,
  and `candidate_versions` tables and their foreign keys.
- [ ] **Step 2:** Add failing session route tests for create, list, rename,
  archive, selection, validation errors, and API restart recovery.
- [ ] **Step 3:** Run
  `npm test -- server/db/migrate.test.ts server/routes/sessions.test.ts`;
  expect failures because the server and schema do not exist.
- [ ] **Step 4:** Add Hono, `better-sqlite3`, shared request/response contracts,
  `@hono/node-server`, the `tsx` development runner, the numbered migration
  runner, and the smallest route/store implementation that satisfies the tests.
  Route handlers call `server/db/stores/` and do not contain SQL.
- [ ] **Step 5:** Add the Vite `/api` proxy and make `make up` run the API and
  frontend together with coordinated shutdown. Configure `tsconfig.server.json`
  and the root project references so `npm run build` type-checks `server/` and
  `shared/`, and ignore `var/` before the first database is created.
- [ ] **Step 6:** Re-run the targeted tests and `npm run build`; expect all tests
  and browser, shared, and server TypeScript compilation to pass. Every route and
  store test uses its own temporary SQLite file and never opens
  `var/research.db`.

Acceptance:

- create, rename, archive, reopen, and list sessions;
- restart the API and recover the same session state;
- no frontend business state is persisted in `localStorage`.

Commit:

```text
feat: add the persisted research session spine
 - Add the lightweight local API and SQLite migrations
 - Persist sessions, candidate lineages, and immutable versions
```

### Batch 2 — Sessionized page composition

**Files:**

- Modify: `src/App.tsx`, `src/index.css`, `vite.config.ts`, `package.json`,
  `package-lock.json`, `vitest.config.ts`
- Consume unchanged: approved shared console package; if supplied as a licensed
  extraction, place it under `src/shared-console/`
- Create: `scripts/verify-shared-ui.ts`, `shared-ui-provenance.json`
- Create: `src/api/client.ts`
- Create: `src/test/setup.ts`
- Create: `src/session/SessionPage.tsx`, `src/session/SessionRail.tsx`
- Test: `src/session/SessionPage.test.tsx`, `src/session/SessionRail.test.tsx`

**Execution steps:**

- [ ] **Step 1:** Run the Section 6.5 public-source gate and pin the approved
  package integrity or licensed extraction hashes. Stop before UI implementation
  if redistribution is not explicitly permitted.
- [ ] **Step 2:** Add failing component tests for first-session creation, loading,
  empty, API-error, rename, archive, URL selection, and refresh restoration.
- [ ] **Step 3:** Add the Vitest UI project with `jsdom`, Testing Library,
  `@testing-library/jest-dom`, and `src/test/setup.ts`; keep server/shared/script
  tests in the Node project.
- [ ] **Step 4:** Run
  `npm test -- src/session/SessionPage.test.tsx src/session/SessionRail.test.tsx`;
  expect failures because the session page does not exist.
- [ ] **Step 5:** Add the typed API client and compose `SessionPage` and
  `SessionRail` exclusively from the frozen page, pane, master-list, feedback,
  and form primitives in Section 6.
- [ ] **Step 6:** Replace only the top-level composition in `src/App.tsx`; keep
  operation-panel geometry intact and limit `src/index.css` changes to the new
  session column and page-level sizing.
- [ ] **Step 7:** Run the targeted tests, `npm run verify:shared-ui`, and
  `npm run build`; expect all checks to pass with no `localStorage` session state
  and no frozen shared-source changes.

Acceptance:

- browser refresh restores the same selected session;
- only the session rail adds a permanent column;
- existing formula-workspace operation-panel geometry remains unchanged;
- desktop checks at normal width and zoomed width retain identical pane order.

Commit:

```text
feat: add the session-based research workspace
 - Add persistent session navigation and URL selection
 - Preserve the shared formula workspace composition
```

### Batch 3 — Multi-candidate generation history

**Files:**

- Move and refactor: `src/core.ts` to `shared/ast/core.ts`
- Create: `shared/ast/registry.ts`, `shared/ast/core.test.ts`
- Delete after replacement: `src/generation.ts`, `src/generation.test.ts`,
  `src/demo.ts`
- Modify: `src/session/SessionPage.tsx`
- Create: `server/generation/generator.ts`,
  `server/generation/openaiGenerator.ts`
- Create: `server/services/generationService.ts`,
  `server/services/recoveryService.ts`, `server/routes/sessionTurns.ts`,
  `server/routes/candidates.ts`
- Create: `server/db/stores/candidates.ts`,
  `server/jobs/inProcessRunner.ts`
- Create: `src/session/GenerationReviewPanel.tsx`
- Test: `server/services/generationService.test.ts`,
  `server/jobs/inProcessRunner.test.ts`,
  `server/services/recoveryService.test.ts`,
  `server/routes/sessionTurns.test.ts`,
  `src/session/GenerationReviewPanel.test.tsx`

**Execution steps:**

- [ ] **Step 1:** Move the AST kernel and provider-neutral contracts to the
  shared/server boundary, implement the Section 7 diabetes registry, preserve
  `AST_VERSION = "1.0"`, and add kernel tests for every operator and limit.
- [ ] **Step 2:** Add failing service tests for multiple proposals, malformed
  payloads, unknown signals, one bounded repair, all-alternative retention,
  provider failure, and append-only retry turns.
- [ ] **Step 3:** Run the targeted kernel, service, runner, route, and component
  test files; expect failures because
  persistence and the review panel are absent.
- [ ] **Step 4:** Persist a session turn before provider execution, normalize all
  provider outputs, insert each candidate lineage and immutable version in one
  transaction through `server/db/stores/candidates.ts`, and preserve the bounded
  raw response plus per-version explanation/assumptions and failure provenance.
- [ ] **Step 5:** Add the FIFO runner, verify concurrency 1, and test that startup
  changes stale generation `pending`/`running` rows to `APP_RESTARTED` failures.
- [ ] **Step 6:** Add `GenerationReviewPanel` with the shared feedback, list,
  status, and button components. Selecting a candidate updates session selection
  but does not create another editor or transcript.
- [x] **Step 7:** Hard-cut the offline provider. Production generation is available
  only through the environment-configured external LLM adapter behind `Generator`;
  tests inject a test-only implementation explicitly.
- [ ] **Step 8:** Re-run targeted tests and `npm run build`; expect all checks to
  pass and every proposal attempt to be queryable after restart. Delete the
  replaced browser generation/demo modules only after no import references them.

Acceptance:

- one prompt produces several stored proposal lineages;
- a forced unknown-signal proposal is rejected or repaired visibly;
- all admitted alternatives remain selectable;
- failed generation can be retried without losing the failed record.

Commit:

```text
feat: persist multi-candidate formula generation
 - Add provider-neutral session turns and proposal lineage
 - Add bounded validation and repair review to each session
```

### Batch 4 — Blockly formula versioning

**Files:**

- Modify: `package.json`, `package-lock.json`
- Reuse unchanged: the approved shared console boundary admitted in Batch 2
- Create: `src/formula/diabetesCatalog.ts`,
  `src/formula/diabetesBlocklyAdapter.ts`,
  `src/formula/diabetesExpressionAdapter.ts`
- Modify: `src/session/SessionPage.tsx`, `server/routes/candidates.ts`
- Test: `src/formula/diabetesBlocklyAdapter.test.ts`,
  `src/session/SessionPage.blockly.test.tsx`,
  `server/routes/candidateVersions.test.ts`

**Execution steps:**

- [ ] **Step 1:** Re-run `npm run verify:shared-ui` before integration and verify
  that the approved boundary remains unchanged.
- [ ] **Step 2:** Add the exact Blockly runtime dependency required by the
  admitted shared artifact; do not introduce a second Blockly version.
- [ ] **Step 3:** Add failing round-trip tests for every admitted operator:
  AST to Blockly to AST, AST to text to AST, dirty state, and invalid block shape.
- [ ] **Step 4:** Add failing API tests proving that only the server can validate
  and append a `blockly` child version and that parent versions remain immutable.
- [ ] **Step 5:** Run the targeted tests; expect failures because the diabetes
  adapters and version endpoint do not exist.
- [ ] **Step 6:** Implement the diabetes catalog and adapters around unchanged
  shared `LibraryPanel`, `CommandPalette`, formula preview/bar, toolbar, canvas,
  and validation components. Do not modify shared component props or markup.
- [ ] **Step 7:** Connect selected saved versions to the one existing canvas and
  add the existing unsaved-change guard and shared version-menu behavior.
- [ ] **Step 8:** Re-run targeted tests and `npm run build`; expect exact round
  trips, immutable lineage, and no diff inside the approved shared package.

Acceptance:

- open every admitted candidate in the same Blockly canvas;
- modify a formula with blocks and through the formula bar;
- save a Blockly child version and retain the generated parent;
- reopen the session and recover the exact block formula and version chain;
- shared visual components have no local forks.

Commit:

```text
feat: add human formula editing and version lineage
 - Bind candidate ASTs to the shared Blockly workspace
 - Persist Blockly formula versions without rewriting generation history
```

### Batch 5 — Cohort database preparation and evaluation

**Files:**

- Modify: `package.json`, `package-lock.json`, `.gitignore`
- Create: `data/README.md`, `data/source-manifest.json`
- Create: `scripts/prepare-cohort.ts`
- Create: `server/db/migrations/0002_cohort_evaluation.sql`
- Create: `server/services/datasetService.ts`,
  `server/services/evaluationService.ts`, `server/services/decisionService.ts`
- Create: `server/db/stores/datasets.ts`, `server/db/stores/evaluations.ts`,
  `server/db/stores/decisions.ts`
- Create: `server/routes/datasets.ts`, `server/routes/evaluations.ts`,
  `server/routes/decisions.ts`
- Test: `scripts/prepare-cohort.test.ts`,
  `server/services/evaluationService.test.ts`,
  `server/services/recoveryService.test.ts`,
  `server/routes/evaluations.test.ts`, `server/routes/decisions.test.ts`

**Execution steps:**

- [ ] **Step 1:** Record the DOI, Dryad file id and MD5 from Section 8.1,
  repository-pinned SHA-256, `CC0-1.0` evidence/citation, admitted workbook
  columns, exact baseline/final FPG mapping, predictor/evaluator projections,
  inclusion rules, outcome mapping, source totals, and split seed in
  `data/source-manifest.json`.
- [ ] **Step 2:** Add failing importer tests using a tiny synthetic workbook for
  checksum mismatch, schema drift, invalid rows, deterministic normalization,
  baseline/final FPG isolation, deterministic split keys, independent display
  UUIDs, duplicate rows, fixed stratified splits, class presence, idempotence,
  and atomic failure.
- [ ] **Step 3:** Add failing evaluator tests for hidden outcome access, score
  direction, predictor-only projection, calibration-only threshold selection,
  threshold sentinels, tied and constant scores, AUROC, average precision,
  confusion classes, non-finite failure, and formula isolation.
- [ ] **Step 4:** Extend the recovery test with stale evaluation `pending` and
  `running` rows; expect both to become `APP_RESTARTED` failures without changing
  completed runs.
- [ ] **Step 5:** Add failing decision route tests for reject-without-evaluation,
  accept-with-matching-current-evaluation, version/run mismatch, stale dataset,
  incomplete evaluation, and append-only decision order.
- [ ] **Step 6:** Run the targeted tests; expect failures because the cohort
  schema, importer, and evaluator do not exist.
- [ ] **Step 7:** Add the cohort/evaluation migration, an ExcelJS streaming
  importer used only by the CLI, the registry-backed in-process evaluator,
  review-decision table, bounded row persistence, and small local aggregate metric
  functions; extend startup recovery to evaluation runs. Do not add an ML
  framework or dynamic-code execution. Change
  `.gitignore` from broad `data/` exclusion to tracked `data/README.md` and
  `data/source-manifest.json` plus ignored `data/raw/` and derived row data.
- [ ] **Step 8:** Implement and test the decision route/service. Acceptance must
  atomically verify an admitted candidate version, a completed matching evaluation,
  the current dataset version, and 100% finite execution; rejection requires no
  evaluation. The database retains every decision in order.
- [ ] **Step 9:** Run `npm run prepare:cohort -- --check-only` against the real
  local workbook; expect checksum/schema verification without writing raw data to
  Git. Then perform one real local import and evaluate a fixed admitted formula,
  recording only aggregate smoke output. Run targeted tests and `npm run build`;
  expect all checks to pass.

Acceptance:

- the same dataset input produces the same dataset version and split;
- every stored evaluation identifies exact AST and dataset hashes;
- every stored evaluation identifies registry, evaluator, threshold-policy, and
  metric-policy versions;
- no candidate AST can reference the outcome label;
- review rows cannot affect the frozen calibration threshold;
- review metrics are labeled exploratory and make no held-out claim;
- a restart does not lose completed evaluation results.

Commit:

```text
feat: evaluate candidate formulas against observed outcomes
 - Add deterministic cohort preparation and local evaluation runs
 - Persist aggregate metrics and row-level disagreement evidence
```

### Batch 6 — Results review and demo closure

**Files:**

- Create: `src/session/CohortEvaluationPanel.tsx`
- Modify: `src/session/SessionPage.tsx`, `src/api/client.ts`, `README.md`,
  `SECURITY.md`, `Makefile`, `package.json`
- Create: `playwright.config.ts`, `e2e/closed-loop.spec.ts`
- Create: `scripts/audit-public-release.ts`
- Test: `src/session/CohortEvaluationPanel.test.tsx`,
  `e2e/closed-loop.spec.ts`

**Execution steps:**

- [ ] **Step 1:** Add failing component tests for metrics, confusion classes,
  dataset/version provenance, bounded pagination, row selection, API failures,
  retry, and accept/reject decisions.
- [ ] **Step 2:** Run targeted tests; expect failures because the results panel
  does not exist.
- [ ] **Step 3:** Render `CohortEvaluationPanel` under the existing right-inspector
  `Cohort results` tab, using shared table, status, tabs, feedback, and buttons.
  Do not add a fourth workspace pane.
- [x] **Step 4:** Add the browser test for the exact Definition of Done path and
  the documented one-command local setup. The test injects a test-only `Generator`
  and a small licensed/synthetic evaluation fixture, never the production provider
  or raw public workbook.
- [ ] **Step 5:** Run `npm run test`, `npm run build`, `npm run test:e2e`, and
  `make check`; expect all commands to pass with no browser console/API errors.
- [ ] **Step 6:** Run secret, private-path, raw-data, package-license, and tracked
  artifact scans across the worktree, index, `git archive HEAD`, all Git refs and
  objects, production build, source maps, `npm pack --dry-run`, screenshots, and
  E2E artifacts before committing the public-ready loop. Any finding blocks
  release; clean history with a separately approved rewrite, then rerun the full
  audit.

Acceptance:

- complete the definition-of-done walkthrough below without manual database
  edits;
- no console errors, failed API calls, or misleading clinical language;
- production build, unit tests, API tests, and browser smoke test pass;
- the release tree, history, build, package, and test artifacts contain no real
  cohort rows or private shared-source metadata.

Commit:

```text
feat: close the formula research review loop
 - Add cohort comparison and disagreement review to the session workspace
 - Complete durable human decisions, recovery, and end-to-end verification
```

## 15. Verification Matrix

| Layer | Required verification |
| --- | --- |
| AST schema | unknown fields, signals, operators, arity, depth, and node limits |
| AST runtime | empty values, non-finite values, protected division, log domain |
| Generation | multiple proposals, malformed JSON, bounded repair, provider failure |
| Versions | generated parent, Blockly child, immutable history, dirty-switch guard |
| Sessions | create, select, refresh, rename, archive, restart recovery |
| Dataset | checksum, deterministic inclusion, fixed split, hidden outcome signal |
| Evaluation | threshold fitted on calibration only, exploratory review metrics, row pagination |
| Decisions | exact version/run target, history, edit-after-accept, stale dataset |
| Frontend | shared-component freeze, session layout, Blockly round trip, results tab |
| Public hygiene | ignored runtime DB/raw data, secret scan, private-source scan |

Every unit/route/service test receives a fresh temporary database. Browser tests
receive a dedicated synthetic database path and delete it afterward. No automated
test may open or mutate `var/research.db` or the real workbook.

## 16. Definition of Done

The prototype is complete only when this walkthrough works from a clean local
checkout plus the user-supplied, checksum-verified Dryad workbook. CI and public
browser artifacts use the synthetic fixture; the real-data step is a local
integration check.

1. Run `npm ci`, place the workbook under `data/raw/`, then run one documented
   `make demo-real` command to verify/import it and start the application.
2. Create a new session from the session rail.
3. Enter a natural-language request and receive multiple formula candidates.
4. Select one candidate and inspect its deterministic validation result.
5. Modify it in Blockly and save a new Blockly version.
6. Run cohort evaluation for both the generated version and the Blockly version.
7. Compare their metrics and inspect false-positive and false-negative rows
   against observed outcomes.
8. Accept one exact version with an optional note.
9. Refresh the browser and restart the backend.
10. Reopen the session and recover the prompt, candidate lineages, Blockly
    version, evaluation results, and human decision. Row filters and pagination
    reset to their documented defaults.

The prototype is not complete if any of these facts exist only in browser
memory, if an unsaved formula can be evaluated, or if a candidate result cannot
be traced to an exact AST and dataset version.

## 17. Rollback and Repository Discipline

- Keep every batch in one reviewable commit using the sequence above.
- Do not combine shared-component cleanup with a business-feature batch.
- Before a SQLite migration, the migration runner uses SQLite's online backup API
  to create a timestamped local backup and verifies it can be opened; never copy
  only the main file while WAL connections are active. The repository does not
  commit runtime databases.
- Dataset preparation is idempotent by source checksum and preprocessing
  version; a failed load leaves the previous dataset version current.
- Removing a failed implementation batch must restore the last runnable batch
  without requiring manual database repair.
- Stage only intended files. Do not use broad staging while unrelated untracked
  workspace files exist.
- A public release requires a clean `scripts/audit-public-release.ts --all-history`
  result for the worktree, index, release archive, every Git ref/object, build,
  package manifest, source map, database/raw-data pattern, secret pattern, and
  private-name denylist. Deleting a file in the latest commit is not sufficient.

## 18. Deferred Extensions

The following may be considered only after the definition of done is satisfied:

- candidate side-by-side AST diff;
- more datasets or external validation;
- probability calibration;
- formula export packages;
- experiment dashboards;
- authenticated multi-user review;
- distributed evaluation workers.

They must not delay or reshape the six prototype batches above.
