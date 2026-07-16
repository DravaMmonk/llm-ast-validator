/**
 * KaTeX presentation for the diabetes formula vocabulary.
 *
 * This mirrors both admitted AST documents and in-progress Blockly state. The
 * latter deliberately renders empty sockets as `\\square`: Blockly may emit
 * incomplete trees while a user is editing, and presentation must remain total
 * while structural validation reports the unfinished input.
 */

import type { AstDocument, AstNode } from "../../shared/ast/core";
import { OPERATORS, SIGNALS, type OperatorId } from "../../shared/ast/registry";
import { LITERAL_BLOCK, argInputName, type BlockState } from "./diabetesBlocklyAdapter";

const SIGNAL_BY_BLOCK = new Map(SIGNALS.map((signal) => [signal.blockly.type, signal.id]));
const OPERATOR_BY_BLOCK = new Map(OPERATORS.map((operator) => [operator.blockly.type, operator.id]));

const escapeLatex = (value: string | number): string =>
  String(value).replace(/\\/g, "\\textbackslash{}").replace(/([#$%&_{}])/g, "\\$1");

type LatexTemplate = (args: readonly string[]) => string;

const OPERATOR_LATEX: Record<OperatorId, LatexTemplate> = {
  add: ([left, right]) => `\\left(${left} + ${right}\\right)`,
  subtract: ([left, right]) => `\\left(${left} - ${right}\\right)`,
  multiply: ([left, right]) => `${left} \\times ${right}`,
  divide: ([numerator, denominator]) => `\\frac{${numerator}}{${denominator}}`,
  abs: ([value]) => `\\left|${value}\\right|`,
  plog: ([value]) => `\\operatorname{plog}\\left(${value}\\right)`,
  min: ([left, right]) => `\\min\\left(${left},\\,${right}\\right)`,
  max: ([left, right]) => `\\max\\left(${left},\\,${right}\\right)`,
  clamp: ([value, lower, upper]) =>
    `\\operatorname{clamp}\\left(${value},\\,${lower},\\,${upper}\\right)`,
};

function formatNode(node: AstNode | null | undefined): string {
  if (!node) return "\\square";
  if (node.node_type === "literal") return escapeLatex(node.value);
  if (node.node_type === "ref") return `\\mathsf{${escapeLatex(node.id)}}`;
  return OPERATOR_LATEX[node.op](node.args.map(formatNode));
}

/** Render an admitted AST document. */
export function formatFormulaLatex(document: AstDocument | null | undefined): string {
  return formatNode(document?.root);
}

/** Render live Blockly state, including incomplete operator sockets. */
export function formatBlockLatex(block: BlockState | null | undefined): string {
  if (!block) return "\\square";
  if (block.type === LITERAL_BLOCK) {
    const value = block.fields?.VALUE;
    return value === undefined ? "\\square" : escapeLatex(value);
  }

  const signal = SIGNAL_BY_BLOCK.get(block.type);
  if (signal) return `\\mathsf{${escapeLatex(signal)}}`;

  const operator = OPERATOR_BY_BLOCK.get(block.type);
  if (!operator) return "\\square";
  const record = OPERATORS.find((entry) => entry.id === operator)!;
  const args = Array.from({ length: record.arity }, (_, index) =>
    formatBlockLatex(block.inputs?.[argInputName(index)]?.block),
  );
  return OPERATOR_LATEX[operator](args);
}
