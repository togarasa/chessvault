//! Reads ChessBase databases and archives, using the `cbvault` reader. Nothing here writes to
//! them: an archive is unpacked into a folder the caller chooses.

use std::error::Error;
use std::io::Write;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::{Path, PathBuf};

use cbvault::bridge::{Database, GameBuf};
use cbvault_format::archive::Archive;
use cbvault_format::game::RecordKind;

/// The records one [`GameBatches`] batch holds: few enough that a batch fits in memory and
/// progress moves often.
const RECORDS_PER_BATCH: u32 = 50_000;

/// The size of a `.cbh` record; the file starts with one such block of its own.
const CBH_RECORD_SIZE: u64 = 46;

/// What a conversion wrote.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ConvertStats {
    /// Games written to the PGN output.
    pub games: u64,
    /// Records that could not be decoded and were left out.
    pub failures: u64,
}

/// The `.cbh` file of the database at `database`, which may be given without the extension.
/// A bare name would be read as having an extension when it has a dot in it, such as `Club.2024`.
fn cbh_path(database: &Path) -> PathBuf {
    if is_cbh(database) {
        return database.to_path_buf();
    }
    let mut name = database.as_os_str().to_owned();
    name.push(".cbh");
    PathBuf::from(name)
}

fn is_cbh(path: &Path) -> bool {
    path.extension().is_some_and(|e| e.eq_ignore_ascii_case("cbh"))
}

/// Runs `read`, which uses the reader. The reader can panic on a damaged file, and that is a
/// failure to read the file like any other.
fn guarded<T>(read: impl FnOnce() -> Result<T, Box<dyn Error>>) -> Result<T, Box<dyn Error>> {
    catch_unwind(AssertUnwindSafe(read)).unwrap_or_else(|_| Err("the file is damaged".into()))
}

/// Converts the ChessBase database at `database` to PGN, written to `out`.
///
/// `database` is the `.cbh` file, with or without its extension, for example
/// `Downloads/MyPGNDownloads` for `MyPGNDownloads.cbh` and its sidecar files.
pub fn convert_to_pgn(database: &Path, out: &mut impl Write, threads: usize) -> Result<ConvertStats, Box<dyn Error>> {
    let mut batches = GameBatches::open(database, threads)?;
    let mut games = 0;
    while let Some(batch) = batches.next_batch() {
        for game in &batch {
            write!(out, "{game}\n\n")?;
        }
        games += batch.len() as u64;
    }
    Ok(ConvertStats { games, failures: batches.failures() })
}

/// Reads a ChessBase database as batches of games in PGN, so a database of millions of games
/// never has to fit in memory.
pub struct GameBatches {
    database: Database,
    threads: usize,
    done: u32,
    failures: u64,
}

impl GameBatches {
    /// Opens the database at `database`, checking that all its files are there.
    /// `threads` of 0 or 1 reads on the calling thread.
    pub fn open(database: &Path, threads: usize) -> Result<Self, Box<dyn Error>> {
        let database = guarded(|| Ok(Database::open(cbh_path(database))?))?;
        Ok(GameBatches { database, threads: threads.max(1), done: 0, failures: 0 })
    }

    /// The records in the database: its games, its guiding texts and any deleted games.
    pub fn total(&self) -> u64 {
        u64::from(self.database.records())
    }

    /// The records read so far.
    pub fn done(&self) -> u64 {
        u64::from(self.done)
    }

    /// The games read so far that could not be decoded and were left out.
    pub fn failures(&self) -> u64 {
        self.failures
    }

    /// The next games in the database's order, each as one PGN text, or `None` at its end.
    /// A batch can be empty when none of its records is a readable game.
    pub fn next_batch(&mut self) -> Option<Vec<String>> {
        let total = self.database.records();
        if self.done >= total {
            return None;
        }
        let last = self.done.saturating_add(RECORDS_PER_BATCH).min(total);
        let (first, database) = (self.done + 1, &self.database);
        let share = (last - first) / self.threads as u32 + 1;
        let parts: Vec<(Vec<String>, u64)> = std::thread::scope(|scope| {
            let workers: Vec<_> = (first..=last)
                .step_by(share as usize)
                .map(|start| scope.spawn(move || read_games(database, start, start.saturating_add(share - 1).min(last))))
                .collect();
            workers.into_iter().map(|worker| worker.join().expect("a reader thread never panics")).collect()
        });
        self.done = last;
        let mut games = Vec::new();
        for (part, failures) in parts {
            games.extend(part);
            self.failures += failures;
        }
        Some(games)
    }
}

/// The games among the records `first..=last` and how many of them could not be read.
fn read_games(database: &Database, first: u32, last: u32) -> (Vec<String>, u64) {
    let mut buffer = GameBuf::new();
    let mut games = Vec::new();
    let mut failures = 0;
    for id in first..=last {
        let is_game = match database.header_ref(id) {
            Ok(header) => !header.is_deleted() && matches!(header.kind(), RecordKind::Game),
            Err(_) => {
                failures += 1;
                continue;
            }
        };
        if !is_game {
            continue;
        }
        // Damaged annotations don't lose the game: its moves are still good.
        let pgn = guarded(|| {
            let with_annotations = database.game_pgn_with(id, &mut buffer, true);
            Ok(with_annotations.or_else(|_| database.game_pgn_with(id, &mut buffer, false))?)
        });
        match pgn {
            Ok(pgn) => games.push(pgn.trim().to_string()),
            Err(_) => {
                failures += 1;
                // It may have been left half used.
                buffer = GameBuf::new();
            }
        }
    }
    (games, failures)
}

/// The number of games in the database at `database`, read without changing anything.
pub fn database_games(database: &Path) -> Result<u64, Box<dyn Error>> {
    guarded(|| Ok(Database::open(cbh_path(database))?.game_count()?))
}

/// About how many records the archive at `archive` holds, read from its table of contents
/// without unpacking anything. Guiding texts count too, so this can be a little high.
pub fn archive_games(archive: &Path) -> Result<u64, Box<dyn Error>> {
    guarded(|| {
        let opened = Archive::open(archive)?;
        let cbh_size: u64 = opened.list().iter().filter(|m| is_cbh(Path::new(m.name()))).map(|m| m.size()).sum();
        Ok((cbh_size / CBH_RECORD_SIZE).saturating_sub(1))
    })
}

/// Unpacks the archive at `archive` into the folder `into` and returns the `.cbh` file of each
/// database in it. Password-protected archives are refused.
pub fn unpack_archive(archive: &Path, into: &Path, threads: usize) -> Result<Vec<PathBuf>, Box<dyn Error>> {
    guarded(|| {
        let opened = Archive::open(archive)?;
        if opened.is_encrypted() {
            return Err(format!("{} is protected by a password", archive.display()).into());
        }
        let mut databases: Vec<PathBuf> =
            opened.extract_parallel(into, threads.max(1))?.into_iter().filter(|path| is_cbh(path)).collect();
        if databases.is_empty() {
            return Err(format!("{} holds no database", archive.display()).into());
        }
        databases.sort();
        Ok(databases)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_database_is_an_error() {
        let mut out = Vec::new();
        let result = convert_to_pgn(Path::new("does-not-exist.cbh"), &mut out, 1);
        assert!(result.is_err());
        assert!(out.is_empty());
        assert!(GameBatches::open(Path::new("does-not-exist.cbh"), 1).is_err());
        assert!(database_games(Path::new("does-not-exist.cbh")).is_err());
    }

    #[test]
    fn a_missing_archive_is_an_error() {
        assert!(archive_games(Path::new("does-not-exist.cbv")).is_err());
        assert!(unpack_archive(Path::new("does-not-exist.cbv"), Path::new("."), 1).is_err());
    }

    #[test]
    fn the_cbh_path_keeps_every_part_of_the_name() {
        assert_eq!(cbh_path(Path::new("Club.2024")), Path::new("Club.2024.cbh"));
        assert_eq!(cbh_path(Path::new("Club.2024.cbh")), Path::new("Club.2024.cbh"));
        assert_eq!(cbh_path(Path::new("Club.CBH")), Path::new("Club.CBH"));
    }
}
