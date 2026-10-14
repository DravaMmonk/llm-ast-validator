import { describe, expect, it } from "vitest";

import { apaP, buildDesign, buildTable1, chooseStyle, crossTab, groupLevels, isGroupingColumn, splitByGroup } from "./analysis";
import { buildFrame, parseDelimitedText } from "./dataset";
import { generateSample } from "./samples";

function frameOf(csv: string) {
  const parsed = parseDelimitedText(csv);
  return buildFrame({ id: "d", name: "d", content_hash: "h", row_count: parsed.rowCount, columns: parsed.columns, derived: [] });
}

const frame = frameOf("y,x,arm,flag,sex\n1,10,a,1,F\n2,12,a,0,M\n3,,b,1,F\n4,15,b,1,\n5,18,c,0,M\n6,20,a,1,F\n");
const all = [0, 1, 2, 3, 4, 5];
const col = (name: string) => frame.columns.find((c) => c.name === name)!;

describe("grouping helpers", () => {
  it("lists levels and recognises grouping columns", () => {
    expect(groupLevels(col("arm"), all)).toEqual([
      { level: "a", count: 3 },
      { level: "b", count: 2 },
      { level: "c", count: 1 },
    ]);
    expect(isGroupingColumn(col("arm"))).toBe(true);
    expect(isGroupingColumn(col("flag"))).toBe(true);
    expect(isGroupingColumn(col("y"))).toBe(true); // 6 distinct numbers still counts as few
  });

  it("splits numbers by group and drops incomplete rows", () => {
    const split = splitByGroup(col("x"), col("arm"), all);
    expect(split.levels).toEqual(["a", "b", "c"]);
    expect(split.values).toEqual([[10, 12, 20], [15], [18]]);
    expect(split.excluded).toBe(1);
  });

  it("cross-tabulates", () => {
    const table = crossTab(col("sex"), col("arm"), all);
    expect(table.rowLevels).toEqual(["a", "b", "c"]);
    expect(table.colLevels).toEqual(["F", "M"]);
    expect(table.table).toEqual([
      [2, 1],
      [1, 0],
      [0, 1],
    ]);
    expect(table.excluded).toBe(1);
  });
});

describe("missing-group robustness", () => {
  it("ignores levels seen only beside a missing group", () => {
    const f = frameOf("g,y\na,x\nb,x\na,y\nb,y\n,z\n");
    const table = crossTab(f.columns[1], f.columns[0], [0, 1, 2, 3, 4]);
    expect(table.colLevels).toEqual(["x", "y"]);
    const t1 = buildTable1(f, [0, 1, 2, 3, 4], ["y"], "g");
    expect(t1.rows[0].p).not.toBeNull();
  });
});

describe("buildDesign", () => {
  it("dummy-codes categories against the most frequent level and drops incomplete rows", () => {
    const design = buildDesign(frame, all, ["x", "arm"], ["y"]);
    expect(design.rows).toEqual([0, 1, 3, 4, 5]);
    expect(design.excluded).toBe(1);
    expect(design.terms.map((t) => t.name)).toEqual(["x", "arm: b vs a", "arm: c vs a"]);
    expect(design.X[2]).toEqual([15, 1, 0]);
  });

  it("drops single-level factors with a reason", () => {
    const design = buildDesign(frame, [0, 2, 5], ["sex"]);
    expect(design.terms).toEqual([]);
    expect(design.dropped[0].reason).toContain("one level");
  });
});

describe("buildTable1", () => {
  it("summarises the synthetic RCT by arm with appropriate tests", () => {
    const parsed = generateSample("rct_hypertension")!;
    const rct = buildFrame({ id: "r", name: "r", content_hash: "h", row_count: 400, columns: parsed, derived: [] });
    const rows = Array.from({ length: 400 }, (_, i) => i);
    const table = buildTable1(rct, rows, ["age", "sex", "baseline_sbp", "adherence_pct", "adverse_event"], "arm");
    expect(table.groupLevels).toEqual(["placebo", "treatment"]);
    expect(table.groupCounts.reduce((a, b) => a + b, 0)).toBe(400);
    const age = table.rows.find((row) => row.label.startsWith("Age"))!;
    expect(age.test).toBe("Welch t-test");
    expect(age.groups).toHaveLength(2);
    const sex = table.rows.find((row) => row.label.startsWith("Sex"))!;
    expect(sex.test).toMatch(/χ²/);
    expect(table.rows.filter((row) => row.indent === 1).map((row) => row.label)).toEqual(["F", "M"]);
    const ae = table.rows.find((row) => row.label.startsWith("Any adverse event"))!;
    expect(ae.overall).toMatch(/^\d+ \(\d+\.\d%\)$/);
    // Adherence is left-skewed by construction → median [IQR].
    const adherence = table.rows.find((row) => row.label.startsWith("Adherence"))!;
    expect(adherence.label).toContain(chooseStyle(rct.columns.find((c) => c.name === "adherence_pct")!.values as number[]) === "median_iqr" ? "median" : "mean");
  });
});

describe("apaP", () => {
  it("formats p-values", () => {
    expect(apaP(0.0004)).toBe("p < .001");
    expect(apaP(0.0341)).toBe("p = .034");
    expect(apaP(null)).toBe("p = n/a");
  });
});
