import { Page } from "@playwright/test";
import { FAKE_ENGINE } from "./global-setup";
import { expect, test } from "./app";

const notation = (page: Page) => page.locator(".notation");

/// Clicks the game whose row contains `player` and waits until it is on the board.
async function openGame(page: Page, player: string) {
  const row = page.locator(".games tbody tr").filter({ hasText: player });
  await row.click();
  await expect(row).toHaveClass(/active/);
  await expect(notation(page).locator(".move.active")).toHaveText("Start");
}

test("the board flips with its button and with F", async ({ chessvault: { page, pgn, openFile } }) => {
  await openFile(pgn);
  await openGame(page, "Beta, Bernd");
  const board = page.locator(".board");
  await expect(board).toHaveClass(/orientation-white/);
  await page.getByRole("button", { name: "Flip board" }).click();
  await expect(board).toHaveClass(/orientation-black/);
  await page.locator(".notation").click();
  await page.keyboard.press("f");
  await expect(board).toHaveClass(/orientation-white/);
});

test("Ctrl+S saves and Delete removes the moves from the shown one", async ({ chessvault: { page, pgn, openFile } }) => {
  await openFile(pgn);
  await openGame(page, "Beta, Bernd");
  await page.keyboard.press("End");
  const last = await notation(page).locator(".move.active").innerText();
  await page.keyboard.press("Delete");
  await expect(notation(page)).not.toContainText(last);
  await expect(page.getByText("Unsaved changes")).toBeVisible();
  // Also while typing in a field.
  await page.getByLabel("Event").click();
  await page.keyboard.press("Control+s");
  await expect(page.locator(".status")).toContainText("Saved game 1");
  await expect(page.getByText("Unsaved changes")).toHaveCount(0);
  // The game was stored without the move: it is gone after opening another game and coming back.
  await openGame(page, "Delta, Dora");
  await openGame(page, "Beta, Bernd");
  await page.keyboard.press("End");
  await expect(notation(page)).not.toContainText(last);
});

test("an engine line is played by clicking its move, and the bar shows the score", async ({
  chessvault: { page, pgn, openFile },
}) => {
  await page.evaluate((path) => localStorage.setItem("chessvault.enginePath", path), FAKE_ENGINE);
  await openFile(pgn);
  await page.getByRole("button", { name: "New game" }).click();
  await page.getByRole("button", { name: "Analyze" }).click();
  // The stand-in engine always answers 1. e4 with +0.30 from the start.
  const move = page.locator(".engine-line .pv-move", { hasText: "1. e4" });
  await expect(move).toBeVisible();
  await expect(page.locator(".evalbar")).toHaveAttribute("title", "+0.30");
  await move.click();
  await expect(notation(page).locator(".move.active")).toHaveText("1. e4");
  // It follows the board: now it suggests 1... e5 for Black.
  await expect(page.locator(".engine-line .pv-move", { hasText: "1... e5" })).toBeVisible();
  await page.getByRole("button", { name: "Stop" }).click();
  await expect(page.locator(".evalbar.idle")).toBeVisible();
});
