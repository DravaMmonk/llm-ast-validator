/**
 * Create or edit a derived variable: a named formula over the dataset's
 * columns, built from puzzle pieces or typed. The preview evaluates it on the
 * real rows before anything is saved.
 */

import { useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  type DerivedColumn,
  type Frame,
  type FrameColumn,
  displayValue,
  kindValueType,
} from "../../../shared/workbench/dataset";
import { type ExprNode, TYPE_LABEL, evaluateColumn, hashExpr, isValidColumnName } from "../../../shared/workbench/expr";
import { ExprEditor, type ExprStatus } from "../../blocks/ExprEditor";
import { PieceLibrary, MATH_PIECES, VALUE_PIECES, CONDITION_PIECES, columnGroups } from "../../blocks/PieceLibrary";
import type { WbCanvasApi } from "../../blocks/useWbCanvas";
import { ConfirmDialog, Modal, inputCls, pillBtn, primaryBtn, toast } from "../../shared-console/src";
import { errorMessage, wbApi } from "../../workstation/api";
import { queryKeys } from "../../workstation/data";
import { Callout, Field, fmt } from "../../workstation/ui";

export function DerivedDialog({
  frame,
  derived,
  editing,
  initialExpr,
  initialName,
  onClose,
}: {
  frame: Frame;
  /** The dataset's full derived list, in order. */
  derived: DerivedColumn[];
  /** The derived column being edited, or null to create one. */
  editing: DerivedColumn | null;
  initialExpr?: ExprNode | null;
  initialName?: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(editing?.name ?? initialName ?? "");
  const [label, setLabel] = useState(editing?.label && editing.label !== editing.name ? editing.label : "");
  const [unit, setUnit] = useState(editing?.unit ?? "");
  const [status, setStatus] = useState<ExprStatus>({ expr: editing?.expr ?? initialExpr ?? null, type: null, problem: null });
  const canvasApi = useRef<WbCanvasApi | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const initialHash = useRef(hashOrNull(editing?.expr ?? initialExpr ?? null));
  const dirty = name !== (editing?.name ?? initialName ?? "") || hashOrNull(status.expr) !== initialHash.current;
  const requestClose = () => (dirty && !save.isSuccess ? setConfirmClose(true) : onClose());

  // A formula may read source columns and derived columns defined before it.
  const editIndex = editing ? derived.findIndex((entry) => entry.name === editing.name) : derived.length;
  const visible = useMemo(() => {
    const earlier = new Set(derived.slice(0, editIndex).map((entry) => entry.name));
    return frame.columns.filter((column) => column.error === null && (!column.derived || earlier.has(column.name)));
  }, [frame, derived, editIndex]);
  const byName = useMemo(() => new Map<string, FrameColumn>(visible.map((column) => [column.name, column])), [visible]);
  const schema = useMemo(() => {
    const types = new Map(visible.map((column) => [column.name, kindValueType(column.kind)]));
    return (columnName: string) => types.get(columnName);
  }, [visible]);
  const describe = (columnName: string) => {
    const column = byName.get(columnName);
    return column ? `${column.label}${column.unit ? ` (${column.unit})` : ""}` : columnName;
  };

  const trimmed = name.trim();
  const nameProblem = (() => {
    if (trimmed === "") return "Give the variable a name.";
    if (!isValidColumnName(trimmed) || trimmed.length > 100) return "Names are 1–100 printable characters.";
    const clash = frame.columns.some(
      (column) => column.name.toLowerCase() === trimmed.toLowerCase() && column.name !== editing?.name,
    );
    return clash ? `A column named “${trimmed}” already exists.` : null;
  })();

  const preview = useMemo(() => {
    if (!status.expr || status.problem) return null;
    const values = evaluateColumn(status.expr, (columnName) => byName.get(columnName)?.values, frame.rowCount);
    const missing = values.filter((value) => value === null).length;
    const numbers = values.filter((value): value is number => typeof value === "number");
    const mean = numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : null;
    return { values, missing, mean, numbers: numbers.length };
  }, [status, byName, frame.rowCount]);

  const save = useMutation({
    mutationFn: () => {
      const entry: DerivedColumn = {
        name: trimmed,
        expr: status.expr!,
        label: label.trim() || trimmed,
        unit: unit.trim(),
        role: editing?.role ?? "none",
        description: editing?.description ?? "",
      };
      const next = editing ? derived.map((item) => (item.name === editing.name ? entry : item)) : [...derived, entry];
      return wbApi.patchDataset(frame.datasetId, { derived: next });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.dataset(frame.datasetId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.datasets() }),
      ]);
      toast(`${editing ? "Updated" : "Created"} derived variable · ${trimmed}`);
      onClose();
    },
  });

  const groups = useMemo(
    () => [
      ...columnGroups({ ...frame, columns: visible }),
      { key: "math", label: "Math", entries: MATH_PIECES },
      { key: "conditions", label: "Conditions", entries: CONDITION_PIECES },
      { key: "values", label: "Values", entries: VALUE_PIECES },
    ],
    [frame, visible],
  );

  return (
    <Modal title={editing ? `Edit derived variable · ${editing.name}` : "New derived variable"} onClose={requestClose} w={1080}>
      <div className="mt-3 grid grid-cols-[1fr_150px_110px] gap-2.5">
        <Field
          label="Name (used in formulas)"
          htmlFor="derived-name"
          hint={/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed) || trimmed === "" ? undefined : "Formulas will need backticks around this name (`like this`); letters, digits and _ avoid that."}
        >
          <input
            id="derived-name"
            autoFocus
            className={`${inputCls} ui-mono w-full`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. bmi_calc"
          />
        </Field>
        <Field label="Label" htmlFor="derived-label">
          <input id="derived-label" className={`${inputCls} w-full`} value={label} onChange={(event) => setLabel(event.target.value)} placeholder="optional" />
        </Field>
        <Field label="Unit" htmlFor="derived-unit">
          <input id="derived-unit" className={`${inputCls} w-full`} value={unit} onChange={(event) => setUnit(event.target.value)} placeholder="optional" />
        </Field>
      </div>

      <div className="mt-3 flex h-[440px] overflow-hidden rounded-[10px] border border-border">
        <PieceLibrary groups={groups} onInsert={(entry) => canvasApi.current?.insert(entry.state)} width={220} />
        <div className="flex min-w-0 flex-1 flex-col">
          <ExprEditor
            value={status.expr}
            loadKey={editing?.name ?? "new"}
            schema={schema}
            describe={describe}
            onChange={setStatus}
            onCanvasApi={(api) => {
              canvasApi.current = api;
            }}
          />
        </div>
      </div>

      <div className="mt-3 flex min-h-[40px] items-start gap-3">
        {preview ? (
          <div className="ui-mono flex-1 text-label text-muted-fg">
            <span className="text-fg">Gives {status.type ? TYPE_LABEL[status.type] : "—"}</span> · {preview.missing.toLocaleString("en-US")} missing of{" "}
            {frame.rowCount.toLocaleString("en-US")}
            {preview.mean !== null && <> · mean {fmt(preview.mean)}</>}
            <div className="mt-1 truncate">
              First rows:{" "}
              {preview.values.slice(0, 8).map((value, index) => (
                <span key={index} className="mr-2 text-fg">
                  {value === null ? "·" : typeof value === "number" ? fmt(value, 4) : displayValue(value)}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex-1 text-label text-muted-fg">{status.problem ?? "Assemble a formula to preview its values."}</div>
        )}
      </div>

      {(nameProblem && trimmed !== "") || save.error ? (
        <Callout tone="bad" className="mt-2">
          {save.error ? errorMessage(save.error) : nameProblem}
        </Callout>
      ) : null}

      <div className="mt-3 flex justify-end gap-2">
        <button type="button" className={pillBtn} onClick={requestClose}>
          Cancel
        </button>
        <button
          type="button"
          className={primaryBtn}
          disabled={Boolean(nameProblem) || !status.expr || Boolean(status.problem) || save.isPending}
          onClick={() => save.mutate()}
        >
          {save.isPending ? "Saving…" : editing ? "Save changes" : "Create variable"}
        </button>
      </div>
      {confirmClose && (
        <ConfirmDialog
          title="Discard this formula?"
          message="The variable has not been saved. Closing discards the formula you assembled."
          confirmLabel="Discard"
          danger
          onConfirm={() => {
            setConfirmClose(false);
            onClose();
          }}
          onClose={() => setConfirmClose(false)}
        />
      )}
    </Modal>
  );
}

function hashOrNull(expr: ExprNode | null): string | null {
  return expr ? hashExpr(expr) : null;
}
