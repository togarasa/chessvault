import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./api";
import App from "./App";
import { GameSummary } from "./types";

vi.mock("./api", async (original) => ({
  ...(await original<typeof import("./api")>()),
  openDatabase: vi.fn(),
  importPgn: vi.fn(),
  listGames: vi.fn(),
  searchGames: vi.fn(),
  getGame: vi.fn(),
  saveGame: vi.fn(),
  addGame: vi.fn(),
  addGameTo: vi.fn(),
  deleteGame: vi.fn(),
  undoGame: vi.fn(),
  exportPgn: vi.fn(),
  databaseCounts: vi.fn(),
  chooseFileToOpen: vi.fn(),
  chooseFileToSave: vi.fn(),
  showInFolder: vi.fn(),
}));

// The board, engine and explorer have their own tests; here they only need to exist.
vi.mock("./Board", () => ({
  Board: ({ onMove }: { onMove: (from: string, to: string) => void }) => (
    <div>
      <button onClick={() => onMove("e2", "e4")}>play e2e4</button>
      <button onClick={() => onMove("e7", "e5")}>play e7e5</button>
    </div>
  ),
}));
vi.mock("./EnginePanel", () => ({ EnginePanel: () => null }));
vi.mock("./ExplorerPanel", () => ({ ExplorerPanel: () => null }));

const CLUB = "C:\\games\\club.pgn";
const summary = (id: number, white: string, black: string): GameSummary => ({
  id,
  event: "Club",
  site: "Town",
  date: "2026.01.01",
  round: "1",
  white,
  black,
  result: "1-0",
  eco: "",
  whiteElo: null,
  blackElo: null,
  plies: 2,
});
const GAMES = [summary(1, "Alpha, Anna", "Beta, Bernd"), summary(2, "Gamma, Gerd", "Alpha, Anna")];
const pgnOf = (white: string) => `[Event "Club"]\n[Date "2026.01.01"]\n[White "${white}"]\n[Black "Beta, Bernd"]\n[Result "1-0"]\n\n1. e4 e5 1-0`;

const status = () => document.querySelector(".status")!.textContent;
const dialog = () => within(document.querySelector(".dialog") as HTMLElement);
const button = (name: string) => screen.getByRole("button", { name });

beforeEach(() => {
  // Also drops answers a failed test queued but never used.
  vi.resetAllMocks();
  localStorage.clear();
  vi.mocked(api.databaseCounts).mockImplementation(async (paths) => paths.map(() => 2));
  vi.mocked(api.openDatabase).mockResolvedValue({ database: "C:\\games\\club.sqlite", games: 2, imported: 0 });
  vi.mocked(api.listGames).mockResolvedValue(GAMES);
  vi.mocked(api.searchGames).mockResolvedValue([GAMES[0]]);
  vi.mocked(api.getGame).mockImplementation(async (id) => {
    const listed = GAMES[id - 1];
    if (listed) return { ...listed, pgn: pgnOf(listed.white) };
    // A game the test just added.
    const added = vi.mocked(api.addGame).mock.calls;
    return { ...summary(id, "Me", "?"), pgn: added[added.length - 1]?.[0] ?? "*" };
  });
  vi.mocked(api.undoGame).mockResolvedValue(true);
  vi.mocked(api.exportPgn).mockResolvedValue(2);
  vi.mocked(api.addGame).mockResolvedValue(3);
});

/// Starts the app and opens the club file through the Open window.
async function openClub() {
  render(<App />);
  vi.mocked(api.chooseFileToOpen).mockResolvedValueOnce(CLUB);
  await userEvent.click(button("Open…"));
  await screen.findByText("Gamma, Gerd");
}

async function openGame(white: string) {
  await userEvent.click(screen.getAllByText(white)[0]);
  await screen.findByText("1. e4");
}

describe("opening files", () => {
  it("starts on the database tiles and opens a file chosen in the Open window", async () => {
    render(<App />);
    expect(status()).toBe("Open a database to begin.");
    expect(screen.getByText("Databases", { selector: "h2" })).toBeTruthy();

    vi.mocked(api.chooseFileToOpen).mockResolvedValueOnce(null);
    await userEvent.click(button("Open…"));
    expect(api.openDatabase).not.toHaveBeenCalled();

    vi.mocked(api.openDatabase).mockResolvedValueOnce({ database: "C:\\games\\club.sqlite", games: 2, imported: 2 });
    vi.mocked(api.chooseFileToOpen).mockResolvedValueOnce(CLUB);
    await userEvent.click(button("Open…"));
    expect(await screen.findByText("Gamma, Gerd")).toBeTruthy();
    expect(status()).toBe("Imported 2 games into C:\\games\\club.sqlite.");
    expect(screen.getByText("club.pgn", { selector: ".current-file" })).toBeTruthy();
    expect(JSON.parse(localStorage.getItem("chessvault.recent")!)[0].path).toBe(CLUB);
  });

  it("opens a recent file from its tile and from the Recent menu, and clears the list", async () => {
    localStorage.setItem("chessvault.recent", JSON.stringify([{ path: CLUB, openedAt: 1 }]));
    render(<App />);
    await waitFor(() => expect(api.databaseCounts).toHaveBeenCalledWith([CLUB]));
    await userEvent.dblClick(screen.getByText("club.pgn"));
    expect(await screen.findByText("Gamma, Gerd")).toBeTruthy();
    expect(status()).toBe("Opened C:\\games\\club.sqlite (2 games).");

    await userEvent.click(button("Recent ▾"));
    await userEvent.click(within(document.querySelector(".menu") as HTMLElement).getByRole("button", { name: "club.pgn" }));
    await waitFor(() => expect(api.openDatabase).toHaveBeenCalledTimes(2));
    await userEvent.click(button("Recent ▾"));
    await userEvent.click(button("Clear list"));
    expect((button("Recent ▾") as HTMLButtonElement).disabled).toBe(true);
  });

  it("offers to forget a recent file that can't be opened", async () => {
    localStorage.setItem("chessvault.recent", JSON.stringify([{ path: CLUB, openedAt: 1 }]));
    vi.mocked(api.openDatabase).mockRejectedValue("not a ChessVault database");
    render(<App />);
    await userEvent.dblClick(screen.getByText("club.pgn"));
    expect(await screen.findByText(/could not be opened: not a ChessVault database/)).toBeTruthy();
    expect(status()).toBe("not a ChessVault database");
    await userEvent.click(dialog().getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("club.pgn")).toBeTruthy();

    await userEvent.dblClick(screen.getByText("club.pgn"));
    await userEvent.click(await screen.findByRole("button", { name: "Remove from recent files" }));
    expect(screen.queryByText("club.pgn")).toBeNull();
  });

  it("only reports a failure for a file that isn't in the recent list", async () => {
    vi.mocked(api.openDatabase).mockRejectedValue("no such file");
    render(<App />);
    vi.mocked(api.chooseFileToOpen).mockResolvedValueOnce("C:\\other.pgn");
    await userEvent.click(button("Open…"));
    await waitFor(() => expect(status()).toBe("no such file"));
    expect(document.querySelector(".dialog")).toBeNull();
  });

  it("goes back to the tiles with the Databases button", async () => {
    await openClub();
    await userEvent.click(button("Databases"));
    expect(status()).toBe("Double-click a database to open it.");
    expect(screen.getByText("club.pgn")).toBeTruthy();
    expect((button("Databases") as HTMLButtonElement).disabled).toBe(true);
  });

  it("imports a PGN file into the open database", async () => {
    await openClub();
    vi.mocked(api.chooseFileToOpen).mockResolvedValueOnce(null);
    await userEvent.click(button("Import PGN…"));
    expect(api.importPgn).not.toHaveBeenCalled();
    vi.mocked(api.importPgn).mockResolvedValueOnce(5);
    vi.mocked(api.chooseFileToOpen).mockResolvedValueOnce("C:\\more.pgn");
    await userEvent.click(button("Import PGN…"));
    await waitFor(() => expect(status()).toBe("Imported 5 games."));
    expect(api.importPgn).toHaveBeenCalledWith("C:\\more.pgn");
  });
});

describe("My Games and the tile menu", () => {
  it("asks where to keep My Games the first time, then opens it directly", async () => {
    render(<App />);
    vi.mocked(api.chooseFileToSave).mockResolvedValueOnce(null);
    await userEvent.dblClick(screen.getByText("My Games"));
    expect(api.openDatabase).not.toHaveBeenCalled();

    vi.mocked(api.chooseFileToSave).mockResolvedValueOnce("D:\\My Games.sqlite");
    await userEvent.dblClick(screen.getByText("My Games"));
    await screen.findByText("Gamma, Gerd");
    expect(api.openDatabase).toHaveBeenCalledWith("D:\\My Games.sqlite");
    expect(localStorage.getItem("chessvault.myGames")).toBe("D:\\My Games.sqlite");

    await userEvent.click(button("Databases"));
    await userEvent.dblClick(screen.getByText("My Games"));
    await waitFor(() => expect(api.openDatabase).toHaveBeenCalledTimes(2));
    expect(api.chooseFileToSave).toHaveBeenCalledTimes(2);
  });

  it("opens, shows, re-chooses and forgets My Games from its menu", async () => {
    localStorage.setItem("chessvault.myGames", "D:\\mine.sqlite");
    render(<App />);
    const menu = async () => {
      fireEvent.contextMenu(screen.getByText("My Games").closest("button")!);
      return within(document.querySelector(".menu") as HTMLElement);
    };
    await userEvent.click((await menu()).getByRole("button", { name: "Show in folder" }));
    expect(api.showInFolder).toHaveBeenCalledWith("D:\\mine.sqlite");

    vi.mocked(api.chooseFileToSave).mockResolvedValueOnce("E:\\other.sqlite");
    await userEvent.click((await menu()).getByRole("button", { name: "Choose another My Games database…" }));
    await screen.findByText("Gamma, Gerd");
    expect(api.openDatabase).toHaveBeenCalledWith("E:\\other.sqlite");
    await userEvent.click(button("Databases"));

    await userEvent.click((await menu()).getByRole("button", { name: "Open" }));
    await waitFor(() => expect(api.openDatabase).toHaveBeenCalledTimes(2));
    await userEvent.click(button("Databases"));
    await userEvent.click((await menu()).getByRole("button", { name: "Remove from list" }));
    expect(screen.getByText("Double-click to create")).toBeTruthy();
    expect(localStorage.getItem("chessvault.myGames")).toBeNull();
  });

  it("opens or forgets another file from its menu, and reports a failed Show in folder", async () => {
    localStorage.setItem("chessvault.recent", JSON.stringify([{ path: CLUB, openedAt: 1 }]));
    vi.mocked(api.showInFolder).mockRejectedValueOnce("Explorer is not available");
    render(<App />);
    const menu = () => {
      fireEvent.contextMenu(screen.getByText("club.pgn").closest("button")!);
      return within(document.querySelector(".menu") as HTMLElement);
    };
    await userEvent.click(menu().getByRole("button", { name: "Show in folder" }));
    await waitFor(() => expect(status()).toBe("Explorer is not available"));
    expect(menu().queryByRole("button", { name: /Choose another/ })).toBeNull();
    await userEvent.click(menu().getByRole("button", { name: "Open" }));
    await screen.findByText("Gamma, Gerd");
    await userEvent.click(button("Databases"));
    await userEvent.click(menu().getByRole("button", { name: "Remove from list" }));
    expect(screen.queryByText("club.pgn")).toBeNull();
  });

  it("opens a file from the Add database tile", async () => {
    render(<App />);
    vi.mocked(api.chooseFileToOpen).mockResolvedValueOnce(CLUB);
    await userEvent.click(screen.getByText("Add database…"));
    expect(await screen.findByText("Gamma, Gerd")).toBeTruthy();
  });
});

describe("the game list", () => {
  it("searches by player, with the search window, sorts and shows all again", async () => {
    await openClub();
    await userEvent.type(screen.getByPlaceholderText("Search by player name"), " Anna {Enter}");
    expect(api.searchGames).toHaveBeenCalledWith(expect.objectContaining({ white: "Anna", ignoreColour: true }), { column: "id", descending: false }, 200, 0);
    expect(await screen.findByText(/Showing: Anna – anyone/)).toBeTruthy();

    await userEvent.click(screen.getByText("Date"));
    expect(api.searchGames).toHaveBeenLastCalledWith(expect.anything(), { column: "date", descending: false }, 200, 0);

    await userEvent.click(button("Show all games"));
    await waitFor(() => expect(screen.queryByText(/Showing:/)).toBeNull());
    expect((screen.getByPlaceholderText("Search by player name") as HTMLInputElement).value).toBe("");

    await userEvent.click(button("Search"));
    expect(api.listGames).toHaveBeenLastCalledWith({ column: "date", descending: false }, 200, 0);
  });

  it("searches with the search window; an empty search shows all games", async () => {
    await openClub();
    await userEvent.click(button("Search games…"));
    await userEvent.type(screen.getByLabelText("ECO from"), "B");
    await userEvent.click(within(document.querySelector(".search-dialog") as HTMLElement).getByRole("button", { name: "Search" }));
    expect(await screen.findByText("Showing: ECO from B")).toBeTruthy();

    await userEvent.click(button("Search games…"));
    expect((screen.getByLabelText("ECO from") as HTMLInputElement).value).toBe("B");
    await userEvent.click(button("Clear fields"));
    await userEvent.click(within(document.querySelector(".search-dialog") as HTMLElement).getByRole("button", { name: "Search" }));
    await waitFor(() => expect(screen.queryByText(/Showing:/)).toBeNull());

    await userEvent.click(button("Search games…"));
    await userEvent.click(button("Cancel"));
    expect(document.querySelector(".search-dialog")).toBeNull();
  });

  it("opens a game from its row or its menu, and reports a failure", async () => {
    await openClub();
    fireEvent.contextMenu(screen.getByText("Gamma, Gerd"));
    await userEvent.click(button("Open game"));
    expect(await screen.findByText("1. e4")).toBeTruthy();
    expect((screen.getByLabelText("White") as HTMLInputElement).value).toBe("Gamma, Gerd");
    // Clicking the game that is already open doesn't load it again.
    await userEvent.click(screen.getAllByText("Gamma, Gerd")[0]);
    expect(api.getGame).toHaveBeenCalledTimes(1);

    vi.mocked(api.getGame).mockRejectedValueOnce("database is locked");
    await userEvent.click(screen.getAllByText("Alpha, Anna")[0]);
    await waitFor(() => expect(status()).toBe("database is locked"));
  });

  it("clears the board when the chosen game no longer exists", async () => {
    await openClub();
    await openGame("Gamma, Gerd");
    vi.mocked(api.getGame).mockResolvedValueOnce(null);
    await userEvent.click(screen.getAllByText("Alpha, Anna")[0]);
    expect(await screen.findByText("Select a game, or start a new one.")).toBeTruthy();
  });
});

describe("saving games", () => {
  it("saves a changed game, keeps the shown move, and undoes the save", async () => {
    await openClub();
    await openGame("Gamma, Gerd");
    fireEvent.change(screen.getByLabelText("Event"), { target: { value: "Final" } });
    await userEvent.click(screen.getByText("e5"));
    await userEvent.click(within(document.querySelector(".actions") as HTMLElement).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(status()).toBe("Saved game 2. Undo restores the previous version."));
    expect(vi.mocked(api.saveGame).mock.calls[0][1]).toContain('[Event "Final"]');
    expect(screen.getByText("e5").className).toContain("active");

    await userEvent.click(button("Undo last save"));
    await waitFor(() => expect(status()).toBe("Restored game 2."));
    vi.mocked(api.undoGame).mockResolvedValueOnce(false);
    await userEvent.click(button("Undo last save"));
    await waitFor(() => expect(status()).toBe("Game 2 has no earlier version."));
  });

  it("saves a new game into the open database with its details", async () => {
    await openClub();
    await userEvent.click(button("New game"));
    expect(status()).toBe("New game. Make moves on the board, then save it.");
    await userEvent.click(button("play e2e4"));
    await userEvent.click(button("Save as new game"));
    expect((dialog().getByLabelText("White") as HTMLInputElement).value).toBe("");
    await userEvent.type(dialog().getByLabelText("White"), "Me");
    await userEvent.click(dialog().getByRole("button", { name: "OK" }));
    await waitFor(() => expect(status()).toBe("Added game 3."));
    const saved = vi.mocked(api.addGame).mock.calls[0][0];
    expect(saved).toContain('[White "Me"]');
    expect(saved).toContain('[Black "?"]');
    expect(saved).toContain("1. e4");
  });

  it("adds a new game to an existing file, or to a new file named after the players", async () => {
    await openClub();
    await userEvent.click(button("New game"));
    await userEvent.click(button("play e2e4"));
    const saveTo = async (where: string) => {
      await userEvent.click(button("Save as new game"));
      fireEvent.change(dialog().getByLabelText("Save to"), { target: { value: where } });
      await userEvent.click(dialog().getByRole("button", { name: "OK" }));
    };

    vi.mocked(api.chooseFileToOpen).mockResolvedValueOnce(null);
    await saveTo("An existing PGN file or database…");
    expect(api.addGameTo).not.toHaveBeenCalled();

    vi.mocked(api.chooseFileToOpen).mockResolvedValueOnce("C:\\games\\mine.pgn");
    await saveTo("An existing PGN file or database…");
    await waitFor(() => expect(status()).toBe("Saved the game to C:\\games\\mine.pgn."));
    expect(screen.queryByText("Unsaved changes")).toBeNull();

    await userEvent.click(button("play e7e5"));
    vi.mocked(api.chooseFileToSave).mockResolvedValueOnce("C:\\games\\new.pgn");
    await saveTo("A new PGN file or database…");
    expect(vi.mocked(api.chooseFileToSave).mock.calls[0][2]).toBe("C:\\games\\? - ?.pgn");
    await waitFor(() => expect(api.addGameTo).toHaveBeenLastCalledWith("C:\\games\\new.pgn", expect.stringContaining("1. e4 e5")));
  });

  it("keeps the game when the details are cancelled or saving fails", async () => {
    await openClub();
    await userEvent.click(button("New game"));
    await userEvent.click(button("play e2e4"));
    await userEvent.click(button("Save as new game"));
    await userEvent.click(dialog().getByRole("button", { name: "Cancel" }));
    expect(api.addGame).not.toHaveBeenCalled();
    expect(screen.getByText("Unsaved changes")).toBeTruthy();

    vi.mocked(api.addGame).mockRejectedValueOnce("invalid game: move 1 is not legal");
    await userEvent.click(button("Save as new game"));
    await userEvent.click(dialog().getByRole("button", { name: "OK" }));
    await waitFor(() => expect(status()).toBe("invalid game: move 1 is not legal"));
  });

  it("asks before leaving a game with unsaved changes", async () => {
    await openClub();
    await openGame("Gamma, Gerd");
    fireEvent.change(screen.getByLabelText("Event"), { target: { value: "Changed" } });

    await userEvent.click(button("New game"));
    await userEvent.click(dialog().getByRole("button", { name: "Cancel" }));
    expect((screen.getByLabelText("Event") as HTMLInputElement).value).toBe("Changed");

    await userEvent.click(button("Databases"));
    await userEvent.click(dialog().getByRole("button", { name: "Cancel" }));
    await userEvent.click(button("Open…"));
    await userEvent.click(dialog().getByRole("button", { name: "Cancel" }));
    await userEvent.click(screen.getAllByText("Alpha, Anna")[0]);
    await userEvent.click(dialog().getByRole("button", { name: "Discard changes" }));
    await waitFor(() => expect((screen.getByLabelText("White") as HTMLInputElement).value).toBe("Alpha, Anna"));
  });

  it("opens the move menu from the notation", async () => {
    await openClub();
    await openGame("Gamma, Gerd");
    fireEvent.contextMenu(screen.getByText("e5"));
    expect(button("Add comment…")).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    expect(document.querySelector(".menu")).toBeNull();
  });
});

describe("deleting and exporting", () => {
  it("deletes a game from its menu after asking, clearing the board when it was shown", async () => {
    await openClub();
    await openGame("Gamma, Gerd");
    fireEvent.contextMenu(screen.getAllByText("Alpha, Anna")[0]);
    await userEvent.click(button("Delete game…"));
    expect(dialog().getByText("Delete game 1: Alpha, Anna – Beta, Bernd (2026.01.01)? This cannot be undone.")).toBeTruthy();
    await userEvent.click(dialog().getByRole("button", { name: "Cancel" }));
    expect(api.deleteGame).not.toHaveBeenCalled();

    await userEvent.click(button("Delete game"));
    expect(dialog().getByText(/Delete game 2: Gamma, Gerd – Beta, Bernd/)).toBeTruthy();
    await userEvent.click(dialog().getByRole("button", { name: "Delete game" }));
    await waitFor(() => expect(status()).toBe("Deleted game 2."));
    expect(screen.getByText("Select a game, or start a new one.")).toBeTruthy();
  });

  it("keeps the shown game when another one is deleted", async () => {
    await openClub();
    await openGame("Gamma, Gerd");
    fireEvent.contextMenu(screen.getAllByText("Beta, Bernd")[0]);
    await userEvent.click(button("Delete game…"));
    await userEvent.click(dialog().getByRole("button", { name: "Delete game" }));
    await waitFor(() => expect(status()).toBe("Deleted game 1."));
    expect(screen.getByText("1. e4")).toBeTruthy();
  });

  it("exports all games, or only the shown one, warning about unsaved changes", async () => {
    await openClub();
    vi.mocked(api.chooseFileToSave).mockResolvedValueOnce(null);
    await userEvent.click(button("Export PGN…"));
    expect(api.chooseFileToSave).toHaveBeenCalledWith("Export to PGN", [api.PGN_FILES], "C:\\games\\club (ChessVault).pgn");
    expect(api.exportPgn).not.toHaveBeenCalled();

    vi.mocked(api.chooseFileToSave).mockResolvedValue("C:\\out.pgn");
    await userEvent.click(button("Export PGN…"));
    await waitFor(() => expect(status()).toBe("Exported 2 games to C:\\out.pgn."));
    expect(api.exportPgn).toHaveBeenCalledWith("C:\\out.pgn", null);

    await openGame("Gamma, Gerd");
    await userEvent.click(button("Export PGN…"));
    await userEvent.click(dialog().getByRole("button", { name: "Cancel" }));
    expect(api.exportPgn).toHaveBeenCalledTimes(1);

    vi.mocked(api.exportPgn).mockResolvedValueOnce(1);
    await userEvent.click(button("Export PGN…"));
    await userEvent.click(dialog().getByRole("button", { name: "Game on the board" }));
    await waitFor(() => expect(status()).toBe("Exported 1 game to C:\\out.pgn."));
    expect(api.exportPgn).toHaveBeenLastCalledWith("C:\\out.pgn", [2]);

    fireEvent.change(screen.getByLabelText("Event"), { target: { value: "Changed" } });
    await userEvent.click(button("Export PGN…"));
    await userEvent.click(dialog().getByRole("button", { name: "All games" }));
    expect(await screen.findByText(/The export has the last saved version/)).toBeTruthy();
    await userEvent.click(dialog().getByRole("button", { name: "Cancel" }));
    expect(api.exportPgn).toHaveBeenCalledTimes(2);
    await userEvent.click(button("Export PGN…"));
    await userEvent.click(dialog().getByRole("button", { name: "All games" }));
    await userEvent.click(await screen.findByRole("button", { name: "Export anyway" }));
    await waitFor(() => expect(api.exportPgn).toHaveBeenCalledTimes(3));
  });
});

describe("loading more games", () => {
  it("loads the next page from the button at the end of the list", async () => {
    const many = Array.from({ length: 200 }, (_, i) => summary(i + 1, `Player ${i + 1}`, "X"));
    vi.mocked(api.listGames).mockResolvedValueOnce(many).mockResolvedValueOnce([summary(201, "Last, Player", "X")]);
    render(<App />);
    vi.mocked(api.chooseFileToOpen).mockResolvedValueOnce(CLUB);
    await userEvent.click(button("Open…"));
    await act(async () => {
      await userEvent.click(await screen.findByRole("button", { name: "Showing 200 games, load more" }));
    });
    expect(await screen.findByText("Last, Player")).toBeTruthy();
    expect(screen.getByText("201 games")).toBeTruthy();
  });
});
