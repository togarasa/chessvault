# Made-up test files

`club.*` is a tiny database in the `.cbh` format and `club.cbv` the same database as an archive.
Every game in them is made up. No program or data of the format's owner was used to make them:
they were written byte by byte by [generate.rs](generate.rs), using the `cbvault-fixtures` test
builder from <https://github.com/itshak/cbvault> (MIT, commit `c9676da`), which isn't published as
a crate and isn't part of ChessVault.

The database holds two games, a guiding text and a deleted game:

| Game | White | Black | Result | Moves |
|---|---|---|---|---|
| 1 | Alpha, Anna (2100) | Beta, Bernd (1900) | 1-0 | 1. e4 c5 {A good start} (1... e5 2. Nf3 Nc6) |
| 2 | Gamma, Gerd | Delta, Dora | ½-½ | 1. d4 d5 |

To make them again, put `generate.rs` as `src/main.rs` in a new Cargo project that depends on
`cbvault-fixtures` (by path, in a clone of that repository) and `gigachess = "0.1.10"`, and run
`cargo run -- <this folder>`.
