import { defineConfig } from "vitest/config";

/// Unit tests for the frontend logic. The real app is tested end to end by Playwright (`e2e/`).
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.ts", "src/vite-env.d.ts", "src/main.tsx"],
      reporter: ["text-summary", "text"],
    },
  },
});
