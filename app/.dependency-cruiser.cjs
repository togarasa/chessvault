// Architecture tests for the frontend: the import rules in docs/ARCHITECTURE.md.
// Run with `pnpm test:arch`.

/// The logic layer: plain TypeScript, no React, no Tauri, no screen code.
const LOGIC = "^src/(tree|filter|recent|engine|columns|pgn|conversion|types)\\.ts$";

module.exports = {
  forbidden: [
    {
      name: "only-api-talks-to-tauri",
      comment: "Only src/api.ts may call the Tauri backend; everything else goes through it.",
      severity: "error",
      from: { path: "^src/", pathNot: "^src/api\\.ts$" },
      to: { path: "@tauri-apps" },
    },
    {
      name: "logic-is-pure",
      comment: "The logic layer must not use React, Tauri, the board, hooks, components or api.ts.",
      severity: "error",
      from: { path: LOGIC },
      to: { path: ["(^|/)react", "@tauri-apps", "chessground", "^src/use[A-Z]", "\\.tsx$", "^src/api\\.ts$"] },
    },
    {
      name: "api-uses-only-logic-types",
      comment: "api.ts is an adapter: it may use the logic layer's types but no hooks or components.",
      severity: "error",
      from: { path: "^src/api\\.ts$" },
      to: { path: ["^src/use[A-Z]", "\\.tsx$"] },
    },
    {
      name: "screens-use-hooks-for-the-backend",
      comment: "Screens show state; they reach the backend through hooks (App.tsx, which runs the file operations, may call api.ts).",
      severity: "error",
      from: { path: "\\.tsx$", pathNot: ["^src/App\\.tsx$", "\\.test\\.tsx$"] },
      to: { path: "^src/api\\.ts$" },
    },
    {
      name: "hooks-do-not-render",
      comment: "Hooks hold state and call api.ts; they don't import screens (only Dialog.tsx for its types).",
      severity: "error",
      from: { path: "^src/use[A-Z]" },
      to: { path: "\\.tsx$", pathNot: "^src/Dialog\\.tsx$" },
    },
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-orphans",
      comment: "Every module is used, apart from entry points, configs and tests.",
      severity: "error",
      from: {
        orphan: true,
        pathNot: ["\\.d\\.ts$", "\\.test\\.ts$", "^src/main\\.tsx$", "(^|/)[^/]+\\.config\\.ts$", "^e2e/"],
      },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    exclude: { path: "\\.css$" },
  },
};
