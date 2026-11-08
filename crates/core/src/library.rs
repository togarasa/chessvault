//! Opens any file the app can show: ChessVault databases, PGN files, and ChessBase databases
//! and archives. A ChessBase file is converted once into a ChessVault database beside it and
//! is never written to; the database is named after the whole file name, `Club.cbh.sqlite`, so
//! that `Club.pgn`, `Club.cbh` and `Club.cbv` in one folder keep separate games.

use std::error::Error as StdError;
use std::fs;
use std::path::{Path, PathBuf};
use std::thread::sleep;
use std::time::Duration;

use crate::convert::{self, GameBatches};
use crate::db::{self, Error, Opened, Result, Store};

/// The meta key that records how many games a conversion left out, so that it isn't forgotten
/// after the status bar has moved on.
const SKIPPED: &str = "converted_skipped";

/// How far a conversion has come, in records. A `total` of 0 means it can't be told yet,
/// which is the case while an archive is unpacked.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
pub struct Progress {
    pub done: u64,
    pub total: u64,
}

/// What a conversion put in its database.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Converted {
    pub games: u64,
    /// Records that could not be read, or games whose moves are not legal; these were left out.
    pub skipped: u64,
}

fn has_extension(path: &Path, extension: &str) -> bool {
    path.extension().is_some_and(|e| e.eq_ignore_ascii_case(extension))
}

fn is_chessbase_database(path: &Path) -> bool {
    has_extension(path, "cbh")
}

fn is_chessbase_archive(path: &Path) -> bool {
    has_extension(path, "cbv")
}

fn is_chessbase(path: &Path) -> bool {
    is_chessbase_database(path) || is_chessbase_archive(path)
}

/// `path` with `suffix` added after its whole file name.
fn with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(suffix);
    PathBuf::from(name)
}

const PARTIAL: &str = ".partial";
const UNPACKED: &str = ".unpacked";
const RENAME_RETRIES: u32 = 10;

/// The ChessVault database kept for the ChessBase file at `path`.
fn database_for(path: &Path) -> PathBuf {
    with_suffix(path, ".sqlite")
}

fn chessbase_error(path: &Path, error: Box<dyn StdError>) -> Error {
    Error::ChessBase(format!("could not read {}: {error}", path.display()))
}

/// Opens `path` as [`db::open_path`] does, and also opens ChessBase files. The first time one
/// is opened it is converted, which calls `on_progress` along the way; `on_progress` returning
/// `false` cancels the conversion, which leaves nothing behind.
pub fn open_path(path: &Path, on_progress: &mut dyn FnMut(Progress) -> bool) -> Result<Opened> {
    if !is_chessbase(path) {
        return db::open_path(path);
    }
    let target = database_for(path);
    // The database is what counts: it holds the user's changes, also after the original has gone.
    if target.exists() {
        // A failure to clean up can't have stopped the database from being finished.
        let _ = remove_leftovers(&with_suffix(&target, PARTIAL), &with_suffix(&target, UNPACKED));
        return open_converted(target, 0);
    }
    if !path.exists() {
        return Err(Error::NotFound(path.to_path_buf()));
    }
    let converted = convert_chessbase(path, &target, on_progress)?;
    open_converted(target, converted.games as usize)
}

fn open_converted(target: PathBuf, imported: usize) -> Result<Opened> {
    let store = Store::open(&target)?;
    let skipped = store.meta(SKIPPED)?.and_then(|count| count.parse().ok()).unwrap_or(0);
    Ok(Opened { store, path: target, imported, skipped })
}

/// The number of games in `path`, read without changing or creating anything; `None` when the
/// file doesn't exist. See [`db::game_count`]. A ChessBase file that was converted counts its
/// database's games.
pub fn game_count(path: &Path) -> Result<Option<i64>> {
    if !is_chessbase(path) {
        return db::game_count(path);
    }
    let target = database_for(path);
    if target.exists() {
        return db::game_count(&target);
    }
    if !path.exists() {
        return Ok(None);
    }
    let games = if is_chessbase_database(path) { convert::database_games(path) } else { convert::archive_games(path) };
    games.map(|count| Some(count as i64)).map_err(|e| chessbase_error(path, e))
}

/// How many games opening `path` would have to convert; `None` when opening it converts nothing.
pub fn games_to_convert(path: &Path) -> Result<Option<i64>> {
    if !is_chessbase(path) || database_for(path).exists() {
        return Ok(None);
    }
    game_count(path)
}

/// Converts the ChessBase file at `source` into a new database at `target`. The database gets
/// its final name only when it is complete and safely on disk, so a conversion that is
/// cancelled, fails or is cut short by a power cut is never taken for a finished one.
pub fn convert_chessbase(source: &Path, target: &Path, on_progress: &mut dyn FnMut(Progress) -> bool) -> Result<Converted> {
    if target.exists() {
        return Err(Error::ChessBase(format!("{} already exists", target.display())));
    }
    let partial = with_suffix(target, PARTIAL);
    let unpacked = with_suffix(target, UNPACKED);
    remove_leftovers(&partial, &unpacked)?;
    let converted = fill_database(source, &partial, &unpacked, on_progress);
    let _ = fs::remove_dir_all(&unpacked);
    let finished = converted.and_then(|converted| {
        // The fast writes of the conversion were not flushed to the disk.
        fs::OpenOptions::new().write(true).open(&partial)?.sync_all()?;
        rename_patiently(&partial, target)?;
        Ok(converted)
    });
    if finished.is_err() {
        let _ = fs::remove_file(&partial);
    }
    finished
}

/// Removes what an earlier conversion left when the app was closed or the computer stopped. A
/// file that can't be removed is in use, so another conversion is running: both writing to one
/// file would ruin it.
fn remove_leftovers(partial: &Path, unpacked: &Path) -> Result<()> {
    for removed in [fs::remove_file(partial), fs::remove_dir_all(unpacked)] {
        match removed {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
                return Err(Error::ChessBase(format!(
                    "{} is in use; another window may be converting this file ({e})",
                    partial.display()
                )));
            }
            _ => {}
        }
    }
    Ok(())
}

/// Renames a new file. A virus scanner or a sync program often holds a new file for a moment,
/// which must not throw away minutes of work.
fn rename_patiently(from: &Path, to: &Path) -> std::io::Result<()> {
    for _ in 0..RENAME_RETRIES {
        if fs::rename(from, to).is_ok() {
            return Ok(());
        }
        sleep(Duration::from_millis(500));
    }
    fs::rename(from, to)
}

fn fill_database(
    source: &Path,
    database: &Path,
    unpacked: &Path,
    on_progress: &mut dyn FnMut(Progress) -> bool,
) -> Result<Converted> {
    let threads = std::thread::available_parallelism().map_or(1, |n| n.get());
    let cbh_files = if is_chessbase_archive(source) {
        keep_going(on_progress, Progress { done: 0, total: 0 })?;
        fs::create_dir_all(unpacked)?;
        convert::unpack_archive(source, unpacked, threads).map_err(|e| chessbase_error(source, e))?
    } else {
        vec![source.to_path_buf()]
    };
    let mut readers = cbh_files
        .iter()
        .map(|cbh| GameBatches::open(cbh, threads))
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| chessbase_error(source, e))?;

    let mut store = Store::open(database).map_err(|e| {
        Error::ChessBase(format!("could not make a database beside {}; copy its files to a folder you can write to ({e})", source.display()))
    })?;
    store.begin_bulk_import()?;
    let total = readers.iter().map(GameBatches::total).sum();
    let mut converted = Converted { games: 0, skipped: 0 };
    let mut done_before = 0;
    keep_going(on_progress, Progress { done: 0, total })?;
    for reader in &mut readers {
        while let Some(games) = reader.next_batch() {
            let counts = store.import_batch(&games)?;
            converted.games += counts.added as u64;
            converted.skipped += counts.skipped as u64;
            keep_going(on_progress, Progress { done: done_before + reader.done(), total })?;
        }
        converted.skipped += reader.failures();
        done_before += reader.total();
    }
    if converted.games == 0 && converted.skipped > 0 {
        return Err(Error::ChessBase(format!("could not read any game in {}", source.display())));
    }
    store.set_meta(SKIPPED, &converted.skipped.to_string())?;
    store.finish_bulk_import()?;
    Ok(converted)
}

fn keep_going(on_progress: &mut dyn FnMut(Progress) -> bool, progress: Progress) -> Result<()> {
    if on_progress(progress) {
        Ok(())
    } else {
        Err(Error::Cancelled)
    }
}
