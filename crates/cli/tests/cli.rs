//! Runs the `chessvault` command the way a user does, against copies of the e2e sample games.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

/// The three self-made games the app's end-to-end tests use too.
fn sample_pgn() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../app/e2e/fixtures/sample.pgn")
}

/// A fresh folder for one test, removed when the test ends.
struct TempDir(PathBuf);

impl TempDir {
    fn new(name: &str) -> Self {
        let dir = std::env::temp_dir().join(format!("chessvault-cli-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        TempDir(dir)
    }

    fn path(&self, file: &str) -> PathBuf {
        self.0.join(file)
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn chessvault(db: &Path, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_chessvault")).arg("--db").arg(db).args(args).output().unwrap()
}

/// Runs a command that must succeed and returns what it printed.
fn ok(db: &Path, args: &[&str]) -> String {
    let output = chessvault(db, args);
    assert!(output.status.success(), "{args:?} failed: {}", String::from_utf8_lossy(&output.stderr));
    String::from_utf8(output.stdout).unwrap()
}

/// Runs a command that must fail and returns its error message.
fn fails(db: &Path, args: &[&str]) -> String {
    let output = chessvault(db, args);
    assert!(!output.status.success(), "{args:?} should fail");
    String::from_utf8(output.stderr).unwrap()
}

/// A database with the three sample games.
fn imported(dir: &TempDir) -> PathBuf {
    let db = dir.path("games.sqlite");
    let printed = ok(&db, &["import", sample_pgn().to_str().unwrap()]);
    assert!(printed.starts_with("imported 3 games into"), "{printed}");
    db
}

#[test]
fn lists_and_searches_games() {
    let dir = TempDir::new("list");
    let db = imported(&dir);

    let list = ok(&db, &["list"]);
    assert_eq!(list.lines().count(), 3);
    assert!(list.lines().next().unwrap().contains("Alpha, Anna - Beta, Bernd  1-0  E2E Club"), "{list}");
    assert_eq!(ok(&db, &["list", "--limit", "1"]).lines().count(), 1);

    let found = ok(&db, &["search", "gamma"]);
    assert_eq!(found.lines().count(), 2);
    assert_eq!(ok(&db, &["search", "Nobody"]), "no games\n");
}

#[test]
fn shows_edits_and_undoes_a_game() {
    let dir = TempDir::new("edit");
    let db = imported(&dir);
    let shown = ok(&db, &["show", "3"]);
    assert!(shown.contains("[White \"Delta, Dora\"]") && shown.contains("{ A good start }"), "{shown}");

    let edited = dir.path("edited.pgn");
    fs::write(&edited, shown.replace("1/2-1/2", "1-0")).unwrap();
    assert!(ok(&db, &["edit", "3", edited.to_str().unwrap()]).starts_with("saved game 3"));
    assert!(ok(&db, &["show", "3"]).contains("[Result \"1-0\"]"));

    assert_eq!(ok(&db, &["undo", "3"]), "restored the previous version of game 3\n");
    assert!(ok(&db, &["show", "3"]).contains("[Result \"1/2-1/2\"]"));
    assert_eq!(ok(&db, &["undo", "3"]), "game 3 has no earlier version\n");
}

#[test]
fn refuses_an_edit_with_an_illegal_move() {
    let dir = TempDir::new("bad-edit");
    let db = imported(&dir);
    let bad = dir.path("bad.pgn");
    fs::write(&bad, "[Event \"x\"]\n\n1. e4 e5 2. Ke3 *\n").unwrap();
    assert!(fails(&db, &["edit", "1", bad.to_str().unwrap()]).contains("invalid game"));
    assert!(ok(&db, &["show", "1"]).contains("Alpha, Anna"), "the game is unchanged");
}

#[test]
fn deletes_and_exports_games() {
    let dir = TempDir::new("export");
    let db = imported(&dir);
    assert_eq!(ok(&db, &["delete", "2"]), "deleted game 2\n");
    assert!(fails(&db, &["delete", "2"]).contains("no game with id 2"));

    let all = dir.path("all.pgn");
    assert!(ok(&db, &["export", all.to_str().unwrap()]).starts_with("wrote 2 games to"));
    assert_eq!(fs::read_to_string(&all).unwrap().matches("[Event ").count(), 2);

    let one = dir.path("one.pgn");
    assert!(ok(&db, &["export", one.to_str().unwrap(), "--ids", "3"]).starts_with("wrote 1 game to"));
    assert!(fs::read_to_string(&one).unwrap().contains("Delta, Dora"));
}

#[test]
fn explains_what_went_wrong() {
    let dir = TempDir::new("errors");
    let db = imported(&dir);
    assert!(fails(&db, &["show", "99"]).contains("no game with id 99"));
    assert!(fails(&db, &["import", dir.path("missing.pgn").to_str().unwrap()]).starts_with("error:"));
    let out = dir.path("out.pgn");
    let error = fails(&db, &["convert", dir.path("missing.cbh").to_str().unwrap(), "-o", out.to_str().unwrap()]);
    assert!(error.starts_with("error:"), "{error}");

    let notes = dir.path("notes.txt");
    fs::write(&notes, "These are notes, not a SQLite database file.").unwrap();
    assert!(fails(&notes, &["list"]).contains("is not a ChessVault database"));
}
