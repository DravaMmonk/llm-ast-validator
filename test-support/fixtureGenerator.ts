/** Test-only Generator used by unit and browser tests. Never selected by server runtime configuration. */

import type {
  Generator,
  GenerationRequest,
  ProviderProposal,
  ProviderResult,
} from "../server/generation/generator";

const literal = (value: number) => ({ node_type: "literal", value });
const signal = (id: string) => ({ node_type: "ref", ref_type: "signal", id });
const call = (op: string, ...args: unknown[]) => ({ node_type: "call", op, args });
const document = (root: unknown) => ({ ast_version: "1.0", root });

const PROPOSALS: ProviderProposal[] = [
  {
    proposal_id: "proposal_baseline_glucose",
    content: document(signal("baseline_fasting_plasma_glucose")),
    explanation: "Uses baseline fasting plasma glucose alone as the score.",
    assumptions: ["Higher baseline fasting plasma glucose indicates higher score."],
  },
  {
    proposal_id: "proposal_glucose_bmi",
    content: document(call("add", signal("baseline_fasting_plasma_glucose"), call("multiply", literal(0.1), signal("bmi")))),
    explanation: "Adds a small body-mass term to the baseline glucose score.",
    assumptions: ["Weights are illustrative."],
  },
  {
    proposal_id: "proposal_invented_signal",
    content: document(call("add", signal("fasting_glucose_mgdl"), call("multiply", literal(0.1), signal("bmi")))),
    explanation: "Exercises the blocked output and repair path.",
    assumptions: ["The initial signal is intentionally unavailable."],
  },
  {
    proposal_id: "proposal_weighted_sum",
    content: document(call("add", signal("baseline_fasting_plasma_glucose"), call("multiply", literal(0.01), signal("age")))),
    explanation: "Combines glucose and age.",
    assumptions: ["Weights are illustrative."],
  },
  {
    proposal_id: "proposal_lipid_ratio",
    content: document(call("add", signal("baseline_fasting_plasma_glucose"), call("divide", signal("triglycerides"), signal("hdl_cholesterol")))),
    explanation: "Adds a protected lipid ratio.",
    assumptions: ["Protected division handles a near-zero denominator."],
  },
];

export class FixtureGenerator implements Generator {
  readonly id = "test-fixture";
  readonly model = "fixture-v1";
  readonly prompt_version = "fixture-prompt-v1";

  async generate(request: GenerationRequest): Promise<ProviderResult> {
    const proposals = PROPOSALS.slice(0, request.candidate_count);
    return { proposals, raw: { provider: this.id, model: this.model, proposals } };
  }

  async repair(
    _request: GenerationRequest,
    proposal: ProviderProposal,
  ): Promise<ProviderProposal> {
    return {
      ...proposal,
      content: document(call("add", signal("baseline_fasting_plasma_glucose"), call("multiply", literal(0.1), signal("bmi")))),
      explanation: "Repaired with signals from the closed vocabulary.",
      assumptions: ["The unavailable signal was replaced for test coverage."],
    };
  }
}
