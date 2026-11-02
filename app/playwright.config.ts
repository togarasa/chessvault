import { defineConfig } from "@playwright/test";

/// End-to-end tests drive the real Windows app through WebView2's debugging port.
/// Run with `pnpm test:e2e`.
export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  // Each test starts its own app window; running them one at a time keeps that reliable.
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
});
