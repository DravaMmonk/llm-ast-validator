/**
 * Automated WCAG 2.1 A/AA checks (axe-core) on every workstation module, in
 * both themes. Blockly's canvas internals are excluded: they are a third-party
 * SVG surface with their own keyboard model.
 */

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const PAGES = [
  "/",
  "/data",
  "/cohorts",
  "/forge",
  "/calculators/egfr_ckdepi_2021",
  "/stats/finder",
  "/stats/table1",
  "/stats/compare",
  "/stats/survival",
  "/diagnostic/two-by-two",
  "/diagnostic/fagan",
  "/design/pico",
  "/design/sample-size",
  "/design/checklist",
  "/report",
];

test.describe.configure({ mode: "default" });

test.beforeAll(async ({ request }) => {
  await request.post("/api/workbench/datasets/samples", { data: { sample_key: "cardiometabolic" } });
});

for (const theme of ["light", "dark"] as const) {
  for (const path of PAGES) {
    test(`${path} has no serious accessibility violations (${theme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await page.setViewportSize({ width: 1512, height: 900 });
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(400);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .exclude(".injectionDiv")
        .exclude(".blocklySvg")
        .exclude(".blocklyWidgetDiv")
        .exclude(".blocklyToolboxDiv")
        .analyze();
      const serious = results.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
      if (process.env.A11Y_REPORT) {
        const { appendFileSync } = await import("node:fs");
        for (const violation of serious) {
          for (const node of violation.nodes) {
            appendFileSync(process.env.A11Y_REPORT, `${theme}\t${path}\t${violation.id}\t${node.target.join(" ")}\t${(node.failureSummary ?? "").replace(/\s+/g, " ").slice(0, 200)}\n`);
          }
        }
      }
      const summary = serious.map((violation) => `${violation.id} (${violation.impact}): ${violation.nodes.length} × ${violation.nodes[0]?.target.join(" ")} — ${violation.nodes[0]?.failureSummary?.split("\n")[1] ?? ""}`);
      expect(summary).toEqual([]);
    });
  }
}
