/// The only module that talks to the Tauri backend: its commands, the engine's events, and the
/// system's file windows. Everything else calls these functions (see docs/ARCHITECTURE.md).
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as openFileWindow, save as saveFileWindow } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { EngineLine } from "./engine";
import { Filter } from "./filter";
import { Game, GameSummary, OpenResult, Order } from "./types";

// Databases and games.

export const openDatabase = (path: string) => invoke<OpenResult>("open_database", { path });
export const importPgn = (path: string) => invoke<number>("import_pgn", { path });
export const listGames = (order: Order, limit: number, offset: number) =>
  invoke<GameSummary[]>("list_games", { order, limit, offset });
export const searchGames = (filter: Filter, order: Order, limit: number, offset: number) =>
  invoke<GameSummary[]>("search_games", { filter, order, limit, offset });
export const getGame = (id: number) => invoke<Game | null>("get_game", { id });
export const saveGame = (id: number, pgn: string) => invoke<void>("save_game", { id, pgn });
/// Adds a game to the open database and returns its id.
export const addGame = (pgn: string) => invoke<number>("add_game", { pgn });
/// Adds a game to another PGN file or database, creating it if needed.
export const addGameTo = (path: string, pgn: string) => invoke<void>("add_game_to", { path, pgn });
export const deleteGame = (id: number) => invoke<boolean>("delete_game", { id });
/// Restores the version before the last save; false when there is none.
export const undoGame = (id: number) => invoke<boolean>("undo_game", { id });
/// Writes the games in `ids`, or all games, to a PGN file; returns how many.
export const exportPgn = (path: string, ids: number[] | null) => invoke<number>("export_pgn", { path, ids });
/// Games in each file, without changing anything; null for a missing or unreadable file.
export const databaseCounts = (paths: string[]) => invoke<(number | null)[]>("database_counts", { paths });

// Engine analysis.

export const startAnalysis = (enginePath: string, fen: string) => invoke<void>("start_analysis", { enginePath, fen });
export const stopAnalysis = () => invoke<void>("stop_analysis");
/// Calls `onLine` for every analysis line; returns a function that stops listening.
export function onEngineLine(onLine: (line: EngineLine) => void): () => void {
  const unlisten = listen<EngineLine>("engine-line", ({ payload }) => onLine(payload));
  return () => void unlisten.then((stop) => stop());
}

// Lichess.

export type ExplorerDatabase = "masters" | "lichess";

export type ExplorerMove = {
  uci: string;
  san: string;
  white: number;
  draws: number;
  black: number;
  averageRating: number | null;
};

export type Explorer = {
  white: number;
  draws: number;
  black: number;
  moves: ExplorerMove[];
  opening: { eco: string; name: string } | null;
};

export const explore = (database: ExplorerDatabase, fen: string) => invoke<Explorer>("explore", { database, fen });
export const hasLichessToken = () => invoke<boolean>("has_lichess_token");
/// Saves the token, or removes it when `token` is empty.
export const setLichessToken = (token: string) => invoke<void>("set_lichess_token", { token });

// The system's file windows.

export type FileKind = { name: string; extensions: string[] };

export const PGN_FILES: FileKind = { name: "PGN files", extensions: ["pgn"] };
export const DATABASE_FILES: FileKind = { name: "ChessVault databases", extensions: ["sqlite"] };
export const GAME_FILES: FileKind = { name: "PGN files and ChessVault databases", extensions: ["pgn", "sqlite"] };

/// Asks for an existing file; null when cancelled.
export async function chooseFileToOpen(title: string, kinds: FileKind[], folder = ""): Promise<string | null> {
  const picked = await openFileWindow({ title, defaultPath: folder || undefined, filters: kinds });
  return typeof picked === "string" ? picked : null;
}

/// Asks where to save a file; null when cancelled. Windows asks itself before replacing a file.
export async function chooseFileToSave(title: string, kinds: FileKind[], suggested: string): Promise<string | null> {
  return (await saveFileWindow({ title, defaultPath: suggested, filters: kinds })) ?? null;
}

export const showInFolder = (path: string) => revealItemInDir(path);
