import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CandidateSummary, CandidateVersionSummary, SessionTurnDetail } from "../../shared/contracts";
import { GenerationReviewPanel } from "./GenerationReviewPanel";

const { createTurn, getTurn, getHealth } = vi.hoisted(() => ({
  createTurn: vi.fn(),
  getTurn: vi.fn(),
  getHealth: vi.fn(),
}));

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, api: { createTurn, getTurn, getHealth } };
});

const SESSION_ID = "s-1";
const TURN_ID = "t-1";

function version(overrides: Partial<CandidateVersionSummary> = {}): CandidateVersionSummary {
  return {
    id: "v-1",
    parent_version_id: null,
    version_no: 1,
    source: "generated",
    admission_state: "admitted",
    ast_hash: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
    first_diagnostic: null,
    explanation: "Uses baseline fasting plasma glucose alone as the score.",
    assumptions: ["A higher baseline fasting plasma glucose indicates higher risk."],
    created_at: "2026-07-16T00:00:00.000Z",
    ...overrides,
  };
}

function candidate(overrides: Partial<CandidateSummary> = {}): CandidateSummary {
  return {
    id: "c-1",
    proposal_id: "proposal_baseline_glucose",
    ordinal: 1,
    versions: [version()],
    ...overrides,
  };
}

function turn(overrides: Partial<SessionTurnDetail> = {}): SessionTurnDetail {
  return {
    id: TURN_ID,
    session_id: SESSION_ID,
    ordinal: 1,
    requirement: "Score risk",
    candidate_count: 3,
    provider: "test-provider",
    model: "test-model-v1",
    prompt_version: "diabetes-prompt-v1",
    status: "completed",
    error: null,
    started_at: "2026-07-16T00:00:00.000Z",
    finished_at: "2026-07-16T00:00:01.000Z",
    candidates: [candidate()],
    ...overrides,
  };
}

function renderPanel(options: { hasTurn?: boolean; selectedVersionId?: string | null } = {}) {
  const onSelectVersion = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <GenerationReviewPanel
        sessionId={SESSION_ID}
        turns={options.hasTurn === false ? [] : [turn()]}
        selectedVersionId={options.selectedVersionId ?? null}
        onSelectVersion={onSelectVersion}
      />
    </QueryClientProvider>,
  );
  return { onSelectVersion };
}

beforeEach(() => {
  createTurn.mockReset();
  getTurn.mockReset().mockResolvedValue(turn());
  getHealth.mockReset().mockResolvedValue({
    status: "ok",
    schema_version: 2,
    generator: { configured: true, provider: "test-provider", model: "test-model-v1" },
  });
});

describe("composer", () => {
  it("disables generation and explains when no generator is configured", async () => {
    getHealth.mockResolvedValue({
      status: "ok",
      schema_version: 2,
      generator: { configured: false, provider: null, model: null },
    });
    renderPanel();

    expect(await screen.findByText(/No generator configured/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Natural-language requirement"), "Score risk");
    expect(screen.getByRole("button", { name: "Generate candidates" })).toBeDisabled();
    expect(createTurn).not.toHaveBeenCalled();
  });

  it("submits the requirement and candidate count", async () => {
    createTurn.mockResolvedValue({ turn_id: "t-2", status: "pending" });
    renderPanel();

    await userEvent.type(screen.getByLabelText("Natural-language requirement"), "Score risk");
    await userEvent.selectOptions(screen.getByLabelText("Candidate count"), "5");
    await userEvent.click(screen.getByRole("button", { name: "Generate candidates" }));

    await waitFor(() =>
      expect(createTurn).toHaveBeenCalledWith(SESSION_ID, { requirement: "Score risk", candidate_count: 5 }),
    );
  });

  it("defaults to three candidates", async () => {
    createTurn.mockResolvedValue({ turn_id: "t-2", status: "pending" });
    renderPanel();

    await userEvent.type(screen.getByLabelText("Natural-language requirement"), "Score risk");
    await userEvent.click(screen.getByRole("button", { name: "Generate candidates" }));

    await waitFor(() => expect(createTurn).toHaveBeenCalledWith(SESSION_ID, expect.objectContaining({ candidate_count: 3 })));
  });

  it("refuses to submit an empty requirement", () => {
    renderPanel();
    expect(screen.getByRole("button", { name: "Generate candidates" })).toBeDisabled();
  });

  it("surfaces a submission failure without losing the requirement box", async () => {
    createTurn.mockRejectedValue(new Error("The local API is unreachable. Is it running?"));
    renderPanel();

    await userEvent.type(screen.getByLabelText("Natural-language requirement"), "Score risk");
    await userEvent.click(screen.getByRole("button", { name: "Generate candidates" }));

    expect(await screen.findByText("The local API is unreachable. Is it running?")).toBeInTheDocument();
  });
});

describe("turn status", () => {
  it("prompts for a requirement when the session has no turn", async () => {
    renderPanel({ hasTurn: false });

    expect(await screen.findByText("No candidates yet")).toBeInTheDocument();
    expect(getTurn).not.toHaveBeenCalled();
  });

  it("shows in-flight generation", async () => {
    getTurn.mockResolvedValue(turn({ status: "running", candidates: [] }));
    renderPanel();

    expect(await screen.findByText("Generating 3 candidates…")).toBeInTheDocument();
  });

  it("keeps a failed turn visible and retryable", async () => {
    getTurn.mockResolvedValue(
      turn({ status: "failed", error: { code: "PROVIDER_FAILED", message: "connection reset" }, candidates: [] }),
    );
    renderPanel();

    expect(await screen.findByText("Generation failed")).toBeInTheDocument();
    expect(screen.getByText(/PROVIDER_FAILED/)).toBeInTheDocument();
    expect(screen.getByText(/stays on the record/)).toBeInTheDocument();
    // Retry is submitting again, which appends a new turn.
    expect(screen.getByRole("button", { name: "Generate candidates" })).toBeInTheDocument();
  });
});

describe("requirement", () => {
  it("shows the requirement the turn answered", async () => {
    renderPanel();
    expect(await screen.findByText("Score risk")).toBeInTheDocument();
  });
});

describe("candidate rows", () => {
  it("shows lineage, admission state, explanation, and assumptions", async () => {
    renderPanel();

    expect(await screen.findByText("baseline_glucose")).toBeInTheDocument();
    expect(screen.getByText("admitted")).toBeInTheDocument();
    expect(screen.getByText("v1 · generated")).toBeInTheDocument();
    expect(screen.getByText("Uses baseline fasting plasma glucose alone as the score.")).toBeInTheDocument();
    expect(screen.getByText("A higher baseline fasting plasma glucose indicates higher risk.")).toBeInTheDocument();
  });

  it("selects an admitted version", async () => {
    const { onSelectVersion } = renderPanel();

    await userEvent.click(await screen.findByText("baseline_glucose"));

    expect(onSelectVersion).toHaveBeenCalledWith("v-1");
  });

  it("shows the first blocking diagnostic and refuses selection for a blocked version", async () => {
    getTurn.mockResolvedValue(
      turn({
        candidates: [
          candidate({
            proposal_id: "proposal_invented_signal",
            versions: [
              version({
                admission_state: "blocked",
                ast_hash: null,
                first_diagnostic: {
                  code: "UNKNOWN_SIGNAL",
                  path: "$.root.args[0].id",
                  message: "Signal “fasting_glucose_mgdl” is not declared.",
                },
              }),
            ],
          }),
        ],
      }),
    );
    const { onSelectVersion } = renderPanel();

    expect(await screen.findByText("UNKNOWN_SIGNAL")).toBeInTheDocument();
    expect(screen.getByText(/fasting_glucose_mgdl/)).toBeInTheDocument();
    expect(screen.getByText("blocked")).toBeInTheDocument();

    await userEvent.click(screen.getByText("invented_signal"));
    expect(onSelectVersion).not.toHaveBeenCalled();
  });

  it("shows the newest version of a repaired lineage and marks it repaired", async () => {
    getTurn.mockResolvedValue(
      turn({
        candidates: [
          candidate({
            versions: [
              version({ id: "v-1", admission_state: "blocked", ast_hash: null, first_diagnostic: { code: "UNKNOWN_SIGNAL", path: "$", message: "nope" } }),
              version({ id: "v-2", version_no: 2, source: "repair", parent_version_id: "v-1" }),
            ],
          }),
        ],
      }),
    );
    const { onSelectVersion } = renderPanel();

    expect(await screen.findAllByText("v2 · repair")).not.toHaveLength(0);
    expect(screen.getByText("repaired")).toBeInTheDocument();

    await userEvent.click(screen.getByText("Version history"));
    expect(screen.getByText("UNKNOWN_SIGNAL")).toBeInTheDocument();
    expect(screen.getByText(/nope/)).toBeInTheDocument();

    await userEvent.click(screen.getByText("baseline_glucose"));
    expect(onSelectVersion).toHaveBeenCalledWith("v-2");
  });

  it("identifies the provider and model behind a generated turn", async () => {
    renderPanel();
    expect(await screen.findByText("test-provider · test-model-v1")).toBeInTheDocument();
  });

  it("keeps every alternative selectable, not only the first", async () => {
    getTurn.mockResolvedValue(
      turn({
        candidates: [
          candidate(),
          candidate({ id: "c-2", proposal_id: "proposal_glucose_bmi", ordinal: 2, versions: [version({ id: "v-9" })] }),
        ],
      }),
    );
    const { onSelectVersion } = renderPanel();

    await userEvent.click(await screen.findByText("glucose_bmi"));
    expect(onSelectVersion).toHaveBeenCalledWith("v-9");
  });

  it("marks the selected candidate", async () => {
    renderPanel({ selectedVersionId: "v-1" });

    const row = (await screen.findByText("baseline_glucose")).closest("button")!;
    expect(row).toHaveAttribute("aria-pressed", "true");
  });
});
