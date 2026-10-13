/**
 * The text twin of the workbench expression language.
 *
 *   or  <  and  <  not  <  comparisons  <  + -  <  * /  <  unary -  <  ^
 *
 * Comparisons do not chain (`a < b < c` is an error — write `between`), `^` is
 * right-associative, and `-2 ^ 2` is `-(2 ^ 2)` as in mathematics. Column names
 * that are not plain identifiers are written in backticks: `Systolic BP`.
 * Friendly aliases are accepted on input (`=`, `≥`, `≤`, `≠`, `&&`, `||`, `!`)
 * and printed back in the canonical spelling.
 *
 * `printExpr(parseExpr(text))` is canonical text; `parseExpr(printExpr(node))`
 * reproduces `node` exactly — the round trip is tested by hash.
 */

import { normalizeZero } from "../ast/canonical";
import { E, type ExprNode, type ExprOp, PREC, findFunctionOp, findOp } from "./expr";

export class ExprSyntaxError extends Error {
  constructor(
    message: string,
    readonly position: number,
  ) {
    super(message);
    this.name = "ExprSyntaxError";
  }
}

const KEYWORDS = new Set(["and", "or", "not", "true", "false"]);
const PLAIN_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

type Token =
  | { t: "num"; v: number; at: number }
  | { t: "str"; v: string; at: number }
  | { t: "ident"; v: string; quoted: boolean; at: number }
  | { t: "op"; v: string; at: number }
  | { t: "end"; at: number };

const SYMBOLS: [string, string][] = [
  ["<=", "<="],
  [">=", ">="],
  ["==", "=="],
  ["!=", "!="],
  ["<>", "!="],
  ["&&", "and"],
  ["||", "or"],
  ["≤", "<="],
  ["≥", ">="],
  ["≠", "!="],
  ["×", "*"],
  ["÷", "/"],
  ["−", "-"],
  ["=", "=="],
  ["<", "<"],
  [">", ">"],
  ["!", "not"],
  ["+", "+"],
  ["-", "-"],
  ["*", "*"],
  ["/", "/"],
  ["^", "^"],
  ["(", "("],
  [")", ")"],
  [",", ","],
];

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const char = input[i];
    if (/\s/.test(char)) {
      i += 1;
      continue;
    }
    const at = i;

    if (/[0-9]/.test(char) || (char === "." && /[0-9]/.test(input[i + 1] ?? ""))) {
      const match = /^(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?/.exec(input.slice(i))!;
      const value = Number(match[0]);
      if (!Number.isFinite(value)) throw new ExprSyntaxError(`“${match[0]}” is not a finite number.`, at);
      tokens.push({ t: "num", v: value, at });
      i += match[0].length;
      if (/[A-Za-z_]/.test(input[i] ?? "")) {
        throw new ExprSyntaxError(`A number cannot run into a name here — add an operator after ${match[0]}.`, i);
      }
      continue;
    }

    if (char === '"' || char === "'") {
      let value = "";
      i += 1;
      for (;;) {
        if (i >= input.length) throw new ExprSyntaxError("Text is missing its closing quote.", at);
        const next = input[i];
        if (next === "\\") {
          const escaped = input[i + 1];
          if (escaped === undefined) throw new ExprSyntaxError("Text ends with a lone backslash.", i);
          value += escaped;
          i += 2;
          continue;
        }
        if (next === char) {
          i += 1;
          break;
        }
        value += next;
        i += 1;
      }
      tokens.push({ t: "str", v: value, at });
      continue;
    }

    if (char === "`") {
      let value = "";
      i += 1;
      for (;;) {
        if (i >= input.length) throw new ExprSyntaxError("Column name is missing its closing backtick.", at);
        if (input[i] === "`") {
          if (input[i + 1] === "`") {
            value += "`";
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        value += input[i];
        i += 1;
      }
      if (value.trim() === "") throw new ExprSyntaxError("A quoted column name cannot be empty.", at);
      tokens.push({ t: "ident", v: value, quoted: true, at });
      continue;
    }

    if (/[A-Za-z_]/.test(char)) {
      const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(input.slice(i))!;
      const word = match[0];
      const lower = word.toLowerCase();
      if (lower === "and" || lower === "or" || lower === "not") tokens.push({ t: "op", v: lower, at });
      else tokens.push({ t: "ident", v: word, quoted: false, at });
      i += word.length;
      continue;
    }

    const symbol = SYMBOLS.find(([text]) => input.startsWith(text, i));
    if (!symbol) throw new ExprSyntaxError(`Unexpected character “${char}”.`, at);
    tokens.push({ t: "op", v: symbol[1], at });
    i += symbol[0].length;
  }
  tokens.push({ t: "end", at: input.length });
  return tokens;
}

const BINARY: Record<string, { op: ExprOp; prec: number; assoc: "left" | "right" | "none" }> = {
  or: { op: "or", prec: PREC.or, assoc: "left" },
  and: { op: "and", prec: PREC.and, assoc: "left" },
  "<": { op: "lt", prec: PREC.compare, assoc: "none" },
  "<=": { op: "le", prec: PREC.compare, assoc: "none" },
  ">": { op: "gt", prec: PREC.compare, assoc: "none" },
  ">=": { op: "ge", prec: PREC.compare, assoc: "none" },
  "==": { op: "eq", prec: PREC.compare, assoc: "none" },
  "!=": { op: "ne", prec: PREC.compare, assoc: "none" },
  "+": { op: "add", prec: PREC.additive, assoc: "left" },
  "-": { op: "sub", prec: PREC.additive, assoc: "left" },
  "*": { op: "mul", prec: PREC.multiplicative, assoc: "left" },
  "/": { op: "div", prec: PREC.multiplicative, assoc: "left" },
  "^": { op: "pow", prec: PREC.power, assoc: "right" },
};

/** Parses formula text into an expression tree. Throws `ExprSyntaxError`. */
export function parseExpr(input: string): ExprNode {
  if (input.trim() === "") throw new ExprSyntaxError("The formula is empty.", 0);
  const tokens = tokenize(input);
  let position = 0;
  const peek = () => tokens[position];
  const next = () => tokens[position++];

  const expectOp = (value: string, context: string) => {
    const token = next();
    if (token.t !== "op" || token.v !== value) {
      throw new ExprSyntaxError(`Expected “${value}” ${context}.`, token.at);
    }
  };

  const parseBinary = (minPrec: number): ExprNode => {
    let left = parsePrefix();
    for (;;) {
      const token = peek();
      if (token.t !== "op") break;
      const binary = BINARY[token.v];
      if (!binary || binary.prec < minPrec) break;
      next();
      const nextMin = binary.assoc === "right" ? binary.prec : binary.prec + 1;
      // The exponent may carry its own sign: 2 ^ -1.
      const right = binary.op === "pow" ? parseUnaryOperand(nextMin) : parseBinary(nextMin);
      left = E.call(binary.op, left, right);
      if (binary.assoc === "none") {
        const after = peek();
        if (after.t === "op" && BINARY[after.v]?.prec === PREC.compare) {
          throw new ExprSyntaxError("Comparisons cannot be chained — use between(x, low, high) or “and”.", after.at);
        }
      }
    }
    return left;
  };

  const parseUnaryOperand = (minPrec: number): ExprNode => {
    const token = peek();
    if (token.t === "op" && token.v === "-") {
      next();
      return negate(parseUnaryOperand(minPrec));
    }
    return parseBinary(minPrec);
  };

  const parsePrefix = (): ExprNode => {
    const token = peek();
    if (token.t === "op" && token.v === "not") {
      next();
      return E.call("not", parseBinary(PREC.not));
    }
    if (token.t === "op" && token.v === "-") {
      next();
      return negate(parseBinary(PREC.unary));
    }
    if (token.t === "op" && token.v === "+") {
      next();
      return parseBinary(PREC.unary);
    }
    return parsePrimary();
  };

  const parsePrimary = (): ExprNode => {
    const token = next();
    if (token.t === "num") return E.num(token.v);
    if (token.t === "str") return E.text(token.v);
    if (token.t === "op" && token.v === "(") {
      const inner = parseBinary(PREC.or);
      expectOp(")", "to close the parenthesis");
      return inner;
    }
    if (token.t === "ident") {
      const following = peek();
      if (!token.quoted && following.t === "op" && following.v === "(") {
        return parseCall(token.v, token.at);
      }
      if (!token.quoted) {
        const lower = token.v.toLowerCase();
        if (lower === "true") return E.bool(true);
        if (lower === "false") return E.bool(false);
      }
      return E.col(token.v);
    }
    if (token.t === "end") throw new ExprSyntaxError("The formula ends too early.", token.at);
    throw new ExprSyntaxError(`Unexpected “${token.v}”.`, token.at);
  };

  const parseCall = (name: string, at: number): ExprNode => {
    const spec = findFunctionOp(name.toLowerCase());
    if (!spec) throw new ExprSyntaxError(`Unknown function “${name}”.`, at);
    expectOp("(", `after ${name}`);
    const args: ExprNode[] = [];
    const close = peek();
    if (!(close.t === "op" && close.v === ")")) {
      for (;;) {
        args.push(parseBinary(PREC.or));
        const separator = next();
        if (separator.t === "op" && separator.v === ",") continue;
        if (separator.t === "op" && separator.v === ")") break;
        throw new ExprSyntaxError(`Expected “,” or “)” in ${name}(…).`, separator.at);
      }
    } else {
      next();
    }
    // round(x) is shorthand for round(x, 0).
    if (spec.id === "round" && args.length === 1) args.push(E.num(0));
    if (args.length !== spec.params.length) {
      throw new ExprSyntaxError(`${name} takes ${spec.params.length} argument(s); got ${args.length}.`, at);
    }
    return E.call(spec.id, ...args);
  };

  const root = parseBinary(PREC.or);
  const tail = peek();
  if (tail.t !== "end") {
    throw new ExprSyntaxError(
      tail.t === "op" && tail.v === ")" ? "There is an unmatched “)”." : "Unexpected text after the formula.",
      tail.at,
    );
  }
  return root;
}

/** A negated literal folds into the literal, so `-5` is one number node. */
function negate(node: ExprNode): ExprNode {
  if (node.k === "num") return E.num(-node.v);
  return E.call("neg", node);
}

/* ------------------------------------------------------------------ */
/* Printing                                                            */
/* ------------------------------------------------------------------ */

export function formatColumnName(name: string): string {
  return PLAIN_IDENTIFIER.test(name) && !KEYWORDS.has(name.toLowerCase()) && !findFunctionLike(name)
    ? name
    : `\`${name.replace(/`/g, "``")}\``;
}

/** A bare identifier equal to a function name still parses as a column when not called, but quoting reads clearer. */
function findFunctionLike(name: string): boolean {
  return findFunctionOp(name.toLowerCase()) !== undefined;
}

export function formatNumber(value: number): string {
  const normalized = normalizeZero(value);
  return String(normalized);
}

function quoteText(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Binding power of a printed node, for deciding where parentheses go. */
function precedenceOf(node: ExprNode): number {
  if (node.k === "num") return node.v < 0 ? PREC.unary : Infinity;
  if (node.k !== "call") return Infinity;
  const spec = findOp(node.op)!;
  if (spec.text.kind === "function") return Infinity;
  return spec.text.prec;
}

/** Canonical text for an expression tree. */
export function printExpr(node: ExprNode): string {
  switch (node.k) {
    case "num":
      return formatNumber(node.v);
    case "text":
      return quoteText(node.v);
    case "bool":
      return node.v ? "true" : "false";
    case "col":
      return formatColumnName(node.name);
    case "call": {
      const spec = findOp(node.op)!;
      const text = spec.text;
      if (text.kind === "function") {
        return `${text.name}(${node.args.map(printExpr).join(", ")})`;
      }
      if (text.kind === "prefix") {
        const operand = node.args[0];
        const inner = printExpr(operand);
        const wrap =
          precedenceOf(operand) < text.prec ||
          (operand.k === "num" && operand.v < 0) ||
          // -(2 ^ 2) reads unambiguously; -2 ^ 2 would be parsed the same but misread.
          (text.token === "-" && operand.k === "call" && operand.op === "pow");
        const body = wrap ? `(${inner})` : inner;
        return text.token === "not" ? `not ${body}` : `-${body}`;
      }
      const [left, right] = node.args;
      const leftPrec = precedenceOf(left);
      const rightPrec = precedenceOf(right);
      const wrapLeft =
        leftPrec < text.prec ||
        (leftPrec === text.prec && text.assoc !== "left") ||
        // (-2) ^ 2 differs from -2 ^ 2.
        (text.token === "^" && leftPrec === PREC.unary);
      const wrapRight =
        (rightPrec < text.prec && !(text.token === "^" && rightPrec === PREC.unary)) ||
        (rightPrec === text.prec && text.assoc !== "right");
      const l = wrapLeft ? `(${printExpr(left)})` : printExpr(left);
      const r = wrapRight ? `(${printExpr(right)})` : printExpr(right);
      return `${l} ${text.token} ${r}`;
    }
  }
}

/** Parses, or returns the error with a caret-friendly position. */
export function tryParseExpr(input: string): { node: ExprNode; error: null } | { node: null; error: ExprSyntaxError } {
  try {
    return { node: parseExpr(input), error: null };
  } catch (error) {
    if (error instanceof ExprSyntaxError) return { node: null, error };
    throw error;
  }
}
