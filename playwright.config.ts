import { defineConfig } from "@playwright/test";

/**
 * The browser smoke path runs against a dedicated synthetic database, never
 * `var/research.db` and never the real workbook (Section 15).
 */
const E2E_DB = "var/e2e.db";
const API_PORT = 8788;
const WEB_PORT = 5174;

export default defineConfig({
  testDir: "e2e",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "off",
    video: "off",
    screenshot: "off",
  },
  webServer: [
    {
      command: `npx tsx e2e/seed-fixture.ts && npx tsx e2e/server.ts`,
      env: {
        RESEARCH_DB_PATH: E2E_DB,
        PORT: String(API_PORT),
        // The API only answers the origin it is told to answer.
        ALLOWED_ORIGINS: `http://localhost:${WEB_PORT},http://127.0.0.1:${WEB_PORT}`,
      },
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      reuseExistingServer: false,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: `npx vite --port ${WEB_PORT} --strictPort`,
      env: { API_TARGET: `http://127.0.0.1:${API_PORT}` },
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
    },
  ],
});
