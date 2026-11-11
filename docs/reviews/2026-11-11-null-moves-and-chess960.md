# Review: null moves and Chess960 (2026-11-11)

The change accepts games with a null move (`--`, also `Z0`: the side to move passes) and games with
a Chess960 start, in the core, on the board and in the engine. An adversarial reviewer (a separate
agent that did not write the code) reviewed it; each finding was verified before it was fixed.

## Checked on real games

Converting a database of 6,465,222 games now leaves none out; the earlier version left out 563
(549 with a null move, 14 Chess960). All 1,839 of its games with a start position or a null move
are read by the board, and read again after being written back.

## Findings

| # | Finding | Verified by | Result |
|---|---|---|---|
| 1 | The `UCI_Chess960` option could be sent right after `stop`, before the stopped search ended; UCI allows options only while the engine waits | Code and the UCI protocol; Stockfish copes | Fixed: the engine waits for the stopped search's `bestmove` (at most two seconds) before changing the option |
| 2 | An engine without the `UCI_Chess960` option writes Chess960 castling as a king step, which reads as an ordinary king move | Reviewer's scratch test: `f1g1` reads as `Kg1` | Not fixed: such an engine can't analyse Chess960 correctly at all. Stockfish and most engines have the option; the guide says so |
| 3 | No test had White pass, or a pass when en passant was possible | Coverage: the branch for White's pass was never taken | Fixed: tests on both sides |
| 4 | The architecture rule for the engine became a list of forbidden modules, so a new module wouldn't be caught | Code | Fixed: the engine may use `crate::validate` and nothing else from core; checked by adding a forbidden import, which fails the test |
| 5 | The roadmap wasn't updated yet | Docs | Fixed in this commit |
| 6 | A standard start position with castling rights that don't fit it, but fit Chess960, is now accepted | Reviewer's example | Kept: the board already accepted these positions, so both sides now agree, and castling lands on the same squares |
| 7 | The core recorded `Z0` as written, the board as `--` | Code | Fixed: both write `--` |

Also checked and correct, by the reviewer: the same positions from the core and the board for
null moves by either side, at the start of a game, in variations and with an en passant chance, and
for Chess960 castling on both wings with K/Q and file letters; a null move in check is refused on
both sides; castling on the board by moving the king onto its rook, with the king on b1, e1 and f1;
saving and reading back; engine lines matched to their position; the screenshots hold only the
self-made test games.

After the fixes: Rust 104 tests (and 2 real-engine tests with Stockfish), frontend 192 unit and
component tests and 23 e2e tests pass. Branch coverage is Rust 88.8% and frontend 97.5%.
