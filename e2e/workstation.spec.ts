/**
 * The research workstation, end to end in a real browser: load a synthetic
 * sample, import a CSV, derive a variable from a typed formula, build and save
 * a cohort from puzzle pieces, run statistics, apply a calculator to the data,
 * judge the score in Score Forge, and collect everything in the report.
 *
 * Only synthetic data is used — the built-in generators and an inline CSV.
 */

import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));
  return errors;
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1512, height: 900 });
});

/** Each test runs in a fresh browser context, so the active dataset is chosen explicitly. */
async function useCardiometabolic(page: Page) {
  await page.goto("/");
  await page.locator("article", { hasText: "Synthetic cardiometabolic cohort" }).getByRole("button").click();
  await expect(page.getByRole("button", { name: /^Active dataset: Synthetic cardiometabolic cohort/ })).toBeVisible({ timeout: 15_000 });
}

test("load a sample dataset from the overview", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "MedLab research workstation" })).toBeVisible();
  const card = page.locator("article", { hasText: "Synthetic cardiometabolic cohort" });
  await card.getByRole("button").click();
  await expect(page.getByRole("button", { name: /^Active dataset: Synthetic cardiometabolic cohort/ })).toBeVisible({ timeout: 15_000 });
  expect(errors).toEqual([]);
});

test("import a CSV and derive a variable from a typed formula", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/data");
  await page.getByRole("button", { name: "Import a dataset" }).click();
  await page.getByLabel("Pasted data").fill("id,weight,height,sex\nA,70,175,F\nB,90,180,M\nC,NA,165,F\n");
  await page.getByLabel("Dataset name").fill("E2E pilot");
  await expect(page.getByText("3 rows · 4 columns")).toBeVisible();
  await page.getByRole("button", { name: "Import 3 rows" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Data Studio" })).toBeVisible();
  await expect(page.getByText("E2E pilot").first()).toBeVisible();

  await page.getByRole("button", { name: /Derived variables/ }).click();
  await page.getByRole("button", { name: "New variable" }).click();
  await page.getByLabel("Name (used in formulas)").fill("bmi_e2e");
  const fx = page.getByRole("dialog").getByLabel("Formula text");
  await fx.fill("weight / (height / 100) ^ 2");
  await fx.press("Enter");
  await expect(page.getByRole("dialog").getByText("✓ valid · gives number")).toBeVisible();
  await expect(page.getByRole("dialog").getByText(/1 missing of 3/)).toBeVisible();
  await page.getByRole("button", { name: "Create variable" }).click();
  await expect(page.getByText("= weight / (height / 100) ^ 2")).toBeVisible();
  expect(errors).toEqual([]);
});

test("build, save and reopen a cohort", async ({ page }) => {
  const errors = trackErrors(page);
  await useCardiometabolic(page);
  await page.goto("/cohorts");
  await page.getByRole("button", { name: "Load example criteria" }).click();
  await expect(page.getByLabel("Cohort title")).toHaveValue("Diabetes-free adults 30–75");
  // The flow diagram recomputes from the snapped pieces.
  await expect(page.getByText("1,367").first()).toBeVisible();
  await page.getByRole("button", { name: "Save cohort" }).click();
  await expect(page).toHaveURL(/\/cohorts\/[0-9a-f-]{36}$/);
  await page.reload();
  await expect(page.getByLabel("Cohort title")).toHaveValue("Diabetes-free adults 30–75");
  await expect(page.getByText("1,367").first()).toBeVisible();

  // A quick criterion appends a step and updates the flow.
  await page.getByLabel("Criterion column").selectOption("sbp");
  await page.getByLabel("Criterion operator").selectOption("lt");
  await page.getByLabel("Criterion value").fill("180");
  await page.getByRole("button", { name: "Add as inclusion criterion" }).click();
  await expect(page.getByText("unsaved", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("run statistics on the cohort and pin results", async ({ page }) => {
  const errors = trackErrors(page);
  await useCardiometabolic(page);
  await page.goto("/stats/table1");
  await expect(page.getByRole("columnheader", { name: /Overall \(n = 1,500\)/ })).toBeVisible();
  await page.getByRole("button", { name: "Pin to report" }).click();
  await expect(page.getByText(/Pinned to report/)).toBeVisible();

  await page.goto("/stats/survival");
  await expect(page.getByText(/Kaplan–Meier analysis of Cardiovascular event/)).toBeVisible();

  await page.goto("/stats/regression");
  await expect(page.getByText(/Cox proportional-hazards model/)).toBeVisible();
  expect(errors).toEqual([]);
});

test("compute a calculator and carry it into Score Forge", async ({ page }) => {
  const errors = trackErrors(page);
  await useCardiometabolic(page);
  await page.goto("/calculators/egfr_ckdepi_2021");
  await page.getByLabel("Serum creatinine", { exact: true }).fill("1.0");
  await page.getByLabel("Age", { exact: true }).fill("50");
  await expect(page.getByText("G1 · normal or high")).toBeVisible();
  await expect(page.getByText("92", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Open as puzzle" }).click();
  await expect(page).toHaveURL(/\/forge$/);
  await expect(page.getByText("✓ valid · gives number")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("AUC", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL(/\/forge\/[0-9a-f-]{36}$/);
  expect(errors).toEqual([]);
});

test("diagnostic lab and study design", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/diagnostic/two-by-two");
  await expect(page.getByText("90.0%").first()).toBeVisible();
  await page.getByLabel("True positive").fill("45");
  await expect(page.getByText("81.8%").first()).toBeVisible();

  await page.goto("/design/pico");
  await page.getByLabel("Add a term to Population").fill("type 2 diabetes");
  await page.getByLabel("Add a term to Population").press("Enter");
  await page.getByLabel("Add a term to Outcome").fill("heart failure");
  await page.getByLabel("Add a term to Outcome").press("Enter");
  await expect(page.locator("pre")).toContainText('"type 2 diabetes"[tiab] AND "heart failure"[tiab]');
  expect(errors).toEqual([]);
});

test("the report collects pinned results and exports Markdown", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/report");
  await expect(page.getByRole("heading", { name: /Table 1/ }).first()).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Markdown" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.md$/);
  expect(errors).toEqual([]);
});

test("the command palette navigates by keyboard", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("textbox", { name: "Command" }).fill("kaplan");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/stats\/survival$/);
});

test("a saved cohort still opens after a column changes type", async ({ page }) => {
  const errors = trackErrors(page);
  const created = await page.request.post("/api/workbench/datasets", { data: { name: "Drift check", csv_text: "x,y\n1,a\n2,b\n3,c\n" } });
  const { dataset } = (await created.json()) as { dataset: { id: string } };
  const cohort = await page.request.post("/api/workbench/documents", {
    data: {
      kind: "cohort",
      title: "Drift cohort",
      dataset_id: dataset.id,
      payload: { steps: [{ id: "s1", label: "x at least 2", kind: "include", expr: { k: "call", op: "ge", args: [{ k: "col", name: "x" }, { k: "num", v: 2 }] } }] },
    },
  });
  const { id } = (await cohort.json()) as { id: string };
  await page.request.patch(`/api/workbench/datasets/${dataset.id}`, { data: { columns: [{ name: "x", kind: "categorical" }] } });

  await page.goto(`/cohorts/${id}`);
  await expect(page.getByLabel("Cohort title")).toHaveValue("Drift cohort");
  // The step is shown and flagged instead of crashing the page.
  await expect(page.getByText(/A step cannot be evaluated/)).toBeVisible();
  expect(errors.filter((error) => !/Failed to load resource/.test(error))).toEqual([]);
});

test("leaving an edited cohort asks before discarding it", async ({ page }) => {
  await useCardiometabolic(page);
  await page.goto("/cohorts");
  await page.getByRole("button", { name: "Load example criteria" }).click();
  await expect(page.getByText("unsaved", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Statistics" }).click();
  await expect(page.getByRole("dialog")).toContainText("Discard unsaved changes?");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page).toHaveURL(/\/cohorts$/);
  await page.getByRole("link", { name: "Statistics" }).click();
  await page.getByRole("button", { name: "Discard and continue" }).click();
  await expect(page).toHaveURL(/\/stats$/);
});

test("clicking library pieces assembles a criterion, and right-click opens the block menu", async ({ page }) => {
  const errors = trackErrors(page);
  await useCardiometabolic(page);
  await page.goto("/cohorts");
  await page.getByRole("button", { name: "Insert Include rows where…" }).click();
  await page.getByRole("button", { name: "Insert Compare numbers" }).click();
  await page.getByRole("button", { name: "Insert age", exact: true }).click();
  await page.getByRole("button", { name: "Insert Number" }).click();
  // age ≥ 0 keeps everyone, and nothing is left loose or incomplete.
  await expect(page.getByText(/loose piece/)).toHaveCount(0);
  await expect(page.getByText(/incomplete step/)).toHaveCount(0);
  await expect(page.getByText(/Meeting: age ≥ 0/)).toBeVisible();

  // Right-click the step's own label text (not the start block that contains it).
  await page.locator(".blocklyText", { hasText: "rows where" }).first().click({ button: "right" });
  await expect(page.locator(".blocklyWidgetDiv")).toContainText(/Disable/);
  await page.locator(".blocklyWidgetDiv").getByText("Disable Block").click();
  // A switched-off step stays in the flow, marked as skipped.
  await expect(page.locator("svg title", { hasText: /^Include: age ≥ 0 — skipped/ })).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("a piece that does not fit its socket explains why", async ({ page }) => {
  const errors = trackErrors(page);
  await useCardiometabolic(page);
  await page.goto("/cohorts");
  await page.getByRole("button", { name: "Insert Include rows where…" }).click();
  // Nothing on the canvas takes a number yet, so the piece lands loose — and says so.
  await page.getByRole("button", { name: "Insert age", exact: true }).click();
  await expect(page.getByText(/No empty number socket/)).toBeVisible();

  // Drag it onto the step's yes/no socket: it cannot snap, and the hint says what to do.
  const piece = (await page.locator(".blocklyText", { hasText: /^age$/ }).last().boundingBox())!;
  const label = (await page.locator(".blocklyText", { hasText: "rows where" }).first().boundingBox())!;
  await page.mouse.move(piece.x + 2, piece.y + piece.height / 2);
  await page.mouse.down();
  await page.mouse.move(label.x + label.width + 16, label.y + label.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(page.getByText(/A number piece doesn’t fit a yes\/no socket\. Compare it first/)).toBeVisible();
  expect(errors).toEqual([]);
});

test("yes/no columns are recognised and case variants can be merged", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/data");
  await page.getByRole("button", { name: "Import a dataset" }).click();
  await page.getByLabel("Pasted data").fill("id,smoker,sex\nA,Yes,male\nB,no,Male\nC,YES,Male\nD,No,Female\n");
  await page.getByLabel("Dataset name").fill("E2E spelling");
  await expect(page.getByText(/some values differ only in letter case/)).toBeVisible();
  await page.getByRole("button", { name: "Import 4 rows" }).click();
  await expect(page.getByText("E2E spelling").first()).toBeVisible();

  const profiles = page.getByRole("region", { name: "Column profiles" });
  await expect(profiles.locator("tr", { hasText: "smoker" })).toContainText("yes/no");
  await profiles.locator("tr", { hasText: "sex" }).click();
  await page.getByRole("button", { name: "Merge case variants" }).click();
  await expect(page.getByRole("dialog")).toContainText("male → Male");
  await page.getByRole("button", { name: "Merge", exact: true }).click();
  await expect(page.getByText("Merged · 1 value respelled")).toBeVisible();
  await expect(page.getByRole("button", { name: "Merge case variants" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("browser Back asks before discarding an edited cohort", async ({ page }) => {
  await useCardiometabolic(page);
  await page.goto("/stats");
  // In-app navigation, so Back stays inside the router instead of unloading the page.
  await page.getByRole("link", { name: "Cohort Builder" }).click();
  await expect(page).toHaveURL(/\/cohorts$/);
  await page.getByRole("button", { name: "Load example criteria" }).click();
  await expect(page.getByText("unsaved", { exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("dialog")).toContainText("Discard unsaved changes?");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page).toHaveURL(/\/cohorts$/);
});

test("switching a calculator unit converts the entered value", async ({ page }) => {
  await page.goto("/calculators/egfr_ckdepi_2021");
  await page.getByLabel("Serum creatinine", { exact: true }).fill("1.0");
  await page.getByLabel("Age", { exact: true }).fill("50");
  await expect(page.getByText("92", { exact: true })).toBeVisible();
  await page.getByLabel("Serum creatinine unit").selectOption({ label: "µmol/L" });
  await expect(page.getByLabel("Serum creatinine", { exact: true })).toHaveValue("88.42");
  await expect(page.getByText("92", { exact: true })).toBeVisible();
});

test("a saved study plan has its own URL", async ({ page }) => {
  await page.goto("/design/pico");
  await page.getByLabel("Study plan title").fill("E2E plan");
  await page.getByRole("button", { name: "Save plan" }).click();
  await expect(page).toHaveURL(/plan=[0-9a-f-]{36}/);
  await page.reload();
  await expect(page.getByLabel("Study plan title")).toHaveValue("E2E plan");
});

test("the public catalogue filters by field, shows how to cite, and refuses a source that changed", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/");
  const catalogue = page.locator("section", { has: page.getByRole("heading", { name: "Public research datasets" }) });
  await catalogue.getByRole("button", { name: /^Hepatology/ }).click();
  await expect(catalogue.locator("article")).toHaveCount(2);
  const pbc = catalogue.locator("article", { hasText: "Mayo Clinic primary biliary cholangitis trial" });
  await pbc.getByText("Cite", { exact: true }).click();
  await expect(pbc).toContainText("Therneau T. survival");
  // The browser-test API serves a synthetic stand-in, so the digest check must refuse it.
  await pbc.getByRole("button", { name: "Download and add Mayo Clinic primary biliary cholangitis trial" }).click();
  await expect(pbc).toContainText("no longer matches the verified version");
  await expect(pbc.getByRole("button", { name: /Download and add/ })).toHaveText("Try again");
  // Nothing was added.
  await page.goto("/data");
  await expect(page.getByText("Mayo Clinic primary biliary cholangitis trial")).toHaveCount(0);
  expect(errors.filter((message) => !message.includes("502"))).toEqual([]);
});
