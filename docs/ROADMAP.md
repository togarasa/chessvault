# ChessVault roadmap

Features are built in this order. Each finished feature is marked with its date and commit.
When something new is learned, this file changes too, with the reason.

Goal: an open-source chess database for Windows and Linux that works like ChessBase without
using anything of ChessBase's: open ChessBase and PGN files, keep and edit your own games,
analyse with Stockfish, use the Lichess explorer, and later import from Chess.com.

## Done

| Feature | Date | Commit |
|---|---|---|
| Workspace and `convert` command (ChessBase `.cbh` to PGN via cbvault) | 2026-10-31 | `3343bbc` |
| SQLite game store: import, search, edit, undo | 2026-10-31 | `1ca462f` |
| Move validation on import and edit | 2026-10-31 | `3f5e28c` |
| Desktop app with game list and PGN editor | 2026-10-31 | `225534b` |
| Chessboard view; open PGN files directly | 2026-10-31 | `76989de` |
| Stockfish analysis and Lichess explorer panels | 2026-10-31 | `e40fd8d` |
| Board editing (variations, comments, symbols, variation prompt, right-click menu), new games, recent files, PGN export, delete, full game list | 2026-10-31 | `6713d70` |
| File dialogs; game list with Elo, moves, ECO and more, sortable | 2026-11-02 | `8b3a9b1` |
| End-to-end tests driving the real app (Playwright) | 2026-11-02 | `cd5d13c` |
| Search window: players, result, ECO, date, Elo, event, site | 2026-11-03 | `07d2868` |
| Database tiles start screen with My Games; LF line endings | 2026-11-03 | `32c2227` |
| Engineering foundation: working rules, architecture doc and tests, `App.tsx` split into layers, 80% branch coverage, user guide with screenshots and videos, adversarial review with 20 findings fixed ([review](reviews/2026-11-07-engineering-foundation.md)) | 2026-11-07 | `2e42e44`–`65dabfc` |

## Next

1. **Open ChessBase databases in the app** — `.cbh` and `.cbv` in Open… and the tiles; games converted once into `<name>.sqlite` beside the original (as for PGN), with progress; ChessBase files stay read-only. Check against `MyPGNDownloads.cbh` (1,417 games matched before).
2. **Game window extras** — flip the board, evaluation bar, click an engine line to play it, keyboard shortcuts.
3. **Ribbon** — the toolbar grouped into tabs (File, Home, Analysis, Lichess).
4. **Linux build and CI** — GitHub Actions: tests on Windows and Linux on every push; Linux e2e approach to be decided (WebView2 debugging is Windows-only).
5. **First release (v0.1.0)** — Windows installer and Linux packages, README with install guide, legal review of the EU database right and trademarks before the public release.
6. **More online sources** — a Lichess player's games; Chess.com game import.
7. **Android version** — added 2026-11-07 at the user's request. Tauri 2 builds Android apps, so the
   Rust core is reused; the work is a touch-friendly layout, Android's file picker (storage access
   framework), and Stockfish packaged inside the app for each processor type instead of a path the
   user types.
   - **Occasional, non-intrusive ads** (the user's plan). To decide first, with the legal review:
     ChessVault is GPL-3 and includes other people's GPL code (shakmaty, chessops, chessground), so a
     closed-source ad SDK such as AdMob very likely can't be shipped with it. Options that fit the
     licence: ads without a closed SDK (e.g. a simple banner loaded as web content), a paid Play
     Store version, or donations. EU rules apply too: tracking ads need GDPR consent, and the Play
     Store needs a data-safety entry.
8. **iPhone version (maybe)** — after Android. Needs an Apple developer account (about €99 a year)
   and a Mac to build. iOS doesn't allow starting other programs, so the engine must be built into
   the app as a library.
9. **macOS version (maybe)** — added 2026-11-07 at the user's request. Tauri builds macOS apps from
   the same code, and GitHub Actions has free macOS machines for public repositories, so no Mac is
   needed to build it. Without Apple's signing and notarisation (the same developer account as the
   iPhone version) macOS warns that the app is from an unknown developer. The app runs in WebKit
   there, so the Windows-only e2e approach needs a replacement, as for Linux.
10. **Later** — dockable panes, themes, Lichess token in the system keychain instead of a file.

## Known issues

- Some games in the ChessBase comparison (6 of 1,417) differ for reasons not yet explained.
- The Lichess token is stored as a plain file in the app's config folder.
- Linux has never been built or tested.
- Rust line and function coverage are understated: the coverage tool counts a second, never-run copy
  of the core library (from its separate builds for unit and integration tests). Branch coverage,
  the measure the rules require, is above 80% even so.
- chessops drops `}` from comments when writing PGN, which PGN can't hold anyway.
