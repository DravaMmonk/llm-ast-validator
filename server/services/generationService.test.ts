import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PROVIDER_ENVELOPE_MAX_BYTES } from "../../shared/contracts";
import { openDatabase } from "../db/connection";
import { migrate } from "../db/migrate";
import { findTurnDetail, findTurnRow } from "../db/stores/candidates";
import { insertSession } from "../db/stores/sessions";
import type { Generator, GenerationRequest, ProviderProposal, ProviderResult } from "../generation/generator";
import { FixtureGenerator } from "../../test-support/fixtureGenerator";
import { createTurn, deriveSessionTitle, executeTurn } from "./generationService";

type Database = ReturnType<typeof openDatabase>;

let directory: string;
let database: Database;
const generator = new FixtureGenerator();

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "research-generation-"));
  database = openDatabase(join(directory, "test.db"));
  migrate(database);
});

afterEach(() => {
  database.close();
  rmSync(directory, { recursive: true, force: true });
});

function seedSession(title = "Untitled session"): string {
  const session = insertSession(database, {
    id: crypto.randomUUID(),
    title,
    now: new Date().toISOString(),
  });
  return session.id;
}

async function runTurn(sessionId: string, body: Record<string, unknown>, provider: Generator = generator) {
  const created = createTurn(database, sessionId, body, provider);
  await executeTurn(database, created.turn_id, provider);
  return findTurnDetail(database, created.turn_id)!;
}

class StubGenerator implements Generator {
  readonly id = "stub";
  readonly model = "stub-v1";
  readonly prompt_version = "stub-prompt-v1";
  constructor(
    private readonly result: () => Promise<ProviderResult>,
    private readonly repairResult?: (proposal: ProviderProposal) => Promise<ProviderProposal>,
  ) {}
  async generate(): Promise<ProviderResult> {
    return this.result();
  }
  async repair(_request: GenerationRequest, proposal: ProviderProposal): Promise<ProviderProposal> {
    if (!this.repairResult) throw new Error("no repair configured");
    return this.repairResult(proposal);
  }
}

describe("deriveSessionTitle", () => {
  it("uses the first 60 normalized characters", () => {
    expect(deriveSessionTitle("  Score   diabetes\n\nrisk  ")).toBe("Score diabetes risk");
    expect(deriveSessionTitle("x".repeat(80))).toBe("x".repeat(60));
  });

  it("is deterministic and needs no model call", () => {
    expect(deriveSessionTitle("Rank fasting glucose")).toBe(deriveSessionTitle("Rank fasting glucose"));
  });
});

describe("createTurn", () => {
  it("persists the turn as pending before any provider work", () => {
    const sessionId = seedSession();
    const created = createTurn(database, sessionId, { requirement: "Score risk" }, generator);

    expect(created.status).toBe("pending");
    const row = findTurnRow(database, created.turn_id)!;
    expect(row.status).toBe("pending");
    expect(row.provider).toBe("test-fixture");
    expect(row.finished_at).toBeNull();
  });

  it("derives a title for an unnamed session on its first turn", () => {
    const sessionId = seedSession();
    createTurn(database, sessionId, { requirement: "Score incident diabetes risk" }, generator);

    const session = database.prepare("SELECT title, current_requirement FROM sessions WHERE id = ?").get(sessionId) as {
      title: string;
      current_requirement: string;
    };
    expect(session.title).toBe("Score incident diabetes risk");
    expect(session.current_requirement).toBe("Score incident diabetes risk");
  });

  it("never overwrites a title the user chose", () => {
    const sessionId = seedSession("My named session");
    createTurn(database, sessionId, { requirement: "Score risk" }, generator);

    const session = database.prepare("SELECT title FROM sessions WHERE id = ?").get(sessionId) as { title: string };
    expect(session.title).toBe("My named session");
  });

  it("does not retitle on a later turn", () => {
    const sessionId = seedSession();
    createTurn(database, sessionId, { requirement: "First requirement" }, generator);
    createTurn(database, sessionId, { requirement: "Second requirement" }, generator);

    const session = database.prepare("SELECT title FROM sessions WHERE id = ?").get(sessionId) as { title: string };
    expect(session.title).toBe("First requirement");
  });

  it("assigns increasing ordinals within a session", () => {
    const sessionId = seedSession();
    const first = createTurn(database, sessionId, { requirement: "One" }, generator);
    const second = createTurn(database, sessionId, { requirement: "Two" }, generator);

    expect(findTurnRow(database, first.turn_id)!.ordinal).toBe(1);
    expect(findTurnRow(database, second.turn_id)!.ordinal).toBe(2);
  });

  it("rejects an unknown session", () => {
    expect(() => createTurn(database, "missing", { requirement: "Score" }, generator)).toThrow(
      /does not exist/,
    );
  });

  it("validates the requirement and candidate count", () => {
    const sessionId = seedSession();
    expect(() => createTurn(database, sessionId, { requirement: "  " }, generator)).toThrow();
    expect(() => createTurn(database, sessionId, { requirement: "x".repeat(4001) }, generator)).toThrow();
    expect(() => createTurn(database, sessionId, { requirement: 5 }, generator)).toThrow();
    expect(() =>
      createTurn(database, sessionId, { requirement: "ok", candidate_count: 1 }, generator),
    ).toThrow();
    expect(() =>
      createTurn(database, sessionId, { requirement: "ok", candidate_count: 6 }, generator),
    ).toThrow();
    expect(() =>
      createTurn(database, sessionId, { requirement: "ok", candidate_count: 2.5 }, generator),
    ).toThrow();
  });
});

describe("executeTurn — multi-candidate persistence", () => {
  it("stores one lineage per proposal, not only the first passing one", async () => {
    const detail = await runTurn(seedSession(), { requirement: "Score risk", candidate_count: 3 });

    expect(detail.status).toBe("completed");
    expect(detail.candidates).toHaveLength(3);
    expect(detail.candidates.map((candidate) => candidate.ordinal)).toEqual([1, 2, 3]);
  });

  it("honours the requested candidate count", async () => {
    const detail = await runTurn(seedSession(), { requirement: "Score risk", candidate_count: 5 });
    expect(detail.candidates).toHaveLength(5);
  });

  it("defaults to three candidates", async () => {
    const detail = await runTurn(seedSession(), { requirement: "Score risk" });
    expect(detail.candidate_count).toBe(3);
    expect(detail.candidates).toHaveLength(3);
  });

  it("admits valid proposals with a canonical AST hash", async () => {
    const detail = await runTurn(seedSession(), { requirement: "Score risk" });
    const first = detail.candidates[0].versions[0];

    expect(first.source).toBe("generated");
    expect(first.version_no).toBe(1);
    expect(first.admission_state).toBe("admitted");
    expect(first.ast_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(first.parent_version_id).toBeNull();
  });

  it("keeps the generated explanation and assumptions beside the candidate, not in the AST", async () => {
    const detail = await runTurn(seedSession(), { requirement: "Score risk" });
    const version = detail.candidates[0].versions[0];

    expect(version.explanation).toContain("baseline fasting plasma glucose");
    expect(version.assumptions.length).toBeGreaterThan(0);

    const stored = database
      .prepare("SELECT ast_json FROM candidate_versions WHERE id = ?")
      .get(version.id) as { ast_json: string };
    expect(stored.ast_json).not.toContain("explanation");
    expect(stored.ast_json).not.toContain("assumption");
  });

  it("repairs an unknown-signal proposal into an admitted child version", async () => {
    const detail = await runTurn(seedSession(), { requirement: "Score risk", candidate_count: 3 });
    const invented = detail.candidates.find((c) => c.proposal_id === "proposal_invented_signal")!;

    expect(invented.versions).toHaveLength(2);
    const [generated, repaired] = invented.versions;

    expect(generated.source).toBe("generated");
    expect(generated.admission_state).toBe("blocked");
    expect(generated.first_diagnostic?.code).toBe("UNKNOWN_SIGNAL");
    expect(generated.ast_hash).toBeNull();

    expect(repaired.source).toBe("repair");
    expect(repaired.version_no).toBe(2);
    expect(repaired.parent_version_id).toBe(generated.id);
    expect(repaired.admission_state).toBe("admitted");
  });

  it("retains the exact blocked payload for audit", async () => {
    const detail = await runTurn(seedSession(), { requirement: "Score risk", candidate_count: 3 });
    const invented = detail.candidates.find((c) => c.proposal_id === "proposal_invented_signal")!;

    const stored = database
      .prepare("SELECT content_json FROM candidate_versions WHERE id = ?")
      .get(invented.versions[0].id) as { content_json: string };
    expect(stored.content_json).toContain("fasting_glucose_mgdl");
  });

  it("stores the bounded raw envelope and its hash on completion", async () => {
    const sessionId = seedSession();
    const created = createTurn(database, sessionId, { requirement: "Score risk" }, generator);
    await executeTurn(database, created.turn_id, generator);

    const row = database
      .prepare("SELECT provider_response_json, response_hash FROM session_turns WHERE id = ?")
      .get(created.turn_id) as { provider_response_json: string; response_hash: string };
    expect(row.response_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.parse(row.provider_response_json)).toMatchObject({ provider: "test-fixture" });
  });

  it("is deterministic across runs", async () => {
    const first = await runTurn(seedSession(), { requirement: "Score risk" });
    const second = await runTurn(seedSession(), { requirement: "Score risk" });

    expect(first.candidates.map((c) => c.versions[0].ast_hash)).toEqual(
      second.candidates.map((c) => c.versions[0].ast_hash),
    );
  });
});

describe("executeTurn — malformed and failing providers", () => {
  it("records a provider transport failure as a durable retryable turn", async () => {
    const failing = new StubGenerator(async () => {
      throw new Error("connection reset");
    });
    const detail = await runTurn(seedSession(), { requirement: "Score risk" }, failing);

    expect(detail.status).toBe("failed");
    expect(detail.error?.code).toBe("PROVIDER_FAILED");
    expect(detail.finished_at).not.toBeNull();
    expect(detail.candidates).toEqual([]);
  });

  it("fails a turn whose provider returns no proposals", async () => {
    const empty = new StubGenerator(async () => ({ proposals: [], raw: { ok: true } }));
    const detail = await runTurn(seedSession(), { requirement: "Score risk" }, empty);

    expect(detail.status).toBe("failed");
    expect(detail.error?.code).toBe("PROVIDER_MALFORMED");
  });

  it("blocks a malformed AST payload but still stores it", async () => {
    const malformed = new StubGenerator(async () => ({
      proposals: [{ proposal_id: "p1", content: { ast_version: "1.0", root: "not-a-node" } }],
      raw: {},
    }));
    const detail = await runTurn(seedSession(), { requirement: "Score risk" }, malformed);

    expect(detail.status).toBe("completed");
    expect(detail.candidates[0].versions[0].admission_state).toBe("blocked");
    expect(detail.candidates[0].versions[0].first_diagnostic?.code).toBe("NODE_NOT_OBJECT");
  });

  it("blocks a proposal that references the outcome label", async () => {
    const leaking = new StubGenerator(async () => ({
      proposals: [
        {
          proposal_id: "p_leak",
          content: {
            ast_version: "1.0",
            root: { node_type: "ref", ref_type: "signal", id: "incident_diabetes" },
          },
        },
      ],
      raw: {},
    }));
    const detail = await runTurn(seedSession(), { requirement: "Cheat", candidate_count: 2 }, leaking);

    expect(detail.candidates[0].versions[0].admission_state).toBe("blocked");
    expect(detail.candidates[0].versions[0].first_diagnostic?.code).toBe("OUTCOME_REFERENCE_FORBIDDEN");
  });

  it("keeps the blocked generated version when repair itself fails", async () => {
    const unrepairable = new StubGenerator(async () => ({
      proposals: [{ proposal_id: "p1", content: { ast_version: "1.0", root: { node_type: "ref", ref_type: "signal", id: "nope" } } }],
      raw: {},
    }));
    const detail = await runTurn(seedSession(), { requirement: "Score risk" }, unrepairable);

    expect(detail.status).toBe("completed");
    expect(detail.candidates[0].versions).toHaveLength(1);
    expect(detail.candidates[0].versions[0].admission_state).toBe("blocked");
  });

  it("stores a blocked repair as a child version when the repair is also invalid", async () => {
    const stillBad = new StubGenerator(
      async () => ({
        proposals: [{ proposal_id: "p1", content: { ast_version: "1.0", root: { node_type: "ref", ref_type: "signal", id: "nope" } } }],
        raw: {},
      }),
      async (proposal) => ({
        ...proposal,
        content: { ast_version: "1.0", root: { node_type: "ref", ref_type: "signal", id: "still_nope" } },
      }),
    );
    const detail = await runTurn(seedSession(), { requirement: "Score risk" }, stillBad);

    expect(detail.candidates[0].versions).toHaveLength(2);
    expect(detail.candidates[0].versions[1].source).toBe("repair");
    expect(detail.candidates[0].versions[1].admission_state).toBe("blocked");
  });

  it("attempts at most one repair per proposal", async () => {
    let repairs = 0;
    const counting = new StubGenerator(
      async () => ({
        proposals: [{ proposal_id: "p1", content: { ast_version: "1.0", root: { node_type: "ref", ref_type: "signal", id: "nope" } } }],
        raw: {},
      }),
      async (proposal) => {
        repairs += 1;
        return { ...proposal, content: { ast_version: "1.0", root: { node_type: "ref", ref_type: "signal", id: "nope2" } } };
      },
    );
    await runTurn(seedSession(), { requirement: "Score risk" }, counting);
    expect(repairs).toBe(1);
  });

  it("rejects an oversized envelope without storing a truncated pseudo-candidate", async () => {
    const huge = new StubGenerator(async () => ({
      proposals: [{ proposal_id: "p1", content: { ast_version: "1.0", root: { node_type: "literal", value: 1 } } }],
      raw: { blob: "x".repeat(PROVIDER_ENVELOPE_MAX_BYTES + 1_000) },
    }));
    const sessionId = seedSession();
    const created = createTurn(database, sessionId, { requirement: "Score risk" }, huge);
    await executeTurn(database, created.turn_id, huge);

    const detail = findTurnDetail(database, created.turn_id)!;
    expect(detail.status).toBe("failed");
    expect(detail.error?.code).toBe("PROVIDER_RESPONSE_TOO_LARGE");
    expect(detail.candidates).toEqual([]);

    const row = database
      .prepare("SELECT provider_response_json, response_hash FROM session_turns WHERE id = ?")
      .get(created.turn_id) as { provider_response_json: string; response_hash: string };
    const stored = JSON.parse(row.provider_response_json) as Record<string, unknown>;
    expect(Object.keys(stored).sort()).toEqual(["byte_length", "sha256"]);
    expect(stored.sha256).toBe(row.response_hash);
    expect(row.provider_response_json).not.toContain("xxxx");
  });

  it("synthesizes ids and disambiguates duplicates so a lineage is never lost", async () => {
    const duplicating = new StubGenerator(async () => ({
      proposals: [
        { proposal_id: "dupe", content: { ast_version: "1.0", root: { node_type: "literal", value: 1 } } },
        { proposal_id: "dupe", content: { ast_version: "1.0", root: { node_type: "literal", value: 2 } } },
        { content: { ast_version: "1.0", root: { node_type: "literal", value: 3 } } } as never,
      ],
      raw: {},
    }));
    const detail = await runTurn(seedSession(), { requirement: "Score risk" }, duplicating);

    expect(detail.candidates).toHaveLength(3);
    expect(new Set(detail.candidates.map((c) => c.proposal_id)).size).toBe(3);
  });

  it("does not run a turn twice", async () => {
    const sessionId = seedSession();
    const created = createTurn(database, sessionId, { requirement: "Score risk" }, generator);
    await executeTurn(database, created.turn_id, generator);
    await executeTurn(database, created.turn_id, generator);

    expect(findTurnDetail(database, created.turn_id)!.candidates).toHaveLength(3);
  });
});

describe("executeTurn — append-only retry", () => {
  it("retries as a new turn without rewriting the failed record", async () => {
    const sessionId = seedSession();
    const failing = new StubGenerator(async () => {
      throw new Error("provider down");
    });

    const failed = createTurn(database, sessionId, { requirement: "Score risk" }, failing);
    await executeTurn(database, failed.turn_id, failing);

    const retried = createTurn(database, sessionId, { requirement: "Score risk" }, generator);
    await executeTurn(database, retried.turn_id, generator);

    const failedDetail = findTurnDetail(database, failed.turn_id)!;
    const retriedDetail = findTurnDetail(database, retried.turn_id)!;

    expect(failedDetail.status).toBe("failed");
    expect(failedDetail.error?.code).toBe("PROVIDER_FAILED");
    expect(retriedDetail.status).toBe("completed");
    expect(retriedDetail.ordinal).toBe(2);
    expect(retriedDetail.candidates.length).toBeGreaterThan(0);
  });
});
