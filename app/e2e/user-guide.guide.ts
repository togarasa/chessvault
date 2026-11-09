// Records the screenshots and videos of the user guide (docs/user/) from the real app with the
// self-made sample games. Run with `pnpm docs:capture`; set CHESSVAULT_ENGINE to a UCI engine to
// include the engine panel. Videos are driven through playwright-cli, whose callouts name each
// action, with a chapter title for each step.
import { Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "./app";
import { FAKE_ENGINE } from "./global-setup";

const DOCS = resolve(import.meta.dirname, "../../docs/user");
const CLI = resolve(import.meta.dirname, "../node_modules/@playwright/cli/playwright-cli.js");
mkdirSync(resolve(DOCS, "images"), { recursive: true });
mkdirSync(resolve(DOCS, "videos"), { recursive: true });

/// Runs a playwright-cli command in this test's session.
function cli(...args: string[]): string {
  return execFileSync(process.execPath, [CLI, "-s=guide", ...args], { encoding: "utf8" });
}

async function shot(page: Page, name: string) {
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(DOCS, "images", `${name}.png`) });
}

/// Opens the game whose row contains `player` and waits until it is on the board.
async function openGame(page: Page, player: string) {
  const row = page.locator(".games tbody tr", { hasText: player });
  await row.click();
  await expect(row).toHaveClass(/active/);
  await expect(page.locator(".notation .move.active")).toHaveText("Start");
}

/// Puts the sample file in the recent list so it shows as a tile.
async function seedRecent(page: Page, pgn: string) {
  await page.evaluate((p) => localStorage.setItem("chessvault.recent", JSON.stringify([{ path: p, openedAt: Date.now() }])), pgn);
  await page.reload();
  await page.locator(".tile").nth(1).waitFor();
}

/// The middle of a board square, e.g. "e2", in page coordinates.
async function square(page: Page, name: string) {
  const box = (await page.locator(".board cg-board").boundingBox())!;
  const size = box.width / 8;
  const file = name.charCodeAt(0) - 97;
  const rank = Number(name[1]) - 1;
  return [Math.round(box.x + (file + 0.5) * size), Math.round(box.y + (7.5 - rank) * size)];
}

/// Plays a move on the board through playwright-cli, so the video shows the clicks.
async function cliMove(page: Page, uci: string) {
  for (const sq of [uci.slice(0, 2), uci.slice(2, 4)]) {
    const [x, y] = await square(page, sq);
    cli("mousemove", String(x), String(y));
    cli("mousedown");
    cli("mouseup");
  }
}

/// Records `steps` as docs/user/videos/<name>.webm, stopping the recording even if a step fails.
async function video(cdpUrl: string, name: string, steps: () => Promise<void>) {
  cli("attach", `--cdp=${cdpUrl}`);
  cli("video-start", resolve(DOCS, "videos", `${name}.webm`));
  cli("video-show-actions");
  try {
    await steps();
  } finally {
    cli("video-stop");
    cli("detach");
  }
}

/// A form field by its label, as a playwright-cli target.
const field = (form: string, label: string) => `${form} label:has-text('${label}') >> input`;

test("start screen, game list and a game", async ({ chessvault: { page, pgn } }) => {
  await seedRecent(page, pgn);
  await shot(page, "start-screen");

  await page.locator(".tile").nth(1).dblclick();
  await expect(page.locator(".games tbody tr")).toHaveCount(3);
  await shot(page, "game-list");

  await openGame(page, "Delta, Dora");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".notation .move.active")).toHaveText("1. e4");
  await shot(page, "game-view");

  await page.locator(".notation .move", { hasText: "c5" }).click({ button: "right" });
  await shot(page, "move-menu");
  await page.keyboard.press("Escape");

  await page.locator(".notation .move", { hasText: "Start" }).click();
  await page.waitForTimeout(200);
  const [x1, y1] = await square(page, "c2");
  const [x2, y2] = await square(page, "c4");
  await page.mouse.click(x1, y1);
  await page.mouse.click(x2, y2);
  await expect(page.locator(".dialog")).toContainText("c4 is a new move here.");
  await shot(page, "variation-prompt");
  await page.keyboard.press("Escape");
});

test("opening a .cbh database", async ({ chessvault: { page, dir } }) => {
  const fixtures = resolve(import.meta.dirname, "../../crates/core/tests/fixtures/chessbase");
  for (const file of readdirSync(fixtures).filter((name) => name.startsWith("club."))) {
    copyFileSync(resolve(fixtures, file), resolve(dir, file));
  }
  await seedRecent(page, resolve(dir, "club.cbh"));
  await page.locator(".tile").nth(1).dblclick();
  // The debug build the guide is recorded with starts slowly, so the window stays long enough.
  await expect(page.getByRole("dialog", { name: "Converting" })).toBeVisible();
  await shot(page, "conversion");
  await expect(page.locator(".games tbody tr")).toHaveCount(2, { timeout: 60_000 });
});

test("search window and results", async ({ chessvault: { page, pgn, openFile } }) => {
  await openFile(pgn);
  await page.getByRole("button", { name: "Search games…" }).click();
  await page.getByLabel("White player").fill("Alpha");
  await page.getByLabel("Ignore colour", { exact: true }).check();
  await shot(page, "search-window");
  await page.locator(".search-dialog").getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.locator(".filter-summary")).toBeVisible();
  await shot(page, "search-results");
});

test("saving a new game", async ({ chessvault: { page, pgn, openFile } }) => {
  await openFile(pgn);
  await page.getByRole("button", { name: "New game" }).click();
  for (const [from, to] of [["e2", "e4"], ["c7", "c5"]]) {
    const [a, b] = await square(page, from);
    const [c, d] = await square(page, to);
    await page.mouse.click(a, b);
    await page.mouse.click(c, d);
    await page.waitForTimeout(200);
  }
  await page.getByRole("button", { name: "Save as new game" }).click();
  await page.locator(".dialog").getByLabel("White").fill("Player, Eve");
  await page.locator(".dialog").getByLabel("Black").fill("Player, Frank");
  await shot(page, "save-new-game");
});

test("engine panel", async ({ chessvault: { page, pgn, openFile } }) => {
  test.skip(!process.env.CHESSVAULT_ENGINE, "set CHESSVAULT_ENGINE to a UCI engine to capture the engine panel");
  await page.evaluate((path) => localStorage.setItem("chessvault.enginePath", path), process.env.CHESSVAULT_ENGINE!);
  await openFile(pgn);
  await openGame(page, "Beta, Bernd");
  await page.keyboard.press("End");
  await page.getByRole("button", { name: "Analyze" }).click();
  await expect(page.locator(".engine-line")).toHaveCount(3, { timeout: 15_000 });
  await page.waitForTimeout(2000);
  await page.locator(".panel").first().screenshot({ path: resolve(DOCS, "images", "engine-panel.png") });
  await page.getByRole("button", { name: "Stop" }).click();
});

test("evaluation bar and a clickable engine line", async ({ chessvault: { page, pgn, openFile } }) => {
  // The tests' stand-in engine always suggests 1. e4, which is enough to show how it looks.
  await page.evaluate((path) => localStorage.setItem("chessvault.enginePath", path), FAKE_ENGINE);
  await openFile(pgn);
  await page.getByRole("button", { name: "New game" }).click();
  await page.getByRole("button", { name: "Analyze" }).click();
  await expect(page.locator(".evalbar")).toHaveAttribute("title", "+0.30");
  // Show the example path from the guide, not where the stand-in engine is on this computer.
  await page.locator(".panel input.path").evaluate((input: HTMLInputElement) => {
    input.value = "C:\\Tools\\stockfish\\stockfish-windows-x86-64.exe";
  });
  await page.locator(".engine-line .pv-move").first().hover();
  await page.locator(".gameview").screenshot({ path: resolve(DOCS, "images", "analysis.png") });
  await page.getByRole("button", { name: "Stop" }).click();
});

test("video: open a database and browse a game", async ({ chessvault: { page, pgn, cdpUrl } }) => {
  await seedRecent(page, pgn);
  await video(cdpUrl, "open-and-browse", async () => {
    cli("video-chapter", "Double-click a database tile to open it");
    cli("dblclick", ".tile >> nth=1");
    await expect(page.locator(".games tbody tr")).toHaveCount(3);
    cli("video-chapter", "Click a column header to sort; click again to reverse");
    cli("click", ".games th >> nth=2");
    cli("click", ".games th >> nth=2");
    cli("video-chapter", "Click a game to show it on the board");
    cli("click", ".games tbody tr:has-text('Delta, Dora')");
    await expect(page.locator(".notation")).toContainText("A good start");
    cli("video-chapter", "Step through the moves with the arrow keys");
    for (const key of ["ArrowRight", "ArrowRight", "ArrowLeft", "End", "Home"]) cli("press", key);
    cli("video-chapter", "Click a move in a variation to see it");
    cli("click", ".notation .variation .move >> nth=1");
    await page.waitForTimeout(800);
  });
});

test("video: enter a variation, comment it and save", async ({ chessvault: { page, pgn, cdpUrl, openFile } }) => {
  await openFile(pgn);
  await openGame(page, "Beta, Bernd");
  await video(cdpUrl, "enter-variation", async () => {
    cli("video-chapter", "Go to the move before the one you want to change");
    cli("click", ".notation .move:has-text('2. Nf3')");
    cli("video-chapter", "Play the other move on the board");
    await cliMove(page, "g8f6");
    await expect(page.locator(".dialog")).toContainText("Nf6 is a new move here.");
    cli("video-chapter", "Choose New variation to keep both moves");
    cli("click", ".dialog button:has-text('New variation')");
    cli("video-chapter", "Right-click a move to comment on it or give it a symbol");
    cli("click", ".notation .move.active", "right");
    cli("click", ".menu button:has-text('Add comment')");
    cli("type", "Another good reply");
    cli("press", "Enter");
    cli("click", ".notation .move.active", "right");
    cli("click", ".menu-row button:text-is('!?')");
    cli("video-chapter", "Save the game; Undo last save brings back the old version");
    cli("click", ".actions button:text-is('Save')");
    await expect(page.locator(".status")).toContainText("Saved game 1");
    await page.waitForTimeout(800);
  });
});

test("video: enter and save a new game", async ({ chessvault: { page, pgn, cdpUrl, openFile } }) => {
  await openFile(pgn);
  await video(cdpUrl, "new-game", async () => {
    cli("video-chapter", "New game starts an empty board");
    cli("click", "button:text-is('New game')");
    cli("video-chapter", "Make the moves on the board");
    for (const move of ["d2d4", "g8f6", "c2c4", "e7e6"]) {
      await cliMove(page, move);
      await page.waitForTimeout(200);
    }
    cli("video-chapter", "Save as new game asks for the players and where to save");
    cli("click", "button:has-text('Save as new game')");
    cli("fill", field(".dialog", "White"), "Player, Eve");
    cli("fill", field(".dialog", "Black"), "Player, Frank");
    cli("click", ".dialog button:text-is('OK')");
    await expect(page.locator(".status")).toContainText("Added game 4");
    cli("video-chapter", "The game is now in the list");
    await page.waitForTimeout(1200);
  });
});

test("video: search for games", async ({ chessvault: { page, pgn, cdpUrl, openFile } }) => {
  await openFile(pgn);
  await video(cdpUrl, "search", async () => {
    cli("video-chapter", "Quick search: type a player's name and press Enter");
    cli("fill", "input[placeholder='Search by player name']", "Gamma");
    cli("press", "Enter");
    cli("video-chapter", "Search games… finds by result, ECO, date, Elo and more");
    cli("click", "button:has-text('Search games…')");
    cli("fill", field(".search-dialog", "ECO from"), "C");
    cli("fill", field(".search-dialog", "ECO to"), "D9");
    cli("click", ".search-dialog button:text-is('Search')");
    await expect(page.locator(".filter-summary")).toContainText("ECO C–D9");
    cli("video-chapter", "Show all games brings the full list back");
    cli("click", "button:has-text('Show all games')");
    await page.waitForTimeout(1000);
  });
});
