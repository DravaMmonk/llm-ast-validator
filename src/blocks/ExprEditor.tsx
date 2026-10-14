/**
 * The puzzle formula editor: live LaTeX twin, Blockly canvas, and an editable
 * text bar — three views of one expression. The canvas is the source of truth
 * while you snap pieces; the text bar is the source of truth when you press
 * Enter. Every change is type-checked against the dataset schema, and the
 * first problem is shown on the canvas in plain words.
 */

import { useEffect, useRef, useState } from "react";
import { Redo2, Undo2, LayoutTemplate, Crosshair } from "lucide-react";

import {
  type ExprNode,
  type SchemaLookup,
  TYPE_LABEL,
  type ValueType,
  checkExpr,
  hashExpr,
} from "../../shared/workbench/expr";
import { type PartialExpr, exprToLatex } from "../../shared/workbench/exprLatex";
import { printExpr, tryParseExpr } from "../../shared/workbench/exprText";
import { FormulaPreview } from "../formula/FormulaPreview";
import { inputCls } from "../shared-console/src";
import { useTheme } from "../workstation/preferences";
import { useWbCanvas, type WbCanvasApi } from "./useWbCanvas";
import { type BlockState, PuzzleError, blockToExpr, blockToPartial, exprToBlock } from "./wbAdapter";
import { setColumnDescriber } from "./wbBlocks";

export interface ExprStatus {
  expr: ExprNode | null;
  type: ValueType | null;
  problem: string | null;
}

export function describeTypeProblem(actual: ValueType, expected: ValueType): string {
  return `This formula gives ${TYPE_LABEL[actual]}, but ${expected === "boolean" ? "a yes/no condition" : `a ${TYPE_LABEL[expected]}`} is needed here.`;
}

/** Validates a finished expression against a schema and the expected type. */
/** Adds the fix clinicians usually need: conditions become points through if(). */
export function explainDiagnostic(message: string): string {
  if (/expects number here, not yes\/no/.test(message)) return `${message} Turn a condition into points with if(condition, 1, 0).`;
  if (/expects yes\/no here, not number/.test(message)) return `${message} Compare it first, e.g. age >= 65.`;
  return message;
}

export function statusOf(expr: ExprNode, schema: SchemaLookup, expected?: ValueType): ExprStatus {
  const checked = checkExpr(expr, schema);
  if (checked.diagnostics.length > 0) return { expr, type: null, problem: explainDiagnostic(checked.diagnostics[0].message) };
  if (expected && checked.type !== expected) return { expr, type: checked.type, problem: describeTypeProblem(checked.type!, expected) };
  return { expr, type: checked.type, problem: null };
}

export function ExprEditor(props: {
  /** Initial or externally replaced value; reloaded whenever `loadKey` changes. */
  value: ExprNode | null;
  loadKey: string | number;
  schema: SchemaLookup;
  describe: (name: string) => string;
  expected?: ValueType;
  onChange: (status: ExprStatus) => void;
  onCanvasApi?: (api: WbCanvasApi | null) => void;
  emptyHint?: string;
}) {
  const [theme] = useTheme();
  return <ExprEditorInner {...props} dark={theme === "dark"} />;
}

function ExprEditorInner({
  value,
  loadKey,
  schema,
  describe,
  expected,
  onChange,
  onCanvasApi,
  emptyHint = "Drag pieces from the library, or type a formula below and press Enter.",
  dark,
}: Parameters<typeof ExprEditor>[0] & { dark: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const [latex, setLatex] = useState(() => (value ? exprToLatex(value) : "\\square"));
  const [text, setText] = useState(() => (value ? printExpr(value) : ""));
  const [status, setStatus] = useState<ExprStatus>(() =>
    value ? statusOf(value, schema, expected) : { expr: null, type: null, problem: null },
  );
  const [empty, setEmpty] = useState(!value);
  const schemaRef = useRef(schema);
  schemaRef.current = schema;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const lastHash = useRef<string | null>(value ? hashExpr(value) : null);

  setColumnDescriber(describe);

  const publish = (next: ExprStatus) => {
    setStatus(next);
    onChangeRef.current(next);
  };

  const canvas = useWbCanvas(
    host,
    () => {
      const tops = canvas.tops();
      setEmpty(tops.length === 0);
      if (tops.length === 0) {
        setLatex("\\square");
        lastHash.current = null;
        publish({ expr: null, type: null, problem: null });
        return;
      }
      // Preview the largest assembly even while other pieces lie loose.
      const largest = [...tops].sort((a, b) => countBlocks(b) - countBlocks(a))[0];
      setLatex(tops.map((top) => exprToLatex(blockToPartial(top) as PartialExpr)).join("\\qquad"));
      if (tops.length > 1) {
        publish({ expr: null, type: null, problem: `${tops.length} separate assemblies — connect every piece into one formula.` });
        return;
      }
      try {
        const expr = blockToExpr(largest);
        setText(printExpr(expr));
        lastHash.current = hashExpr(expr);
        publish(statusOf(expr, schemaRef.current, expected));
      } catch (error) {
        publish({ expr: null, type: null, problem: error instanceof PuzzleError ? error.message : "The pieces do not form a formula yet." });
      }
    },
    { dark },
  );

  const typeOf = (name: string) => schemaRef.current(name);

  const loadExpr = (expr: ExprNode | null) => {
    let loaded = true;
    if (expr) {
      // A column whose type changed since saving no longer fits its socket;
      // untyped pieces always fit, and the type checker still names the problem.
      let primary: BlockState[] | null = null;
      try {
        primary = [exprToBlock(expr, typeOf)];
      } catch {
        primary = null;
      }
      loaded = canvas.load(primary ?? [], [exprToBlock(expr, () => undefined)]);
    } else {
      canvas.load([]);
    }
    setEmpty(!expr);
    setLatex(expr ? exprToLatex(expr) : "\\square");
    setText(expr ? printExpr(expr) : "");
    lastHash.current = expr ? hashExpr(expr) : null;
    const next = expr ? statusOf(expr, schemaRef.current, expected) : { expr: null, type: null, problem: null };
    publish(loaded ? next : { ...next, problem: "This formula could not be shown as pieces — edit it in the text bar below." });
  };

  useEffect(() => {
    onCanvasApi?.(canvas);
    return () => onCanvasApi?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the api object is stable
  }, []);

  useEffect(() => {
    loadExpr(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only on an explicit external replacement
  }, [loadKey]);

  // Column types can change (a kind conversion); recheck without reloading.
  useEffect(() => {
    if (status.expr) publish(statusOf(status.expr, schema, expected));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- schema identity drives the recheck
  }, [schema]);

  const applyText = (draft: string): string | null => {
    if (draft.trim() === "") {
      loadExpr(null);
      return null;
    }
    const parsed = tryParseExpr(draft);
    if (!parsed.node) return `${parsed.error.message} (at character ${parsed.error.position + 1})`;
    // A type error would leave pieces that cannot snap together; explain it in the bar instead.
    const mismatch = checkExpr(parsed.node, schemaRef.current).diagnostics.find((diagnostic) => diagnostic.code === "TYPE_MISMATCH" || diagnostic.code === "LIST_NOT_LITERAL");
    if (mismatch) return explainDiagnostic(mismatch.message);
    try {
      loadExpr(parsed.node);
    } catch (error) {
      return error instanceof Error ? error.message : "That formula cannot be shown as pieces.";
    }
    return null;
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <FormulaPreview latex={latex} />
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div ref={host} className="absolute inset-0" data-testid="puzzle-canvas" />
        <div className="absolute right-2.5 top-2.5 z-[5] flex items-center gap-0.5 rounded-lg border border-border bg-card p-0.5 shadow-sm">
          {(
            [
              { title: "Undo (⌘Z)", Icon: Undo2, run: canvas.undo },
              { title: "Redo (⇧⌘Z)", Icon: Redo2, run: canvas.redo },
              { title: "Tidy layout", Icon: LayoutTemplate, run: canvas.tidy },
              { title: "Centre on formula", Icon: Crosshair, run: canvas.center },
            ] as const
          ).map(({ title, Icon, run }) => (
            <button
              key={title}
              type="button"
              onClick={run}
              title={title}
              aria-label={title}
              className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-fg hover:bg-muted"
            >
              <Icon size={13} />
            </button>
          ))}
        </div>
        {empty && (
          <div className="pointer-events-none absolute inset-x-0 top-1/2 z-[4] mx-auto max-w-[360px] -translate-y-1/2 px-4 text-center text-body leading-relaxed text-muted-fg">
            {emptyHint}
          </div>
        )}
        {status.problem && (
          <div
            role="status"
            className="pointer-events-none absolute bottom-2.5 left-1/2 z-[5] max-w-[85%] -translate-x-1/2 rounded-full border border-border bg-card px-2.5 py-1 text-dense font-medium shadow-sm"
            style={{ color: "var(--bad)" }}
          >
            ⚠ {status.problem}
          </div>
        )}
        {!status.problem && status.type && (
          <div className="pointer-events-none absolute bottom-2.5 left-2.5 z-[5] rounded-full border border-border bg-card px-2 py-0.5 text-cap font-medium text-muted-fg shadow-sm">
            ✓ valid · gives {TYPE_LABEL[status.type]}
          </div>
        )}
      </div>
      <FxBar text={text} onApply={applyText} />
    </div>
  );
}

function countBlocks(state: { inputs?: Record<string, { block?: unknown }> }): number {
  let count = 1;
  for (const input of Object.values(state.inputs ?? {})) {
    if (input.block) count += countBlocks(input.block as typeof state);
  }
  return count;
}

/** The text twin: type a formula, Enter rebuilds the pieces, Esc discards the draft. */
export function FxBar({ text, onApply }: { text: string; onApply: (draft: string) => string | null }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const value = draft ?? text;
  return (
    <div className="flex flex-none flex-col gap-1 border-t border-border bg-card-2 px-[11px] py-2">
      <div className="flex items-center gap-1.5">
        <span className="ui-mono flex-none text-label font-semibold text-primary">fx</span>
        <input
          className={`${inputCls} ui-mono min-w-0 flex-1`}
          aria-label="Formula text"
          spellCheck={false}
          value={value}
          placeholder='e.g. weight_kg / (height_cm / 100) ^ 2   or   age >= 18 and sex == "F"'
          onChange={(event) => {
            setDraft(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              const failure = onApply(value);
              setError(failure);
              if (!failure) setDraft(null);
            } else if (event.key === "Escape") {
              setDraft(null);
              setError(null);
            }
          }}
          onBlur={() => {
            if (draft === text) setDraft(null);
          }}
          style={{ borderColor: error ? "var(--bad)" : draft !== null ? "var(--primary)" : undefined }}
          title="Type a formula — Enter rebuilds the pieces, Esc discards the draft."
        />
      </div>
      {error ? (
        <div className="pl-6 text-dense leading-snug" style={{ color: "var(--bad)" }}>
          ⚠ {error}
        </div>
      ) : draft !== null ? (
        <div className="pl-6 text-dense text-muted-fg">↵ apply to canvas · esc discard</div>
      ) : null}
    </div>
  );
}
