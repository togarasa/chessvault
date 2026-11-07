/// Data shared between the backend and the screens; matches the Rust types in `crates/core`.

/// A game as shown in the game list (`db::GameSummary`).
export type GameSummary = {
  id: number;
  event: string;
  site: string;
  date: string;
  round: string;
  white: string;
  black: string;
  result: string;
  eco: string;
  whiteElo: number | null;
  blackElo: number | null;
  /// Half-moves in the main line.
  plies: number | null;
};

/// A full game with its PGN text (`db::Game`).
export type Game = Pick<GameSummary, "id" | "event" | "date" | "white" | "black" | "result"> & { pgn: string };

/// A column the game list can be sorted by (`db::SortColumn`).
export type SortColumn =
  | "id"
  | "white"
  | "whiteElo"
  | "black"
  | "blackElo"
  | "result"
  | "plies"
  | "eco"
  | "event"
  | "site"
  | "round"
  | "date";

/// How the game list is sorted (`db::Order`).
export type Order = { column: SortColumn; descending: boolean };

/// What opening a file did: the database used, its games, and how many were just imported.
export type OpenResult = { database: string; games: number; imported: number };
