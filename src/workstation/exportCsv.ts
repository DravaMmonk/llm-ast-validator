/**
 * CSV export of a frame (source and derived columns), optionally restricted to
 * a row selection such as a cohort. RFC 4180 quoting; missing values are empty
 * cells; numbers keep full precision.
 */

import { type Frame, displayValue } from "../../shared/workbench/dataset";

function cell(value: string): string {
  return /[",\r\n]/.test(value) || /^\s|\s$/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function frameToCsv(frame: Frame, rows?: readonly number[]): string {
  const columns = frame.columns.filter((column) => column.error === null);
  const lines = [columns.map((column) => cell(column.name)).join(",")];
  const order = rows ?? Array.from({ length: frame.rowCount }, (_, i) => i);
  for (const row of order) {
    lines.push(columns.map((column) => {
      const value = column.values[row];
      return value === null ? "" : cell(typeof value === "number" ? String(value) : displayValue(value));
    }).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

export function downloadText(filename: string, text: string, type = "text/csv;charset=utf-8"): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function safeFilename(name: string): string {
  return name.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "export";
}
