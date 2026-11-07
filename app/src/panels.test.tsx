import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./api";
import { Board } from "./Board";
import { EngineLine } from "./engine";
import { EnginePanel } from "./EnginePanel";
import { ExplorerPanel } from "./ExplorerPanel";
import { GameView } from "./GameView";
import { START_FEN, useGameEditor } from "./useGameEditor";

const board = vi.hoisted(() => ({
  set: vi.fn(),
  destroy: vi.fn(),
  config: null as null | { movable: { events: { after: (from: string, to: string) => void } } },
}));

vi.mock("chessground", () => ({
  Chessground: (_element: HTMLElement, config: typeof board.config) => {
    board.config = config;
    return { set: board.set, destroy: board.destroy };
  },
}));

const engine = vi.hoisted(() => ({ onLine: null as null | ((line: EngineLine) => void), stop: vi.fn() }));

vi.mock("./api", () => ({
  startAnalysis: vi.fn(async () => {}),
  stopAnalysis: vi.fn(async () => {}),
  onEngineLine: (onLine: (line: EngineLine) => void) => {
    engine.onLine = onLine;
    return engine.stop;
  },
  hasLichessToken: vi.fn(),
  explore: vi.fn(),
  setLichessToken: vi.fn(async () => {}),
}));

const AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";

/// What the board was last told to show.
const lastSet = () => board.set.mock.calls[board.set.mock.calls.length - 1][0];

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe("Board", () => {
  it("shows the position with the side to move's legal moves and passes moves on", () => {
    const onMove = vi.fn();
    const { rerender, unmount } = render(<Board fen={START_FEN} revision={0} onMove={onMove} />);
    const shown = lastSet();
    expect(shown.fen).toBe(START_FEN);
    expect([shown.turnColor, shown.check]).toEqual(["white", false]);
    expect(shown.movable.dests.get("e2")).toEqual(["e3", "e4"]);

    // The latest handler is used even though the board was made earlier.
    const later = vi.fn();
    rerender(<Board fen={START_FEN} revision={0} onMove={later} />);
    board.config!.movable.events.after("e2", "e4");
    expect(later).toHaveBeenCalledWith("e2", "e4");
    expect(onMove).not.toHaveBeenCalled();

    rerender(<Board fen={START_FEN} revision={1} onMove={later} />);
    expect(board.set).toHaveBeenCalledTimes(2);
    unmount();
    expect(board.destroy).toHaveBeenCalledOnce();
  });

  it("marks a king in check", () => {
    render(<Board fen="4k3/8/8/8/8/8/8/4K2R b K - 0 1" revision={0} onMove={vi.fn()} />);
    render(<Board fen="4k3/8/8/8/8/8/8/R3K3 b - - 0 1" revision={0} onMove={vi.fn()} />);
    render(<Board fen="4k3/8/8/8/8/8/8/4R1K1 b - - 0 1" revision={0} onMove={vi.fn()} />);
    expect(lastSet().check).toBe("black");
  });

  it("allows no moves in an impossible position", () => {
    render(<Board fen="8/8/8/8/8/8/8/8 w - - 0 1" revision={0} onMove={vi.fn()} />);
    const shown = lastSet();
    expect(shown.movable.dests.size).toBe(0);
    expect(shown.movable.color).toBeUndefined();
  });
});

const line = (fen: string, multipv: number, extra: Partial<EngineLine> = {}): EngineLine => ({
  fen,
  multipv,
  depth: 12,
  score: { kind: "cp", value: 25 },
  moves: ["e4", "e5"],
  ...extra,
});

describe("EnginePanel", () => {
  it("starts with the remembered engine and analyses while running", async () => {
    localStorage.setItem("chessvault.enginePath", "C:\\stockfish.exe");
    const { rerender } = render(<EnginePanel fen={START_FEN} />);
    await userEvent.click(screen.getByRole("button", { name: "Analyze" }));
    expect(api.startAnalysis).toHaveBeenCalledWith("C:\\stockfish.exe", START_FEN);
    expect(screen.getByText("Thinking…")).toBeTruthy();
    expect((screen.getByPlaceholderText(/Path to Stockfish/) as HTMLInputElement).disabled).toBe(true);

    act(() => engine.onLine!(line(START_FEN, 2, { score: { kind: "mate", value: 3 } })));
    act(() => engine.onLine!(line(START_FEN, 1)));
    act(() => engine.onLine!(line(AFTER_E4, 3)));
    expect(document.querySelectorAll(".engine-line")).toHaveLength(2);
    expect(screen.getByText("+0.25")).toBeTruthy();
    expect(screen.getByText("#3")).toBeTruthy();
    expect(screen.getAllByText("1. e4 e5")).toHaveLength(2);

    // A new position clears the lines and analyses again.
    rerender(<EnginePanel fen={AFTER_E4} />);
    expect(document.querySelectorAll(".engine-line")).toHaveLength(0);
    expect(api.startAnalysis).toHaveBeenLastCalledWith("C:\\stockfish.exe", AFTER_E4);

    await userEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(api.stopAnalysis).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Analyze" })).toBeTruthy();
  });

  it("remembers a typed engine path and needs one to start", async () => {
    render(<EnginePanel fen={START_FEN} />);
    const analyze = screen.getByRole("button", { name: "Analyze" }) as HTMLButtonElement;
    expect(analyze.disabled).toBe(true);
    await userEvent.type(screen.getByPlaceholderText(/Path to Stockfish/), "D:\\sf.exe");
    await userEvent.click(analyze);
    expect(localStorage.getItem("chessvault.enginePath")).toBe("D:\\sf.exe");
  });

  it("shows when the engine can't start or stop", async () => {
    vi.mocked(api.startAnalysis).mockRejectedValueOnce("could not start the engine");
    localStorage.setItem("chessvault.enginePath", "bad.exe");
    render(<EnginePanel fen={START_FEN} />);
    await userEvent.click(screen.getByRole("button", { name: "Analyze" }));
    expect(await screen.findByText("could not start the engine")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Analyze" })).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Analyze" }));
    vi.mocked(api.stopAnalysis).mockRejectedValueOnce("the engine stopped responding");
    await userEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(await screen.findByText("the engine stopped responding")).toBeTruthy();
  });

  it("stops the engine and its events when it closes", () => {
    const { unmount } = render(<EnginePanel fen={START_FEN} />);
    unmount();
    expect(api.stopAnalysis).toHaveBeenCalled();
    expect(engine.stop).toHaveBeenCalled();
  });
});

const explorerData: api.Explorer = {
  white: 50,
  draws: 30,
  black: 20,
  moves: [
    { uci: "e2e4", san: "e4", white: 40, draws: 20, black: 10, averageRating: 2400 },
    { uci: "d2d4", san: "d4", white: 1, draws: 2, black: 27, averageRating: null },
  ],
  opening: { eco: "A00", name: "Start position" },
};

describe("ExplorerPanel", () => {
  it("asks for a token first and looks the position up once it is saved", async () => {
    vi.mocked(api.hasLichessToken).mockResolvedValue(false);
    vi.mocked(api.explore).mockResolvedValue(explorerData);
    render(<ExplorerPanel fen={START_FEN} onPlay={vi.fn()} />);
    const save = await screen.findByRole("button", { name: "Save" });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    await userEvent.type(screen.getByPlaceholderText("Lichess personal token"), "secret");
    await userEvent.click(save);
    expect(api.setLichessToken).toHaveBeenCalledWith("secret");
    expect(await screen.findByText("A00 Start position")).toBeTruthy();
    expect(api.explore).toHaveBeenCalledWith("masters", START_FEN);
  });

  it("shows moves with games, results and rating, and plays a clicked move", async () => {
    vi.mocked(api.hasLichessToken).mockResolvedValue(true);
    vi.mocked(api.explore).mockResolvedValue(explorerData);
    const onPlay = vi.fn();
    render(<ExplorerPanel fen={START_FEN} onPlay={onPlay} />);
    await screen.findByText("e4");
    expect(screen.getByText("70")).toBeTruthy();
    expect(screen.getByText("2400")).toBeTruthy();
    expect(screen.getByText("Total")).toBeTruthy();
    expect(screen.getAllByText("57%")).toHaveLength(1);
    // Shares under 15% get no label, so the bar stays readable.
    expect(screen.getByTitle("White 3%, draws 7%, Black 90%").textContent).toBe("90%");
    await userEvent.click(screen.getByText("d4"));
    expect(onPlay).toHaveBeenCalledWith("d2d4");

    await userEvent.selectOptions(screen.getByRole("combobox"), "lichess");
    await waitFor(() => expect(api.explore).toHaveBeenLastCalledWith("lichess", START_FEN));
  });

  it("says when no games reach the position, and shows errors", async () => {
    vi.mocked(api.hasLichessToken).mockResolvedValue(true);
    vi.mocked(api.explore).mockResolvedValueOnce({ white: 0, draws: 0, black: 0, moves: [], opening: null });
    const { rerender } = render(<ExplorerPanel fen={START_FEN} onPlay={vi.fn()} />);
    expect(await screen.findByText("No games reach this position.")).toBeTruthy();
    vi.mocked(api.explore).mockRejectedValueOnce("Lichess rejected the token");
    rerender(<ExplorerPanel fen={AFTER_E4} onPlay={vi.fn()} />);
    expect(await screen.findByText("Lichess rejected the token")).toBeTruthy();
    expect(screen.queryByText("Total")).toBeNull();
  });

  it("waits briefly so quick steps through a game make one request", async () => {
    vi.mocked(api.hasLichessToken).mockResolvedValue(true);
    vi.mocked(api.explore).mockResolvedValue(explorerData);
    const { rerender } = render(<ExplorerPanel fen={START_FEN} onPlay={vi.fn()} />);
    await waitFor(() => expect(api.hasLichessToken).toHaveBeenCalled());
    rerender(<ExplorerPanel fen={AFTER_E4} onPlay={vi.fn()} />);
    await screen.findByText("e4");
    expect(api.explore).toHaveBeenCalledTimes(1);
    expect(api.explore).toHaveBeenCalledWith("masters", AFTER_E4);
  });

  it("ignores an answer that arrives after the position changed", async () => {
    vi.mocked(api.hasLichessToken).mockResolvedValue(true);
    let answer: (data: api.Explorer) => void = () => {};
    let fail: (error: string) => void = () => {};
    vi.mocked(api.explore)
      .mockReturnValueOnce(new Promise((resolve) => (answer = resolve)))
      .mockReturnValueOnce(new Promise((_, reject) => (fail = reject)))
      .mockResolvedValueOnce({ ...explorerData, opening: null });
    const { rerender } = render(<ExplorerPanel fen={START_FEN} onPlay={vi.fn()} />);
    await waitFor(() => expect(api.explore).toHaveBeenCalledTimes(1));
    rerender(<ExplorerPanel fen={AFTER_E4} onPlay={vi.fn()} />);
    await waitFor(() => expect(api.explore).toHaveBeenCalledTimes(2));
    rerender(<ExplorerPanel fen={START_FEN} onPlay={vi.fn()} />);
    await act(async () => {
      answer(explorerData);
      fail("too late");
    });
    await screen.findByText("e4");
    expect(screen.queryByText("A00 Start position")).toBeNull();
    expect(screen.queryByText("too late")).toBeNull();
  });

  it("changes or removes the token", async () => {
    vi.mocked(api.hasLichessToken).mockResolvedValue(true);
    vi.mocked(api.explore).mockResolvedValue(explorerData);
    render(<ExplorerPanel fen={START_FEN} onPlay={vi.fn()} />);
    await userEvent.click(await screen.findByRole("button", { name: "Token" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByPlaceholderText("Lichess personal token")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Token" }));
    vi.mocked(api.setLichessToken).mockRejectedValueOnce("could not save the token");
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(await screen.findByText("could not save the token")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(api.setLichessToken).toHaveBeenLastCalledWith("");
    expect(await screen.findByRole("button", { name: "Save" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Token" })).toBeNull();
  });

  it("treats a failed token check as no token", async () => {
    vi.mocked(api.hasLichessToken).mockRejectedValue(new Error("no config folder"));
    render(<ExplorerPanel fen={START_FEN} onPlay={vi.fn()} />);
    expect(await screen.findByPlaceholderText("Lichess personal token")).toBeTruthy();
    expect(api.explore).not.toHaveBeenCalled();
  });
});

describe("GameView", () => {
  const PGN = '[Event "Club"]\n[White "Anna"]\n[Black "Bernd"]\n[Result "*"]\n\n1. e4 e5 *';

  function view(id: number | null, pgn: string | null) {
    const handlers = { onSave: vi.fn(), onUndo: vi.fn(), onDelete: vi.fn(), onMoveMenu: vi.fn() };
    const hook = renderHook(() => useGameEditor({ askUser: vi.fn(async () => null), busy: false }));
    act(() => hook.result.current.show(id, pgn));
    const ui = render(<GameView editor={hook.result.current} {...handlers} />);
    const refresh = () => ui.rerender(<GameView editor={hook.result.current} {...handlers} />);
    return { ...handlers, hook, refresh };
  }

  it("asks for a game when none is shown", () => {
    view(null, null);
    expect(screen.getByText("Select a game, or start a new one.")).toBeTruthy();
  });

  it("edits headers and the result, and steps with the buttons", async () => {
    vi.mocked(api.hasLichessToken).mockResolvedValue(false);
    const { hook, refresh } = view(4, PGN);
    expect((screen.getByLabelText("White") as HTMLInputElement).value).toBe("Anna");
    fireEvent.change(screen.getByLabelText("White"), { target: { value: "Carla" } });
    fireEvent.change(screen.getByLabelText("Result"), { target: { value: "1-0" } });
    refresh();
    expect(hook.result.current.tree!.headers.get("White")).toBe("Carla");
    expect(hook.result.current.tree!.headers.get("Result")).toBe("1-0");
    expect(screen.getByText("Unsaved changes")).toBeTruthy();

    const step = async (label: string) => {
      await userEvent.click(screen.getByRole("button", { name: label }));
      refresh();
    };
    await step(">|");
    expect(hook.result.current.current!.san).toBe("e5");
    await step("<");
    expect(hook.result.current.current!.san).toBe("e4");
    await step("|<");
    expect(hook.result.current.current!.parent).toBeNull();
    await step(">");
    expect(hook.result.current.current!.san).toBe("e4");
  });

  it("saves, undoes and deletes a stored game; a new game can only be saved", async () => {
    vi.mocked(api.hasLichessToken).mockResolvedValue(false);
    const stored = view(4, PGN);
    // The explorer's token form has a Save button too.
    const gameSave = () => within(document.querySelector(".actions") as HTMLElement).getByRole("button", { name: "Save" });
    expect((gameSave() as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "Undo last save" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete game" }));
    expect([stored.onUndo.mock.calls.length, stored.onDelete.mock.calls.length]).toEqual([1, 1]);
    fireEvent.contextMenu(screen.getByText("e5"), { clientX: 1, clientY: 2 });
    expect(stored.onMoveMenu).toHaveBeenCalled();

    fireEvent.change(document.querySelector(".source textarea")!, { target: { value: "edited" } });
    stored.refresh();
    await userEvent.click(gameSave());
    expect(stored.onSave).toHaveBeenCalledOnce();
  });

  it("offers Save as new game for a game that isn't stored yet, and plays explorer moves", async () => {
    vi.mocked(api.hasLichessToken).mockResolvedValue(true);
    vi.mocked(api.explore).mockResolvedValue(explorerData);
    const fresh = view(null, "*");
    expect(screen.getByRole("button", { name: "Save as new game" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Undo last save" }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(await screen.findByText("e4"));
    await waitFor(() => expect(fresh.hook.result.current.current!.san).toBe("e4"));
  });
});
