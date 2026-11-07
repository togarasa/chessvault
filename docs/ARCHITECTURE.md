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

*Being introduced by the `App.tsx` refactor (roadmap step 1); until then `App.tsx` still mixes these layers.*

| Layer | Files | Rule |
|---|---|---|
| Logic | `tree.ts` (game tree on chessops), `filter.ts`, `recent.ts` | No React, no Tauri. Unit-tested with Vitest. |
| Backend access | `api.ts` | The only file that calls Tauri commands (`invoke`). |
| Components | `*.tsx` | Show state and call logic or `api.ts`. |

These rules are checked by dependency-cruiser (`pnpm test:arch`).

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
