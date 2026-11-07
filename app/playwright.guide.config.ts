import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";
import base from "./playwright.config";

// Keep the user's name out of the paths the screenshots show (tiles, status bar).
process.env.CHESSVAULT_E2E_DIR ??= resolve(import.meta.dirname, "../target/user-guide");

/// Records the user guide's screenshots and videos (`pnpm docs:capture`); not part of the test run.
export default defineConfig({
  ...base,
  testMatch: "**/*.guide.ts",
  timeout: 120_000,
});
