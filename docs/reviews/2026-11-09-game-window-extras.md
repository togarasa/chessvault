# Review: game window extras (2026-11-09)

An adversarial reviewer (a separate agent that did not write the code) reviewed the uncommitted
change: flipping the board, the evaluation bar, playing engine lines by clicking them, and the keys
F, Delete and Ctrl+S. Each finding was verified before it was fixed.

| # | Finding | Verified by | Result |
|---|---|---|---|
| 1 | `pnpm test` failed: the App tests reached Tauri through the engine hook, which moved into the game view | Ran the tests: 60 unhandled errors, exit code 1 | Fixed: the App tests mock the engine hook |
| 2 | The engine kept analysing, with no panel to stop it, after the game left the board (deleted, or another database opened) | Reviewer's test | Fixed: the engine stops when no game is shown; new test |
| 3 | Holding Delete deleted move after move back to the start; one Delete also rewrote typed PGN source | Reviewer's test | Fixed: a held key acts once. Rewriting the source is how every board edit works; the hint now names deletions too |
| 4 | Keys acted on the game behind the search window and the conversion window; Ctrl+S could save changes just discarded for the conversion | Code | Fixed: the game's keys are off while either is open; new test |
| 5 | The new screenshot showed a local path | Looked at it | Fixed: it shows the guide's example path |
| 6 | Ctrl+S held, or pressed twice, saved twice, leaving an undo step that changes nothing | Reviewer's test for the key; code for the second save | Fixed: a held key acts once and a second save waits for the first; new test |
| 7 | A test step and a guard against lines for another position could never act | Code: the engine hook already drops those lines | Fixed: both removed |
| 8 | Ctrl+S without a game shown could open the window's own "Save page" | Code (not tried in the app) | Fixed: Ctrl+S never reaches the window; new test |
| 9 | The flipped board stays flipped for other games; the bar had no text for screen readers | Code | The flip staying is kept on purpose and now in the guide; the bar has a label with the score |

The reviewer also confirmed: the bar's direction (scores are from White's side), that a mate in 0
never arrives, that promotions and checks in engine lines play correctly, and that the engine stops
when going back to the databases.

One full e2e run failed once in the archive test (it took twice its usual time); it passed three
times on its own and in the next full run.

After the fixes: 187 frontend unit and component tests and 22 e2e tests pass. Frontend branch
coverage is 97.56%. The Rust code is unchanged.
