import { readFileSync } from "node:fs";
import { expect, playMove, test } from "./app";

const rows = (page: import("@playwright/test").Page) => page.locator(".games tbody tr");
const notation = (page: import("@playwright/test").Page) => page.locator(".notation");
const dialog = (page: import("@playwright/test").Page) => page.locator(".dialog");
/// The game's Save button; the explorer's token form has one too.
const saveButton = (page: import("@playwright/test").Page) =>
  page.locator(".actions").getByRole("button", { name: "Save", exact: true });

/// Clicks the game whose row contains `player` and waits until it is on the board.
async function openGame(page: import("@playwright/test").Page, player: string) {
  const row = rows(page).filter({ hasText: player });
  await row.click();
  await expect(row).toHaveClass(/active/);
  await expect(notation(page).locator(".move.active")).toHaveText("Start");
}

test("opening a PGN file lists its games with Elo and moves", async ({ chessvault: { page, pgn, openFile } }) => {
  await openFile(pgn);
  await expect(page.locator(".status")).toContainText("Imported 3 games");
  await expect(rows(page)).toHaveCount(3);
  await expect(page.locator(".list-end")).toHaveText("3 games");

  const first = rows(page).first().locator("td");
  // No., White, Elo, Black, Elo, Result, Moves, ECO, Event, Site, Round, Date
  await expect(first).toHaveText(["1", "Alpha, Anna", "2100", "Beta, Bernd", "1900", "1-0", "5", "C84", "E2E Club", "Testville", "1", "2026.01.10"]);

  // Opening the same file again uses its database instead of importing twice.
  await openFile(pgn);
  await expect(page.locator(".status")).toContainText("Opened");
  await expect(rows(page)).toHaveCount(3);
});

test("clicking a column header sorts the list, again reverses it", async ({ chessvault: { page, pgn, openFile } }) => {
  await openFile(pgn);
  const whites = rows(page).locator("td:nth-child(2)");
  const whiteElo = page.locator(".games th").filter({ hasText: "Elo" }).first();

  await whiteElo.click();
  // Lowest Elo first; the game without an Elo goes last.
  await expect(whites).toHaveText(["Gamma, Gerd", "Alpha, Anna", "Delta, Dora"]);
  await expect(whiteElo).toHaveText("Elo ▲");

  await whiteElo.click();
  await expect(whites).toHaveText(["Alpha, Anna", "Gamma, Gerd", "Delta, Dora"]);
  await expect(whiteElo).toHaveText("Elo ▼");

  await page.locator(".games th", { hasText: "Moves" }).click();
  await expect(whites).toHaveText(["Delta, Dora", "Gamma, Gerd", "Alpha, Anna"]);
});

test("searching by player finds their games", async ({ chessvault: { page, pgn, openFile } }) => {
  await openFile(pgn);
  await page.getByPlaceholder("Search by player name").fill("Gamma");
  await page.getByPlaceholder("Search by player name").press("Enter");
  await expect(rows(page)).toHaveCount(2);
  await page.getByPlaceholder("Search by player name").fill("");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(rows(page)).toHaveCount(3);
});

test("a game shows its moves, comments and variations, and the arrow keys step through it", async ({
  chessvault: { page, pgn, openFile },
}) => {
  await openFile(pgn);
  await openGame(page, "Delta, Dora");
  await expect(notation(page)).toContainText("A good start");
  await expect(notation(page).locator(".variation")).toContainText("1. d4");
  await expect(notation(page).locator(".move.active")).toHaveText("Start");

  await page.keyboard.press("ArrowRight");
  await expect(notation(page).locator(".move.active")).toHaveText("1. e4");
  await page.keyboard.press("End");
  // After a comment the move number is shown again.
  await expect(notation(page).locator(".move.active")).toHaveText("1... c5");
  await page.keyboard.press("Home");
  await expect(notation(page).locator(".move.active")).toHaveText("Start");

  // Clicking a move in a variation shows it.
  await notation(page).locator(".variation .move", { hasText: "Nf6" }).click();
  await expect(notation(page).locator(".move.active")).toHaveText("Nf6");
});

test("a new move on the board can become a variation, and saving keeps it", async ({
  chessvault: { page, pgn, openFile },
}) => {
  await openFile(pgn);
  await openGame(page, "Beta, Bernd");

  // From the start, play 1. d4 instead of the game's 1. e4.
  await playMove(page, "d2d4");
  await expect(dialog(page)).toContainText("d4 is a new move here.");
  await dialog(page).getByRole("button", { name: "New variation" }).click();
  await expect(notation(page).locator(".move.active")).toHaveText("1. d4");
  await expect(notation(page).locator(".variation")).toContainText("1. d4");
  await expect(page.getByText("Unsaved changes")).toBeVisible();

  // Playing a move that already exists just follows it, with no question.
  await page.keyboard.press("Home");
  await expect(notation(page).locator(".move.active")).toHaveText("Start");
  await playMove(page, "e2e4");
  await expect(dialog(page)).toHaveCount(0);
  await expect(notation(page).locator(".move.active")).toHaveText("1. e4");

  await saveButton(page).click();
  await expect(page.locator(".status")).toContainText("Saved game 1");

  // Open another game and come back: the variation was stored.
  await openGame(page, "Delta, Dora");
  await openGame(page, "Beta, Bernd");
  await expect(notation(page).locator(".variation")).toContainText("1. d4");
});

test("an illegal move on the board is not played", async ({ chessvault: { page, pgn, openFile } }) => {
  await openFile(pgn);
  await openGame(page, "Beta, Bernd");
  await playMove(page, "e2e5");
  await expect(dialog(page)).toHaveCount(0);
  await expect(notation(page).locator(".move.active")).toHaveText("Start");
});

test("the right-click menu adds a comment and a symbol, and undo restores the saved game", async ({
  chessvault: { page, pgn, openFile },
}) => {
  await openFile(pgn);
  await openGame(page, "Beta, Bernd");
  const move = notation(page).locator(".move", { hasText: "Nf3" });

  await move.click({ button: "right" });
  await page.getByRole("button", { name: "Add comment…" }).click();
  await dialog(page).locator("textarea").fill("Develops a piece");
  await dialog(page).getByRole("button", { name: "OK" }).click();
  await expect(notation(page)).toContainText("Develops a piece");

  await move.click({ button: "right" });
  await page.locator(".menu-row button", { hasText: /^!$/ }).click();
  await expect(move).toHaveText("2. Nf3!");

  await saveButton(page).click();
  await expect(page.locator(".status")).toContainText("Saved game 1");
  await expect(page.locator(".source textarea")).toHaveValue(/2\. Nf3 \$1 \{ Develops a piece \}/);

  await page.getByRole("button", { name: "Undo last save" }).click();
  await expect(page.locator(".status")).toContainText("Restored game 1");
  await expect(notation(page)).not.toContainText("Develops a piece");
});

test("a new game is saved into the open database and can be deleted", async ({
  chessvault: { page, pgn, openFile },
}) => {
  await openFile(pgn);
  await page.getByRole("button", { name: "New game" }).click();
  await playMove(page, "e2e4");
  await expect(notation(page).locator(".move.active")).toHaveText("1. e4");
  await playMove(page, "e7e5");
  await expect(notation(page).locator(".move.active")).toHaveText("e5");

  await page.getByRole("button", { name: "Save as new game" }).click();
  await dialog(page).getByLabel("White").fill("Player, Eve");
  await dialog(page).getByLabel("Black").fill("Player, Frank");
  await dialog(page).getByLabel("Result").selectOption("1-0");
  await dialog(page).getByRole("button", { name: "OK" }).click();
  await expect(page.locator(".status")).toContainText("Added game 4");

  const added = rows(page).filter({ hasText: "Player, Eve" });
  await expect(added.locator("td")).toContainText(["4", "Player, Eve", "", "Player, Frank", "", "1-0", "1"]);
  // The board stays on the last move after saving.
  await expect(notation(page).locator(".move.active")).toHaveText("e5");

  await added.click({ button: "right" });
  await page.getByRole("button", { name: "Delete game…" }).click();
  await expect(dialog(page)).toContainText("Delete game 4: Player, Eve – Player, Frank");
  await dialog(page).getByRole("button", { name: "Delete game" }).click();
  await expect(page.locator(".status")).toContainText("Deleted game 4");
  await expect(rows(page)).toHaveCount(3);

  // The PGN file itself is never changed by edits in its database.
  expect(readFileSync(pgn, "utf8")).not.toContain("Player, Eve");
});

test("leaving a game with unsaved changes asks first", async ({ chessvault: { page, pgn, openFile } }) => {
  await openFile(pgn);
  await openGame(page, "Beta, Bernd");
  await page.keyboard.press("End");
  await expect(notation(page).locator(".move.active")).toHaveText("Be7");
  await playMove(page, "a2a3");
  await expect(page.getByText("Unsaved changes")).toBeVisible();

  await rows(page).filter({ hasText: "Delta, Dora" }).click();
  await expect(dialog(page)).toContainText("unsaved changes");
  await dialog(page).getByRole("button", { name: "Cancel" }).click();
  await expect(notation(page)).toContainText("a3");

  await rows(page).filter({ hasText: "Delta, Dora" }).click();
  await dialog(page).getByRole("button", { name: "Discard changes" }).click();
  await expect(notation(page)).toContainText("A good start");
});
