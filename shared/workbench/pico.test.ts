import { describe, expect, it } from "vitest";

import { CHECKLISTS, checklistItemCount } from "./checklists";
import { EMPTY_PICO, buildPubmedQuery, clinicalTrialsUrl, formatTerm, pubmedUrl, structuredQuestion } from "./pico";

const pico = {
  ...EMPTY_PICO,
  population: [
    { text: "type 2 diabetes", field: "mesh" as const },
    { text: "T2DM", field: "tiab" as const },
  ],
  intervention: [{ text: "SGLT2 inhibitor*", field: "tiab" as const }],
  comparison: [{ text: "placebo", field: "tiab" as const }],
  outcome: [{ text: "heart failure", field: "tiab" as const }],
  timeframe: "two years",
};

describe("PICO search builder", () => {
  it("formats terms with field tags and quotes phrases", () => {
    expect(formatTerm({ text: "heart failure", field: "tiab" })).toBe('"heart failure"[tiab]');
    expect(formatTerm({ text: "aspirin", field: "mesh" })).toBe("aspirin[MeSH Terms]");
    expect(formatTerm({ text: 'say "hi"', field: "all" })).toBe('"say hi"');
    expect(formatTerm({ text: "  ", field: "all" })).toBe("");
  });

  it("ORs synonyms within and ANDs across elements, leaving out the comparison by default", () => {
    expect(buildPubmedQuery(pico, { humans: false, english: false, design: "", yearFrom: null })).toBe(
      '("type 2 diabetes"[MeSH Terms] OR T2DM[tiab]) AND "SGLT2 inhibitor*"[tiab] AND "heart failure"[tiab]',
    );
    expect(buildPubmedQuery(pico, { humans: true, english: true, design: "rct", yearFrom: 2015 }, true)).toBe(
      '("type 2 diabetes"[MeSH Terms] OR T2DM[tiab]) AND "SGLT2 inhibitor*"[tiab] AND placebo[tiab] AND "heart failure"[tiab] AND randomized controlled trial[pt] NOT (animals[MeSH Terms] NOT humans[MeSH Terms]) AND english[la] AND ("2015"[dp] : "3000"[dp])',
    );
  });

  it("builds no query from filters alone", () => {
    expect(buildPubmedQuery(EMPTY_PICO, { humans: true, english: true, design: "rct", yearFrom: 2020 })).toBe("");
  });

  it("builds links and a structured question", () => {
    expect(pubmedUrl("a AND b")).toBe("https://pubmed.ncbi.nlm.nih.gov/?term=a%20AND%20b");
    expect(clinicalTrialsUrl(pico)).toContain("cond=type+2+diabetes+OR+T2DM");
    expect(structuredQuestion(pico)).toBe("In type 2 diabetes, does SGLT2 inhibitor* compared with placebo affect heart failure over two years?");
    expect(structuredQuestion(EMPTY_PICO)).toBe("");
  });
});

describe("checklists", () => {
  it.each([
    ["consort-2025", 42],
    ["strobe", 34],
    ["stard-2015", 34],
    ["tripod-ai", 52],
    ["prisma-2020", 42],
    ["spirit-2025", 53],
  ])("%s has the verified %d tickable lines with unique ids", (key, count) => {
    const checklist = CHECKLISTS.find((entry) => entry.key === key)!;
    expect(checklistItemCount(checklist)).toBe(count);
    const ids = checklist.sections.flatMap((section) => section.items.map((item) => item.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id, index) => id && checklist.sections.flatMap((s) => s.items)[index].label)).toBe(true);
  });
});
