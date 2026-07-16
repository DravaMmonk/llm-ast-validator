/**
 * The formula-bar text contract (plan Section 7.4).
 *
 * A domain adapter, not a shared visual component: it turns the diabetes
 * operator vocabulary into text and back. `/` maps only to protected divide and
 * `plog` only to the protected natural log — there is no unprotected division
 * or log to parse into.
 *
 * Round trips are compared by canonical AST hash, never by whitespace or label.
 */

import { AST_VERSION, type AstDocument, type AstNode } from "../../shared/ast/core";
import type { OperatorId } from "../../shared/ast/registry";
import { LITERAL_MAX, LITERAL_MIN, findOperator, isSignalId } from "../../shared/ast/registry";

export class ExpressionError extends Error {
  constructor(
    message: string,
    readonly position: number,
  ) {
    super(message);
    this.name = "ExpressionError";
  }
}

type Token =
  | { kind: "number"; value: number; at: number }
  | { kind: "name"; value: string; at: number }
  | { kind: "punct"; value: "(" | ")" | "," | "+" | "-" | "*" | "/"; at: number };

const FUNCTIONS: Record<string, { op: OperatorId; arity: number }> = {
  abs: { op: "abs", arity: 1 },
  plog: { op: "plog", arity: 1 },
  min: { op: "min", arity: 2 },
  max: { op: "max", arity: 2 },
  clamp: { op: "clamp", arity: 3 },
};

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const char = input[i];
    if (/\s/.test(char)) {
      i += 1;
      continue;
    }
    if ("()+-*/,".includes(char)) {
      tokens.push({ kind: "punct", value: char as Token["value"] & string, at: i } as Token);
      i += 1;
      continue;
    }
    // Decimal literals only; no exponent form in the authoring surface.
    if (/[0-9.]/.test(char)) {
      const start = i;
      while (i < input.length && /[0-9.]/.test(input[i])) i += 1;
      const text = input.slice(start, i);
      const value = Number(text);
      if (!Number.isFinite(value)) throw new ExpressionError(`“${text}” is not a number.`, start);
      tokens.push({ kind: "number", value, at: start });
      continue;
    }
    if (/[a-zA-Z_]/.test(char)) {
      const start = i;
      while (i < input.length && /[a-zA-Z0-9_]/.test(input[i])) i += 1;
      tokens.push({ kind: "name", value: input.slice(start, i), at: start });
      continue;
    }
    throw new ExpressionError(`Unexpected character “${char}”.`, i);
  }
  return tokens;
}

/**
 * Recursive descent over the documented precedence: parentheses and functions
 * bind first, then multiply/divide, then add/subtract, all left-associative.
 */
function parseExpression(tokens: Token[], input: string): AstNode {
  let position = 0;

  const peek = (): Token | undefined => tokens[position];
  const endOf = () => (position > 0 ? (tokens[position - 1]?.at ?? 0) + 1 : 0);

  const expect = (value: string): Token => {
    const token = peek();
    if (!token || token.kind !== "punct" || token.value !== value) {
      throw new ExpressionError(`Expected “${value}”.`, token?.at ?? endOf());
    }
    position += 1;
    return token;
  };

  const parsePrimary = (): AstNode => {
    const token = peek();
    if (!token) throw new ExpressionError("Unexpected end of formula.", endOf());

    if (token.kind === "punct" && token.value === "(") {
      position += 1;
      const inner = parseAdditive();
      expect(")");
      return inner;
    }

    // Unary minus is folded into a negated literal or a subtraction from zero.
    if (token.kind === "punct" && token.value === "-") {
      position += 1;
      const operand = parsePrimary();
      if (operand.node_type === "literal") return { node_type: "literal", value: -operand.value };
      return { node_type: "call", op: "subtract", args: [{ node_type: "literal", value: 0 }, operand] };
    }

    if (token.kind === "number") {
      position += 1;
      if (token.value < LITERAL_MIN || token.value > LITERAL_MAX) {
        throw new ExpressionError(`Literal must lie within [${LITERAL_MIN}, ${LITERAL_MAX}].`, token.at);
      }
      return { node_type: "literal", value: token.value };
    }

    if (token.kind === "name") {
      position += 1;
      const next = peek();
      const isCall = next && next.kind === "punct" && next.value === "(";

      if (isCall) {
        const fn = FUNCTIONS[token.value];
        if (!fn) throw new ExpressionError(`Unknown function “${token.value}”.`, token.at);
        expect("(");
        const args: AstNode[] = [parseAdditive()];
        while (peek()?.kind === "punct" && (peek() as { value: string }).value === ",") {
          position += 1;
          args.push(parseAdditive());
        }
        expect(")");
        if (args.length !== fn.arity) {
          throw new ExpressionError(
            `“${token.value}” expects ${fn.arity} argument(s); received ${args.length}.`,
            token.at,
          );
        }
        return { node_type: "call", op: fn.op, args };
      }

      if (!isSignalId(token.value)) {
        throw new ExpressionError(`Unknown signal “${token.value}”.`, token.at);
      }
      return { node_type: "ref", ref_type: "signal", id: token.value };
    }

    throw new ExpressionError("Unexpected token.", token.at);
  };

  const parseMultiplicative = (): AstNode => {
    let left = parsePrimary();
    for (;;) {
      const token = peek();
      if (!token || token.kind !== "punct" || (token.value !== "*" && token.value !== "/")) return left;
      position += 1;
      const op: OperatorId = token.value === "*" ? "multiply" : "divide";
      left = { node_type: "call", op, args: [left, parsePrimary()] };
    }
  };

  const parseAdditive = (): AstNode => {
    let left = parseMultiplicative();
    for (;;) {
      const token = peek();
      if (!token || token.kind !== "punct" || (token.value !== "+" && token.value !== "-")) return left;
      position += 1;
      const op: OperatorId = token.value === "+" ? "add" : "subtract";
      left = { node_type: "call", op, args: [left, parseMultiplicative()] };
    }
  };

  const root = parseAdditive();
  const trailing = peek();
  if (trailing) throw new ExpressionError("Unexpected trailing input.", trailing.at);
  return root;
}

/** Parses formula text into an AST document. Admission still happens server-side. */
export function parseFormula(input: string): AstDocument {
  const text = input.trim();
  if (text === "") throw new ExpressionError("Formula is empty.", 0);
  return { ast_version: AST_VERSION, root: parseExpression(tokenize(text), text) };
}

function precedenceOf(node: AstNode): number {
  if (node.node_type !== "call") return 4;
  return findOperator(node.op)!.text.precedence;
}

/** Prints an AST as text, parenthesizing only where precedence requires it. */
export function printFormula(document: AstDocument): string {
  const render = (node: AstNode): string => {
    if (node.node_type === "literal") return String(node.value);
    if (node.node_type === "ref") return node.id;

    const record = findOperator(node.op)!;
    if (record.text.form === "function") {
      return `${record.text.token}(${node.args.map(render).join(", ")})`;
    }

    const [left, right] = node.args;
    const self = record.text.precedence;
    // The right operand of a left-associative operator needs parentheses at
    // equal precedence too: a - (b - c) is not a - b - c.
    const leftText = precedenceOf(left) < self ? `(${render(left)})` : render(left);
    const rightText = precedenceOf(right) <= self ? `(${render(right)})` : render(right);
    return `${leftText} ${record.text.token} ${rightText}`;
  };

  return render(document.root);
}
