import type OpenAI from "openai";
import { describe, expect, it, vi } from "vitest";

import { buildGenerationRequest, ProviderTransportError } from "./generator";
import { generatorFromEnvironment, OpenAIGenerator } from "./openaiGenerator";

const proposal = (id: string) => ({
  proposal_id: id,
  content: {
    ast_version: "1.0",
    root: { node_type: "ref", ref_type: "signal", id: "baseline_fasting_plasma_glucose" },
  },
  explanation: "Uses baseline glucose.",
  assumptions: [],
});

function clientWith(output: unknown) {
  const create = vi.fn().mockResolvedValue({
    id: "resp_test",
    model: "test-model",
    output_text: typeof output === "string" ? output : JSON.stringify(output),
  });
  return { client: { responses: { create } } as unknown as OpenAI, create };
}

describe("generatorFromEnvironment", () => {
  it("returns no generator unless both server-side values exist", () => {
    expect(generatorFromEnvironment({})).toBeUndefined();
    expect(generatorFromEnvironment({ OPENAI_API_KEY: "key" })).toBeUndefined();
    expect(generatorFromEnvironment({ OPENAI_MODEL: "model" })).toBeUndefined();
  });

  it("creates the sole production adapter from complete configuration", () => {
    const generator = generatorFromEnvironment({ OPENAI_API_KEY: "key", OPENAI_MODEL: "model" });
    expect(generator).toMatchObject({ id: "openai", model: "model" });
  });
});

describe("OpenAIGenerator", () => {
  it("requests strict structured candidates without storing provider state", async () => {
    const { client, create } = clientWith({ proposals: [proposal("p1"), proposal("p2")] });
    const generator = new OpenAIGenerator("test-model", "key", client);
    const request = buildGenerationRequest("Score risk", 2);

    const result = await generator.generate(request);

    expect(result.proposals.map((entry) => entry.proposal_id)).toEqual(["p1", "p2"]);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "test-model",
        store: false,
        text: { format: expect.objectContaining({ type: "json_schema", strict: true }) },
      }),
    );
    const payload = create.mock.calls[0][0] as { input: { content: string }[] };
    expect(payload.input[0].content).toContain("Allowed signals");
    expect(payload.input[0].content).not.toContain("incident_diabetes");
  });

  it("uses one bounded structured request for repair", async () => {
    const repaired = proposal("different-id");
    const { client, create } = clientWith({ proposals: [repaired] });
    const generator = new OpenAIGenerator("test-model", "key", client);
    const request = buildGenerationRequest("Score risk", 3);

    const result = await generator.repair(request, proposal("original-id"), [
      { phase: "vocabulary", code: "UNKNOWN_SIGNAL", path: "$.root.id", message: "Unknown." },
    ]);

    expect(result.proposal_id).toBe("original-id");
    const payload = create.mock.calls[0][0] as { text: { format: { schema: { properties: { proposals: { maxItems: number } } } } } };
    expect(payload.text.format.schema.properties.proposals.maxItems).toBe(1);
  });

  it("sanitizes malformed or failed provider responses", async () => {
    const malformed = clientWith("not-json");
    const generator = new OpenAIGenerator("test-model", "key", malformed.client);

    await expect(generator.generate(buildGenerationRequest("Score risk", 2))).rejects.toMatchObject({
      code: "PROVIDER_MALFORMED",
    } satisfies Partial<ProviderTransportError>);

    const create = vi.fn().mockRejectedValue(new Error("secret upstream detail"));
    const failed = new OpenAIGenerator(
      "test-model",
      "key",
      { responses: { create } } as unknown as OpenAI,
    );
    await expect(failed.generate(buildGenerationRequest("Score risk", 2))).rejects.toThrow(
      "The configured LLM request failed.",
    );
  });
});
