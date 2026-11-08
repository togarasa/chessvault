# Review: opening `.cbh` and `.cbv` files (2026-11-08)

An adversarial reviewer (a separate agent that did not write the code) reviewed the uncommitted
change. Each finding was verified before it was fixed: reproduced with a test or a script, or proven
from the code.

| # | Finding | Verified by | Result |
|---|---|---|---|
| 1 | A damaged game made the reader panic, which closed the whole release build (`panic = "abort"`) | New byte-flipping test failed at the reader's SAN writer | Fixed: panics are caught and count as an unreadable game or file; release builds unwind. The test tried about 7,500 damaged files once, and a sample stays in the suite |
| 2 | Two opens at once could write one `.partial` and make a database with every game twice | The reviewer's two-thread program | Fixed: the app ignores a second open while one runs; a `.partial` that can't be removed is refused as in use |
| 3 | Games with a null move or a Chess960 start are left out, and were called unreadable | 6.4-million-game test: 549 with `--`, 14 Chess960 | Message corrected and guide updated. Supporting them is on the roadmap |
| 4 | A power cut after the rename could leave a broken database under the final name | Code: nothing flushed the fast writes | Fixed: the file is flushed before the rename |
| 5 | A scanner holding the new file for a moment threw away the whole conversion | Code | Fixed: the rename is retried for 5 seconds |
| 6 | A leftover `.unpacked` folder after a success was never removed | Code | Fixed: cleaned up on the next open |
| 7 | A zero-byte or foreign file named `X.cbh.sqlite`, or `X.cbh.pgn`'s database, is used as the conversion | Reproduced for zero bytes | Not fixed: needs an unusual file with exactly that name, and deleting it brings the conversion back |
| 8 | The number of games left out was forgotten after one status-bar message | Existing test | Fixed: kept in the database and shown at every open |
| 9 | Closing the window during a conversion gave no sign of stopping; cancelling waits during unpacking and index building | Code | Fixed the sign ("Stopping…"); the guide says which steps have to finish first |
| 10 | The size warning ignored an archive's unpacked files | Code | Guide says so. The warning still names only the final file, as the unpacked size isn't known cheaply |
| 11 | Moving or deleting the original hid the database with the user's changes | Code | Fixed: the database opens and counts without the original |
| 12 | The new screenshot shows the folder `D:\Claude Projects\chessvaul…` | Looked at it | Rejected: the same as the guide's other screenshots, and no name or personal data in it |
| 13 | The name appears in the command-line help and the guide | Code | Fixed in the help (`.cbh`, `.cbv`). Kept in the guide, which has to say what the files are; belongs to the legal review before the first release |
| 14 | Progress said "0 of 4 games" for two games, as guiding texts and deleted games count | Screenshot | Fixed: shows a percentage; the large-file question says "about" |
| 15 | `-o my.sqlite` removes an existing `my.sqlite.partial` or `.unpacked` | Reviewer's run | Rejected: these names belong to the conversion, and the app's own target names make a clash very unlikely |
| 16 | Reading never ended at exactly 2³²−1 records | Arithmetic | Fixed: counts records done, which can't get stuck |
| 17 | Old message texts; `Club.cbh (ChessVault).pgn` as export name; unhelpful error in a read-only folder | Code | Fixed |
| 18 | A misleading test comment; a test that only compared bytes | Code | Fixed: the sources are read-only during the test. Still without a test: an archive with several databases, as no such fixture exists |
| 19 | The fixture's README showed the wrong moves | Output | Fixed |
| 20 | A comment with a line starting with `[` could break a later re-import | Store-level only; none of 1,584 real games has a line break in its moves or comments | Rejected: the reader writes each game's moves on one line |

The reviewer also confirmed as correct: the progress arithmetic, archive names that try to leave the
folder are refused, and nothing can write to the source files.

After the fixes: Rust 87 tests and frontend 177 unit and component tests pass, plus 19 e2e tests.
Branch coverage is Rust 87.95% and frontend 97.46%.
