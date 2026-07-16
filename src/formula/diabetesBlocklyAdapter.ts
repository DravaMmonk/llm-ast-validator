/**
 * The diabetes Blockly adapter (plan Section 6.2).
 *
 * Domain logic, not a shared visual component: it defines one block per
 * registry entry and converts between the AST and Blockly's serialized block
 * state. The registry drives every definition, so the canvas, the validator,
 * the text bar, and the server evaluator cannot drift apart.
 *
 * Conversion is expressed over Blockly's plain serialization JSON rather than a
 * live workspace, which keeps it pure and testable without a DOM.
 */

import { AST_VERSION, type AstDocument, type AstNode } from "../../shared/ast/core";
import type { OperatorId, SignalId } from "../../shared/ast/registry";
import {
  LITERAL_MAX,
  LITERAL_MIN,
  OPERATORS,
  SIGNALS,
  findOperator,
  findSignal,
  isSignalId,
} from "../../shared/ast/registry";

export const LITERAL_BLOCK = "diabetes_literal";

/** Blockly's serialized block shape, narrowed to what this adapter emits. */
export interface BlockState {
  type: string;
  fields?: Record<string, string | number>;
  inputs?: Record<string, { block: BlockState }>;
}

export class BlockConversionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockConversionError";
  }
}

/** Argument input names are positional: ARG0, ARG1, ARG2. */
export function argInputName(index: number): string {
  return `ARG${index}`;
}

export interface BlockDefinition {
  type: string;
  message0: string;
  args0: { type: string; name: string; min?: number; max?: number }[];
  inputsInline?: boolean;
  output: string;
  colour: number;
  tooltip: string;
}

/**
 * One block definition per registry entry, plus the numeric literal. Generated
 * rather than hand-listed so a registry change cannot leave a stale block.
 */
export function blockDefinitions(): BlockDefinition[] {
  const literal: BlockDefinition = {
    type: LITERAL_BLOCK,
    message0: "%1",
    // The field enforces the admission range at entry time, so a value the
    // server would reject cannot even be typed into the canvas.
    args0: [{ type: "field_number", name: "VALUE", min: LITERAL_MIN, max: LITERAL_MAX }],
    output: "Number",
    colour: 140,
    tooltip: `A finite number within [${LITERAL_MIN}, ${LITERAL_MAX}].`,
  };

  const signals: BlockDefinition[] = SIGNALS.map((signal) => ({
    type: signal.blockly.type,
    message0: signal.blockly.message,
    args0: [],
    output: "Number",
    colour: signal.blockly.colour,
    tooltip: `${signal.label} (${signal.unit}) — ${signal.summary}`,
  }));

  const operators: BlockDefinition[] = OPERATORS.map((operator) => ({
    type: operator.blockly.type,
    message0: operator.blockly.message,
    args0: Array.from({ length: operator.arity }, (_, index) => ({
      type: "input_value",
      name: argInputName(index),
    })),
    // Formula operators read left-to-right. Force Blockly to keep every socket
    // on the same row, including the three-input clamp block.
    inputsInline: true,
    output: "Number",
    colour: operator.blockly.colour,
    tooltip: operator.protected ? `${operator.display.summary} — ${operator.semantics}` : operator.display.summary,
  }));

  return [literal, ...signals, ...operators];
}

const SIGNAL_BY_BLOCK = new Map<string, SignalId>(SIGNALS.map((signal) => [signal.blockly.type, signal.id]));
const OPERATOR_BY_BLOCK = new Map<string, OperatorId>(
  OPERATORS.map((operator) => [operator.blockly.type, operator.id]),
);

/** AST node → Blockly block state. */
export function nodeToBlock(node: AstNode): BlockState {
  if (node.node_type === "literal") {
    return { type: LITERAL_BLOCK, fields: { VALUE: node.value } };
  }
  if (node.node_type === "ref") {
    const signal = findSignal(node.id);
    if (!signal) throw new BlockConversionError(`Signal “${node.id}” has no block.`);
    return { type: signal.blockly.type };
  }

  const operator = findOperator(node.op);
  if (!operator) throw new BlockConversionError(`Operator “${node.op}” has no block.`);
  const inputs: Record<string, { block: BlockState }> = {};
  node.args.forEach((arg, index) => {
    inputs[argInputName(index)] = { block: nodeToBlock(arg) };
  });
  return { type: operator.blockly.type, inputs };
}

export function documentToBlock(document: AstDocument): BlockState {
  return nodeToBlock(document.root);
}

/** Blockly block state → AST node. Every failure names the block that caused it. */
export function blockToNode(block: BlockState | undefined): AstNode {
  if (!block || typeof block.type !== "string") {
    throw new BlockConversionError("An input is empty; every operator socket must be filled.");
  }

  if (block.type === LITERAL_BLOCK) {
    const raw = block.fields?.VALUE;
    const value = typeof raw === "string" ? Number(raw) : raw;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new BlockConversionError("A number block does not hold a finite value.");
    }
    return { node_type: "literal", value };
  }

  const signalId = SIGNAL_BY_BLOCK.get(block.type);
  if (signalId) {
    // Defensive: a hand-edited workspace could name a block that is no longer
    // in the registry.
    if (!isSignalId(signalId)) throw new BlockConversionError(`Signal “${signalId}” is not declared.`);
    return { node_type: "ref", ref_type: "signal", id: signalId };
  }

  const operatorId = OPERATOR_BY_BLOCK.get(block.type);
  if (!operatorId) throw new BlockConversionError(`Block “${block.type}” is not in the vocabulary.`);

  const operator = findOperator(operatorId)!;
  const args: AstNode[] = [];
  for (let index = 0; index < operator.arity; index += 1) {
    args.push(blockToNode(block.inputs?.[argInputName(index)]?.block));
  }
  return { node_type: "call", op: operatorId, args };
}

export function blockToDocument(block: BlockState | undefined): AstDocument {
  return { ast_version: AST_VERSION, root: blockToNode(block) };
}

/** The toolbox the canvas mounts, grouped like the library rail. */
export function toolboxDefinition(): {
  kind: "categoryToolbox";
  contents: { kind: "category"; name: string; colour: string; contents: { kind: "block"; type: string }[] }[];
} {
  return {
    kind: "categoryToolbox",
    contents: [
      {
        kind: "category",
        name: "Signals",
        colour: "210",
        contents: SIGNALS.map((signal) => ({ kind: "block" as const, type: signal.blockly.type })),
      },
      {
        kind: "category",
        name: "Operators",
        colour: "265",
        contents: OPERATORS.map((operator) => ({ kind: "block" as const, type: operator.blockly.type })),
      },
      {
        kind: "category",
        name: "Values",
        colour: "140",
        contents: [{ kind: "block" as const, type: LITERAL_BLOCK }],
      },
    ],
  };
}
