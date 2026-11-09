import { act, renderHook, waitFor } from "@testing-library/react";
import { parseUci } from "chessops/util";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./api";
import { Ask, MenuItem } from "./Dialog";
import { EMPTY_FILTER, playerFilter } from "./filter";
import { GameSummary } from "./types";
import { useDialogs } from "./useDialogs";
import { useFileCounts } from "./useFileCounts";
import { START_FEN, useGameEditor } from "./useGameEditor";
import { useGameList } from "./useGameList";

vi.mock("./api", () => ({
  listGames: vi.fn(),
  searchGames: vi.fn(),
  databaseCounts: vi.fn(),
}));

const PGN = '[Event "Club"]\n[White "Anna"]\n[Black "Bernd"]\n[Result "*"]\n\n1. e4 ( 1. d4 d5 ) 1... e5 2. Nf3 *';

describe("useDialogs", () => {
  it("answers questions and forms, then closes them", async () => {
    const { result } = renderHook(() => useDialogs());
    expect(result.current.busy).toBe(false);

    let answer: Promise<string | null>;
    act(() => void (answer = result.current.askUser({ title: "Sure?", choices: [] })));
    expect(result.current.ask?.title).toBe("Sure?");
    expect(result.current.busy).toBe(true);
    act(() => result.current.ask!.answer("yes"));
    expect(await answer!).toBe("yes");
    expect(result.current.ask).toBeNull();

    let form: Promise<Record<string, string> | null>;
    act(() => void (form = result.current.askFields("Details", [{ name: "White", value: "" }])));
    expect(result.current.ask?.fields).toHaveLength(1);
    act(() => result.current.ask!.answer("ok", { White: "Anna" }));
    expect(await form!).toEqual({ White: "Anna" });

    act(() => void (form = result.current.askFields("Details", [])));
    act(() => result.current.ask!.answer(null));
    expect(await form!).toBeNull();
  });

  it("opens and closes the right-click menu", () => {
    const { result } = renderHook(() => useDialogs());
    act(() => result.current.openMenu({ x: 1, y: 2, items: [] }));
    expect(result.current.menu).toEqual({ x: 1, y: 2, items: [] });
    expect(result.current.busy).toBe(true);
    act(() => result.current.closeMenu());
    expect(result.current.menu).toBeNull();
  });
});

/// The editor hook with a scripted `askUser`: each question gets the next answer.
function editor(answers: (string | null)[] = [], busy = false) {
  const askUser = vi.fn(async (_question: Omit<Ask, "answer" | "fields">) => answers.shift() ?? null);
  const onSave = vi.fn();
  const hook = renderHook((props: { busy: boolean }) => useGameEditor({ askUser, busy: props.busy, onSave }), {
    initialProps: { busy },
  });
  return { ...hook, askUser, onSave };
}

/// Presses a key on `target`, the window unless given.
function press(key: string, target: EventTarget = window, modifiers: KeyboardEventInit = {}) {
  act(() => void target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...modifiers })));
}

function run(item: MenuItem | undefined) {
  if (!item || item === "separator" || "buttons" in item) throw new Error("not a menu entry");
  return item.action();
}

describe("useGameEditor", () => {
  it("shows a game, or the start position when there is none", () => {
    const { result } = editor();
    expect([result.current.tree, result.current.fen, result.current.dirty]).toEqual([null, START_FEN, false]);
    act(() => result.current.show(7, PGN, [0, 0]));
    expect(result.current.gameId).toBe(7);
    expect(result.current.current?.san).toBe("e5");
    expect(result.current.currentPath()).toEqual([0, 0]);
    expect(result.current.dirty).toBe(false);
    act(() => result.current.show(null, null));
    expect([result.current.tree, result.current.current, result.current.currentPath()]).toEqual([null, null, []]);
  });

  it("follows a move that is already there without asking", async () => {
    const { result, askUser } = editor();
    act(() => result.current.show(1, PGN));
    await act(() => result.current.play(parseUci("e2e4")!));
    expect(result.current.current?.san).toBe("e4");
    expect(askUser).not.toHaveBeenCalled();
    expect(result.current.dirty).toBe(false);
  });

  it("adds a move at the end of a line without asking", async () => {
    const { result, askUser } = editor();
    act(() => result.current.show(1, PGN));
    act(() => result.current.toEnd());
    await act(() => result.current.play(parseUci("b8c6")!));
    expect(result.current.current?.san).toBe("Nc6");
    expect(askUser).not.toHaveBeenCalled();
    expect(result.current.dirty).toBe(true);
    expect(result.current.draft).toContain("2. Nf3 Nc6");
  });

  it("asks how to add a new move where the game continues", async () => {
    const { result, askUser } = editor(["variation"]);
    act(() => result.current.show(1, PGN));
    await act(() => result.current.play(parseUci("c2c4")!));
    expect(askUser.mock.calls[0][0].title).toBe("c4 is a new move here.");
    expect(result.current.tree!.root.children.map((c) => c.san)).toEqual(["e4", "d4", "c4"]);
    expect(result.current.current?.san).toBe("c4");
  });

  it("puts the piece back when the question is cancelled", async () => {
    const { result } = editor([null]);
    act(() => result.current.show(1, PGN));
    const before = result.current.revision;
    await act(() => result.current.play(parseUci("c2c4")!));
    expect(result.current.revision).toBe(before + 1);
    expect(result.current.tree!.root.children).toHaveLength(2);
    expect(result.current.dirty).toBe(false);
  });

  it("puts the piece back for a move that is not legal in the shown position", async () => {
    const { result, askUser } = editor();
    act(() => result.current.show(1, PGN, [0]));
    const before = result.current.revision;
    await act(() => result.current.play(parseUci("d2d4")!));
    expect(result.current.revision).toBe(before + 1);
    expect(result.current.current?.san).toBe("e4");
    expect(askUser).not.toHaveBeenCalled();
    expect(result.current.dirty).toBe(false);
  });

  it("asks which piece a pawn becomes, and can be cancelled", async () => {
    const { result, askUser } = editor(["knight", null]);
    act(() => result.current.show(null, '[FEN "8/P7/8/8/8/8/8/k6K w - - 0 1"]\n[SetUp "1"]\n\n*'));
    await act(() => result.current.boardMove("a7", "a8"));
    expect(askUser.mock.calls[0][0].title).toBe("Promote to");
    expect(result.current.current?.san).toBe("a8=N");

    act(() => result.current.setCurrent(result.current.tree!.root));
    const before = result.current.revision;
    await act(() => result.current.boardMove("a7", "a8"));
    expect(result.current.revision).toBe(before + 1);
    expect(result.current.current).toBe(result.current.tree!.root);
  });

  it("plays ordinary board moves and ignores moves without a game", async () => {
    const { result } = editor();
    await act(() => result.current.boardMove("e2", "e4"));
    await act(() => result.current.play(parseUci("e2e4")!));
    expect(result.current.tree).toBeNull();
    act(() => result.current.show(null, "*"));
    await act(() => result.current.boardMove("g1", "f3"));
    expect(result.current.current?.san).toBe("Nf3");
  });

  it("edits comments through the move menu", async () => {
    const { result } = editor(["  A fine move  ", "", null]);
    act(() => result.current.show(1, PGN));
    const e4 = result.current.tree!.root.children[0];
    const menu = () => result.current.moveMenu(e4);
    expect((menu()[0] as { label: string }).label).toBe("Add comment…");
    await act(() => run(menu()[0]));
    expect(e4.comments).toEqual(["A fine move"]);
    expect((menu()[0] as { label: string }).label).toBe("Edit comment…");
    await act(() => run(menu()[0]));
    expect(e4.comments).toEqual([]);
    await act(() => run(menu()[0]));
    expect(e4.comments).toEqual([]);
  });

  it("sets symbols, removes comments and symbols, and edits variations from the menu", () => {
    const { result } = editor();
    act(() => result.current.show(1, PGN));
    const [e4, d4] = result.current.tree!.root.children;
    const labels = (items: MenuItem[]) => items.map((i) => (typeof i === "string" ? i : "buttons" in i ? "row" : `${i.label}${i.disabled ? " (off)" : ""}`));
    expect(labels(result.current.moveMenu(e4))).toEqual([
      "Add comment…", "row", "row", "Remove comment and symbols (off)", "separator",
      "Promote variation (off)", "Delete variation (off)", "Delete moves from here",
    ]);

    const symbols = result.current.moveMenu(e4)[1] as { buttons: { label: string; action: () => void }[] };
    act(() => symbols.buttons.find((b) => b.label === "!")!.action());
    expect(e4.nags).toEqual([1]);
    const row = result.current.moveMenu(e4)[1] as { buttons: { label: string; active?: boolean }[] };
    expect(row.buttons.find((b) => b.label === "!")!.active).toBe(true);
    act(() => run(result.current.moveMenu(e4)[3]));
    expect(e4.nags).toEqual([]);

    act(() => run(result.current.moveMenu(d4)[5]));
    expect(result.current.tree!.root.children[0]).toBe(d4);
    act(() => run(result.current.moveMenu(e4)[6]));
    expect(result.current.tree!.root.children).toEqual([d4]);
    expect(result.current.current).toBe(result.current.tree!.root);
    act(() => run(result.current.moveMenu(d4.children[0])[7]));
    expect(d4.children).toEqual([]);
    expect(result.current.current).toBe(d4);
    expect(result.current.dirty).toBe(true);
  });

  it("edits headers and the PGN text, and forgets changes once saved elsewhere", () => {
    const { result } = editor();
    act(() => result.current.setHeader("White", "nobody"));
    act(() => result.current.show(1, PGN));
    act(() => result.current.setHeader("White", "Carla"));
    expect(result.current.tree!.headers.get("White")).toBe("Carla");
    expect(result.current.draft).toContain('[White "Carla"]');
    expect(result.current.dirty).toBe(true);
    act(() => result.current.markSaved(result.current.draft));
    expect(result.current.dirty).toBe(false);
    act(() => result.current.setDraft(result.current.draft + " "));
    expect(result.current.dirty).toBe(true);
  });

  it("steps through moves with the arrow keys, Home and End", () => {
    const { result, rerender } = editor();
    act(() => result.current.show(1, PGN));
    press("ArrowRight");
    expect(result.current.current?.san).toBe("e4");
    press("End");
    expect(result.current.current?.san).toBe("Nf3");
    press("ArrowRight");
    expect(result.current.current?.san).toBe("Nf3");
    press("ArrowLeft");
    expect(result.current.current?.san).toBe("e5");
    press("Home");
    expect(result.current.current).toBe(result.current.tree!.root);
    press("ArrowLeft");
    press("x");
    expect(result.current.current).toBe(result.current.tree!.root);

    // Not while typing, and not while a dialog is open.
    const input = document.body.appendChild(document.createElement("input"));
    press("ArrowRight", input);
    expect(result.current.current).toBe(result.current.tree!.root);
    input.remove();
    rerender({ busy: true });
    press("ArrowRight");
    expect(result.current.current).toBe(result.current.tree!.root);
  });

  it("flips the board with F, deletes with Delete and saves with Ctrl+S, also while typing", () => {
    const { result, rerender, onSave } = editor();
    act(() => result.current.show(1, PGN));
    expect(result.current.orientation).toBe("white");
    press("f");
    expect(result.current.orientation).toBe("black");
    press("F");
    expect(result.current.orientation).toBe("white");
    // Ctrl+F is the window's, not a flip.
    press("f", window, { ctrlKey: true });
    expect(result.current.orientation).toBe("white");

    press("Delete");
    expect(result.current.dirty).toBe(false);
    press("End");
    press("Delete");
    expect(result.current.current?.san).toBe("e5");
    expect(result.current.dirty).toBe(true);
    // Holding a key down acts once.
    press("Delete", window, { repeat: true });
    press("f", window, { repeat: true });
    press("s", window, { ctrlKey: true, repeat: true });
    expect([result.current.current?.san, result.current.orientation]).toEqual(["e5", "white"]);
    expect(onSave).not.toHaveBeenCalled();

    const input = document.body.appendChild(document.createElement("input"));
    press("f", input);
    press("Delete", input);
    expect([result.current.orientation, result.current.current?.san]).toEqual(["white", "e5"]);
    press("s", input, { ctrlKey: true });
    expect(onSave).toHaveBeenCalledOnce();
    input.remove();
    press("S", window, { metaKey: true });
    expect(onSave).toHaveBeenCalledTimes(2);

    rerender({ busy: true });
    press("s", window, { ctrlKey: true });
    press("f");
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(result.current.orientation).toBe("white");

    // The window's own Save never opens, also without a game.
    act(() => result.current.show(null, null));
    const ctrlS = new KeyboardEvent("keydown", { key: "s", ctrlKey: true, cancelable: true });
    window.dispatchEvent(ctrlS);
    expect(ctrlS.defaultPrevented).toBe(true);
  });

  it("plays a line of moves, asking only where the game goes on differently", async () => {
    const { result, askUser } = editor(["variation"]);
    act(() => result.current.show(1, PGN));
    // 1. e4 is the game's move; 1... c5 is new there, and then the line goes on alone.
    await act(() => result.current.playLine(["e4", "c5", "Nf3", "d6"]));
    expect(askUser).toHaveBeenCalledOnce();
    expect(result.current.current?.san).toBe("d6");
    expect(result.current.draft).toContain("( 1... c5 2. Nf3 d6 )");
  });

  it("stops a line at a move that is cancelled or not legal, keeping the moves before", async () => {
    const { result } = editor([null]);
    act(() => result.current.show(1, PGN));
    await act(() => result.current.playLine(["e4", "c5"]));
    expect(result.current.current?.san).toBe("e4");
    expect(result.current.dirty).toBe(false);

    act(() => result.current.toEnd());
    await act(() => result.current.playLine(["Nc6", "Bc4", "Kxe1"]));
    expect(result.current.current?.san).toBe("Bc4");
    await act(() => result.current.playLine(["e4"]));
    expect(result.current.current?.san).toBe("Bc4");

    act(() => result.current.show(null, null));
    await act(() => result.current.playLine(["e4"]));
    expect(result.current.current).toBeNull();
  });
});

const game = (id: number) => ({ id }) as GameSummary;
const pages = (count: number, from = 1) => Array.from({ length: count }, (_, i) => game(from + i));

describe("useGameList", () => {
  const run = async (action: () => Promise<void>) => {
    try {
      await action();
    } catch {
      // Reported in the status bar by the app.
    }
  };

  beforeEach(() => vi.mocked(api.listGames).mockReset() && vi.mocked(api.searchGames).mockReset());

  it("loads the first page and more while there are more", async () => {
    vi.mocked(api.listGames).mockResolvedValueOnce(pages(200)).mockResolvedValueOnce(pages(5, 201));
    const { result } = renderHook(() => useGameList(run));
    await act(() => result.current.showNewDatabase());
    expect(api.listGames).toHaveBeenCalledWith({ column: "id", descending: false }, 200, 0);
    expect([result.current.games.length, result.current.hasMore]).toEqual([200, true]);
    await act(() => result.current.loadMore());
    expect(api.listGames).toHaveBeenLastCalledWith({ column: "id", descending: false }, 200, 200);
    expect([result.current.games.length, result.current.hasMore, result.current.loadingMore]).toEqual([205, false, false]);
    await act(() => result.current.loadMore());
    expect(api.listGames).toHaveBeenCalledTimes(2);
  });

  it("keeps as many rows as are loaded when the list is read again", async () => {
    vi.mocked(api.listGames).mockResolvedValueOnce(pages(200)).mockResolvedValueOnce(pages(50, 201)).mockResolvedValueOnce(pages(240));
    const { result } = renderHook(() => useGameList(run));
    await act(() => result.current.showNewDatabase());
    await act(() => result.current.loadMore());
    await act(() => result.current.reload());
    expect(api.listGames).toHaveBeenLastCalledWith({ column: "id", descending: false }, 250, 0);
    expect(result.current.hasMore).toBe(false);
  });

  it("searches with a filter and goes back to all games", async () => {
    vi.mocked(api.searchGames).mockResolvedValue(pages(2));
    vi.mocked(api.listGames).mockResolvedValue(pages(3));
    const { result } = renderHook(() => useGameList(run));
    await act(() => result.current.applyFilter(playerFilter("Anna")));
    expect(api.searchGames).toHaveBeenCalledWith(playerFilter("Anna"), { column: "id", descending: false }, 200, 0);
    expect(result.current.filter).toEqual(playerFilter("Anna"));
    expect(result.current.games).toHaveLength(2);
    await act(() => result.current.applyFilter(null));
    expect(result.current.filter).toBeNull();
    expect(result.current.games).toHaveLength(3);
  });

  it("sorts by a column and reverses it on the second click, keeping the search", async () => {
    vi.mocked(api.searchGames).mockResolvedValue([]);
    const { result } = renderHook(() => useGameList(run));
    await act(() => result.current.applyFilter(EMPTY_FILTER));
    await act(() => result.current.sortBy("date"));
    expect(api.searchGames).toHaveBeenLastCalledWith(EMPTY_FILTER, { column: "date", descending: false }, 200, 0);
    await act(() => result.current.sortBy("date"));
    expect(result.current.order).toEqual({ column: "date", descending: true });
  });

  it("stops loading when loading more fails", async () => {
    vi.mocked(api.listGames).mockResolvedValueOnce(pages(200)).mockRejectedValueOnce(new Error("gone"));
    const { result } = renderHook(() => useGameList(run));
    await act(() => result.current.showNewDatabase());
    await act(() => result.current.loadMore());
    expect([result.current.games.length, result.current.loadingMore]).toEqual([200, false]);
  });
});

describe("useFileCounts", () => {
  beforeEach(() => vi.mocked(api.databaseCounts).mockReset());

  it("reads the counts while active, and again when the files change", async () => {
    vi.mocked(api.databaseCounts).mockResolvedValueOnce([3, null]).mockResolvedValueOnce([4]);
    const { result, rerender } = renderHook((p: { active: boolean; paths: string[] }) => useFileCounts(p.active, p.paths), {
      initialProps: { active: true, paths: ["a.pgn", "b.pgn"] },
    });
    await waitFor(() => expect(result.current).toEqual({ "a.pgn": 3, "b.pgn": null }));
    rerender({ active: true, paths: ["a.pgn", "b.pgn"] });
    expect(api.databaseCounts).toHaveBeenCalledTimes(1);
    rerender({ active: true, paths: ["c.pgn"] });
    await waitFor(() => expect(result.current).toEqual({ "c.pgn": 4 }));
  });

  it("reads nothing while inactive and ignores failures and late answers", async () => {
    let finish: (counts: (number | null)[]) => void = () => {};
    vi.mocked(api.databaseCounts).mockRejectedValueOnce(new Error("no")).mockReturnValueOnce(new Promise((r) => (finish = r)));
    const { result, rerender } = renderHook((p: { active: boolean }) => useFileCounts(p.active, ["a.pgn"]), {
      initialProps: { active: false },
    });
    expect(api.databaseCounts).not.toHaveBeenCalled();
    rerender({ active: true });
    await waitFor(() => expect(api.databaseCounts).toHaveBeenCalledTimes(1));
    expect(result.current).toEqual({});
    rerender({ active: false });
    rerender({ active: true });
    rerender({ active: false });
    await act(async () => finish([9]));
    expect(result.current).toEqual({});
  });
});
