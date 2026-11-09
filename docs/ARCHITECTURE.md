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
            │  use cases: library (opens any game file)               │
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
| `convert` | Reads ChessBase `.cbh` databases and unpacks `.cbv` archives through cbvault. Never writes to them. | `cbvault`, files |
| `library` | Opens any game file: the use case that combines `db` and `convert`. Converts a ChessBase file once into a database beside it. | `db`, `convert`, files |

Rules:
- `core` never depends on Tauri, clap, the app or the CLI.
- `validate` depends on no other module and does no input/output.
- The adapters (`db`, `engine`, `online`, `convert`) don't use each other; only `db` uses `validate`.

### `crates/cli` — command-line adapter

Parses arguments with clap and calls `core`. No logic of its own beyond printing.

### `app/src-tauri` — desktop backend adapter

Tauri commands that call `core` and hold the open database and the running engine. Commands
translate errors into messages; they contain no chess or database logic. Commands that touch files
or the database are `async`, so Tauri runs them off the window's thread. `CHESSVAULT_CONFIG_DIR`
replaces the config folder (where the Lichess token is kept); the e2e tests set it so they never
use the user's own token.

### `app/src` — desktop user interface (React)

| Layer | Files | Rule |
|---|---|---|
| Logic | `tree.ts` (game tree on chessops), `filter.ts` (searches), `columns.ts` (game list columns and sorting), `pgn.ts` (new games, header values), `engine.ts` (engine lines and scores), `recent.ts` (recent files, My Games, paths), `conversion.ts` (texts about converting files), `types.ts` (data shared with the backend) | No React, no Tauri, no screens, no hooks, no `api.ts`. Unit-tested with Vitest. |
| Backend access | `api.ts` | The only file that uses Tauri: commands, engine events, file windows, show in folder. May use logic types only. |
| State (hooks) | `useDialogs.ts` (questions and menus), `useGameList.ts` (list, sorting, search, loading more), `useGameEditor.ts` (the game on the board and its editing), `useFileCounts.ts` (game counts for the tiles), `useConversion.ts` (progress of converting a file), `useEngine.ts` (engine analysis; `GameView` holds it so the panel and the evaluation bar share one engine), `useExplorer.ts` (Lichess explorer and token) | Hold state and call logic and `api.ts`; render nothing (they may use `Dialog.tsx`'s types). |
| Screens (components) | `App.tsx` (ties the parts together and runs the file operations), `Toolbar`, `SearchBar`, `GameList`, `GameView`, `DatabaseTiles`, `Board`, `EvalBar`, `Notation`, `EnginePanel`, `ExplorerPanel`, `Search` (search window), `ConversionDialog`, `Dialog` (questions and menus) | Show state and pass the user's actions on; only `App.tsx` calls `api.ts`, the others reach the backend through hooks. |

dependency-cruiser checks these rules, plus no circular imports and no unused modules
(`pnpm test:arch`, configured in `app/.dependency-cruiser.cjs`).

## Data

- Games are stored as PGN text in SQLite, with indexed header columns (players, Elo, ECO, date,
  moves) for lists and searches. Every edit keeps the previous version for undo.
- Opening a `.pgn` file creates a `.sqlite` database beside it the first time and records in its
  `meta` table that the PGN was imported, so it is never imported twice. Editing never changes the
  PGN file; only "Save as new game" into an existing PGN file appends to it.
- Opening never creates a missing database (`db::open_path` fails with `NotFound`); creating one is
  the separate `db::create_database`. Export writes only `.pgn` files and adding a game only `.pgn`
  or `.sqlite`, so ChessBase files and databases can't be overwritten by mistake. ChessBase files
  are only ever read.
- Opening a ChessBase file converts it once into `<whole file name>.sqlite`, so that `Club.pgn`,
  `Club.cbh` and `Club.cbv` in one folder keep separate games. The conversion builds
  `….sqlite.partial` with SQLite's safety off for speed, and renames it only when it is complete: a
  file with the final name is always a finished database, flushed to the disk. `….sqlite.unpacked`
  holds an archive's files during the conversion; an archive's databases go into one list. Both are
  removed afterwards, or by the next open after a crash. A `.partial` that can't be removed is in
  use, so the second conversion is refused instead of writing to the same file.
  Games are read in batches, so a database of millions never has to fit in memory. A game that can't
  be read or isn't legal is left out and counted in `meta`, so one bad game doesn't lose the others.
  The reader can panic on damaged files, so `convert` catches panics and release builds unwind.
- Settings that belong to one computer (recent files, My Games location, engine path) live in the
  app's local storage; the Lichess token in a file in the app's config folder.

## Tests

| Kind | Where | Run |
|---|---|---|
| Rust unit tests | next to the code (`#[cfg(test)]`) | `cargo test --workspace` |
| Rust integration tests | `crates/core/tests/engine.rs` (against the fake UCI engine in `tests/support/`), `crates/cli/tests/cli.rs` (runs the `chessvault` command) | `cargo test --workspace` |
| Rust architecture tests | `crates/core/tests/architecture.rs` | `cargo test --workspace` |
| Frontend unit and component tests | `app/src/*.test.ts(x)`: logic, `api.ts` checked against the Rust command list, hooks, and screens rendered with Testing Library and a mocked `api.ts` | `pnpm test` in `app/` |
| Frontend architecture tests | `app/.dependency-cruiser.cjs` | `pnpm test:arch` in `app/` |
| End-to-end tests | `app/e2e/` | `pnpm test:e2e` in `app/` (Windows) |

Tests that need the outside world only run on request: a real engine
(`CHESSVAULT_ENGINE=<path> cargo test -- --ignored`) and the live Lichess explorer.

### Coverage

At least 80% branch coverage, checked by:

- Rust: `node scripts/rust-coverage.mjs` (branch coverage needs the nightly toolchain; the Tauri
  commands in `app/src-tauri` are thin and covered by the e2e tests instead).
- Frontend: `pnpm test:coverage` in `app/`, which fails below 80%.
