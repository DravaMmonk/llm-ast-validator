/**
 * The provider boundary (plan Section 10, Batch 3 Step 7).
 *
 * The server always constructs the request constraints itself: the closed
 * vocabulary, the AST schema version, the numeric-score output contract, and the
 * safety limits. A browser payload can only supply the requirement text and the
 * candidate count, so it can never weaken these.
 *
 * A real LLM adapter implements this interface and nothing more. No credentials
 * or model SDK belong here.
 */

import type { Diagnostic } from "../../shared/ast/core";
import { AST_VERSION, MAX_DEPTH, MAX_NODE_COUNT } from "../../shared/ast/core";
import type { OperatorId, SignalId } from "../../shared/ast/registry";
import {
  LITERAL_MAX,
  LITERAL_MIN,
  OPERATORS,
  REGISTRY_VERSION,
  SIGNALS,
  registryHash,
} from "../../shared/ast/registry";

export interface GenerationRequest {
  requirement: string;
  candidate_count: number;
  ast_schema_version: string;
  registry_version: string;
  registry_hash: string;
  /** The formula must emit one finite numeric score per cohort row. */
  output_contract: "numeric_score";
  vocabulary: {
    signals: readonly SignalId[];
    operators: readonly OperatorId[];
  };
  limits: {
    max_node_count: number;
    max_depth: number;
    literal_min: number;
    literal_max: number;
  };
}

export interface ProviderProposal {
  proposal_id: string;
  /** Exact provider payload, retained verbatim even when admission fails. */
  content: unknown;
  explanation?: string;
  assumptions?: string[];
}

export interface ProviderResult {
  proposals: ProviderProposal[];
  /** The raw envelope, stored bounded and hashed. */
  raw: unknown;
}

export interface Generator {
  readonly id: string;
  readonly model: string;
  readonly prompt_version: string;
  generate(request: GenerationRequest): Promise<ProviderResult>;
  repair(
    request: GenerationRequest,
    proposal: ProviderProposal,
    diagnostics: readonly Diagnostic[],
  ): Promise<ProviderProposal>;
}

/**
 * Builds the constraints the server imposes on every provider call. Only
 * `requirement` and `candidate_count` come from the caller.
 */
export function buildGenerationRequest(
  requirement: string,
  candidateCount: number,
): GenerationRequest {
  return {
    requirement,
    candidate_count: candidateCount,
    ast_schema_version: AST_VERSION,
    registry_version: REGISTRY_VERSION,
    registry_hash: registryHash(),
    output_contract: "numeric_score",
    vocabulary: {
      signals: SIGNALS.map((signal) => signal.id),
      operators: OPERATORS.map((operator) => operator.id),
    },
    limits: {
      max_node_count: MAX_NODE_COUNT,
      max_depth: MAX_DEPTH,
      literal_min: LITERAL_MIN,
      literal_max: LITERAL_MAX,
    },
  };
}

export class ProviderTransportError extends Error {
  constructor(
    message: string,
    readonly code = "PROVIDER_FAILED",
  ) {
    super(message);
    this.name = "ProviderTransportError";
  }
}
