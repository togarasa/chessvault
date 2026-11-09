import { execSync } from "node:child_process";
import { resolve } from "node:path";

/// The stand-in UCI engine of the Rust tests, which the e2e tests use instead of Stockfish.
export const FAKE_ENGINE = resolve(import.meta.dirname, "../../target/e2e/debug/fake-uci-engine.exe");

/// Builds the app with its frontend built in, into its own target folder so a running
/// `pnpm tauri dev` is never disturbed. Later runs only rebuild what changed.
export default function globalSetup() {
  if (process.env.CHESSVAULT_E2E_SKIP_BUILD) return;
  execSync("pnpm tauri build --debug --no-bundle", {
    cwd: resolve(import.meta.dirname, ".."),
    stdio: "inherit",
    env: { ...process.env, CARGO_TARGET_DIR: resolve(import.meta.dirname, "../../target/e2e") },
  });
  execSync("cargo build -p chessvault-core --bin fake-uci-engine", {
    stdio: "inherit",
    env: { ...process.env, CARGO_TARGET_DIR: resolve(import.meta.dirname, "../../target/e2e") },
  });
}
