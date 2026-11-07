# ChessVault — working rules

These rules apply to every change in this repository.

## Roadmap

- `docs/ROADMAP.md` is the single list of features. Build features in its order.
- Mark every finished feature there (with the date and commit) in the same change that finishes it.
- Update the roadmap when something new is learned: reorder, split or add items, and say why.

## Architecture

- `docs/ARCHITECTURE.md` describes the layers and the rules between them. Keep it current with every change that touches structure.
- Follow clean architecture: dependencies point inwards. `crates/core` (domain and use cases) depends on no UI or app crate; `crates/cli` and `app/src-tauri` are thin adapters over core; the frontend talks to the backend only through Tauri commands.
- Architecture tests enforce these rules and must pass: Rust dependency rules as tests in the workspace, frontend import rules with dependency-cruiser.

## Clean code

- Small functions with one job, names that say what they do, no duplicated logic, no dead code.
- Match the style of the code around a change; comments explain why, not what.

## Tests

- At least 80% branch coverage, measured with cargo-llvm-cov (Rust) and Vitest coverage (frontend). Think of edge cases: empty input, missing files, bad data, boundaries.
- End-to-end tests (`pnpm test:e2e`) drive the real app; run them after every UI change.
- Reuse existing tests, fixtures and helpers before writing new ones.
- Check UI changes visually with playwright-cli as well.

## Review

- After every iteration an adversarial reviewer (a separate agent that did not write the code) reviews the change.
- Verify each finding (reproduce it or prove it from the code) before fixing it; reject findings that don't hold up, and say why.

## User documentation

- `docs/user/` is the user guide, written for chess players, not developers.
- Each feature gets an explanation with screenshots, and a short video where a workflow has several steps (recorded from the e2e tests or playwright-cli).
- Update it in the same iteration as the feature.

## Git

- Commit each finished step yourself, in Conventional Commits format (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`, with a scope where useful, e.g. `feat(app): ...`).
- Push to GitHub only when the user asks.
- Never commit the user's own games (`games/`), databases or ChessBase data.

## Legal (EU)

- ChessBase-like workflows are fine; never use ChessBase's name or marks in the product, its icons, artwork, decompiled code, manual or help text, databases or commentary — not in code, tests, docs or screenshots.
- ChessBase files are read-only: never write to them.
- Screenshots and videos for the docs use only self-made test games (`app/e2e/fixtures/`).
