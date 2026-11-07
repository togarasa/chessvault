# ChessVault

An open-source chess database and analysis tool for Windows and Linux, written in Rust.

- Open ChessBase `.cbh` and `.cbv` databases and PGN files (via [cbvault](https://github.com/itshak/cbvault))
- Save and organize your own games
- Analyze positions and games with Stockfish or any UCI engine
- Browse the Lichess opening explorer and games

**Status:** early development. The desktop app opens PGN files and ChessVault databases, edits games with variations and comments, and has Stockfish and Lichess explorer panels.

## Tests

- Core library and CLI: `cargo test --workspace`
- Desktop app, unit and component tests: `pnpm test` in `app/`; architecture rules: `pnpm test:arch`
- Desktop app, end to end (Windows): `pnpm test:e2e` in `app/`. Playwright drives the real app through WebView2's debugging port, with its own profile and a copy of `app/e2e/fixtures/sample.pgn`. The first run builds a test copy of the app into `target/e2e`, which takes a few minutes.
- Coverage (at least 80% of branches): `node scripts/rust-coverage.mjs` (needs `rustup toolchain install nightly`) and `pnpm test:coverage` in `app/`.

See `docs/ARCHITECTURE.md` for the layers and the test kinds.

## Disclaimer

ChessVault is not affiliated with or endorsed by ChessBase GmbH. ChessBase is a trademark of its owner.

ChessVault does not include any ChessBase software, databases or commentary. Test data consists of self-made PGN fixtures or games you own.

## License

GPL-3.0-or-later. See `LICENSE`.
