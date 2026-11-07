import { beforeEach, describe, expect, it, vi } from "vitest";
// The Rust backend source, loaded as text by Vite.
import backendSource from "../src-tauri/src/lib.rs?raw";

const calls: { command: string; args?: Record<string, unknown> }[] = [];
const replies: Record<string, unknown> = {};
const windows = { open: vi.fn(), save: vi.fn() };
const reveal = vi.fn();
const listeners: ((event: { payload: unknown }) => void)[] = [];
const stopListening = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args?: Record<string, unknown>) => {
    calls.push({ command, args });
    return replies[command];
  },
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (_event: string, handler: (event: { payload: unknown }) => void) => {
    listeners.push(handler);
    return stopListening;
  },
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: windows.open, save: windows.save }));
vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir: reveal }));
const windowEvents = vi.hoisted(() => ({ close: null as null | ((event: { preventDefault: () => void }) => void), destroy: vi.fn(), stop: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onCloseRequested: async (handler: (event: { preventDefault: () => void }) => void) => {
      windowEvents.close = handler;
      return windowEvents.stop;
    },
    destroy: windowEvents.destroy,
  }),
}));

const api = await import("./api");
const { EMPTY_FILTER } = await import("./filter");

/// The backend's commands and their argument names, read from the Rust source. Tauri turns the
/// Rust names into camelCase, and `state` and `app` are filled in by Tauri itself.
function backendCommands(): Map<string, string[]> {
  const commands = new Map<string, string[]>();
  // Commands are marked #[tauri::command] or #[tauri::command(async)].
  for (const [, name, params] of backendSource.matchAll(/#\[tauri::command(?:\([^)]*\))?\]\s*(?:async\s+)?fn\s+(\w+)\s*\(([^)]*)\)/g)) {
    // Type arguments like State<'_, AppState> contain commas of their own.
    const args = params
      .replace(/<[^<>]*>/g, "")
      .split(",")
      .map((p: string) => p.trim().split(":")[0].trim())
      .filter((p: string) => p && p !== "state" && p !== "app")
      .map((p: string) => p.replace(/_([a-z])/g, (_: string, c: string) => c.toUpperCase()));
    commands.set(name, args.sort());
  }
  return commands;
}

beforeEach(() => {
  calls.length = 0;
  vi.clearAllMocks();
});

describe("api.ts calls the backend's real commands", () => {
  const order = { column: "id", descending: false } as const;
  const everyCall: [string, () => Promise<unknown>][] = [
    ["open_database", () => api.openDatabase("a.pgn")],
    ["create_database", () => api.createDatabase("a.sqlite")],
    ["import_pgn", () => api.importPgn("a.pgn")],
    ["list_games", () => api.listGames(order, 10, 0)],
    ["search_games", () => api.searchGames(EMPTY_FILTER, order, 10, 0)],
    ["get_game", () => api.getGame(1)],
    ["save_game", () => api.saveGame(1, "pgn")],
    ["add_game", () => api.addGame("pgn")],
    ["add_game_to", () => api.addGameTo("b.pgn", "pgn", false)],
    ["delete_game", () => api.deleteGame(1)],
    ["undo_game", () => api.undoGame(1)],
    ["export_pgn", () => api.exportPgn("out.pgn", null)],
    ["database_counts", () => api.databaseCounts(["a.pgn"])],
    ["start_analysis", () => api.startAnalysis("stockfish.exe", "fen")],
    ["stop_analysis", () => api.stopAnalysis()],
    ["explore", () => api.explore("masters", "fen")],
    ["has_lichess_token", () => api.hasLichessToken()],
    ["set_lichess_token", () => api.setLichessToken("token")],
  ];

  it.each(everyCall)("%s, with the argument names it expects", async (command, call) => {
    const backend = backendCommands();
    await call();
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe(command);
    expect(backend.has(command), `the backend has no command ${command}`).toBe(true);
    expect(Object.keys(calls[0].args ?? {}).sort()).toEqual(backend.get(command));
  });

  it("covers every command the backend offers", () => {
    expect([...backendCommands().keys()].sort()).toEqual(everyCall.map(([c]) => c).sort());
  });

  it("passes the values through and returns the backend's reply", async () => {
    replies.get_game = { id: 7, pgn: "*" };
    expect(await api.getGame(7)).toEqual({ id: 7, pgn: "*" });
    expect(calls[0].args).toEqual({ id: 7 });
    await api.exportPgn("out.pgn", [3, 4]);
    expect(calls[1].args).toEqual({ path: "out.pgn", ids: [3, 4] });
  });
});

describe("engine lines", () => {
  it("are passed on until listening stops", async () => {
    const seen: unknown[] = [];
    const stop = api.onEngineLine((line) => seen.push(line));
    listeners[listeners.length - 1]({ payload: { multipv: 1 } });
    expect(seen).toEqual([{ multipv: 1 }]);
    stop();
    await vi.waitFor(() => expect(stopListening).toHaveBeenCalledOnce());
  });
});

describe("the window", () => {
  it("stays open when closed, so the app can ask first, and closes for real on request", async () => {
    const onClose = vi.fn();
    const stop = api.onCloseRequested(onClose);
    await vi.waitFor(() => expect(windowEvents.close).not.toBeNull());
    const preventDefault = vi.fn();
    windowEvents.close!({ preventDefault });
    expect([preventDefault.mock.calls.length, onClose.mock.calls.length]).toEqual([1, 1]);
    stop();
    await vi.waitFor(() => expect(windowEvents.stop).toHaveBeenCalledOnce());
    await api.closeWindow();
    expect(windowEvents.destroy).toHaveBeenCalledOnce();
  });
});

describe("file windows", () => {
  it("return the chosen file, or null when cancelled or several are chosen", async () => {
    windows.open.mockResolvedValueOnce("C:\\a.pgn");
    expect(await api.chooseFileToOpen("Open", [api.PGN_FILES], "C:\\")).toBe("C:\\a.pgn");
    expect(windows.open).toHaveBeenCalledWith({ title: "Open", defaultPath: "C:\\", filters: [api.PGN_FILES] });

    windows.open.mockResolvedValueOnce(null);
    expect(await api.chooseFileToOpen("Open", [api.PGN_FILES])).toBeNull();
    expect(windows.open.mock.calls[1][0].defaultPath).toBeUndefined();
    windows.open.mockResolvedValueOnce(["a.pgn", "b.pgn"]);
    expect(await api.chooseFileToOpen("Open", [api.PGN_FILES])).toBeNull();

    windows.save.mockResolvedValueOnce("C:\\out.pgn");
    expect(await api.chooseFileToSave("Save", [api.PGN_FILES], "out.pgn")).toBe("C:\\out.pgn");
    windows.save.mockResolvedValueOnce(undefined);
    expect(await api.chooseFileToSave("Save", [api.PGN_FILES], "out.pgn")).toBeNull();
  });

  it("show a file in its folder", async () => {
    await api.showInFolder("C:\\games\\a.pgn");
    expect(reveal).toHaveBeenCalledWith("C:\\games\\a.pgn");
  });
});
