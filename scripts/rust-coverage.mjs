// Measures branch coverage of the Rust crates and fails below 80%.
// Branch coverage needs the nightly toolchain: `rustup toolchain install nightly`.
// Run from the repository root: `node scripts/rust-coverage.mjs`.
// The desktop backend (`app/src-tauri`) is left out: its commands are covered by the e2e tests.
import { execFileSync } from "node:child_process";

const MINIMUM = 80;

const json = execFileSync(
  "cargo",
  ["+nightly", "llvm-cov", "--workspace", "--exclude", "app", "--branch", "--json", "--summary-only"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 64 * 1024 * 1024 },
);
const totals = JSON.parse(json).data[0].totals;
for (const kind of ["branches", "lines", "functions"]) {
  const { covered, count, percent } = totals[kind];
  console.log(`${kind.padEnd(9)} ${percent.toFixed(2)}% (${covered}/${count})`);
}
if (totals.branches.percent < MINIMUM) {
  console.error(`Branch coverage is below ${MINIMUM}%.`);
  process.exit(1);
}
