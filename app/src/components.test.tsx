import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DatabaseTiles } from "./DatabaseTiles";
import { Ask, ContextMenu, Dialog } from "./Dialog";
import { EMPTY_FILTER, playerFilter } from "./filter";
import { GameList } from "./GameList";
import { Notation } from "./Notation";
import { SearchDialog } from "./Search";
import { SearchBar } from "./SearchBar";
import { Toolbar } from "./Toolbar";
import { parseGame } from "./tree";
import { GameSummary } from "./types";

function ask(extra: Partial<Ask>): Ask {
  return { title: "Question?", answer: vi.fn(), ...extra };
}

describe("Dialog", () => {
  it("offers choices and a cancel button, focusing the first choice", async () => {
    const question = ask({ choices: [{ label: "Yes", value: "y" }, { label: "No", value: "n" }] });
    render(<Dialog ask={question} />);
    expect(screen.getByText("Question?")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Yes" }));
    await userEvent.click(screen.getByRole("button", { name: "No" }));
    expect(question.answer).toHaveBeenCalledWith("n");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(question.answer).toHaveBeenLastCalledWith(null);
  });

  it("asks for text: Enter answers, Shift+Enter makes a new line", async () => {
    const question = ask({ text: "old" });
    render(<Dialog ask={question} />);
    const box = screen.getByRole("textbox");
    await userEvent.clear(box);
    await userEvent.type(box, "line one{Shift>}{Enter}{/Shift}two");
    expect(question.answer).not.toHaveBeenCalled();
    await userEvent.type(box, "{Enter}");
    expect(question.answer).toHaveBeenCalledWith("line one\ntwo");
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(question.answer).toHaveBeenLastCalledWith("line one\ntwo");
  });

  it("shows a form with text and choice fields and answers with their values", async () => {
    const question = ask({
      fields: [
        { name: "White", value: "Anna" },
        { name: "Result", value: "*", options: ["*", "1-0"], hint: "Pick one" },
      ],
    });
    render(<Dialog ask={question} />);
    expect(screen.getByText("Pick one")).toBeTruthy();
    await userEvent.type(screen.getByLabelText("White"), " B");
    await userEvent.selectOptions(screen.getByRole("combobox"), "1-0");
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(question.answer).toHaveBeenCalledWith("ok", { White: "Anna B", Result: "1-0" });
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(question.answer).toHaveBeenLastCalledWith(null);
  });

  it("cancels with Escape or a click beside it, but not inside it", async () => {
    const question = ask({ choices: [] });
    const { container } = render(<Dialog ask={question} />);
    fireEvent.mouseDown(screen.getByText("Question?"));
    expect(question.answer).not.toHaveBeenCalled();
    fireEvent.mouseDown(container.querySelector(".overlay")!);
    expect(question.answer).toHaveBeenCalledWith(null);
    await userEvent.keyboard("{Escape}");
    expect(question.answer).toHaveBeenCalledTimes(2);
  });
});

describe("ContextMenu", () => {
  it("runs a chosen item, closing first; disabled items do nothing", async () => {
    const close = vi.fn();
    const open = vi.fn();
    const symbol = vi.fn();
    render(
      <ContextMenu
        x={10}
        y={10}
        close={close}
        items={[
          { label: "Open", action: open },
          "separator",
          { buttons: [{ label: "!", action: symbol, active: true }, { label: "?", action: vi.fn() }] },
          { label: "Gone", action: vi.fn(), disabled: true },
        ]}
      />,
    );
    expect(screen.getByRole("button", { name: "!" }).className).toBe("active");
    expect(screen.getByRole("button", { name: "?" }).className).toBe("");
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    expect([close.mock.calls.length, open.mock.calls.length]).toEqual([1, 1]);
    await userEvent.click(screen.getByRole("button", { name: "!" }));
    expect(symbol).toHaveBeenCalledOnce();
    expect((screen.getByRole("button", { name: "Gone" }) as HTMLButtonElement).disabled).toBe(true);
    expect(document.querySelector("hr")).toBeTruthy();
  });

  it("closes with Escape, a click outside or another right-click", async () => {
    const close = vi.fn();
    const { container } = render(<ContextMenu x={5000} y={5000} close={close} items={[{ label: "A", action: vi.fn() }]} />);
    const menu = container.querySelector(".menu") as HTMLElement;
    // Kept on screen near the window's edges.
    expect(parseInt(menu.style.left)).toBeLessThan(5000);
    fireEvent.mouseDown(menu);
    expect(close).not.toHaveBeenCalled();
    await userEvent.keyboard("{Escape}");
    fireEvent.mouseDown(container.querySelector(".menu-overlay")!);
    fireEvent.contextMenu(container.querySelector(".menu-overlay")!);
    expect(close).toHaveBeenCalledTimes(3);
  });
});

describe("Toolbar", () => {
  const handlers = () => ({
    onDatabases: vi.fn(),
    onOpen: vi.fn(),
    onRecent: vi.fn(),
    onImport: vi.fn(),
    onNewGame: vi.fn(),
    onExport: vi.fn(),
  });

  it("offers only opening files while no database is open", () => {
    render(<Toolbar isOpen={false} dbPath="" hasRecent={false} {...handlers()} />);
    for (const name of ["Databases", "Recent ▾", "Import PGN…", "New game", "Export PGN…"]) {
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
    }
    expect((screen.getByRole("button", { name: "Open…" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows the open file and passes on every button", async () => {
    const h = handlers();
    render(<Toolbar isOpen dbPath={"C:\\games\\club.pgn"} hasRecent {...h} />);
    expect(screen.getByText("club.pgn")).toBeTruthy();
    for (const name of ["Databases", "Open…", "Recent ▾", "Import PGN…", "New game", "Export PGN…"]) {
      await userEvent.click(screen.getByRole("button", { name }));
    }
    for (const fn of Object.values(h)) expect(fn).toHaveBeenCalledOnce();
    expect(h.onRecent.mock.calls[0]).toHaveLength(2);
  });
});

describe("SearchBar", () => {
  it("searches on Enter or the button and opens the search window", async () => {
    const props = { text: "", onText: vi.fn(), onSearch: vi.fn(), onSearchWindow: vi.fn(), filter: null, onShowAll: vi.fn() };
    render(<SearchBar {...props} />);
    await userEvent.type(screen.getByPlaceholderText("Search by player name"), "a{Enter}");
    expect(props.onText).toHaveBeenCalledWith("a");
    expect(props.onSearch).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    await userEvent.click(screen.getByRole("button", { name: "Search games…" }));
    expect([props.onSearch.mock.calls.length, props.onSearchWindow.mock.calls.length]).toEqual([2, 1]);
    expect(screen.queryByText(/Showing/)).toBeNull();
  });

  it("shows the active search with a way back to all games", async () => {
    const onShowAll = vi.fn();
    render(<SearchBar text="x" onText={vi.fn()} onSearch={vi.fn()} onSearchWindow={vi.fn()} filter={playerFilter("Anna")} onShowAll={onShowAll} />);
    expect(screen.getByText(/Showing: Anna – anyone \(either colour\)/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Show all games" }));
    expect(onShowAll).toHaveBeenCalledOnce();
  });
});

const game = (id: number, extra: Partial<GameSummary> = {}): GameSummary => ({
  id,
  event: "Club",
  site: "Town",
  date: "2026.01.01",
  round: "1",
  white: `White ${id}`,
  black: `Black ${id}`,
  result: "1-0",
  eco: "B20",
  whiteElo: 2000,
  blackElo: null,
  plies: 41,
  ...extra,
});

describe("GameList", () => {
  const props = () => ({
    order: { column: "id", descending: false } as const,
    selectedId: 2,
    hasMore: false,
    loadingMore: false,
    onSort: vi.fn(),
    onSelect: vi.fn(),
    onMenu: vi.fn(),
    onLoadMore: vi.fn(),
  });

  it("lists games with their columns and marks the sorted column and the open game", () => {
    render(<GameList games={[game(1), game(2)]} {...props()} />);
    const rows = screen.getAllByRole("row");
    expect(within(rows[1]).getAllByRole("cell").map((c) => c.textContent)).toEqual(
      ["1", "White 1", "2000", "Black 1", "", "1-0", "21", "B20", "Club", "Town", "1", "2026.01.01"],
    );
    expect(rows[2].className).toBe("active");
    expect(screen.getByText("No. ▲")).toBeTruthy();
    expect(screen.getByText("2 games")).toBeTruthy();
  });

  it("passes on sorting, opening, the right-click menu and loading more", async () => {
    const p = props();
    const { container } = render(<GameList games={[game(1)]} {...p} order={{ column: "white", descending: true }} hasMore />);
    expect(screen.getByText("White ▼")).toBeTruthy();
    await userEvent.click(screen.getByText("Moves"));
    expect(p.onSort).toHaveBeenCalledWith("plies");
    await userEvent.click(screen.getByText("White 1"));
    expect(p.onSelect).toHaveBeenCalledWith(1);
    fireEvent.contextMenu(screen.getByText("White 1"), { clientX: 3, clientY: 4 });
    expect(p.onMenu).toHaveBeenCalledWith(game(1), 3, 4);
    await userEvent.click(screen.getByRole("button", { name: "Showing 1 games, load more" }));
    fireEvent.scroll(container.querySelector(".games")!);
    expect(p.onLoadMore).toHaveBeenCalledTimes(2);
  });

  it("says when a list is empty, has one game, or is loading", () => {
    const { rerender } = render(<GameList games={[]} {...props()} />);
    expect(screen.getByText("No games.")).toBeTruthy();
    rerender(<GameList games={[game(1)]} {...props()} />);
    expect(screen.getByText("1 game")).toBeTruthy();
    rerender(<GameList games={[game(1)]} {...props()} hasMore loadingMore />);
    expect((screen.getByRole("button", { name: "Loading…" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("doesn't load more while scrolling far from the end", () => {
    const p = props();
    const { container } = render(<GameList games={[game(1)]} {...p} hasMore />);
    const list = container.querySelector(".games") as HTMLElement;
    Object.defineProperty(list, "scrollHeight", { value: 5000 });
    Object.defineProperty(list, "clientHeight", { value: 500 });
    fireEvent.scroll(list);
    expect(p.onLoadMore).not.toHaveBeenCalled();
  });
});

describe("DatabaseTiles", () => {
  const MINE = "D:\\mine.sqlite";
  const files = [
    { path: "C:\\games\\club.pgn", openedAt: new Date(2026, 0, 2).getTime() },
    { path: "C:\\games\\gone.pgn", openedAt: 0 },
    { path: "C:\\games\\new.sqlite", openedAt: 0 },
  ];
  const handlers = () => ({ onOpen: vi.fn(), onMyGames: vi.fn(), onAdd: vi.fn(), onMenu: vi.fn() });

  it("shows My Games first, then each file with its count, folder and date", () => {
    const counts = { "C:\\games\\club.pgn": 1, "C:\\games\\gone.pgn": null, "D:\\mine.sqlite": 1234 };
    render(<DatabaseTiles files={files} myGames={MINE} counts={counts} {...handlers()} />);
    const tiles = document.querySelectorAll(".tile");
    expect(tiles[0].textContent).toContain("My Games");
    // Counts use the computer's number format, e.g. 1.234 in German.
    expect(tiles[0].textContent).toContain(`${(1234).toLocaleString()} games`);
    expect(tiles[1].textContent).toContain("1 game");
    expect(tiles[1].textContent).toContain("C:\\games");
    expect(tiles[2].className).toContain("missing");
    expect(tiles[2].textContent).toContain("not found");
    expect(tiles[3].textContent).toContain("…");
    expect(tiles[4].textContent).toContain("Add database…");
  });

  it("asks to create My Games when it isn't set, and doesn't list it twice", () => {
    const { rerender } = render(<DatabaseTiles files={[]} myGames={null} counts={{}} {...handlers()} />);
    expect(screen.getByText("Double-click to create")).toBeTruthy();
    rerender(<DatabaseTiles files={[{ path: "d:\\MINE.sqlite", openedAt: 0 }]} myGames={MINE} counts={{}} {...handlers()} />);
    expect(document.querySelectorAll(".tile")).toHaveLength(2);
  });

  it("selects on click, opens on double-click or Enter, and has a right-click menu", async () => {
    const h = handlers();
    render(<DatabaseTiles files={files} myGames={MINE} counts={{}} {...h} />);
    const club = screen.getByText("club.pgn").closest("button")!;
    await userEvent.click(club);
    expect(club.className).toContain("selected");
    expect(h.onOpen).not.toHaveBeenCalled();
    await userEvent.dblClick(club);
    fireEvent.keyDown(club, { key: "Enter" });
    fireEvent.keyDown(club, { key: "a" });
    expect(h.onOpen).toHaveBeenCalledTimes(2);
    expect(h.onOpen).toHaveBeenCalledWith("C:\\games\\club.pgn");

    fireEvent.contextMenu(club, { clientX: 1, clientY: 2 });
    expect(h.onMenu).toHaveBeenCalledWith("C:\\games\\club.pgn", false, 1, 2);
    const mine = screen.getByText("My Games").closest("button")!;
    fireEvent.contextMenu(mine, { clientX: 1, clientY: 2 });
    expect(h.onMenu).toHaveBeenLastCalledWith("D:\\mine.sqlite", true, 1, 2);
    await userEvent.dblClick(mine);
    expect(h.onMyGames).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByText("Add database…"));
    expect(h.onAdd).toHaveBeenCalled();
  });

  it("has no menu for My Games before it exists", () => {
    const h = handlers();
    render(<DatabaseTiles files={[]} myGames={null} counts={{}} {...h} />);
    fireEvent.contextMenu(screen.getByText("My Games").closest("button")!);
    expect(h.onMenu).not.toHaveBeenCalled();
  });
});

describe("Notation", () => {
  const tree = parseGame("{ Intro } 1. e4 $1 { Good } ( 1. d4 d5 ( 1... Nf6 ) ) 1... e5 2. Nf3 *");

  it("shows numbers, symbols, comments and variations, with the shown move marked", () => {
    const e5 = tree.root.children[0].children[0];
    const { container } = render(<Notation root={tree.root} current={e5} onSelect={vi.fn()} onMenu={vi.fn()} />);
    const moves = [...container.querySelectorAll(".move")].map((m) => m.textContent);
    expect(moves).toEqual(["Start", "1. e4!", "1. d4", "d5", "1... Nf6", "1... e5", "2. Nf3"]);
    expect(container.querySelector(".move.active")!.textContent).toBe("1... e5");
    expect([...container.querySelectorAll(".comment")].map((c) => c.textContent)).toEqual(["Intro", "Good"]);
    expect(container.querySelector(".variation.block")!.textContent).toContain("1. d4");
    expect(container.querySelector(".variation .variation:not(.block)")!.textContent).toBe("1... Nf6");
  });

  it("selects a move on click and opens its menu on right-click", () => {
    const onSelect = vi.fn();
    const onMenu = vi.fn();
    render(<Notation root={tree.root} current={tree.root} onSelect={onSelect} onMenu={onMenu} />);
    expect(screen.getByText("Start").className).toContain("active");
    fireEvent.click(screen.getByText("2. Nf3"));
    const nf3 = tree.root.children[0].children[0].children[0];
    expect(onSelect).toHaveBeenCalledWith(nf3);
    fireEvent.contextMenu(screen.getByText("2. Nf3"), { clientX: 7, clientY: 8 });
    expect(onMenu).toHaveBeenCalledWith(nf3, 7, 8);
    fireEvent.click(screen.getByText("Start"));
    expect(onSelect).toHaveBeenLastCalledWith(tree.root);
  });

  it("invites a first move in an empty game", () => {
    const empty = parseGame("*");
    render(<Notation root={empty.root} current={empty.root} onSelect={vi.fn()} onMenu={vi.fn()} />);
    expect(screen.getByText(/Make a move on the board/)).toBeTruthy();
  });
});

describe("SearchDialog", () => {
  it("searches with the filled-in fields, trimmed, and Elo as a number", async () => {
    const onSearch = vi.fn();
    render(<SearchDialog initial={EMPTY_FILTER} onSearch={onSearch} onClose={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("White player"), "  Anna ");
    await userEvent.click(screen.getByLabelText("Ignore colour"));
    await userEvent.selectOptions(screen.getByLabelText("Result"), "1/2-1/2");
    await userEvent.type(screen.getByLabelText("ECO from"), "B20");
    await userEvent.type(screen.getByLabelText("White Elo at least"), "2000");
    await userEvent.type(screen.getByLabelText("Black Elo at least"), "1");
    await userEvent.clear(screen.getByLabelText("Black Elo at least"));
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(onSearch).toHaveBeenCalledWith({
      ...EMPTY_FILTER,
      white: "Anna",
      ignoreColour: true,
      result: "1/2-1/2",
      ecoFrom: "B20",
      minWhiteElo: 2000,
      minBlackElo: null,
    });
  });

  it("starts from the last search, clears its fields, and closes without searching", async () => {
    const onSearch = vi.fn();
    const onClose = vi.fn();
    const { container } = render(<SearchDialog initial={{ ...EMPTY_FILTER, black: "Bernd", minBlackElo: 1800 }} onSearch={onSearch} onClose={onClose} />);
    expect((screen.getByLabelText("Black player") as HTMLInputElement).value).toBe("Bernd");
    expect((screen.getByLabelText("Black Elo at least") as HTMLInputElement).value).toBe("1800");
    await userEvent.click(screen.getByRole("button", { name: "Clear fields" }));
    expect((screen.getByLabelText("Black player") as HTMLInputElement).value).toBe("");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await userEvent.keyboard("{Escape}");
    fireEvent.mouseDown(container.querySelector(".search-dialog")!);
    fireEvent.mouseDown(container.querySelector(".overlay")!);
    expect(onClose).toHaveBeenCalledTimes(3);
    expect(onSearch).not.toHaveBeenCalled();
  });
});
