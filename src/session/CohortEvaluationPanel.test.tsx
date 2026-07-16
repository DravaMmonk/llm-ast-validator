import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EvaluationRow, EvaluationRunDetail, ReviewMetrics } from "../../shared/contracts";
import { CohortEvaluationPanel } from "./CohortEvaluationPanel";

const {
  getCurrentDataset,
  createEvaluationRuns,
  getLatestEvaluationRun,
  getEvaluationRun,
  getEvaluationRows,
  getDecisions,
  createDecision,
} = vi.hoisted(() => ({
  getCurrentDataset: vi.fn(),
  createEvaluationRuns: vi.fn(),
  getLatestEvaluationRun: vi.fn(),
  getEvaluationRun: vi.fn(),
  getEvaluationRows: vi.fn(),
  getDecisions: vi.fn(),
  createDecision: vi.fn(),
}));

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return {
    ...actual,
    api: {
      getCurrentDataset,
      createEvaluationRuns,
      getLatestEvaluationRun,
      getEvaluationRun,
      getEvaluationRows,
      getDecisions,
      createDecision,
    },
  };
});

const SESSION_ID = "s-1";
const VERSION_ID = "11111111-1111-4111-8111-111111111111";
const RUN_ID = "22222222-2222-4222-8222-222222222222";

function metrics(overrides: Partial<ReviewMetrics> = {}): ReviewMetrics {
  return {
    auroc: 0.82,
    average_precision: 0.41,
    sensitivity: 0.7,
    specificity: 0.75,
    positive_predictive_value: 0.3,
    negative_predictive_value: 0.94,
    confusion: { true_positive: 7, true_negative: 45, false_positive: 15, false_negative: 3 },
    median_score_positive: 6.1,
    median_score_negative: 5.0,
    review_row_count: 70,
    observed_positive_count: 10,
    prevalence: 0.143,
    interpretation: "exploratory",
    ...overrides,
  };
}

function run(overrides: Partial<EvaluationRunDetail> = {}): EvaluationRunDetail {
  return {
    id: RUN_ID,
    candidate_version_id: VERSION_ID,
    dataset_version_id: "33333333-3333-4333-8333-333333333333",
    status: "completed",
    score_direction: "higher",
    threshold: 5.85,
    threshold_policy_version: "youden-v1",
    metric_policy_version: "exploratory-v1",
    evaluator_version: "v1",
    ast_hash: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
    registry_hash: "f".repeat(64),
    calibration_summary: { row_count: 140, youden_j: 0.45, policy: "youden-v1" },
    review_metrics: metrics(),
    calibration_row_count: 140,
    review_row_count: 70,
    error: null,
    stale_dataset: false,
    started_at: "2026-07-16T00:00:00.000Z",
    finished_at: "2026-07-16T00:00:02.000Z",
    ...overrides,
  };
}

function row(overrides: Partial<EvaluationRow> = {}): EvaluationRow {
  return {
    row_key: "aaaaaaaa-1111-4111-8111-111111111111",
    score: 6.4,
    percentile: 0.91,
    predicted_label: 1,
    observed_label: 0,
    error_class: "false_positive",
    explanation_inputs: { age: 52, bmi: 27.1, baseline_fasting_plasma_glucose: 6.4 },
    ...overrides,
  };
}

function renderPanel(options: { versionId?: string | null; isDirty?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CohortEvaluationPanel
        sessionId={SESSION_ID}
        versionId={options.versionId === undefined ? VERSION_ID : options.versionId}
        isDirty={options.isDirty ?? false}
      />
    </QueryClientProvider>,
  );
}

/** Starts an evaluation and waits for the completed view. */
async function evaluate(): Promise<void> {
  await userEvent.click(screen.getByRole("button", { name: "Run cohort evaluation" }));
  await waitFor(() => expect(getEvaluationRun).toHaveBeenCalled());
}

beforeEach(() => {
  getCurrentDataset.mockReset().mockResolvedValue({ dataset: { id: "d1" }, counts: [] });
  createEvaluationRuns.mockReset().mockResolvedValue({ run_ids: [RUN_ID] });
  getLatestEvaluationRun.mockReset().mockResolvedValue({ run: null });
  getEvaluationRun.mockReset().mockResolvedValue(run());
  getEvaluationRows.mockReset().mockResolvedValue({ rows: [row()], next_cursor: null });
  getDecisions.mockReset().mockResolvedValue({ decisions: [] });
  createDecision.mockReset();
});

describe("preconditions", () => {
  it("prompts when no candidate is selected", () => {
    renderPanel({ versionId: null });
    expect(screen.getByText("No candidate selected")).toBeInTheDocument();
  });

  it("refuses to evaluate an unsaved draft", async () => {
    renderPanel({ isDirty: true });

    expect(await screen.findByRole("button", { name: "Run cohort evaluation" })).toBeDisabled();
    expect(screen.getByText(/a draft cannot be evaluated/i)).toBeInTheDocument();
    expect(createEvaluationRuns).not.toHaveBeenCalled();
  });

  it("reports when no cohort is prepared", async () => {
    const { ApiError } = await vi.importActual<typeof import("../api/client")>("../api/client");
    getCurrentDataset.mockRejectedValue(new ApiError(409, "DATASET_NOT_PREPARED", "No current dataset version."));
    renderPanel();

    expect(await screen.findByText("No cohort prepared")).toBeInTheDocument();
  });

  it("targets the selected saved version", async () => {
    renderPanel();
    await evaluate();
    expect(createEvaluationRuns).toHaveBeenCalledWith(SESSION_ID, [VERSION_ID]);
  });
});

describe("aggregate metrics", () => {
  it("restores the latest persisted evaluation and decision without rerunning", async () => {
    getLatestEvaluationRun.mockResolvedValue({ run: run() });
    getDecisions.mockResolvedValue({
      decisions: [
        {
          id: "d1",
          candidate_version_id: VERSION_ID,
          decision_no: 1,
          decision: "accepted",
          evaluation_run_id: RUN_ID,
          note: "Persisted decision",
          decided_at: "2026-07-16T00:00:03.000Z",
          stale_dataset: false,
        },
      ],
    });
    renderPanel();

    expect(await screen.findByText("AUROC")).toBeInTheDocument();
    expect(await screen.findByText(/Persisted decision/)).toBeInTheDocument();
    expect(createEvaluationRuns).not.toHaveBeenCalled();
  });

  it("shows the minimum metric set", async () => {
    renderPanel();
    await evaluate();

    expect(await screen.findByText("AUROC")).toBeInTheDocument();
    expect(screen.getByText("0.820")).toBeInTheDocument();
    expect(screen.getByText("Average precision")).toBeInTheDocument();
    expect(screen.getByText("0.410")).toBeInTheDocument();
    expect(screen.getByText("Sensitivity")).toBeInTheDocument();
    expect(screen.getByText("Specificity")).toBeInTheDocument();
    expect(screen.getByText("PPV")).toBeInTheDocument();
    expect(screen.getByText("NPV")).toBeInTheDocument();
  });

  it("shows the confusion matrix counts", async () => {
    renderPanel();
    await evaluate();

    await screen.findByText("AUROC");
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("45")).toBeInTheDocument();
    expect(screen.getByText("15")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("shows the denominator beside the metrics that depend on it", async () => {
    renderPanel();
    await evaluate();

    expect(await screen.findByText(/N=70/)).toBeInTheDocument();
    expect(screen.getByText(/observed positive=10/)).toBeInTheDocument();
    expect(screen.getByText(/prevalence=0.143/)).toBeInTheDocument();
  });

  it("shows the direction, comparator, and frozen threshold", async () => {
    renderPanel();
    await evaluate();

    expect(await screen.findByText(">= 5.8500 (higher)")).toBeInTheDocument();
    expect(screen.getByText(/140 calibration rows · youden-v1/)).toBeInTheDocument();
  });

  it("uses <= when the direction is lower", async () => {
    getEvaluationRun.mockResolvedValue(run({ score_direction: "lower", threshold: 2.5 }));
    renderPanel();
    await evaluate();

    expect(await screen.findByText("<= 2.5000 (lower)")).toBeInTheDocument();
  });

  it("labels the review metrics exploratory", async () => {
    renderPanel();
    await evaluate();
    expect(await screen.findByText("exploratory")).toBeInTheDocument();
  });
});

describe("provenance", () => {
  it("shows the dataset and candidate version prominently", async () => {
    renderPanel();
    await evaluate();

    expect(await screen.findByText("Candidate version")).toBeInTheDocument();
    expect(screen.getByText("11111111")).toBeInTheDocument();
    expect(screen.getByText("Dataset version")).toBeInTheDocument();
    expect(screen.getByText("33333333")).toBeInTheDocument();
    expect(screen.getByText("abcdef012345")).toBeInTheDocument();
  });

  it("marks a superseded dataset as stale and blocks acceptance", async () => {
    getEvaluationRun.mockResolvedValue(run({ stale_dataset: true }));
    renderPanel();
    await evaluate();

    expect(await screen.findByText("stale dataset")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accept" })).toBeDisabled();
    // A prior result stays visible rather than disappearing.
    expect(screen.getByText("AUROC")).toBeInTheDocument();
  });
});

describe("row table", () => {
  it("defaults to disagreements", async () => {
    renderPanel();
    await evaluate();

    await waitFor(() =>
      expect(getEvaluationRows).toHaveBeenCalledWith(RUN_ID, expect.objectContaining({ error_class: "disagreement" })),
    );
  });

  it("switches between all four error classes", async () => {
    renderPanel();
    await evaluate();
    await screen.findByText("Rows");

    for (const [label, expected] of [
      ["TP", "true_positive"],
      ["TN", "true_negative"],
      ["FP", "false_positive"],
      ["FN", "false_negative"],
    ] as const) {
      await userEvent.click(screen.getByRole("button", { name: label }));
      await waitFor(() =>
        expect(getEvaluationRows).toHaveBeenLastCalledWith(RUN_ID, expect.objectContaining({ error_class: expected })),
      );
    }
  });

  it("requests a bounded page", async () => {
    renderPanel();
    await evaluate();

    await waitFor(() => expect(getEvaluationRows).toHaveBeenCalledWith(RUN_ID, expect.objectContaining({ limit: 50 })));
  });

  it("says observed outcome, never ground-truth diagnosis", async () => {
    renderPanel();
    await evaluate();
    await screen.findByText("Rows");

    expect(screen.getByText("Observed")).toBeInTheDocument();
    expect(screen.queryByText(/ground.truth/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/diagnosis/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/probability/i)).not.toBeInTheDocument();
  });

  it("shows only the admitted inputs when a row is selected", async () => {
    renderPanel();
    await evaluate();
    await screen.findByText("Rows");

    await userEvent.click(screen.getByText("aaaaaaaa"));

    expect(await screen.findByText("Formula score")).toBeInTheDocument();
    expect(screen.getByText("6.4000")).toBeInTheDocument();
    expect(screen.getByText("Percentile in review")).toBeInTheDocument();
    expect(screen.getByText("91.0%")).toBeInTheDocument();
    expect(screen.getByText("Observed outcome")).toBeInTheDocument();
    expect(screen.getByText("Formula inputs")).toBeInTheDocument();
    expect(screen.getByText("baseline_fasting_plasma_glucose")).toBeInTheDocument();
    // The outcome and follow-up must never appear as row evidence.
    expect(screen.queryByText("incident_diabetes")).not.toBeInTheDocument();
    expect(screen.queryByText("followup_fasting_plasma_glucose")).not.toBeInTheDocument();
  });

  it("explains true negative without implying permanent freedom", async () => {
    renderPanel();
    await evaluate();
    await screen.findByText("Rows");

    const tn = screen.getByTitle(/Formula negative; no diabetes was observed/);
    expect(tn).toHaveAttribute("title", expect.stringContaining("does not mean permanent freedom"));
  });

  it("reports an empty class rather than looking broken", async () => {
    getEvaluationRows.mockResolvedValue({ rows: [], next_cursor: null });
    renderPanel();
    await evaluate();

    expect(await screen.findByText("No disagreements")).toBeInTheDocument();
  });

  it("surfaces a row loading failure with a retry", async () => {
    getEvaluationRows.mockRejectedValueOnce(new Error("The local API is unreachable. Is it running?"));
    renderPanel();
    await evaluate();

    expect(await screen.findByText("Could not load rows")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});

describe("failure and retry", () => {
  it("keeps a failed evaluation visible and retryable", async () => {
    getEvaluationRun.mockResolvedValue(
      run({
        status: "failed",
        review_metrics: null,
        threshold: null,
        score_direction: null,
        error: { code: "NON_FINITE_SCORE", message: "The formula did not produce a finite score for every row." },
      }),
    );
    renderPanel();
    await evaluate();

    expect(await screen.findByText("Evaluation failed")).toBeInTheDocument();
    expect(screen.getByText(/NON_FINITE_SCORE/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("shows in-flight evaluation", async () => {
    getEvaluationRun.mockResolvedValue(run({ status: "running", review_metrics: null }));
    renderPanel();
    await evaluate();

    expect(await screen.findByText("Evaluating against the cohort…")).toBeInTheDocument();
  });

  it("surfaces a start failure", async () => {
    createEvaluationRuns.mockRejectedValue(new Error("No current dataset version exists."));
    renderPanel();

    await userEvent.click(await screen.findByRole("button", { name: "Run cohort evaluation" }));

    expect(await screen.findByText("No current dataset version exists.")).toBeInTheDocument();
  });
});

describe("decisions", () => {
  it("binds acceptance to the completed run of this exact version", async () => {
    createDecision.mockResolvedValue({ decision: "accepted", decision_no: 1 });
    renderPanel();
    await evaluate();

    await userEvent.type(await screen.findByLabelText("Decision note"), "Reasonable.");
    await userEvent.click(screen.getByRole("button", { name: "Accept" }));

    await waitFor(() =>
      expect(createDecision).toHaveBeenCalledWith(VERSION_ID, {
        decision: "accepted",
        evaluation_run_id: RUN_ID,
        note: "Reasonable.",
      }),
    );
  });

  it("rejects without evaluation evidence", async () => {
    createDecision.mockResolvedValue({ decision: "rejected", decision_no: 1 });
    renderPanel();
    await evaluate();

    await userEvent.click(await screen.findByRole("button", { name: "Reject" }));

    await waitFor(() =>
      expect(createDecision).toHaveBeenCalledWith(VERSION_ID, {
        decision: "rejected",
        evaluation_run_id: undefined,
        note: undefined,
      }),
    );
  });

  it("treats the note as optional", async () => {
    createDecision.mockResolvedValue({ decision: "accepted", decision_no: 1 });
    renderPanel();
    await evaluate();

    await userEvent.click(await screen.findByRole("button", { name: "Accept" }));

    await waitFor(() =>
      expect(createDecision).toHaveBeenCalledWith(VERSION_ID, expect.objectContaining({ note: undefined })),
    );
  });

  it("shows the effective decision and its history position", async () => {
    getDecisions.mockResolvedValue({
      decisions: [
        { id: "d1", candidate_version_id: VERSION_ID, decision_no: 1, decision: "rejected", evaluation_run_id: null, note: "First look", decided_at: "x", stale_dataset: false },
        { id: "d2", candidate_version_id: VERSION_ID, decision_no: 2, decision: "accepted", evaluation_run_id: RUN_ID, note: "On reflection", decided_at: "y", stale_dataset: false },
      ],
    });
    renderPanel();
    await evaluate();

    // The latest decision is effective.
    expect(await screen.findByText(/#2 · On reflection/)).toBeInTheDocument();
  });

  it("surfaces a rejected decision from the server", async () => {
    const { ApiError } = await vi.importActual<typeof import("../api/client")>("../api/client");
    createDecision.mockRejectedValue(new ApiError(409, "STALE_DATASET", "That evaluation ran against a superseded dataset."));
    renderPanel();
    await evaluate();

    await userEvent.click(await screen.findByRole("button", { name: "Accept" }));

    expect(await screen.findByText(/STALE_DATASET/)).toBeInTheDocument();
  });

  it("offers no decision until an evaluation completes", async () => {
    getEvaluationRun.mockResolvedValue(run({ status: "running", review_metrics: null }));
    renderPanel();
    await evaluate();

    await screen.findByText("Evaluating against the cohort…");
    expect(screen.queryByRole("button", { name: "Accept" })).not.toBeInTheDocument();
  });
});
