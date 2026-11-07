# Review: engineering foundation (2026-11-07)

An adversarial reviewer (a separate agent that did not write the code) reviewed the whole code base,
with extra attention to `32c2227..084b0b5`. Each finding was verified before it was fixed:
reproduced with the CLI, a test or a script, or proven from the code. Every fix has a test that
fails without it.

| # | Finding | Verified by | Result |
|---|---|---|---|
| 1 | A stale explorer table could play illegal moves (White twice, a null move from an empty square) | Vitest script: `childFor` accepted d2d4 after 1. e4 | Fixed: `childFor` refuses illegal moves; the explorer shows only the answer for the shown position |
| 2 | Undo last save threw away unsaved edits without asking, even when there was nothing to undo | Code | Fixed: asks first; reloads only when something was restored |
| 3 | `0-0` castling, or a game whose first tag isn't `[Event]`, made a whole PGN file fail to import | CLI on test files | Fixed in the backend; the frontend (chessops) already read `0-0` |
| 4 | Export could overwrite any file, including ChessBase files and databases | Code | Fixed: export writes only `.pgn` |
| 5 | Opening a moved `.sqlite` created a new empty one in its place | CLI | Fixed: opening a missing file is an error; My Games is created by a separate command |
| 6 | Deleting every game of a PGN-backed database imported the PGN again | Code | Fixed: a `meta` marker records the import |
| 7 | e2e and guide recordings used the user's real Lichess token | The guide screenshot showed the token as set | Fixed: `CHESSVAULT_CONFIG_DIR` gives test runs their own folder |
| 8 | Setting a position symbol removed unrelated symbols such as $146 | Code | Fixed: only symbols of the same kind replace each other |
| 9 | File and database commands ran on the window's thread | Tauri's documented behaviour (not reproduced) | Fixed: those commands are `async` |
| 10 | Closing the window lost unsaved changes without asking | Code | Fixed: the close is intercepted and asks |
| 11 | Comments before a variation's first move moved behind it on save | Code; chessops parses them separately | Fixed: kept as `startingComments`. Not fixed: chessops drops `}` from comments, because PGN can't hold it |
| 12 | After a failed open the toolbar showed the wrong file | Code | Fixed |
| 13 | "A new PGN file" appended to a file the user agreed to replace | Code | Fixed: a new PGN replaces it; an existing database is never replaced |
| 14 | The PGN source hint didn't say other edits rewrite the text | Code | Fixed: hint reworded |
| 15 | Values saved as `?` sorted first, not last | Code | Fixed |
| 16 | Escaped tag values (`O\"Brien`) were shown with the backslash | CLI | Fixed |
| 17 | The engine could open a console window in release builds | Windows behaviour (not reproduced) | Fixed: `CREATE_NO_WINDOW` |
| 18 | Architecture tests had gaps | Code | Fixed: screens may not call `api.ts` (engine and explorer state moved to hooks); grouped imports and `super::` are checked. Kept: `app/src-tauri` stays out of Rust coverage, its commands are thin and covered by e2e |
| 19 | Double-clicking Add database could open the file window more than once | Code | Fixed: opens on a double-click or Enter, like the other tiles |
| 20 | The docs said PGN files are never changed; Lichess requests had no timeout | Docs and code | Fixed: docs say when a PGN changes; 20-second timeout |

After the fixes: Rust 62 tests and frontend 162 unit and component tests pass, plus 17 e2e tests.
Branch coverage is Rust 85.9% and frontend 97.3%.
