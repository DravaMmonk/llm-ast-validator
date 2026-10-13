import { describe, expect, it } from "vitest";

import { evaluateCohort } from "./cohort";
import {
  DatasetError,
  type StoredColumn,
  buildFrame,
  caseVariants,
  cleanHeaders,
  convertColumnKind,
  hashColumns,
  isBinaryColumn,
  mergeCaseVariants,
  parseDelimitedText,
  validateColumnPatches,
  validateDerived,
} from "./dataset";
import { validateCohortPayload, validateReportItemPayload, validateScorePayload } from "./documents";
import { parseExpr } from "./exprText";
import { SAMPLE_DATASETS, createRng, generateSample } from "./samples";

describe("parseDelimitedText", () => {
  it("infers numeric and categorical columns with missing tokens", () => {
    const result = parseDelimitedText("id,age,sex,ldl\nA1,52,F,3.1\nA2,NA,M,\nA3,61, F ,2.9e0\n");
    expect(result.rowCount).toBe(3);
    const [id, age, sex, ldl] = result.columns;
    expect(id).toMatchObject({ kind: "categorical", role: "id" });
    expect(age).toMatchObject({ kind: "numeric", values: [52, null, 61] });
    expect(sex).toMatchObject({ kind: "categorical", values: ["F", "M", "F"] });
    expect(ldl.values).toEqual([3.1, null, 2.9]);
  });

  it("auto-detects semicolons and tabs and strips a BOM", () => {
    expect(parseDelimitedText("﻿a;b\n1;2\n").columns.map((c) => c.name)).toEqual(["a", "b"]);
    expect(parseDelimitedText("a\tb\n1\t2\n").delimiter).toBe("\t");
  });

  it("treats a column with any non-numeric value as categorical", () => {
    const result = parseDelimitedText("grade\n1\n2\n3a\n");
    expect(result.columns[0]).toMatchObject({ kind: "categorical", values: ["1", "2", "3a"] });
  });

  it("pads ragged rows and warns", () => {
    const result = parseDelimitedText("a,b,c\n1,2\n1,2,3,4\n");
    expect(result.columns[2].values).toEqual([null, 3]);
    expect(result.warnings.join(" ")).toContain("2 rows");
  });

  it("handles overflow, delimiter-only records and trailing delimiters", () => {
    const overflow = parseDelimitedText("x\n1\n1e400\n");
    expect(overflow.columns[0]).toMatchObject({ kind: "numeric", values: [1, null] });
    expect(overflow.warnings.join(" ")).toContain("too large");
    const blanks = parseDelimitedText("a,b\n1,2\n,\n\n3,4\n");
    expect(blanks.rowCount).toBe(3);
    const trailing = parseDelimitedText("a,b,\n1,2,\n3,4,\n");
    expect(trailing.columns.map((c) => c.name)).toEqual(["a", "b"]);
    expect(trailing.warnings.join(" ")).toContain("trailing");
  });

  it("reads decimal commas when the delimiter is not a comma", () => {
    const result = parseDelimitedText("w;h\n70,5;175\n80;1,8e2\n");
    expect(result.columns[0]).toMatchObject({ kind: "numeric", values: [70.5, 80] });
  });

  it("cleans empty and duplicate headers", () => {
    expect(cleanHeaders(["", "a", "A", "a", " b "])).toEqual(["column_1", "a", "A_2", "a_3", "b"]);
  });

  it.each([
    ["", "DATASET_EMPTY"],
    ["a,b\n", "DATASET_NO_ROWS"],
    ['a,b\n"1,2\n', "DATASET_PARSE_FAILED"],
  ])("rejects %j with %s", (text, code) => {
    try {
      parseDelimitedText(text);
      throw new Error("expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(DatasetError);
      expect((error as DatasetError).code).toBe(code);
    }
  });
});

describe("column metadata and conversion", () => {
  const { columns } = parseDelimitedText("x,y\n1,a\n2,b\n");

  it("validates patches against existing columns", () => {
    expect(validateColumnPatches([{ name: "x", role: "outcome", unit: "mg" }], columns)).toEqual([
      { name: "x", role: "outcome", unit: "mg" },
    ]);
    expect(() => validateColumnPatches([{ name: "zz" }], columns)).toThrow(/does not match/);
    expect(() => validateColumnPatches([{ name: "x", role: "boss" }], columns)).toThrow(/role/);
  });

  it("converts kinds and counts lost values", () => {
    const text = convertColumnKind(columns[0], "categorical");
    expect(text.column.values).toEqual(["1", "2"]);
    const back = convertColumnKind({ ...columns[1], values: ["1.5", "x", null] }, "numeric");
    expect(back.column.values).toEqual([1.5, null, null]);
    expect(back.lost).toBe(1);
  });

  it("hashes content deterministically", () => {
    expect(hashColumns(columns)).toBe(hashColumns(parseDelimitedText("x,y\n1,a\n2,b\n").columns));
    expect(hashColumns(columns)).not.toBe(hashColumns(parseDelimitedText("x,y\n1,a\n3,b\n").columns));
  });
});

describe("derived columns and frames", () => {
  const { columns, rowCount } = parseDelimitedText("w,h,sex\n70,175,F\n90,,M\n");

  it("validates derived formulas in order and rejects shadowing", () => {
    const derived = validateDerived(
      [
        { name: "bmi", expr: parseExpr("w / (h / 100) ^ 2") },
        { name: "obese", expr: parseExpr("bmi >= 30") },
      ],
      columns,
    );
    expect(derived.map((d) => d.name)).toEqual(["bmi", "obese"]);
    expect(() => validateDerived([{ name: "W", expr: parseExpr("1") }], columns)).toThrow(/already exists/);
    expect(() => validateDerived([{ name: "z", expr: parseExpr("sex + 1") }], columns)).toThrow(/expects number/);
    // A later formula may not be referenced before it is defined.
    expect(() =>
      validateDerived(
        [
          { name: "a", expr: parseExpr("b + 1") },
          { name: "b", expr: parseExpr("w") },
        ],
        columns,
      ),
    ).toThrow(/does not exist/);
  });

  it("keeps an unchanged stored formula that no longer type-checks, but rejects a new one", () => {
    const stored = validateDerived([{ name: "older", expr: parseExpr("w >= 80") }], columns);
    const converted = columns.map((column) => (column.name === "w" ? { ...column, kind: "categorical" as const } : column));
    expect(validateDerived(stored, converted, stored).map((d) => d.name)).toEqual(["older"]);
    expect(() => validateDerived([...stored, { name: "x", expr: parseExpr("w * 2") }], converted, stored)).toThrow(/expects number/);
    expect(() => validateDerived(stored, converted, [])).toThrow(/expects number/);
  });

  it("materializes derived columns, including booleans and missing", () => {
    const derived = validateDerived(
      [
        { name: "bmi", expr: parseExpr("round(w / (h / 100) ^ 2, 1)") },
        { name: "female", expr: parseExpr('sex == "F"') },
      ],
      columns,
    );
    const frame = buildFrame({ id: "d", name: "d", content_hash: "h", row_count: rowCount, columns, derived });
    const bmi = frame.columns.find((c) => c.name === "bmi")!;
    expect(bmi.values).toEqual([22.9, null]);
    const female = frame.columns.find((c) => c.name === "female")!;
    expect(female.kind).toBe("boolean");
    expect(female.values).toEqual([true, false]);
    expect(isBinaryColumn(female)).toBe(true);
  });

  it("keeps a broken derived column visible with an error", () => {
    const frame = buildFrame({
      id: "d",
      name: "d",
      content_hash: "h",
      row_count: rowCount,
      columns,
      derived: [{ name: "bad", expr: parseExpr("missing_col * 2"), label: "", unit: "", role: "none", description: "" }],
    });
    const bad = frame.columns.find((c) => c.name === "bad")!;
    expect(bad.error).toContain("does not exist");
    expect(bad.values).toEqual([null, null]);
  });
});

describe("evaluateCohort", () => {
  const { columns, rowCount } = parseDelimitedText("age,sex,ldl\n17,F,3\n25,F,\n40,M,5\n70,M,2\n55,F,4.5\n");
  const frame = buildFrame({ id: "d", name: "d", content_hash: "h", row_count: rowCount, columns, derived: [] });
  const step = (id: string, kind: "include" | "exclude", text: string, on_missing: "drop" | "keep" = "drop", enabled = true) => ({
    id,
    label: id,
    kind,
    expr: parseExpr(text),
    on_missing,
    enabled,
  });

  it("accounts for every removed row", () => {
    const result = evaluateCohort(frame, [
      step("adults", "include", "age >= 18"),
      step("high_ldl", "exclude", "ldl > 4.9"),
    ]);
    expect(result.steps[0]).toMatchObject({ before: 5, removedByCriterion: 1, removedMissing: 0, remaining: 4 });
    // Row with missing LDL is dropped by policy, the LDL 5 row by the criterion.
    expect(result.steps[1]).toMatchObject({ before: 4, removedByCriterion: 1, removedMissing: 1, remaining: 2 });
    expect(result.final).toBe(2);
    expect([...result.mask]).toEqual([0, 0, 0, 1, 1]);
    expect(result.valid).toBe(true);
  });

  it("keeps missing rows when asked and passes disabled steps through", () => {
    const result = evaluateCohort(frame, [
      step("high_ldl", "exclude", "ldl > 4.9", "keep"),
      step("women", "include", 'sex == "F"', "drop", false),
    ]);
    expect(result.steps[0]).toMatchObject({ removedByCriterion: 1, keptMissing: 1, remaining: 4 });
    expect(result.steps[1]).toMatchObject({ enabled: false, remaining: 4 });
    expect(result.final).toBe(4);
  });

  it("flags criteria that are not yes/no conditions or do not type-check", () => {
    const result = evaluateCohort(frame, [step("num", "include", "age + 1"), step("bad", "include", "nope > 1")]);
    expect(result.valid).toBe(false);
    expect(result.steps[0].error).toContain("yes/no");
    expect(result.steps[1].error).toContain("does not exist");
    expect(result.final).toBe(5);
  });
});

describe("document payloads", () => {
  it("validates a cohort payload and fills defaults", () => {
    const payload = validateCohortPayload({
      steps: [{ id: "s1", label: "Adults", kind: "include", expr: parseExpr("age >= 18") }],
    });
    expect(payload.steps[0]).toMatchObject({ on_missing: "drop", enabled: true });
    expect(payload.notes).toBe("");
    expect(() => validateCohortPayload({ steps: [{ id: "s1", kind: "keep", expr: parseExpr("1") }] })).toThrow(/include or exclude/);
    expect(() =>
      validateCohortPayload({
        steps: [
          { id: "s1", kind: "include", expr: parseExpr("true") },
          { id: "s1", kind: "include", expr: parseExpr("true") },
        ],
      }),
    ).toThrow(/duplicated/);
  });

  it("validates score and report payloads", () => {
    expect(validateScorePayload({ expr: null })).toMatchObject({ direction: "higher", outcome: null });
    expect(() => validateScorePayload({ expr: { k: "call", op: "eval", args: [] } })).toThrow(/vocabulary/);
    const item = validateReportItemPayload({ module: "stats", summary: "x", table: { columns: ["a"], rows: [[1], ["b"], [null]] } });
    expect(item.table!.rows).toHaveLength(3);
    expect(() => validateReportItemPayload({ table: { columns: ["a"], rows: [[{}]] } })).toThrow(/text, a number/);
  });
});

describe("samples", () => {
  it.each(SAMPLE_DATASETS.map((sample) => [sample.key, sample.rows] as const))(
    "%s is deterministic with %d rows",
    (key, rows) => {
      const first = generateSample(key)!;
      const second = generateSample(key)!;
      expect(first[0].values).toHaveLength(rows);
      expect(hashColumns(first)).toBe(hashColumns(second));
      for (const column of first) {
        for (const value of column.values) {
          if (column.kind === "numeric") expect(value === null || Number.isFinite(value)).toBe(true);
          else expect(value === null || typeof value === "string").toBe(true);
        }
      }
    },
  );

  it("plants realistic event rates", () => {
    const cm = generateSample("cardiometabolic")!;
    const rate = (name: string) => {
      const values = cm.find((c) => c.name === name)!.values as number[];
      return values.reduce((sum, v) => sum + v, 0) / values.length;
    };
    expect(rate("incident_diabetes")).toBeGreaterThan(0.05);
    expect(rate("incident_diabetes")).toBeLessThan(0.3);
    expect(rate("cvd_event")).toBeGreaterThan(0.03);
    expect(rate("cvd_event")).toBeLessThan(0.35);
  });

  it("rng is reproducible", () => {
    const a = createRng(1);
    const b = createRng(1);
    expect([a.uniform(), a.normal(), a.uniform()]).toEqual([b.uniform(), b.normal(), b.uniform()]);
  });
});

describe("yes/no columns and case variants", () => {
  it("reads yes/no spellings as a yes/no column, case-insensitively", () => {
    const { columns } = parseDelimitedText("smoker,flag,sex,only_f,only_yes\nYes,T,M,F,yes\nno,f,F,F,\nYES,t,M,F,Yes\n");
    const kinds = Object.fromEntries(columns.map((column) => [column.name, column.kind]));
    expect(kinds).toEqual({ smoker: "boolean", flag: "boolean", sex: "categorical", only_f: "categorical", only_yes: "boolean" });
    expect(columns[0].values).toEqual([true, false, true]);
    expect(columns[4].values).toEqual([true, null, true]);
  });

  it("keeps 0/1 numbers numeric", () => {
    expect(parseDelimitedText("x\n0\n1\n").columns[0].kind).toBe("numeric");
  });

  it("converts between all three kinds and counts what is lost", () => {
    const text: StoredColumn = { name: "a", kind: "categorical", label: "a", unit: "", role: "none", description: "", values: ["Yes", "n", "maybe", null] };
    const asBool = convertColumnKind(text, "boolean");
    expect(asBool.column.values).toEqual([true, false, null, null]);
    expect(asBool.lost).toBe(1);
    expect(convertColumnKind(asBool.column, "numeric").column.values).toEqual([1, 0, null, null]);
    expect(convertColumnKind(asBool.column, "categorical").column.values).toEqual(["yes", "no", null, null]);
    const numbers: StoredColumn = { ...text, kind: "numeric", values: [1, 0, 2, null] };
    expect(convertColumnKind(numbers, "boolean")).toMatchObject({ column: { values: [true, false, null, null] }, lost: 1 });
  });

  it("finds and merges case variants to the most common spelling", () => {
    const column: StoredColumn = {
      name: "sex",
      kind: "categorical",
      label: "sex",
      unit: "",
      role: "none",
      description: "",
      values: ["Male", "male", "Male", "MALE", "Female", "Other", null],
    };
    expect(caseVariants(column.values)).toEqual([{ canonical: "Male", variants: ["Male", "male", "MALE"] }]);
    const merged = mergeCaseVariants(column);
    expect(merged.changed).toBe(2);
    expect(merged.column.values).toEqual(["Male", "Male", "Male", "Male", "Female", "Other", null]);
    expect(mergeCaseVariants(merged.column).changed).toBe(0);
  });

  it("warns about case variants on import and validates merge patches", () => {
    expect(parseDelimitedText("g\nAa\naa\nAA\n").warnings.some((warning) => warning.includes("letter case"))).toBe(true);
    const meta = [{ name: "g", kind: "categorical" as const, label: "g", unit: "", role: "none" as const, description: "" }];
    expect(validateColumnPatches([{ name: "g", merge_case: true, kind: "boolean" }], meta)).toEqual([{ name: "g", kind: "boolean", merge_case: true }]);
    expect(() => validateColumnPatches([{ name: "g", merge_case: false }], meta)).toThrow(/merge_case/);
  });
});
