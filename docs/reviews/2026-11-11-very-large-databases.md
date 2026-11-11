# Review: very large databases (2026-11-11)

The change keeps the game list's columns apart from the games' text, adds an index for sorting by
each column, and moves databases in the older layout over when they are opened. An adversarial
reviewer (a separate agent that did not write the code) reviewed it; each finding was verified
before it was fixed.

## Measured on 6,464,659 games

| | Before | After |
|---|---|---|
| Sort by White, first page / page at 3,000,000 | 3.5 s / 58 s | 0.00 s / 0.13 s |
| Sort by White Elo, first page / page at 3,000,000 | 3.7 s / 38 s | 0.00 s / 0.07 s |
| Sort by date or event, page at 3,000,000 | 7–14 s | 0.1 s |
| List by number, page at 3,000,000 | 1.3 s | 0.2 s |
| Search a player | 1.5 s | 0.5 s |
| Search a player, sorted by Elo | 3.6 s | 1.2 s |
| Search result 1-0 and ECO B20–B99, sorted by Elo | 3.3 s | 0.7 s |
| Converting the database | 6 min, 5.8 GB | 6½ min, 6.8 GB |
| Opening a database in the old layout the first time | – | 2¼ min, once |

## Findings

| # | Finding | Verified by | Result |
|---|---|---|---|
| 1 | A search by date, ECO, result or Elo, sorted by a column, walked the whole sort index checking every game: seconds where it had been fast | Reviewer's timing on 2 million games | Fixed: searches find their matches and sort them; only the whole list reads the sort indexes. Tests now check the plans of the statements the list and searches really send, and fail when either way is broken |
| 2 | A failed compaction after the move left the file twice its size for good, and the open failed although the data was fine | Reviewer's run with a missing temporary folder | Fixed: a failed compaction is recorded and tried again at the next open, and never stops the database opening |
| 3 | The move needs about three times the database's size free on its drive, and once more in the temporary folder | Reviewer's measurement | Guide says so; if the room runs out, nothing is lost and the next open tries again |
| 4 | An old database on a read-only file can't be opened any more | Reviewer's run | Not fixed: the move has to write. The guide says to make the file writable |
| 5 | Another program reading the database blocks the move | Reviewer's run | Not fixed: the move waits five seconds, then gives up without losing anything and tries again next time; the guide names the message |
| 6 | A negative limit lost the games without a value | Reviewer's comparison | Fixed: it means all games, as before; new test |
| 7 | Two new plan tests checked SQL they built themselves | Code | Fixed with finding 1 |
| 8 | The damaged-file test tries fewer bytes than before | Code | Kept: every byte of the moves file is still tried; the sample of the others keeps the test at about a minute now that each conversion builds eleven indexes |
| 9 | Older ChessVault versions can't open a database after the move | Code | Guide says so |
| 10 | The size estimate said 6.9 GB, the guide 6.8 GB | Tests | Fixed: 6.8 GB both |

Also checked and correct, by the reviewer: every page size and start against a plain sorted query,
with and without a search; unknown values (`''`, `?`, `????.??.??`) as before; a crash during the
move undoes it completely; a second open does nothing; the undo history keeps its game numbers.

One behaviour changed on purpose: games without a value are now listed by number among themselves.

After the fixes: Rust 94 tests, frontend 187 unit and component tests and 22 e2e tests pass. Branch
coverage is Rust 88.4% and frontend 97.4%.
