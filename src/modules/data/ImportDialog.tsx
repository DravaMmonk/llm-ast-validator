/**
 * CSV / TSV import with a live preview. The file is parsed in the browser by
 * the same shared module the server uses, so the preview — inferred types,
 * missing counts, warnings — is exactly what will be stored. The server
 * re-parses and validates on upload; the browser verdict is never trusted.
 */

import { useDeferredValue, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileUp } from "lucide-react";

import {
  DATASET_TEXT_MAX_BYTES,
  DatasetError,
  displayValue,
  parseDelimitedText,
  type CsvImportResult,
} from "../../../shared/workbench/dataset";
import { ConfirmDialog, Modal, inputCls, pillBtn, primaryBtn, selectSmCls, textareaCls, toast } from "../../shared-console/src";
import { errorMessage, wbApi } from "../../workstation/api";
import { queryKeys } from "../../workstation/data";
import { Callout, Field, KindBadge, plural } from "../../workstation/ui";

const DELIMITERS = [
  { v: "", label: "Detect automatically" },
  { v: ",", label: "Comma ," },
  { v: ";", label: "Semicolon ;" },
  { v: "\t", label: "Tab" },
  { v: "|", label: "Pipe |" },
];

export function ImportDialog({ onClose, onImported }: { onClose: () => void; onImported: (datasetId: string) => void }) {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [delimiter, setDelimiter] = useState("");
  const [readError, setReadError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  // Closing (✕, Escape, backdrop) asks first once something has been pasted or loaded.
  const requestClose = () => (text.trim() !== "" && !upload.isSuccess ? setConfirmClose(true) : onClose());

  // Parsing a large paste on every keystroke would stall typing.
  const deferredText = useDeferredValue(text);
  const preview = useMemo((): { result: CsvImportResult | null; error: string | null } => {
    if (deferredText.trim() === "") return { result: null, error: null };
    try {
      return { result: parseDelimitedText(deferredText, { delimiter: delimiter || undefined }), error: null };
    } catch (error) {
      return { result: null, error: error instanceof DatasetError ? error.message : "The text could not be parsed." };
    }
  }, [deferredText, delimiter]);

  const upload = useMutation({
    mutationFn: () =>
      wbApi.createDataset({ name: name.trim(), csv_text: text, ...(delimiter ? { delimiter } : {}) }),
    onSuccess: async ({ dataset, warnings }) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.datasets() });
      toast(`Imported · ${dataset.row_count.toLocaleString("en-US")} rows${warnings.length ? ` · ${plural(warnings.length, "warning")}` : ""}`);
      onImported(dataset.id);
    },
  });

  const readFile = (file: File) => {
    setReadError(null);
    if (file.size > DATASET_TEXT_MAX_BYTES) {
      setReadError(`“${file.name}” is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is ${DATASET_TEXT_MAX_BYTES / 1024 / 1024} MB.`);
      return;
    }
    if (/\.(xlsx|xls|sav|dta|sas7bdat|parquet)$/i.test(file.name)) {
      setReadError("Spreadsheet and statistics-package files are not read directly — save the sheet as CSV (UTF-8) first.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setText(String(reader.result ?? ""));
      if (!name.trim()) setName(file.name.replace(/\.[^.]+$/, "").slice(0, 120));
    };
    reader.onerror = () => setReadError(`“${file.name}” could not be read.`);
    reader.readAsText(file);
  };

  const result = preview.result;
  const canImport = Boolean(result) && deferredText === text && name.trim() !== "" && !upload.isPending;

  return (
    <Modal title="Import a dataset" onClose={requestClose} w={820}>
      <div className="mt-3 grid grid-cols-[1fr_220px] gap-3 mobile:grid-cols-1">
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            const file = event.dataTransfer.files[0];
            if (file) readFile(file);
          }}
          className="flex flex-col gap-2 rounded-[10px] border border-dashed p-3"
          style={{ borderColor: dragging ? "var(--primary)" : "var(--border)", background: dragging ? "var(--primary-soft)" : "var(--card-2)" }}
        >
          <div className="flex items-center gap-2">
            <FileUp size={16} className="text-muted-fg" aria-hidden />
            <span className="text-ui text-fg">Drop a .csv or .tsv file here, or</span>
            <button type="button" className={pillBtn} onClick={() => fileInput.current?.click()}>
              Choose file…
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"
              className="hidden"
              aria-label="Choose a CSV file"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) readFile(file);
                event.target.value = "";
              }}
            />
          </div>
          <textarea
            className={`${textareaCls} ui-mono h-[110px] text-label`}
            placeholder={"…or paste delimited text, header row first:\nid,age,sex,sbp\nP1,54,F,132"}
            aria-label="Pasted data"
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              if (!name.trim() && event.target.value.trim()) setName("Pasted data");
            }}
            spellCheck={false}
          />
        </div>
        <div className="flex flex-col gap-2.5">
          <Field label="Dataset name" htmlFor="import-name" hint={result && name.trim() === "" ? <span style={{ color: "var(--bad)" }}>A name is required to import.</span> : undefined}>
            <input
              id="import-name"
              className={`${inputCls} w-full`}
              value={name}
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Pilot cohort 2026"
            />
          </Field>
          <Field label="Delimiter" htmlFor="import-delimiter">
            <select id="import-delimiter" className={`${selectSmCls} h-7 w-full`} value={delimiter} onChange={(event) => setDelimiter(event.target.value)}>
              {DELIMITERS.map((option) => (
                <option key={option.label} value={option.v}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
          <p className="m-0 text-cap leading-relaxed text-muted-fg">
            Blank, NA, N/A, NaN, null, “.” and “-” are read as missing. A column is numeric only if every present value is a number.
          </p>
        </div>
      </div>

      {(readError || preview.error) && (
        <Callout tone="bad" className="mt-3">
          {readError ?? preview.error}
        </Callout>
      )}

      {result && (
        <div className="mt-3">
          <div className="mb-1.5 flex items-center gap-2 text-label text-muted-fg">
            <span className="ui-mono">
              {result.rowCount.toLocaleString("en-US")} rows · {result.columns.length} columns · delimiter{" "}
              {result.delimiter === "\t" ? "tab" : `“${result.delimiter}”`}
            </span>
          </div>
          {result.warnings.map((warning) => (
            <Callout key={warning} tone="warn" className="mb-1.5">
              {warning}
            </Callout>
          ))}
          <div className="ui-scroll max-h-[240px] overflow-auto rounded-md border border-border-2">
            <table className="border-collapse">
              <thead>
                <tr>
                  {result.columns.map((column) => (
                    <th key={column.name} className="sticky top-0 border-b border-border-2 bg-card-2 px-2 py-1 text-left">
                      <div className="flex items-center gap-1">
                        <KindBadge kind={column.kind} />
                        <span className="ui-mono whitespace-nowrap text-label font-semibold text-fg">{column.name}</span>
                      </div>
                      <div className="ui-mono text-nano font-normal text-muted-fg">
                        {column.values.filter((v) => v === null).length} missing
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: Math.min(8, result.rowCount) }, (_, row) => (
                  <tr key={row}>
                    {result.columns.map((column) => {
                      const value = column.values[row];
                      return (
                        <td
                          key={column.name}
                          className={`ui-mono whitespace-nowrap border-b border-border-2 px-2 py-0.5 text-label ${value === null ? "text-muted-fg" : "text-fg"}`}
                          style={{ textAlign: column.kind === "numeric" ? "right" : "left" }}
                        >
                          {value === null ? "·" : displayValue(value)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {upload.error && (
        <Callout tone="bad" className="mt-3">
          {errorMessage(upload.error)}
        </Callout>
      )}

      <div className="mt-4 flex items-center justify-end gap-2">
        <span className="mr-auto text-cap text-muted-fg">Data is stored only in the local workstation database.</span>
        <button type="button" className={pillBtn} onClick={requestClose}>
          Cancel
        </button>
        <button type="button" className={primaryBtn} disabled={!canImport} onClick={() => upload.mutate()}>
          {upload.isPending ? "Importing…" : result ? `Import ${result.rowCount.toLocaleString("en-US")} rows` : "Import"}
        </button>
      </div>
      {confirmClose && (
        <ConfirmDialog
          title="Discard this import?"
          message="The pasted or loaded data has not been imported yet. Closing discards it."
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
