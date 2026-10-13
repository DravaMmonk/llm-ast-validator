/**
 * README screenshots, regenerated on demand:
 *
 *   SCREENSHOTS=1 npx playwright test e2e/screenshots.spec.ts
 *
 * Skipped in normal runs. Uses only the built-in synthetic sample, against the
 * throwaway e2e database — never real cohort data.
 */

import { expect, test, type Page } from "@playwright/test";

const OUT = "docs/screenshots";

test.skip(!process.env.SCREENSHOTS, "set SCREENSHOTS=1 to regenerate the README screenshots");
test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: "light" });
});

async function useCardiometabolic(page: Page) {
  await page.goto("/");
  await page.locator("article", { hasText: "Synthetic cardiometabolic cohort" }).getByRole("button").click();
  await expect(page.getByRole("button", { name: /^Active dataset: Synthetic cardiometabolic cohort/ })).toBeVisible({ timeout: 15_000 });
}

async function shoot(page: Page, name: string) {
  // Park the pointer away from hover cards, then let charts, KaTeX and the canvas settle.
  await page.mouse.move(1430, 890);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/${name}.png` });
}

test("overview", async ({ page }) => {
  await useCardiometabolic(page);
  await shoot(page, "overview");
});

test("cohort builder", async ({ page }) => {
  await useCardiometabolic(page);
  await page.goto("/cohorts");
  await page.getByRole("button", { name: "Load example criteria" }).click();
  await expect(page.getByText("1,367").first()).toBeVisible();
  await shoot(page, "cohort-builder");
});

test("score forge", async ({ page }) => {
  await useCardiometabolic(page);
  await page.goto("/forge");
  const fx = page.getByLabel("Formula text");
  await fx.fill("if(age >= 60, 2, 0) + if(bmi >= 30, 2, 0) + if(fpg_mmol >= 5.6, 3, 0) + if(sbp >= 140, 1, 0)");
  await fx.press("Enter");
  await expect(page.getByText(/AUC/).first()).toBeVisible();
  await shoot(page, "score-forge");
});

test("statistics", async ({ page }) => {
  await useCardiometabolic(page);
  await page.goto("/stats/survival");
  await page.getByLabel("Group", { exact: true }).selectOption("smoking");
  await expect(page.getByText(/χ² = /).first()).toBeVisible({ timeout: 15_000 });
  await shoot(page, "kaplan-meier");
});

test("calculators", async ({ page }) => {
  await useCardiometabolic(page);
  await page.goto("/calculators/egfr_ckdepi_2021");
  await page.getByLabel("Serum creatinine", { exact: true }).fill("1.1");
  await page.getByLabel("Age", { exact: true }).fill("62");
  await shoot(page, "calculators");
});

test("diagnostic lab", async ({ page }) => {
  await useCardiometabolic(page);
  await page.goto("/diagnostic/fagan");
  await shoot(page, "fagan-nomogram");
});
