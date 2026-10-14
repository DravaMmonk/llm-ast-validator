/**
 * Plain-English descriptions of conditions, for flow diagrams and labels when
 * the user did not write one: `is_missing(ldl)` reads “ldl missing”,
 * `between(age, 30, 75)` reads “age 30–75”. Anything unusual falls back to the
 * canonical formula text.
 */

import type { ExprNode } from "./expr";
import { splitList } from "./expr";
import { formatNumber, printExpr } from "./exprText";

const SYMBOL: Record<string, string> = { lt: "<", le: "≤", gt: ">", ge: "≥", eq: "=", ne: "≠" };

function term(node: ExprNode): string {
  if (node.k === "col") return node.name;
  if (node.k === "num") return formatNumber(node.v);
  if (node.k === "text") return node.v;
  if (node.k === "bool") return node.v ? "yes" : "no";
  return printExpr(node);
}

export function describeExpr(node: ExprNode): string {
  if (node.k !== "call") return term(node);
  const [a, b, c] = node.args;
  switch (node.op) {
    case "lt":
    case "le":
    case "gt":
    case "ge":
    case "eq":
    case "ne":
      if (b.k === "bool" && a.k === "col") return node.op === "eq" ? (b.v ? a.name : `not ${a.name}`) : b.v ? `not ${a.name}` : a.name;
      return `${term(a)} ${SYMBOL[node.op]} ${term(b)}`;
    case "between":
      return `${term(a)} ${term(b)}–${term(c)}`;
    case "is_missing":
      return `${term(a)} missing`;
    case "not":
      if (a.k === "call" && a.op === "is_missing") return `${term(a.args[0])} recorded`;
      return `not (${describeExpr(a)})`;
    case "one_of":
      return b.k === "text" ? `${term(a)} is ${splitList(b.v).join(" or ")}` : printExpr(node);
    case "and":
      return `${describeExpr(a)} and ${describeExpr(b)}`;
    case "or":
      return `${describeExpr(a)} or ${describeExpr(b)}`;
    default:
      return printExpr(node);
  }
}
