import { describe, expect, it } from "vitest";

import { buildFrame, parseDelimitedText } from "../../shared/workbench/dataset";
import { parseExpr } from "../../shared/workbench/exprText";
import { frameToCsv } from "./exportCsv";

describe("frameToCsv", () => {
  it("round-trips through the importer, including derived columns, quoting and missing values", () => {
    const parsed = parseDelimitedText('name,x\n"Smith, J",1.5\nO"Neil,\n plain ,3\n');
    const frame = buildFrame({
      id: "d",
      name: "d",
      content_hash: "h",
      row_count: parsed.rowCount,
      columns: parsed.columns,
      derived: [{ name: "big", expr: parseExpr("x > 2"), label: "", unit: "", role: "none", description: "" }],
    });
    const csv = frameToCsv(frame);
    expect(csv.split("\r\n")[0]).toBe("name,x,big");
    const again = parseDelimitedText(csv);
    expect(again.columns[0].values).toEqual(["Smith, J", 'O"Neil', "plain"]);
    expect(again.columns[1].values).toEqual([1.5, null, 3]);
    // A yes/no column exports as yes/no words and re-imports as yes/no.
    expect(again.columns[2]).toMatchObject({ kind: "boolean", values: [false, null, true] });
    expect(frameToCsv(frame, [2]).trim().split("\r\n")).toHaveLength(2);
  });
});
