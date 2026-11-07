import { defineConfig } from "vitest/config";

/// Unit and component tests. The real app is tested end to end by Playwright (`e2e/`).
export default defineConfig({
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "happy-dom",
    setupFiles: ["src/test-setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/test-setup.ts", "src/vite-env.d.ts", "src/main.tsx"],
      reporter: ["text-summary", "text", "json-summary"],
      thresholds: { branches: 80 },
    },
  },
});
