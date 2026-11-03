import { Page } from "@playwright/test";
import { expect, test } from "./app";

const whites = (page: Page) => page.locator(".games tbody tr td:nth-child(2)");
const searchWindow = (page: Page) => page.locator(".search-dialog");

/// Opens the search window, fills `fields` (label → value; true ticks a box) and searches.
async function searchFor(page: Page, fields: Record<string, string | boolean>) {
  await page.getByRole("button", { name: "Search games…" }).click();
  const form = searchWindow(page);
  await form.getByRole("button", { name: "Clear fields" }).click();
  for (const [label, value] of Object.entries(fields)) {
    const field = form.getByLabel(label, { exact: true });
    if (typeof value === "boolean") await field.setChecked(value);
    else if (label === "Result") await field.selectOption(value);
    else await field.fill(value);
  }
  await form.getByRole("button", { name: "Search", exact: true }).click();
  await expect(searchWindow(page)).toHaveCount(0);
}

test("the search window finds players with or without their colour", async ({ chessvault: { page, pgn, openFile } }) => {
  await openFile(pgn);

  await searchFor(page, { "White player": "alpha" });
  await expect(whites(page)).toHaveText(["Alpha, Anna"]);
  await expect(page.locator(".filter-summary")).toContainText("alpha – anyone");

  await searchFor(page, { "White player": "alpha", "Ignore colour": true });
  await expect(whites(page)).toHaveText(["Alpha, Anna", "Gamma, Gerd"]);
  await expect(page.locator(".filter-summary")).toContainText("(either colour)");

  await searchFor(page, { "White player": "Gamma", "Black player": "Delta", "Ignore colour": true });
  await expect(whites(page)).toHaveText(["Delta, Dora"]);
});

test("the search window filters by result, ECO, date and Elo, and the list resets", async ({
  chessvault: { page, pgn, openFile },
}) => {
  await openFile(pgn);

  await searchFor(page, { "ECO from": "C", "ECO to": "D9" });
  await expect(whites(page)).toHaveText(["Alpha, Anna", "Gamma, Gerd"]);
  await expect(page.locator(".filter-summary")).toContainText("ECO C–D9");

  await searchFor(page, { Result: "0-1" });
  await expect(whites(page)).toHaveText(["Gamma, Gerd"]);

  await searchFor(page, { "Date from": "2026.01.15" });
  await expect(whites(page)).toHaveText(["Gamma, Gerd", "Delta, Dora"]);

  await searchFor(page, { "White Elo at least": "2000" });
  await expect(whites(page)).toHaveText(["Alpha, Anna"]);

  await searchFor(page, { Event: "club", Site: "nowhere" });
  await expect(page.locator(".games")).toContainText("No games.");

  await page.getByRole("button", { name: "Show all games" }).click();
  await expect(whites(page)).toHaveCount(3);
  await expect(page.locator(".filter-summary")).toHaveCount(0);
});

test("the search window remembers the last search and sorting still works", async ({
  chessvault: { page, pgn, openFile },
}) => {
  await openFile(pgn);
  await searchFor(page, { "White player": "a", "Ignore colour": true });
  await expect(whites(page)).toHaveCount(3);

  await page.locator(".games th", { hasText: "Moves" }).click();
  await expect(whites(page)).toHaveText(["Delta, Dora", "Gamma, Gerd", "Alpha, Anna"]);

  await page.getByRole("button", { name: "Search games…" }).click();
  await expect(searchWindow(page).getByLabel("White player")).toHaveValue("a");
  await expect(searchWindow(page).getByLabel("Ignore colour")).toBeChecked();
  await page.keyboard.press("Escape");
  await expect(searchWindow(page)).toHaveCount(0);
  await expect(whites(page)).toHaveCount(3);
});
