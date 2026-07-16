import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        // Server, shared contracts, scripts, and the browser-free kernel tests.
        test: {
          name: "node",
          environment: "node",
          include: ["server/**/*.test.ts", "shared/**/*.test.ts", "scripts/**/*.test.ts"],
        },
      },
      {
        plugins: [react()],
        test: {
          name: "ui",
          environment: "jsdom",
          setupFiles: ["src/test/setup.ts"],
          include: ["src/**/*.test.{ts,tsx}"],
        },
      },
    ],
  },
});
