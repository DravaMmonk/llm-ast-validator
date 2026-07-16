import { describe, expect, it } from "vitest";

import { admit, hashDocument, type AstDocument } from "../../shared/ast/core";
import { OPERATORS, SIGNALS } from "../../shared/ast/registry";
import {
  BlockConversionError,
  LITERAL_BLOCK,
  blockDefinitions,
  blockToDocument,
  documentToBlock,
  toolboxDefinition,
} from "./diabetesBlocklyAdapter";
import { parseFormula } from "./diabetesExpressionAdapter";

function admitted(text: string): AstDocument {
  const result = admit(parseFormula(text));
  expect(result.report.diagnostics, JSON.stringify(result.report.diagnostics)).toEqual([]);
  return result.document!;
}

/** AST → blocks → AST, compared by canonical hash (Section 7.4). */
function roundTrips(text: string): void {
  const document = admitted(text);
  const back = blockToDocument(documentToBlock(document));
  expect(hashDocument(back), `round trip of: ${text}`).toBe(hashDocument(document));
}

describe("blockDefinitions", () => {
  it("defines one block per signal, one per operator, plus the literal", () => {
    expect(blockDefinitions()).toHaveLength(SIGNALS.length + OPERATORS.length + 1);
  });

  it("gives every operator block one input per argument", () => {
    const definitions = new Map(blockDefinitions().map((definition) => [definition.type, definition]));
    for (const operator of OPERATORS) {
      const definition = definitions.get(operator.blockly.type)!;
      expect(definition.args0, operator.id).toHaveLength(operator.arity);
      expect(definition.args0.every((arg) => arg.type === "input_value"), operator.id).toBe(true);
      expect(definition.inputsInline, operator.id).toBe(true);
    }
  });

  it("surfaces the protected fallback in the tooltip", () => {
    const definitions = new Map(blockDefinitions().map((d) => [d.type, d]));
    expect(definitions.get("diabetes_op_divide")!.tooltip).toContain("Protected division");
    expect(definitions.get("diabetes_op_plog")!.tooltip).toContain("Protected natural log");
  });

  it("has no block for the outcome label", () => {
    const types = blockDefinitions().map((definition) => definition.type);
    expect(types).not.toContain("diabetes_signal_incident_diabetes");
    expect(types.some((type) => type.includes("followup"))).toBe(false);
  });

  it("emits every block type in the toolbox", () => {
    const toolboxTypes = toolboxDefinition()
      .contents.flatMap((category) => category.contents)
      .map((entry) => entry.type);
    expect(toolboxTypes.sort()).toEqual(blockDefinitions().map((d) => d.type).sort());
  });
});

describe("AST → block → AST round trip", () => {
  it("round-trips a literal", () => {
    roundTrips("0.85");
    roundTrips("-5");
  });

  it("round-trips every signal", () => {
    for (const signal of SIGNALS) roundTrips(signal.id);
  });

  it("round-trips every operator", () => {
    for (const text of [
      "age + bmi",
      "age - bmi",
      "age * 2",
      "age / bmi",
      "abs(age - bmi)",
      "plog(triglycerides)",
      "min(age, bmi)",
      "max(age, bmi)",
      "clamp(age, 0, 100)",
    ]) {
      roundTrips(text);
    }
  });

  it("round-trips a deeply nested formula", () => {
    roundTrips(
      "baseline_fasting_plasma_glucose + 0.1 * bmi + clamp(plog(triglycerides / hdl_cholesterol), 0, 5)",
    );
  });

  it("preserves argument order", () => {
    // subtract is not commutative: a swapped round trip must not hash equal.
    const left = blockToDocument(documentToBlock(admitted("age - bmi")));
    const right = admitted("bmi - age");
    expect(hashDocument(left)).not.toBe(hashDocument(right));
  });
});

describe("documentToBlock", () => {
  it("maps a literal to a value field", () => {
    expect(documentToBlock(admitted("42"))).toEqual({ type: LITERAL_BLOCK, fields: { VALUE: 42 } });
  });

  it("maps a signal to its registry block type", () => {
    expect(documentToBlock(admitted("age"))).toEqual({ type: "diabetes_signal_age" });
  });

  it("maps operator arguments to positional inputs", () => {
    expect(documentToBlock(admitted("age + bmi"))).toEqual({
      type: "diabetes_op_add",
      inputs: {
        ARG0: { block: { type: "diabetes_signal_age" } },
        ARG1: { block: { type: "diabetes_signal_bmi" } },
      },
    });
  });
});

describe("blockToDocument — invalid block shapes", () => {
  it("rejects an empty socket", () => {
    expect(() =>
      blockToDocument({ type: "diabetes_op_add", inputs: { ARG0: { block: { type: "diabetes_signal_age" } } } }),
    ).toThrow(/socket must be filled/);
  });

  it("rejects a block outside the vocabulary", () => {
    expect(() => blockToDocument({ type: "controls_if" })).toThrow(BlockConversionError);
    expect(() => blockToDocument({ type: "controls_if" })).toThrow(/not in the vocabulary/);
  });

  it("rejects a literal with no finite value", () => {
    expect(() => blockToDocument({ type: LITERAL_BLOCK, fields: { VALUE: "abc" } })).toThrow(/finite value/);
    expect(() => blockToDocument({ type: LITERAL_BLOCK })).toThrow(/finite value/);
  });

  it("rejects an undefined block", () => {
    expect(() => blockToDocument(undefined)).toThrow(BlockConversionError);
  });

  it("accepts a numeric field serialized as a string", () => {
    // Blockly field_number round-trips through XML as text.
    expect(blockToDocument({ type: LITERAL_BLOCK, fields: { VALUE: "2.5" } }).root).toEqual({
      node_type: "literal",
      value: 2.5,
    });
  });
});

describe("text and block adapters agree", () => {
  it("produces the same AST from text and from blocks", () => {
    const text = "clamp(age / bmi, 0, 10)";
    const fromText = admitted(text);
    const fromBlocks = blockToDocument(documentToBlock(fromText));
    expect(hashDocument(fromBlocks)).toBe(hashDocument(fromText));
  });
});
