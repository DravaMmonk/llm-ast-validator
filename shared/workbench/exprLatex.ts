/**
 * KaTeX presentation of workbench expressions. Total over partial trees: an
 * absent operand renders as an empty box, so the live preview never breaks
 * while a puzzle is half-assembled.
 */

import { type ExprNode, type ExprOp, PREC, findOp, splitList } from "./expr";

/**
 * Escapes text for KaTeX text mode in one pass. Characters with no text-mode
 * escape in KaTeX (\\ ~ ^) are replaced by look-alike Unicode glyphs.
 */
export function escapeLatex(value: string): string {
  return value.replace(/[\\~^#$%&_{}]/g, (char) => {
    if (char === "\\") return "∖";
    if (char === "~") return "∼";
    if (char === "^") return "ˆ";
    return `\\${char}`;
  });
}

const BOX = "\\square";

/** Partial nodes allow missing children while editing. */
export type PartialExpr =
  | ExprNode
  | { k: "call"; op: ExprOp; args: (PartialExpr | null)[] }
  | null;

function prec(node: PartialExpr): number {
  if (!node) return Infinity;
  if (node.k === "num") return node.v < 0 ? PREC.unary : Infinity;
  if (node.k !== "call") return Infinity;
  const spec = findOp(node.op)!;
  if (spec.text.kind === "function") return Infinity;
  // Fractions and powers render as their own visual group.
  if (node.op === "div") return Infinity;
  return spec.text.prec;
}

function wrap(latex: string): string {
  return `\\left(${latex}\\right)`;
}

const COMPARE_SYMBOL: Record<string, string> = {
  lt: "<",
  le: "\\le",
  gt: ">",
  ge: "\\ge",
  eq: "=",
  ne: "\\ne",
};

/** Renders a column name, using its display label when one is supplied. */
export type ColumnLabeler = (name: string) => string;

export function exprToLatex(node: PartialExpr, label: ColumnLabeler = (name) => name): string {
  const render = (current: PartialExpr): string => {
    if (!current) return BOX;
    switch (current.k) {
      case "num":
        return current.v === 0 || (Math.abs(current.v) >= 1e-4 && Math.abs(current.v) < 1e15)
          ? String(current.v)
          : current.v.toExponential().replace(/e([+-]?\d+)/, (_, exp) => `\\times 10^{${Number(exp)}}`);
      case "text":
        return `\\text{“${escapeLatex(current.v)}”}`;
      case "bool":
        return `\\textsf{${current.v ? "yes" : "no"}}`;
      case "col":
        return `\\textsf{${escapeLatex(label(current.name))}}`;
      case "call": {
        const spec = findOp(current.op)!;
        const args = current.args as PartialExpr[];
        const arg = (index: number, minPrec: number, strictly = false) => {
          const child = args[index] ?? null;
          const latex = render(child);
          const childPrec = prec(child);
          return childPrec < minPrec || (strictly && childPrec === minPrec) ? wrap(latex) : latex;
        };
        switch (current.op) {
          case "add":
            return `${arg(0, PREC.additive)} + ${arg(1, PREC.additive, true)}`;
          case "sub":
            return `${arg(0, PREC.additive)} - ${arg(1, PREC.additive, true)}`;
          case "mul":
            return `${arg(0, PREC.multiplicative)} \\times ${arg(1, PREC.multiplicative, true)}`;
          case "div":
            return `\\dfrac{${render(args[0] ?? null)}}{${render(args[1] ?? null)}}`;
          case "pow": {
            // Any operator-built base reads ambiguously under an exponent.
            const base = args[0] ?? null;
            const bracket =
              (base?.k === "call" && findOp(base.op)!.text.kind !== "function") || (base?.k === "num" && base.v < 0);
            return `{${bracket ? wrap(render(base)) : render(base)}}^{${render(args[1] ?? null)}}`;
          }
          case "neg":
            return `-${arg(0, PREC.unary)}`;
          case "abs":
            return `\\left|${render(args[0] ?? null)}\\right|`;
          case "sqrt":
            return `\\sqrt{${render(args[0] ?? null)}}`;
          case "ln":
            return `\\ln${wrap(render(args[0] ?? null))}`;
          case "log10":
            return `\\log_{10}${wrap(render(args[0] ?? null))}`;
          case "exp":
            return `e^{${render(args[0] ?? null)}}`;
          case "floor":
            return `\\left\\lfloor ${render(args[0] ?? null)} \\right\\rfloor`;
          case "ceil":
            return `\\left\\lceil ${render(args[0] ?? null)} \\right\\rceil`;
          case "lt":
          case "le":
          case "gt":
          case "ge":
          case "eq":
          case "ne":
            return `${arg(0, PREC.compare, true)} ${COMPARE_SYMBOL[current.op]} ${arg(1, PREC.compare, true)}`;
          case "and":
            return `${arg(0, PREC.and)} \\;\\land\\; ${arg(1, PREC.and, true)}`;
          case "or":
            return `${arg(0, PREC.or)} \\;\\lor\\; ${arg(1, PREC.or, true)}`;
          case "not":
            return `\\lnot ${arg(0, PREC.not)}`;
          case "if":
            return `\\begin{cases} ${render(args[1] ?? null)} & \\text{if } ${render(args[0] ?? null)} \\\\ ${render(
              args[2] ?? null,
            )} & \\text{otherwise} \\end{cases}`;
          case "between":
            return `${render(args[1] ?? null)} \\le ${arg(0, PREC.compare, true)} \\le ${render(args[2] ?? null)}`;
          case "one_of": {
            const list = args[1];
            const members =
              list && list.k === "text"
                ? splitList(list.v)
                    .map((entry) => `\\text{${escapeLatex(entry)}}`)
                    .join(",\\,")
                : render(list ?? null);
            return `${arg(0, PREC.compare, true)} \\in \\{${members}\\}`;
          }
          case "is_missing":
            return `\\operatorname{missing}${wrap(render(args[0] ?? null))}`;
          case "valid_if":
            return `${render(args[1] ?? null)}\\;\\big|\\; ${render(args[0] ?? null)}`;
          case "coalesce":
            return `\\operatorname{coalesce}${wrap(`${render(args[0] ?? null)},\\, ${render(args[1] ?? null)}`)}`;
          default: {
            const name = spec.text.kind === "function" ? spec.text.name : spec.id;
            return `\\operatorname{${name}}${wrap(args.map((child) => render(child)).join(",\\, "))}`;
          }
        }
      }
    }
  };
  return render(node);
}
