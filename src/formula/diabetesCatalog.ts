/**
 * The diabetes signal/operator catalog for the library rail.
 *
 * A domain adapter (plan Section 6.2): it projects the shared registry into the
 * data the library UI needs. The registry stays the single source — this file
 * must not invent an operator or restate its semantics.
 */

import { OPERATORS, SIGNALS, type OperatorRecord, type SignalRecord } from "../../shared/ast/registry";
import { LITERAL_BLOCK } from "./diabetesBlocklyAdapter";

export type CatalogCategory = "signal" | "operator" | "protected" | "value";

/** Dot/tint per category — matches the hue family of the canvas blocks
 *  (signals 210, operators 265, protected 38, values 140). */
export function categoryColor(category: CatalogCategory): string {
  switch (category) {
    case "signal":
      return "var(--info)";
    case "operator":
      return "var(--accent2)";
    case "protected":
      return "var(--warn)";
    case "value":
      return "var(--risk-low)";
  }
}

export interface CatalogEntry {
  id: string;
  label: string;
  detail: string;
  category: CatalogCategory;
  /** Short tag shown at the row's right edge (unit or text token). */
  tag: string;
  /** Text inserted into the formula bar by a quick insert. */
  snippet: string;
  /** The canvas block this entry creates on click or drag. */
  insert: { blockType: string; fields?: Record<string, string | number> };
}

export interface CatalogGroup {
  key: string;
  label: string;
  entries: CatalogEntry[];
}

function signalEntry(signal: SignalRecord): CatalogEntry {
  return {
    id: signal.id,
    label: signal.label,
    detail: `${signal.unit} — ${signal.summary}`,
    category: "signal",
    tag: signal.unit,
    snippet: signal.id,
    insert: { blockType: signal.blockly.type },
  };
}

function operatorEntry(operator: OperatorRecord): CatalogEntry {
  const snippet =
    operator.text.form === "function"
      ? `${operator.text.token}(${Array.from({ length: operator.arity }, () => "…").join(", ")})`
      : `… ${operator.text.token} …`;
  return {
    id: operator.id,
    label: operator.display.label,
    detail: operator.protected ? `${operator.display.summary} — ${operator.semantics}` : operator.display.summary,
    category: operator.protected ? "protected" : "operator",
    tag: operator.text.token,
    snippet,
    insert: { blockType: operator.blockly.type },
  };
}

const LITERAL_ENTRY: CatalogEntry = {
  id: "literal",
  label: "Number",
  detail: "A finite numeric constant, e.g. a weight or a threshold.",
  category: "value",
  tag: "0.0",
  snippet: "0",
  insert: { blockType: LITERAL_BLOCK, fields: { VALUE: 0 } },
};

/** Baseline predictors, operators, and values, grouped for the library rail. */
export function catalogGroups(): CatalogGroup[] {
  return [
    { key: "signals", label: "Baseline signals", entries: SIGNALS.map(signalEntry) },
    {
      key: "arithmetic",
      label: "Arithmetic",
      entries: OPERATORS.filter((operator) => !operator.protected && operator.text.form === "infix").map(operatorEntry),
    },
    {
      key: "functions",
      label: "Functions",
      entries: OPERATORS.filter((operator) => !operator.protected && operator.text.form === "function").map(
        operatorEntry,
      ),
    },
    {
      key: "protected",
      label: "Protected",
      entries: OPERATORS.filter((operator) => operator.protected).map(operatorEntry),
    },
    { key: "values", label: "Values", entries: [LITERAL_ENTRY] },
  ];
}

export function searchCatalog(query: string): CatalogEntry[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [];
  return catalogGroups()
    .flatMap((group) => group.entries)
    .filter((entry) => `${entry.id} ${entry.label} ${entry.detail}`.toLowerCase().includes(needle));
}
