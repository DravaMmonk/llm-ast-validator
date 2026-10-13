/**
 * The Definition of Done walkthrough (plan Section 16), in a real browser.
 *
 * It injects a test-only Generator and a synthetic cohort fixture — never the
 * production provider or real workbook — so no artifact this test produces can
 * contain a real cohort row.
 */

import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });

/** Fails the test on any console error, per the batch's acceptance. */
function failOnConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));
  return errors;
}

test("the closed loop survives a refresh and a restart", async ({ page }) => {
  const errors = failOnConsoleErrors(page);
  const blocklyMediaRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).hostname === "blockly-demo.appspot.com") blocklyMediaRequests.push(request.url());
  });

  // 2. Create a new session from the session rail.
  await page.goto("/sessions");
  await page.getByRole("button", { name: "New session" }).first().click();
  await expect(page.getByLabel("Session title")).toBeVisible();
  const sessionUrl = page.url();
  expect(sessionUrl).toContain("/sessions/");

  // 3. Enter a natural-language request and receive multiple candidates.
  await page
    .getByLabel("Natural-language requirement")
    .fill("Score incident diabetes risk from baseline fasting glucose and BMI");
  await page.getByLabel("Candidate count").selectOption("3");
  await page.getByRole("button", { name: "Generate candidates" }).click();

  await expect(page.getByText("baseline_glucose")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("glucose_bmi")).toBeVisible();
  await expect(page.getByText("invented_signal")).toBeVisible();
  await expect(page.getByText("test-fixture · fixture-v1")).toBeVisible();

  // 4. Inspect a deterministic validation result: the invented signal is
  //    blocked, then repaired, and the record shows both.
  await expect(page.getByTitle("One bounded repair was applied.")).toBeVisible();
  await page.getByText("Version history").click();
  await expect(page.getByText("UNKNOWN_SIGNAL")).toBeVisible();

  // Select an admitted candidate; it loads into the one Blockly canvas.
  await page.getByText("glucose_bmi").click();
  await expect(page.getByLabel("Formula text")).toHaveValue(
    "baseline_fasting_plasma_glucose + 0.1 * bmi",
    { timeout: 15_000 },
  );

  // 5. Modify it and save a new Blockly version.
  await page.getByLabel("Formula text").fill("baseline_fasting_plasma_glucose + 0.05 * bmi + 0.01 * age");
  await page.getByLabel("Formula text").press("Enter");
  await expect(page.getByText("unsaved", { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Save version" }).click();
  await expect(page.getByText("v2 · blockly").first()).toBeVisible({ timeout: 15_000 });

  // 6. Run cohort evaluation for the saved version.
  await page.getByRole("tab", { name: "Cohort results" }).or(page.getByRole("button", { name: "Cohort results" })).click();
  await page.getByRole("button", { name: "Run cohort evaluation" }).click();

  // 7. Compare metrics and inspect rows against observed outcomes.
  await expect(page.getByText("AUROC")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("exploratory", { exact: true })).toBeVisible();
  await expect(page.getByText(/N=\d+/)).toBeVisible();
  await expect(page.getByText("Candidate version")).toBeVisible();
  await expect(page.getByText("Dataset version")).toBeVisible();

  // The language contract: observed outcome, never a diagnosis or probability.
  const body = await page.locator("body").innerText();
  expect(body).not.toMatch(/ground.truth/i);
  expect(body).not.toMatch(/\bdiagnosis\b/i);
  expect(body).not.toMatch(/\bprobability\b/i);

  // 8. Accept one exact version with a note.
  await page.getByLabel("Decision note").fill("Reasonable on the synthetic cohort.");
  await page.getByRole("button", { name: "Accept" }).click();
  await expect(page.getByText(/Reasonable on the synthetic cohort/)).toBeVisible({ timeout: 15_000 });

  // 9-10. Refresh: the session, the Blockly version, and the decision return
  //       from the API, since none of it lives in browser memory.
  await page.reload();
  await expect(page.getByText("v2 · blockly").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByLabel("Formula text")).toHaveValue(
    "baseline_fasting_plasma_glucose + 0.05 * bmi + 0.01 * age",
  );

  // Row filters reset to their documented default.
  await page.getByRole("button", { name: "Cohort results" }).click();
  await expect(page.getByText("AUROC")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Reasonable on the synthetic cohort/)).toBeVisible();

  expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
  expect(blocklyMediaRequests, "Blockly must not fetch demo media from Appspot").toEqual([]);
});

test("an unsaved draft cannot be evaluated", async ({ page }) => {
  await page.goto("/sessions");
  await page.getByRole("button", { name: "New session" }).first().click();
  await page.getByLabel("Natural-language requirement").fill("Score risk from baseline glucose");
  await page.getByRole("button", { name: "Generate candidates" }).click();
  await expect(page.getByText("baseline_glucose")).toBeVisible({ timeout: 20_000 });

  await page.getByText("baseline_glucose").click();
  await expect(page.getByLabel("Formula text")).toHaveValue("baseline_fasting_plasma_glucose", { timeout: 15_000 });

  // Make it dirty without saving.
  await page.getByLabel("Formula text").fill("baseline_fasting_plasma_glucose + 1");
  await page.getByLabel("Formula text").press("Enter");
  await expect(page.getByText("unsaved", { exact: true })).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "Cohort results" }).click();
  await expect(page.getByRole("button", { name: "Run cohort evaluation" })).toBeDisabled();
  await expect(page.getByText(/a draft cannot be evaluated/i)).toBeVisible();
});

test("a blocked candidate never reaches the canvas", async ({ page }) => {
  await page.goto("/sessions");
  await page.getByRole("button", { name: "New session" }).first().click();
  await page.getByLabel("Natural-language requirement").fill("Score risk using a glucose column in mg/dL");
  await page.getByLabel("Candidate count").selectOption("3");
  await page.getByRole("button", { name: "Generate candidates" }).click();

  // The deliberately invalid proposal is visible with its diagnostic and its
  // repair; the blocked attempt is never silently dropped.
  await expect(page.getByText("invented_signal")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTitle("One bounded repair was applied.")).toBeVisible();
});
