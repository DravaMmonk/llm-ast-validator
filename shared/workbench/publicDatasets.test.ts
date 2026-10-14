import { describe, expect, it } from "vitest";

import { buildFrame } from "./dataset";
import { PUBLIC_DATASETS, type PublicDataset } from "./publicDatasets";
import { PublicContractError, applyPublicContract, publicDatasetDescription, validatePublicCatalog } from "./publicImport";

/** A synthetic catalogue entry — tests never touch the real files. */
function entry(overrides: Omit<Partial<PublicDataset>, "source"> & { source?: Partial<PublicDataset["source"]> } = {}): PublicDataset {
  const base: PublicDataset = {
    key: "synthetic_trial",
    name: "Synthetic trial",
    summary: "A made-up trial.",
    description: "Made-up rows for tests.",
    domain: "Oncology",
    design: "Randomised trial",
    topics: ["Kaplan–Meier"],
    rows: 3,
    source: {
      publisher: "Test",
      url: "https://archive.ics.uci.edu/test.csv",
      page: "https://archive.ics.uci.edu/test",
      sha256: "0".repeat(64),
      bytes: 100,
      header: true,
      columns: 5,
    },
    license: { spdx: "CC0-1.0", name: "CC0", url: "https://creativecommons.org/publicdomain/zero/1.0/" },
    citation: "Test data.",
    columns: [
      { from: "arm", name: "treatment", label: "Treatment", kind: "categorical", codes: { "1": "drug", "2": "placebo" }, role: "group" },
      { from: "days", name: "followup_days", label: "Follow-up", kind: "numeric", unit: "days", role: "time" },
      { from: "status", name: "death", label: "Died", kind: "numeric", codes: { "1": 0, "2": 1 }, role: "event" },
      { from: "ascites", name: "ascites", label: "Ascites", kind: "boolean", codes: { "0": false, "1": true, "9": null } },
    ],
  };
  return { ...base, ...overrides, source: { ...base.source, ...overrides.source } };
}

const CSV = "rownames,arm,days,status,ascites\n1,1,400,2,1\n2,2,4500,1,9\n3,NA,1012,2,NA\n";

describe("public dataset catalogue", () => {
  it("passes every structural check", () => {
    expect(validatePublicCatalog(PUBLIC_DATASETS)).toEqual([]);
    expect(PUBLIC_DATASETS.length).toBeGreaterThanOrEqual(15);
  });

  it("gives each entry a citation, licence and source that fit the stored description", () => {
    for (const dataset of PUBLIC_DATASETS) {
      expect(dataset.citation.length).toBeGreaterThan(10);
      expect(dataset.license.url).toMatch(/^https:\/\//);
      expect(publicDatasetDescription(dataset)).toContain(dataset.citation);
    }
  });

  it("flags broken entries", () => {
    const broken = entry({
      key: "Bad Key",
      source: { url: "http://example.com/x.csv", sha256: "abc" },
      columns: [
        { from: "arm", name: "Treatment Arm", label: "Treatment", kind: "categorical" },
        { from: "days", name: "days", label: "Days", kind: "numeric", role: "time" },
        { from: "flag", name: "flag", label: "Flag", kind: "boolean", codes: { "1": "yes" } },
      ],
    });
    const problems = validatePublicCatalog([broken, broken]).join("\n");
    expect(problems).toMatch(/key must be lower_snake_case/);
    expect(problems).toMatch(/duplicate key/);
    expect(problems).toMatch(/sha256/);
    expect(problems).toMatch(/https on an allowed host/);
    expect(problems).toMatch(/plain lower_snake_case identifier/);
    expect(problems).toMatch(/does not match kind boolean/);
    expect(problems).toMatch(/time column needs an event column/);
  });
});

describe("applyPublicContract", () => {
  it("reads typed, coded columns and treats listed codes and NA as missing", () => {
    const { columns, rowCount } = applyPublicContract(entry(), CSV);
    expect(rowCount).toBe(3);
    expect(columns.map((column) => [column.name, column.kind, column.role])).toEqual([
      ["treatment", "categorical", "group"],
      ["followup_days", "numeric", "time"],
      ["death", "numeric", "event"],
      ["ascites", "boolean", "none"],
    ]);
    expect(columns[0].values).toEqual(["drug", "placebo", null]);
    expect(columns[2].values).toEqual([1, 0, 1]);
    expect(columns[3].values).toEqual([true, null, null]);
    const frame = buildFrame({ id: "x", name: "x", content_hash: "", row_count: rowCount, columns, derived: [] });
    expect(frame.columns[1].unit).toBe("days");
  });

  it("reads headerless files by position and filters rows", () => {
    const headerless = entry({
      rows: 2,
      source: { header: false, columns: 3, filter: { from: "#2", equals: "b", note: "keep b" } },
      columns: [
        { from: "#0", name: "age", label: "Age", kind: "numeric" },
        { from: "#1", name: "sex", label: "Sex", kind: "categorical", codes: { "0.0": "female", "1.0": "male" } },
      ],
    });
    const { columns } = applyPublicContract(headerless, "63.0,1.0,a\n41.0,0.0,b\n?,1.0,b\n");
    expect(columns[0].values).toEqual([41, null]);
    expect(columns[1].values).toEqual(["female", "male"]);
  });

  it("refuses a file that does not match the contract", () => {
    const refuse = (text: string, dataset = entry()) => () => applyPublicContract(dataset, text);
    expect(refuse("rownames,arm,days,status,ascites\n1,1,400,2,1\n")).toThrow(/expected 3 rows, found 1/);
    expect(refuse(CSV.replace("1,1,400,2,1", "1,3,400,2,1"))).toThrow(/treatment: unexpected value “3”/);
    expect(refuse(CSV.replace("4500", "long"))).toThrow(/followup_days: “long” in row 2 is not a number/);
    expect(refuse(CSV.replace("days", "duration"))).toThrow(/no longer has a column “days”/);
    expect(refuse(CSV.replace("1,1,400,2,1", "1,1,400,2,1,extra"))).toThrow(/row 1 has 6 fields/);
    expect(refuse("rownames,arm,days\n")).toThrow(PublicContractError);
  });
});
