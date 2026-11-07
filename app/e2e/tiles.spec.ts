import { Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, playMove, test, tile } from "./app";

const dialog = (page: Page) => page.locator(".dialog");

/// Puts files in the recent list (newest first) and, optionally, sets My Games, then reloads.
async function seed(page: Page, recent: string[], myGames?: string) {
  await page.evaluate(
    ([paths, mine]) => {
      const now = Date.now();
      localStorage.setItem("chessvault.recent", JSON.stringify(paths.map((path, i) => ({ path, openedAt: now - i }))));
      if (mine) localStorage.setItem("chessvault.myGames", mine);
    },
    [recent, myGames ?? ""] as const,
  );
  await page.reload();
}

test("the start screen shows files as tiles with their game counts", async ({ chessvault: { page, pgn, dir } }) => {
  const gone = join(dir, "moved away.pgn");
  await seed(page, [pgn, gone]);

  await expect(page.locator(".tiles-screen h2")).toHaveText("Databases");
  await expect(tile(page, "My Games")).toContainText("Double-click to create");
  await expect(tile(page, "sample.pgn")).toContainText("3 games");
  await expect(tile(page, "moved away.pgn")).toContainText("not found");
  // Counting a PGN file doesn't create its database.
  expect(existsSync(join(dir, "sample.sqlite"))).toBe(false);

  // One click only selects; a double-click opens.
  await tile(page, "sample.pgn").click();
  await expect(tile(page, "sample.pgn")).toHaveClass(/selected/);
  await expect(page.locator(".games")).toHaveCount(0);
  await tile(page, "sample.pgn").dblclick();
  await expect(page.locator(".games tbody tr")).toHaveCount(3);
});

test("the Databases button goes back to the tiles, with fresh counts", async ({ chessvault: { page, pgn, openFile } }) => {
  await openFile(pgn);
  await page.getByRole("button", { name: "New game" }).click();
  await playMove(page, "e2e4");
  await expect(page.locator(".notation .move.active")).toHaveText("1. e4");

  // Unsaved changes are not lost by going back.
  await page.getByRole("button", { name: "Databases" }).click();
  await expect(dialog(page)).toContainText("unsaved changes");
  await dialog(page).getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: "Save as new game" }).click();
  await dialog(page).getByLabel("White").fill("Player, Eve");
  await dialog(page).getByRole("button", { name: "OK" }).click();
  await expect(page.locator(".status")).toContainText("Added game 4");

  await page.getByRole("button", { name: "Databases" }).click();
  await expect(tile(page, "sample.pgn")).toContainText("4 games");
});

test("a moved My Games is reported, not created again empty", async ({ chessvault: { page, pgn, dir } }) => {
  // Creating My Games the first time goes through Windows' save window, which a test can't use.
  const moved = join(dir, "My Games.sqlite");
  await seed(page, [pgn], moved);
  await expect(page.locator(".tile").first()).toContainText("My Games");
  await expect(tile(page, "My Games")).toContainText("not found");
  await tile(page, "My Games").dblclick();
  await expect(page.locator(".status")).toContainText("was not found");
  expect(existsSync(moved)).toBe(false);
});

test("My Games is pinned first and opens directly", async ({ chessvault: { page, pgn, dir, openFile } }) => {
  // Opening the sample PGN makes a database beside it; use that as My Games.
  await openFile(pgn);
  const mine = join(dir, "sample.sqlite");
  await seed(page, [pgn], mine);
  await tile(page, "My Games").dblclick();
  await expect(page.locator(".status")).toContainText("(3 games)");

  await page.getByRole("button", { name: "Databases" }).click();
  await expect(tile(page, "My Games")).toContainText("3 games");
  // Opening My Games doesn't add it to the other tiles a second time.
  await expect(page.locator(".tile")).toHaveCount(3);

  // Removing My Games from the list forgets it but keeps its file.
  await tile(page, "My Games").click({ button: "right" });
  await page.getByRole("button", { name: "Remove from list" }).click();
  await expect(tile(page, "My Games")).toContainText("Double-click to create");
  await expect(page.locator(".tile")).toHaveCount(3);
  expect(existsSync(mine)).toBe(true);
  await page.reload();
  await expect(tile(page, "My Games")).toContainText("Double-click to create");
});

test("a tile's right-click menu removes it from the list", async ({ chessvault: { page, pgn, dir } }) => {
  await seed(page, [pgn, join(dir, "other.pgn")]);
  await tile(page, "other.pgn").click({ button: "right" });
  await expect(page.locator(".menu")).toContainText("Show in folder");
  await page.getByRole("button", { name: "Remove from list" }).click();
  await expect(tile(page, "other.pgn")).toHaveCount(0);
  await expect(tile(page, "sample.pgn")).toBeVisible();

  // The list stays that way after a restart of the page.
  await page.reload();
  await expect(tile(page, "other.pgn")).toHaveCount(0);
});
