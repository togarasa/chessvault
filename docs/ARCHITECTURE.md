# ChessVault architecture

ChessVault follows clean architecture: the chess and database logic sits in the middle and knows
nothing about the user interface; the command line and the desktop app are thin adapters around it.
Dependencies always point inwards. Architecture tests enforce the rules below, so a change that
breaks them fails the build.

## Overview

```
            ┌──────────────────────────────┐   ┌──────────────────────┐
            │ Desktop app (app/)           │   │ CLI (crates/cli)     │
            │  React UI ──▶ api.ts         │   │  clap commands       │
            │      Tauri commands (Rust)   │   │                      │
            └──────────────┬───────────────┘   └──────────┬───────────┘
                           │                              │
                           ▼                              ▼
            ┌─────────────────────────────────────────────────────────┐
            │ crates/core                                             │
            │  adapters:  db (SQLite)  engine (UCI)  online (Lichess)  │
            │             convert (ChessBase via cbvault)             │
            │  domain:    validate (chess rules, PGN movetext)        │
            └─────────────────────────────────────────────────────────┘
```

## Layers

### `crates/core` — domain and use cases

| Module | Role | May use |
|---|---|---|
| `validate` | Domain: checks PGN movetext and walks the main line. Pure: no files, no network, no database. | `shakmaty`, `serde` |
| `db` | Game storage in SQLite: import, list, search, edit, undo, export. | `validate`, `rusqlite`, files |
| `engine` | Runs a UCI engine (Stockfish) as a child process. | `shakmaty`, `serde`, processes |
| `online::lichess` | Lichess opening explorer over HTTPS. Further services (Chess.com) go beside it in `online`. | `reqwest`, `serde` |
| `convert` | Reads ChessBase `.cbh` databases (read-only) through cbvault. | `cbvault`, files |

Rules:
- `core` never depends on Tauri, clap, the app or the CLI.
- `validate` depends on no other module and does no input/output.
- The adapters (`db`, `engine`, `online`, `convert`) don't use each other; only `db` uses `validate`.

### `crates/cli` — command-line adapter

Parses arguments with clap and calls `core`. No logic of its own beyond printing.

### `app/src-tauri` — desktop backend adapter

Tauri commands that call `core` and hold the open database and the running engine. Commands
translate errors into messages; they contain no chess or database logic.

### `app/src` — desktop user interface (React)

| Layer | Files | Rule |
|---|---|---|
| Logic | `tree.ts` (game tree on chessops), `filter.ts` (searches), `columns.ts` (game list columns and sorting), `pgn.ts` (new games, header values), `engine.ts` (engine lines and scores), `recent.ts` (recent files, My Games, paths), `types.ts` (data shared with the backend) | No React, no Tauri, no screens, no hooks, no `api.ts`. Unit-tested with Vitest. |
| Backend access | `api.ts` | The only file that uses Tauri: commands, engine events, file windows, show in folder. May use logic types only. |
| State (hooks) | `useDialogs.ts` (questions and menus), `useGameList.ts` (list, sorting, search, loading more), `useGameEditor.ts` (the game on the board and its editing), `useFileCounts.ts` (game counts for the tiles) | Hold state and call logic and `api.ts`; render nothing (they may use `Dialog.tsx`'s types). |
| Screens (components) | `App.tsx` (ties the parts together and runs the file operations), `Toolbar`, `SearchBar`, `GameList`, `GameView`, `DatabaseTiles`, `Board`, `Notation`, `EnginePanel`, `ExplorerPanel`, `Search` (search window), `Dialog` (questions and menus) | Show state and pass the user's actions on. |

dependency-cruiser checks these rules, plus no circular imports and no unused modules
(`pnpm test:arch`, configured in `app/.dependency-cruiser.cjs`).

## Data

- Games are stored as PGN text in SQLite, with indexed header columns (players, Elo, ECO, date,
  moves) for lists and searches. Every edit keeps the previous version for undo.
- Opening a `.pgn` file creates a `.sqlite` database beside it the first time; the PGN file itself
  is never changed. ChessBase files are only ever read.
- Settings that belong to one computer (recent files, My Games location, engine path) live in the
  app's local storage; the Lichess token in a file in the app's config folder.

## Tests

| Kind | Where | Run |
|---|---|---|
| Rust unit tests | next to the code (`#[cfg(test)]`) | `cargo test --workspace` |
| Rust architecture tests | `crates/core/tests/architecture.rs` | `cargo test --workspace` |
| Frontend unit tests | `app/src/*.test.ts` | `pnpm test` in `app/` |
| Frontend architecture tests | `app/.dependency-cruiser.cjs` | `pnpm test:arch` in `app/` |
| End-to-end tests | `app/e2e/` | `pnpm test:e2e` in `app/` (Windows) |

Coverage target: at least 80% of branches.
