import { Browser, Page, test as base, chromium, expect } from "@playwright/test";
import { ChildProcess, spawn } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/// The test build of the app, made by global-setup.ts.
export const APP_EXE = resolve(import.meta.dirname, "../../target/e2e/debug/app.exe");
const SAMPLE_PGN = resolve(import.meta.dirname, "fixtures/sample.pgn");

let nextPort = 9400;

/// The running app: its window, and a fresh copy of the sample games it can open.
export type ChessVault = {
  page: Page;
  /// The copy of `fixtures/sample.pgn` for this test.
  pgn: string;
  /// Opens a file the way a user does from the start screen's recent files.
  openFile: (path: string) => Promise<void>;
};

/// Starts the app with its own WebView2 profile, so tests never touch the user's
/// recent files or settings, and connects Playwright to its window.
async function launch(dir: string): Promise<{ app: ChildProcess; browser: Browser; page: Page }> {
  const port = nextPort++;
  const app = spawn(APP_EXE, [], {
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
      WEBVIEW2_USER_DATA_FOLDER: join(dir, "profile"),
    },
  });
  let browser: Browser | undefined;
  for (let i = 0; i < 60 && !browser; i++) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  if (!browser) {
    app.kill();
    throw new Error(`the app did not open a debugging port at ${port}`);
  }
  const page = browser.contexts()[0].pages()[0] ?? (await browser.contexts()[0].waitForEvent("page"));
  await page.locator(".app").waitFor();
  return { app, browser, page };
}

export const test = base.extend<{ chessvault: ChessVault }>({
  chessvault: async ({}, use) => {
    const dir = mkdtempSync(join(tmpdir(), "chessvault-e2e-"));
    const pgn = join(dir, "sample.pgn");
    copyFileSync(SAMPLE_PGN, pgn);
    const { app, browser, page } = await launch(dir);

    async function openFile(path: string) {
      // The native Open window can't be driven, so put the file in the recent list and click it there.
      await page.evaluate((p) => {
        localStorage.setItem("chessvault.recent", JSON.stringify([{ path: p, openedAt: Date.now() }]));
      }, path);
      await page.reload();
      await page.locator("button.recent").first().click();
      await expect(page.locator(".status")).toContainText(/Imported|Opened/);
    }

    await use({ page, pgn, openFile });

    await browser.close().catch(() => {});
    app.kill();
    // WebView2 lets go of its profile a moment after the app exits.
    for (let i = 0; i < 10; i++) {
      try {
        rmSync(dir, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  },
});

export { expect };

/// Clicks one board square, e.g. "e2". The board shows White at the bottom.
export async function clickSquare(page: Page, square: string) {
  const box = await page.locator(".board cg-board").boundingBox();
  if (!box) throw new Error("the board is not visible");
  const file = square.charCodeAt(0) - "a".charCodeAt(0);
  const rank = Number(square[1]) - 1;
  const size = box.width / 8;
  await page.mouse.click(box.x + (file + 0.5) * size, box.y + (7 - rank + 0.5) * size);
}

/// Plays a move on the board by clicking its two squares, e.g. "e2e4". Wait for the
/// position to show first: the board only takes moves for the side to move there.
export async function playMove(page: Page, uci: string) {
  await clickSquare(page, uci.slice(0, 2));
  await clickSquare(page, uci.slice(2, 4));
}
