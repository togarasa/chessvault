//! Opening ChessBase files, with the made-up files in `tests/fixtures/chessbase`.

use std::fs;
use std::path::{Path, PathBuf};

use chessvault_core::db::{Error, Order, Store};
use chessvault_core::library::{convert_chessbase, game_count, games_to_convert, open_path, Progress};

const FIXTURE_FILES: [&str; 8] =
    ["club.cbh", "club.cbg", "club.cba", "club.cbp", "club.cbt", "club.cbc", "club.cbs", "club.cbv"];

/// A folder of its own for a test, holding a copy of the fixture files, removed afterwards.
struct Folder(PathBuf);

impl Folder {
    fn new(test: &str) -> Self {
        let dir = std::env::temp_dir().join(format!("chessvault-library-{test}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/chessbase");
        for file in FIXTURE_FILES {
            fs::copy(fixtures.join(file), dir.join(file)).unwrap();
        }
        Folder(dir)
    }

    fn path(&self, file: &str) -> PathBuf {
        self.0.join(file)
    }

    /// The names in the folder, sorted.
    fn names(&self) -> Vec<String> {
        let mut names: Vec<String> =
            fs::read_dir(&self.0).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        names.sort();
        names
    }

    /// The fixture's files and whatever else `extra` names, as `names` lists them.
    fn fixtures_and(extra: &[&str]) -> Vec<String> {
        let mut names: Vec<String> = FIXTURE_FILES.iter().chain(extra).map(|n| n.to_string()).collect();
        names.sort();
        names
    }

    /// Renames the database's files from `club.*` to `name.*`.
    fn rename_database(&self, name: &str) {
        for file in FIXTURE_FILES {
            let extension = file.rsplit('.').next().unwrap();
            fs::rename(self.path(file), self.path(&format!("{name}.{extension}"))).unwrap();
        }
    }
}

impl Drop for Folder {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn no_progress(_: Progress) -> bool {
    true
}

fn players(store: &Store) -> Vec<(String, String)> {
    store.list(Order::default(), 10, 0).unwrap().into_iter().map(|g| (g.white, g.black)).collect()
}

fn the_two_games() -> Vec<(String, String)> {
    vec![("Alpha, Anna".into(), "Beta, Bernd".into()), ("Gamma, Gerd".into(), "Delta, Dora".into())]
}

#[test]
fn a_database_is_converted_once_into_a_database_beside_it() {
    let folder = Folder::new("once");
    let source = folder.path("club.cbh");
    let mut seen = Vec::new();

    let opened = open_path(&source, &mut |p| {
        seen.push(p);
        true
    })
    .unwrap();

    // The guiding text and the deleted game are not games to show.
    assert_eq!((opened.imported, opened.skipped), (2, 0));
    assert_eq!(opened.path, folder.path("club.cbh.sqlite"));
    assert_eq!(players(&opened.store), the_two_games());
    assert_eq!(seen.first(), Some(&Progress { done: 0, total: 4 }));
    assert_eq!(seen.last(), Some(&Progress { done: 4, total: 4 }));

    let game = opened.store.get(1).unwrap().unwrap();
    assert!(game.pgn.contains("A good start") && game.pgn.contains("(1... e5"), "{}", game.pgn);
    let listed = &opened.store.list(Order::default(), 1, 0).unwrap()[0];
    assert_eq!((listed.white_elo, listed.black_elo, listed.plies), (Some(2100), Some(1900), Some(2)));

    // Opening again uses the database, keeping changes and not asking for progress.
    let mut store = opened.store;
    assert!(store.delete_game(2).unwrap());
    drop(store);
    let again = open_path(&source, &mut |_| panic!("no conversion the second time")).unwrap();
    assert_eq!((again.imported, again.store.count().unwrap()), (0, 1));
}

#[test]
fn the_original_files_are_not_changed() {
    let folder = Folder::new("read-only");
    let before: Vec<Vec<u8>> = FIXTURE_FILES.iter().map(|f| fs::read(folder.path(f)).unwrap()).collect();
    // Read-only files also catch opening them for writing, even without writing anything.
    let set_read_only = |read_only| {
        for file in FIXTURE_FILES {
            let mut permissions = fs::metadata(folder.path(file)).unwrap().permissions();
            permissions.set_readonly(read_only);
            fs::set_permissions(folder.path(file), permissions).unwrap();
        }
    };
    set_read_only(true);
    let cbh = open_path(&folder.path("club.cbh"), &mut no_progress).map(drop);
    let cbv = open_path(&folder.path("club.cbv"), &mut no_progress).map(drop);
    set_read_only(false);
    cbh.unwrap();
    cbv.unwrap();
    let after: Vec<Vec<u8>> = FIXTURE_FILES.iter().map(|f| fs::read(folder.path(f)).unwrap()).collect();
    assert!(before == after, "a source file was changed");
    assert_eq!(folder.names(), Folder::fixtures_and(&["club.cbh.sqlite", "club.cbv.sqlite"]));
}

#[test]
fn an_archive_is_unpacked_and_converted_without_leaving_the_unpacked_files() {
    let folder = Folder::new("archive");
    let mut seen = Vec::new();
    let opened = open_path(&folder.path("club.cbv"), &mut |p| {
        seen.push(p);
        true
    })
    .unwrap();
    assert_eq!(players(&opened.store), the_two_games());
    assert_eq!(opened.path, folder.path("club.cbv.sqlite"));
    // First the unpacking, whose length can't be told, then the games.
    assert_eq!(seen[0], Progress { done: 0, total: 0 });
    assert_eq!(seen.last(), Some(&Progress { done: 4, total: 4 }));
    assert_eq!(folder.names(), Folder::fixtures_and(&["club.cbv.sqlite"]));
}

#[test]
fn file_names_with_dots_and_capital_letters_work() {
    let dotted = Folder::new("dotted");
    dotted.rename_database("Club.2024");
    let opened = open_path(&dotted.path("Club.2024.cbh"), &mut no_progress).unwrap();
    assert_eq!(players(&opened.store), the_two_games());

    let capitals = Folder::new("capitals");
    fs::rename(capitals.path("club.cbh"), capitals.path("club.CBH")).unwrap();
    assert_eq!(players(&open_path(&capitals.path("club.CBH"), &mut no_progress).unwrap().store), the_two_games());
}

#[test]
fn cancelling_leaves_nothing_behind_and_can_be_tried_again() {
    for file in ["club.cbh", "club.cbv"] {
        let folder = Folder::new(&format!("cancel-{file}"));
        let result = open_path(&folder.path(file), &mut |_| false);
        assert!(matches!(result, Err(Error::Cancelled)));
        assert_eq!(folder.names(), Folder::fixtures_and(&[]));
        assert_eq!(open_path(&folder.path(file), &mut no_progress).unwrap().imported, 2);
    }

    // Cancelling after the last game also counts: the database is not finished yet.
    let folder = Folder::new("cancel-late");
    let result = open_path(&folder.path("club.cbh"), &mut |p| p.done < p.total);
    assert!(matches!(result, Err(Error::Cancelled)));
    assert_eq!(folder.names(), Folder::fixtures_and(&[]));
}

#[test]
fn what_an_interrupted_conversion_left_is_replaced() {
    let folder = Folder::new("leftovers");
    fs::write(folder.path("club.cbv.sqlite.partial"), "half a database").unwrap();
    fs::create_dir(folder.path("club.cbv.sqlite.unpacked")).unwrap();
    fs::write(folder.path("club.cbv.sqlite.unpacked/old.cbh"), "old").unwrap();

    assert_eq!(open_path(&folder.path("club.cbv"), &mut no_progress).unwrap().imported, 2);
    assert_eq!(folder.names(), Folder::fixtures_and(&["club.cbv.sqlite"]));
}

#[test]
fn missing_files_are_reported_and_nothing_is_created() {
    let folder = Folder::new("missing");
    assert!(matches!(open_path(&folder.path("gone.cbh"), &mut no_progress), Err(Error::NotFound(_))));
    assert!(matches!(open_path(&folder.path("gone.cbv"), &mut no_progress), Err(Error::NotFound(_))));

    fs::remove_file(folder.path("club.cbg")).unwrap();
    let error = open_path(&folder.path("club.cbh"), &mut no_progress).err().unwrap();
    assert!(error.to_string().contains("could not read"), "{error}");
    assert!(error.to_string().contains("club.cbg"), "{error}");
    assert!(!folder.path("club.cbh.sqlite").exists());
}

#[test]
fn files_that_are_not_what_they_say_are_reported() {
    let folder = Folder::new("bad-files");
    fs::write(folder.path("club.cbv"), "This is not an archive.").unwrap();
    let error = open_path(&folder.path("club.cbv"), &mut no_progress).err().unwrap();
    assert!(matches!(error, Error::ChessBase(_)), "{error}");
    assert_eq!(game_count(&folder.path("club.cbv")).ok().flatten(), None);

    fs::write(folder.path("club.cbh"), "This is not a database.").unwrap();
    let error = open_path(&folder.path("club.cbh"), &mut no_progress).err().unwrap();
    assert!(matches!(error, Error::ChessBase(_)), "{error}");
    assert_eq!(folder.names(), Folder::fixtures_and(&[]));
}

/// Where game `id`'s moves start in the moves file, from its header record.
fn moves_offset(cbh: &[u8], id: usize) -> u64 {
    let record = &cbh[46 * id..];
    u64::from(u32::from_be_bytes([record[1], record[2], record[3], record[4]]))
}

#[test]
fn a_game_that_cannot_be_read_is_left_out_and_counted() {
    let folder = Folder::new("damaged");
    // Cut the moves file inside the second game; the first game stays whole.
    let second_game = moves_offset(&fs::read(folder.path("club.cbh")).unwrap(), 3);
    fs::OpenOptions::new().write(true).open(folder.path("club.cbg")).unwrap().set_len(second_game).unwrap();

    let opened = open_path(&folder.path("club.cbh"), &mut no_progress).unwrap();
    assert_eq!((opened.imported, opened.skipped), (1, 1));
    assert_eq!(players(&opened.store), the_two_games()[..1]);

    // It is still known the next time, when no conversion happens.
    drop(opened);
    let again = open_path(&folder.path("club.cbh"), &mut no_progress).unwrap();
    assert_eq!((again.imported, again.skipped), (0, 1));
}

#[test]
fn a_database_with_no_readable_game_is_an_error_and_leaves_nothing() {
    let folder = Folder::new("unreadable");
    let first_game = moves_offset(&fs::read(folder.path("club.cbh")).unwrap(), 1);
    fs::OpenOptions::new().write(true).open(folder.path("club.cbg")).unwrap().set_len(first_game).unwrap();

    let error = open_path(&folder.path("club.cbh"), &mut no_progress).err().unwrap();
    assert!(error.to_string().contains("could not read any game"), "{error}");
    assert!(!folder.path("club.cbh.sqlite").exists());
}

#[test]
fn an_empty_database_opens_empty() {
    let folder = Folder::new("empty");
    let header = fs::read(folder.path("club.cbh")).unwrap()[..46].to_vec();
    fs::write(folder.path("club.cbh"), header).unwrap();
    let opened = open_path(&folder.path("club.cbh"), &mut no_progress).unwrap();
    assert_eq!((opened.imported, opened.skipped, opened.store.count().unwrap()), (0, 0, 0));
}

#[test]
fn damaged_files_never_crash_the_conversion() {
    let folder = Folder::new("fuzz");
    // Every byte of the small files that hold moves and comments, a sample of the others: this
    // takes half a minute, and trying every byte of them all takes five.
    for (file, step) in [("club.cbg", 1), ("club.cba", 1), ("club.cbh", 3), ("club.cbp", 13), ("club.cbt", 7), ("club.cbv", 11)] {
        let original = fs::read(folder.path(file)).unwrap();
        // Which source to open: the archive holds its own copy of the other files.
        let source = folder.path(if file == "club.cbv" { "club.cbv" } else { "club.cbh" });
        for at in (0..original.len()).step_by(step) {
            for flip in [0xFF, 0x01] {
                let mut damaged = original.clone();
                damaged[at] ^= flip;
                fs::write(folder.path(file), &damaged).unwrap();
                // Failing is fine; a panic isn't, and fails this test.
                let _ = game_count(&source);
                drop(open_path(&source, &mut no_progress));
                let _ = fs::remove_file(with_sqlite(&source));
            }
        }
        fs::write(folder.path(file), &original).unwrap();
    }
}

fn with_sqlite(source: &Path) -> PathBuf {
    PathBuf::from(format!("{}.sqlite", source.display()))
}

#[test]
fn game_counts_create_nothing_and_follow_the_conversion() {
    let folder = Folder::new("counts");
    assert_eq!(game_count(&folder.path("club.cbh")).unwrap(), Some(2));
    // An archive is counted from its table of contents, which also counts the other records.
    assert_eq!(game_count(&folder.path("club.cbv")).unwrap(), Some(4));
    assert_eq!(folder.names(), Folder::fixtures_and(&[]));

    let mut store = open_path(&folder.path("club.cbv"), &mut no_progress).unwrap().store;
    store.delete_game(1).unwrap();
    drop(store);
    assert_eq!(game_count(&folder.path("club.cbv")).unwrap(), Some(1));

    assert_eq!(game_count(&folder.path("gone.cbh")).unwrap(), None);
    assert_eq!(game_count(&folder.path("gone.cbv")).unwrap(), None);
    assert_eq!(game_count(&folder.path("gone.pgn")).unwrap(), None);
}

#[test]
fn only_a_chessbase_file_not_yet_converted_has_games_to_convert() {
    let folder = Folder::new("to-convert");
    let club = folder.path("club.cbh");
    assert_eq!(games_to_convert(&club).unwrap(), Some(2));
    assert_eq!(games_to_convert(&folder.path("gone.cbh")).unwrap(), None);
    assert_eq!(games_to_convert(&folder.path("games.pgn")).unwrap(), None);
    drop(open_path(&club, &mut no_progress).unwrap());
    assert_eq!(games_to_convert(&club).unwrap(), None);
}

#[test]
fn the_database_still_opens_after_the_original_has_gone() {
    let folder = Folder::new("moved");
    let source = folder.path("club.cbh");
    drop(open_path(&source, &mut no_progress).unwrap());
    fs::remove_file(&source).unwrap();
    assert_eq!(game_count(&source).unwrap(), Some(2));
    assert_eq!(open_path(&source, &mut no_progress).unwrap().store.count().unwrap(), 2);
}

/// On Windows a database that is open can't be removed, which is how a running conversion shows.
#[cfg(windows)]
#[test]
fn a_second_conversion_of_one_file_is_refused_not_mixed_in() {
    let folder = Folder::new("twice");
    let partial = folder.path("club.cbh.sqlite.partial");
    let running = Store::open(&partial).unwrap();

    let error = open_path(&folder.path("club.cbh"), &mut no_progress).err().unwrap();
    assert!(error.to_string().contains("in use"), "{error}");
    assert!(!folder.path("club.cbh.sqlite").exists());

    assert_eq!(running.count().unwrap(), 0, "the running conversion's file got games from the second");
    drop(running);
    assert_eq!(open_path(&folder.path("club.cbh"), &mut no_progress).unwrap().store.count().unwrap(), 2);
}

#[test]
fn leftovers_beside_a_finished_database_are_cleaned_up() {
    let folder = Folder::new("cleanup");
    drop(open_path(&folder.path("club.cbh"), &mut no_progress).unwrap());
    fs::create_dir(folder.path("club.cbh.sqlite.unpacked")).unwrap();
    drop(open_path(&folder.path("club.cbh"), &mut no_progress).unwrap());
    assert_eq!(folder.names(), Folder::fixtures_and(&["club.cbh.sqlite"]));
}

#[test]
fn other_files_open_as_before() {
    let folder = Folder::new("others");
    let pgn = folder.path("games.pgn");
    fs::write(&pgn, "[Event \"E\"]\n[White \"A\"]\n[Black \"B\"]\n[Result \"*\"]\n\n1. e4 *\n").unwrap();
    let opened = open_path(&pgn, &mut |_| panic!("a PGN file has no conversion")).unwrap();
    assert_eq!((opened.imported, &opened.path), (1, &folder.path("games.sqlite")));
    drop(opened);
    assert_eq!(game_count(&pgn).unwrap(), Some(1));
    assert_eq!(open_path(&folder.path("games.sqlite"), &mut no_progress).unwrap().imported, 0);
}

#[test]
fn a_conversion_never_replaces_a_database() {
    let folder = Folder::new("exists");
    let target = folder.path("mine.sqlite");
    fs::write(&target, "my own games").unwrap();
    assert!(convert_chessbase(&folder.path("club.cbh"), &target, &mut no_progress).is_err());
    assert_eq!(fs::read_to_string(&target).unwrap(), "my own games");

    let new = folder.path("new.sqlite");
    assert_eq!(convert_chessbase(&folder.path("club.cbh"), &new, &mut no_progress).unwrap().games, 2);
    assert_eq!(players(&Store::open(&new).unwrap()), the_two_games());
}
