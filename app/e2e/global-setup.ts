import { execSync } from "node:child_process";
import { resolve } from "node:path";

/// Builds the app with its frontend built in, into its own target folder so a running
/// `pnpm tauri dev` is never disturbed. Later runs only rebuild what changed.
export default function globalSetup() {
  if (process.env.CHESSVAULT_E2E_SKIP_BUILD) return;
  execSync("pnpm tauri build --debug --no-bundle", {
    cwd: resolve(import.meta.dirname, ".."),
    stdio: "inherit",
    env: { ...process.env, CARGO_TARGET_DIR: resolve(import.meta.dirname, "../../target/e2e") },
  });
}
