//! Game storage in SQLite. Games are kept as PGN with indexed headers, and
//! every edit saves the previous version so it can be undone.

use std::fmt;
use std::fs::{self, File};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, ErrorCode, OptionalExtension, Transaction};

use crate::validate;

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS games (
    id         INTEGER PRIMARY KEY,
    event      TEXT NOT NULL,
    site       TEXT NOT NULL,
    date       TEXT NOT NULL,
    round      TEXT NOT NULL,
    white      TEXT NOT NULL,
    black      TEXT NOT NULL,
    result     TEXT NOT NULL,
    eco        TEXT NOT NULL,
    white_elo  INTEGER,
    black_elo  INTEGER,
    plies      INTEGER,
    pgn        TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS revisions (
    id       INTEGER PRIMARY KEY,
    game_id  INTEGER NOT NULL,
    pgn      TEXT NOT NULL,
    saved_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS games_white ON games(white);
CREATE INDEX IF NOT EXISTS games_black ON games(black);
CREATE INDEX IF NOT EXISTS revisions_game ON revisions(game_id);
";

const INSERT_GAME: &str = "INSERT INTO games
     (event, site, date, round, white, black, result, eco, white_elo, black_elo, plies, pgn, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)";

const SUMMARY_COLUMNS: &str = "id, event, site, date, round, white, black, result, eco, white_elo, black_elo, plies";

/// Errors from the store.
#[derive(Debug)]
pub enum Error {
    Sql(rusqlite::Error),
    Io(std::io::Error),
    InvalidGame(String),
    NotADatabase(PathBuf),
    NotFound(PathBuf),
    /// Games can't be written to this kind of file; the text says which kinds are allowed.
    WrongFileType(PathBuf, &'static str),
    /// A ChessBase file couldn't be read; the text says why.
    ChessBase(String),
    /// The user stopped the work.
    Cancelled,
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Sql(e) => write!(f, "database error: {e}"),
            Error::Io(e) => write!(f, "{e}"),
            Error::InvalidGame(msg) => write!(f, "invalid game: {msg}"),
            Error::NotADatabase(path) => write!(
                f,
                "{} is not a ChessVault database; open a .sqlite, .pgn, .cbh or .cbv file",
                path.display()
            ),
            Error::NotFound(path) => write!(f, "{} was not found; it may have been moved or deleted", path.display()),
            Error::WrongFileType(path, allowed) => {
                write!(f, "{} can't be written to; choose {allowed}", path.display())
            }
            Error::ChessBase(msg) => write!(f, "{msg}"),
            Error::Cancelled => write!(f, "cancelled"),
        }
    }
}

impl std::error::Error for Error {}

impl From<rusqlite::Error> for Error {
    fn from(e: rusqlite::Error) -> Self {
        Error::Sql(e)
    }
}

impl From<std::io::Error> for Error {
    fn from(e: std::io::Error) -> Self {
        Error::Io(e)
    }
}

/// A database opened by [`open_path`].
pub struct Opened {
    pub store: Store,
    /// The database file that was opened or created.
    pub path: PathBuf,
    /// Games imported from the file; 0 when an existing database was opened.
    pub imported: usize,
    /// Games left out of the import because they could not be read.
    pub skipped: usize,
}

/// Opens `path` as a database. For a `.pgn` file, opens the database beside it
/// with the same name and a `.sqlite` extension, and imports the file's games
/// the first time, so opening the same PGN again doesn't duplicate them.
pub fn open_path(path: &Path) -> Result<Opened> {
    // A database that was moved or deleted must not come back empty.
    if !path.exists() {
        return Err(Error::NotFound(path.to_path_buf()));
    }
    if !has_extension(path, "pgn") {
        let store = Store::open(path)?;
        return Ok(Opened { store, path: path.to_path_buf(), imported: 0, skipped: 0 });
    }
    let db_path = path.with_extension("sqlite");
    let existed = db_path.exists();
    let mut store = Store::open(&db_path)?;
    // Databases made before the marker existed count as imported when they have games.
    if store.meta(PGN_IMPORTED)?.is_some() || store.count()? > 0 {
        return Ok(Opened { store, path: db_path, imported: 0, skipped: 0 });
    }
    let imported = fs::read_to_string(path)
        .map_err(Error::from)
        .and_then(|text| store.import_pgn(&text))
        .and_then(|imported| store.set_meta(PGN_IMPORTED, "1").map(|()| imported));
    match imported {
        Ok(imported) => Ok(Opened { store, path: db_path, imported, skipped: 0 }),
        Err(e) => {
            // Don't leave an empty database behind for a PGN that failed to import.
            drop(store);
            if !existed {
                let _ = fs::remove_file(&db_path);
            }
            Err(e)
        }
    }
}

/// The meta key that records that a PGN file's games were imported into its database.
const PGN_IMPORTED: &str = "pgn_imported";

fn has_extension(path: &Path, ext: &str) -> bool {
    path.extension().is_some_and(|e| e.eq_ignore_ascii_case(ext))
}

/// Creates a new, empty database at `path`, or opens it if it already exists.
pub fn create_database(path: &Path) -> Result<Opened> {
    if !has_extension(path, "sqlite") {
        return Err(Error::WrongFileType(path.to_path_buf(), "a .sqlite file"));
    }
    Ok(Opened { store: Store::open(path)?, path: path.to_path_buf(), imported: 0, skipped: 0 })
}

/// Adds one game to the file at `path`, creating it if needed: a `.pgn` file gets the game
/// appended, any other path is opened as a database. A PGN file's database from [`open_path`],
/// if there is one, gets the game too so the two stay alike.
///
/// With `replace`, the file becomes a new one holding only this game: an existing PGN file is
/// overwritten. An existing database, or a PGN file with a database beside it, is refused
/// rather than thrown away.
pub fn add_game_to(path: &Path, pgn: &str, replace: bool) -> Result<()> {
    if !has_extension(path, "pgn") && !has_extension(path, "sqlite") {
        return Err(Error::WrongFileType(path.to_path_buf(), "a .pgn or .sqlite file"));
    }
    let pgn = single_game(pgn)?;
    check_game(&pgn)?;
    let db_path = path.with_extension("sqlite");
    if replace && db_path.exists() {
        return Err(Error::InvalidGame(format!(
            "{} already has a ChessVault database; add the game to it instead of replacing it",
            path.display()
        )));
    }
    if has_extension(path, "sqlite") {
        Store::open(path)?.add_game(&pgn)?;
        return Ok(());
    }
    if replace {
        fs::write(path, format!("{}\n\n", pgn.trim()))?;
        return Ok(());
    }
    let existing = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Vec::new(),
        Err(e) => return Err(e.into()),
    };
    // Leave one blank line between the last game and the new one.
    let separator = match existing.iter().rposition(|b| !b.is_ascii_whitespace()) {
        None => "",
        Some(last) => match existing[last..].iter().filter(|&&b| b == b'\n').count() {
            0 => "\n\n",
            1 => "\n",
            _ => "",
        },
    };
    let mut file = fs::OpenOptions::new().create(true).append(true).open(path)?;
    write!(file, "{separator}{}\n\n", pgn.trim())?;
    file.sync_all()?;
    if db_path.exists() {
        Store::open(&db_path)?.add_game(&pgn)?;
    }
    Ok(())
}

/// The number of games in a database or PGN file, read without changing or creating anything.
/// A PGN file that has a database beside it from [`open_path`] counts that database's games.
/// Returns `None` when the file doesn't exist.
pub fn game_count(path: &Path) -> Result<Option<i64>> {
    if !path.exists() {
        return Ok(None);
    }
    if path.extension().is_some_and(|e| e.eq_ignore_ascii_case("pgn")) {
        let db_path = path.with_extension("sqlite");
        if db_path.exists() {
            return game_count(&db_path);
        }
        let text = fs::read_to_string(path)?;
        let games = text.lines().filter(|l| l.trim_start_matches(['\u{feff}', ' ', '\t']).starts_with("[Event ")).count();
        return Ok(Some(games as i64));
    }
    let conn = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let count = conn.query_row("SELECT COUNT(*) FROM games", [], |r| r.get(0)).map_err(|e| match e {
        rusqlite::Error::SqliteFailure(failure, _) if failure.code == ErrorCode::NotADatabase => {
            Error::NotADatabase(path.to_path_buf())
        }
        other => Error::Sql(other),
    })?;
    Ok(Some(count))
}

pub type Result<T> = std::result::Result<T, Error>;

/// What [`Store::import_batch`] did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BatchCounts {
    pub added: usize,
    /// Games left out because their moves are not legal.
    pub skipped: usize,
}

/// A game as shown in lists and search results.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameSummary {
    pub id: i64,
    pub event: String,
    pub site: String,
    pub date: String,
    pub round: String,
    pub white: String,
    pub black: String,
    pub result: String,
    pub eco: String,
    pub white_elo: Option<i64>,
    pub black_elo: Option<i64>,
    /// Half-moves in the main line.
    pub plies: Option<i64>,
}

/// What to look for in a game search. Empty fields match every game; text fields match any
/// part of the value, ignoring case.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Filter {
    pub white: String,
    pub black: String,
    /// Also find the games where the names are the other way round.
    pub ignore_colour: bool,
    /// "1-0", "0-1", "1/2-1/2" or "*"; empty for any.
    pub result: String,
    /// ECO codes from and to, both included; "B2" to "B9" covers B20 to B99.
    pub eco_from: String,
    pub eco_to: String,
    /// Dates from and to, both included, as "2024" or "2024.06" or "2024.06.15".
    pub date_from: String,
    pub date_to: String,
    pub min_white_elo: Option<i64>,
    pub min_black_elo: Option<i64>,
    pub event: String,
    pub site: String,
}

impl Filter {
    /// The SQL condition and its values, numbered from ?1.
    fn sql(&self) -> (String, Vec<Box<dyn rusqlite::ToSql>>) {
        let mut parts: Vec<String> = Vec::new();
        let mut values: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        /// Adds a value and returns its placeholder.
        fn value(v: Box<dyn rusqlite::ToSql>, values: &mut Vec<Box<dyn rusqlite::ToSql>>) -> String {
            values.push(v);
            format!("?{}", values.len())
        }
        let (white, black) = (self.white.trim(), self.black.trim());
        if !white.is_empty() || !black.is_empty() {
            let w = value(Box::new(like_pattern(white)), &mut values);
            let b = value(Box::new(like_pattern(black)), &mut values);
            let as_given = format!("(white LIKE {w} ESCAPE '\\' AND black LIKE {b} ESCAPE '\\')");
            parts.push(if self.ignore_colour {
                format!("({as_given} OR (white LIKE {b} ESCAPE '\\' AND black LIKE {w} ESCAPE '\\'))")
            } else {
                as_given
            });
        }
        for (column, text) in [("event", &self.event), ("site", &self.site)] {
            if !text.trim().is_empty() {
                let v = value(Box::new(like_pattern(text.trim())), &mut values);
                parts.push(format!("{column} LIKE {v} ESCAPE '\\'"));
            }
        }
        if !self.result.trim().is_empty() {
            let v = value(Box::new(self.result.trim().to_string()), &mut values);
            parts.push(format!("result = {v}"));
        }
        // "~" sorts after digits, letters, '.' and '?', so "B9~" is above every B9x code
        // and "2026~" above every 2026 date.
        for (column, from, to) in [("eco", &self.eco_from, &self.eco_to), ("date", &self.date_from, &self.date_to)] {
            if !from.trim().is_empty() {
                let v = value(Box::new(from.trim().to_uppercase()), &mut values);
                parts.push(format!("{column} >= {v}"));
            }
            if !to.trim().is_empty() {
                let v = value(Box::new(format!("{}~", to.trim().to_uppercase())), &mut values);
                parts.push(format!("{column} <= {v}"));
            }
        }
        for (column, min) in [("white_elo", self.min_white_elo), ("black_elo", self.min_black_elo)] {
            if let Some(min) = min {
                let v = value(Box::new(min), &mut values);
                parts.push(format!("{column} >= {v}"));
            }
        }
        let condition = if parts.is_empty() { "1".to_string() } else { parts.join(" AND ") };
        (condition, values)
    }
}

/// A LIKE pattern that finds `text` anywhere, with LIKE's own wildcards escaped.
fn like_pattern(text: &str) -> String {
    let escaped = text.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_");
    format!("%{escaped}%")
}

/// A column the game list can be sorted by.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SortColumn {
    #[default]
    Id,
    White,
    WhiteElo,
    Black,
    BlackElo,
    Result,
    Plies,
    Eco,
    Event,
    Site,
    Round,
    Date,
}

/// How to sort the game list. Games without a value (no Elo, say) come last either way.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Deserialize)]
pub struct Order {
    pub column: SortColumn,
    pub descending: bool,
}

impl Order {
    fn sql(self) -> String {
        let column = match self.column {
            SortColumn::Id => "id",
            SortColumn::White => "white",
            SortColumn::WhiteElo => "white_elo",
            SortColumn::Black => "black",
            SortColumn::BlackElo => "black_elo",
            SortColumn::Result => "result",
            SortColumn::Plies => "plies",
            SortColumn::Eco => "eco",
            SortColumn::Event => "event",
            SortColumn::Site => "site",
            SortColumn::Round => "round",
            SortColumn::Date => "date",
        };
        let dir = if self.descending { "DESC" } else { "ASC" };
        // Every game has a number, and this order needs no sorting even with millions of games.
        if matches!(self.column, SortColumn::Id) {
            return format!("ORDER BY id {dir}");
        }
        // PGN writes unknown values as "?" (or "????.??.??" for a date); they go last like empty ones.
        let unknown = format!("{column} IS NULL OR {column} = '' OR CAST({column} AS TEXT) LIKE '?%'");
        format!("ORDER BY {unknown}, {column} {dir}, id {dir}")
    }
}

/// A full game, including its PGN text.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct Game {
    pub id: i64,
    pub event: String,
    pub date: String,
    pub white: String,
    pub black: String,
    pub result: String,
    pub pgn: String,
}

/// A ChessVault game database.
pub struct Store {
    conn: Connection,
}

impl Store {
    /// Opens or creates the database file at `path`.
    pub fn open(path: &Path) -> Result<Self> {
        Self::from_connection(Connection::open(path)?).map_err(|e| match e {
            Error::Sql(rusqlite::Error::SqliteFailure(failure, _))
                if failure.code == ErrorCode::NotADatabase =>
            {
                Error::NotADatabase(path.to_path_buf())
            }
            other => other,
        })
    }

    /// Opens a throwaway in-memory database, for tests.
    pub fn open_in_memory() -> Result<Self> {
        Self::from_connection(Connection::open_in_memory()?)
    }

    fn from_connection(conn: Connection) -> Result<Self> {
        conn.execute_batch(SCHEMA)?;
        let mut store = Store { conn };
        store.migrate()?;
        Ok(store)
    }

    /// Adds the Elo and move count columns to databases made before they existed,
    /// filling them in from each game's PGN.
    fn migrate(&mut self) -> Result<()> {
        let has_plies = self
            .conn
            .prepare("SELECT 1 FROM pragma_table_info('games') WHERE name = 'plies'")?
            .exists([])?;
        if has_plies {
            return Ok(());
        }
        let tx = self.conn.transaction()?;
        tx.execute_batch(
            "ALTER TABLE games ADD COLUMN white_elo INTEGER;
             ALTER TABLE games ADD COLUMN black_elo INTEGER;
             ALTER TABLE games ADD COLUMN plies INTEGER;",
        )?;
        let games: Vec<(i64, String)> = tx
            .prepare("SELECT id, pgn FROM games")?
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<rusqlite::Result<_>>()?;
        for (id, pgn) in games {
            // Stored games were checked when saved; leave the columns empty if one no longer reads.
            let Ok(h) = Headers::from_pgn(&pgn) else { continue };
            tx.execute(
                "UPDATE games SET white_elo = ?1, black_elo = ?2, plies = ?3 WHERE id = ?4",
                params![h.white_elo, h.black_elo, h.plies, id],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Imports every game in `text`. Either all games are imported or none are.
    pub fn import_pgn(&mut self, text: &str) -> Result<usize> {
        let games = split_games(text.trim_start_matches('\u{feff}'))?;
        let tx = self.conn.transaction()?;
        for pgn in &games {
            let h = Headers::from_pgn(pgn)?;
            tx.execute(INSERT_GAME, h.insert_params(pgn).as_slice())?;
        }
        tx.commit()?;
        Ok(games.len())
    }

    /// Makes the many writes of a conversion fast. A crash can then ruin the database, so this
    /// is only for a new file that is thrown away unless [`Store::finish_bulk_import`] is reached.
    pub fn begin_bulk_import(&mut self) -> Result<()> {
        self.conn.execute_batch(
            "PRAGMA journal_mode = OFF;
             PRAGMA synchronous = OFF;
             DROP INDEX games_white;
             DROP INDEX games_black;",
        )?;
        Ok(())
    }

    /// Adds games, leaving out those whose moves are not legal, so one bad game among millions
    /// doesn't lose the others.
    pub fn import_batch(&mut self, games: &[String]) -> Result<BatchCounts> {
        let tx = self.conn.transaction()?;
        let mut counts = BatchCounts { added: 0, skipped: 0 };
        {
            let mut insert = tx.prepare_cached(INSERT_GAME)?;
            for pgn in games {
                let Ok(headers) = Headers::from_pgn(pgn) else {
                    counts.skipped += 1;
                    continue;
                };
                insert.execute(headers.insert_params(pgn).as_slice())?;
                counts.added += 1;
            }
        }
        tx.commit()?;
        Ok(counts)
    }

    /// Ends [`Store::begin_bulk_import`]: builds the indexes and returns to safe writing.
    pub fn finish_bulk_import(&mut self) -> Result<()> {
        self.conn.execute_batch(SCHEMA)?;
        self.conn.execute_batch("PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL;")?;
        Ok(())
    }

    /// Adds one game and returns its id.
    pub fn add_game(&mut self, pgn: &str) -> Result<i64> {
        let pgn = single_game(pgn)?;
        let h = Headers::from_pgn(&pgn)?;
        self.conn.execute(INSERT_GAME, h.insert_params(&pgn).as_slice())?;
        Ok(self.conn.last_insert_rowid())
    }

    /// Writes games as PGN, separated by blank lines: the games in `ids`, or all
    /// games when `ids` is `None`. Returns how many were written.
    pub fn export_pgn(&self, out: &mut impl Write, ids: Option<&[i64]>) -> Result<usize> {
        let mut stmt = self.conn.prepare("SELECT id, pgn FROM games ORDER BY id")?;
        let mut rows = stmt.query([])?;
        let mut written = 0;
        while let Some(row) = rows.next()? {
            let id: i64 = row.get(0)?;
            if ids.is_some_and(|ids| !ids.contains(&id)) {
                continue;
            }
            let pgn: String = row.get(1)?;
            write!(out, "{}\n\n", pgn.trim())?;
            written += 1;
        }
        Ok(written)
    }

    /// Exports games to the PGN file at `path`, replacing it only once all games are written.
    pub fn export_pgn_file(&self, path: &Path, ids: Option<&[i64]>) -> Result<usize> {
        // Never replace a database, a ChessBase file or anything else by mistake.
        if !has_extension(path, "pgn") {
            return Err(Error::WrongFileType(path.to_path_buf(), "a .pgn file"));
        }
        let mut tmp_name = path.as_os_str().to_owned();
        tmp_name.push(".tmp");
        let tmp = PathBuf::from(tmp_name);
        let written = (|| {
            let mut out = BufWriter::new(File::create(&tmp)?);
            let written = self.export_pgn(&mut out, ids)?;
            out.into_inner().map_err(|e| e.into_error())?.sync_all()?;
            fs::rename(&tmp, path)?;
            Ok(written)
        })();
        if written.is_err() {
            let _ = fs::remove_file(&tmp);
        }
        written
    }

    /// Deletes a game and its saved versions. Returns `false` when there is no game with that id.
    pub fn delete_game(&mut self, id: i64) -> Result<bool> {
        let tx = self.conn.transaction()?;
        tx.execute("DELETE FROM revisions WHERE game_id = ?1", params![id])?;
        let deleted = tx.execute("DELETE FROM games WHERE id = ?1", params![id])? > 0;
        tx.commit()?;
        Ok(deleted)
    }

    pub fn meta(&self, key: &str) -> Result<Option<String>> {
        Ok(self.conn.query_row("SELECT value FROM meta WHERE key = ?1", params![key], |r| r.get(0)).optional()?)
    }

    pub fn set_meta(&self, key: &str, value: &str) -> Result<()> {
        self.conn.execute("INSERT OR REPLACE INTO meta (key, value) VALUES (?1, ?2)", params![key, value])?;
        Ok(())
    }

    /// Number of games in the database.
    pub fn count(&self) -> Result<i64> {
        Ok(self.conn.query_row("SELECT COUNT(*) FROM games", [], |r| r.get(0))?)
    }

    /// Lists games in `order`.
    pub fn list(&self, order: Order, limit: i64, offset: i64) -> Result<Vec<GameSummary>> {
        let mut stmt = self.conn.prepare(&format!(
            "SELECT {SUMMARY_COLUMNS} FROM games {} LIMIT ?1 OFFSET ?2",
            order.sql()
        ))?;
        let rows = stmt.query_map(params![limit, offset], summary_row)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// Finds games where `name` appears as either player, in `order`, skipping the first `offset` matches.
    pub fn search_player(&self, name: &str, order: Order, limit: i64, offset: i64) -> Result<Vec<GameSummary>> {
        let filter = Filter { white: name.to_string(), ignore_colour: true, ..Filter::default() };
        self.search(&filter, order, limit, offset)
    }

    /// Finds the games that match every field set in `filter`, in `order`, skipping the first `offset`.
    pub fn search(&self, filter: &Filter, order: Order, limit: i64, offset: i64) -> Result<Vec<GameSummary>> {
        let (condition, mut values) = filter.sql();
        values.push(Box::new(limit));
        values.push(Box::new(offset));
        let n = values.len();
        let mut stmt = self.conn.prepare(&format!(
            "SELECT {SUMMARY_COLUMNS} FROM games WHERE {condition} {} LIMIT ?{} OFFSET ?{n}",
            order.sql(),
            n - 1
        ))?;
        let rows = stmt.query_map(rusqlite::params_from_iter(values.iter()), summary_row)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// Returns one game with its PGN, or `None` if the id doesn't exist.
    pub fn get(&self, id: i64) -> Result<Option<Game>> {
        let game = self
            .conn
            .query_row(
                "SELECT id, event, date, white, black, result, pgn FROM games WHERE id = ?1",
                params![id],
                |r| {
                    Ok(Game {
                        id: r.get(0)?,
                        event: r.get(1)?,
                        date: r.get(2)?,
                        white: r.get(3)?,
                        black: r.get(4)?,
                        result: r.get(5)?,
                        pgn: r.get(6)?,
                    })
                },
            )
            .optional()?;
        Ok(game)
    }

    /// Replaces a game's PGN. The previous version is kept for `undo`.
    pub fn update_pgn(&mut self, id: i64, pgn: &str) -> Result<()> {
        let pgn = single_game(pgn)?;
        let tx = self.conn.transaction()?;
        let old: String = tx
            .query_row("SELECT pgn FROM games WHERE id = ?1", params![id], |r| r.get(0))
            .optional()?
            .ok_or_else(|| Error::InvalidGame(format!("no game with id {id}")))?;
        tx.execute(
            "INSERT INTO revisions (game_id, pgn, saved_at) VALUES (?1, ?2, ?3)",
            params![id, old, now()],
        )?;
        write_game(&tx, id, &pgn)?;
        tx.commit()?;
        Ok(())
    }

    /// Restores the version saved by the last edit of a game. Returns `false`
    /// when the game has no earlier version.
    pub fn undo(&mut self, id: i64) -> Result<bool> {
        let tx = self.conn.transaction()?;
        let previous: Option<(i64, String)> = tx
            .query_row(
                "SELECT id, pgn FROM revisions WHERE game_id = ?1 ORDER BY id DESC LIMIT 1",
                params![id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        let Some((revision_id, pgn)) = previous else {
            return Ok(false);
        };
        write_game(&tx, id, &pgn)?;
        tx.execute("DELETE FROM revisions WHERE id = ?1", params![revision_id])?;
        tx.commit()?;
        Ok(true)
    }
}

fn summary_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<GameSummary> {
    Ok(GameSummary {
        id: r.get(0)?,
        event: r.get(1)?,
        site: r.get(2)?,
        date: r.get(3)?,
        round: r.get(4)?,
        white: r.get(5)?,
        black: r.get(6)?,
        result: r.get(7)?,
        eco: r.get(8)?,
        white_elo: r.get(9)?,
        black_elo: r.get(10)?,
        plies: r.get(11)?,
    })
}

fn write_game(tx: &Transaction<'_>, id: i64, pgn: &str) -> Result<()> {
    let h = Headers::from_pgn(pgn)?;
    let pgn = pgn.to_string();
    let mut values = h.insert_params(&pgn);
    values.push(&id);
    tx.execute(
        "UPDATE games SET event = ?1, site = ?2, date = ?3, round = ?4, white = ?5, black = ?6,
             result = ?7, eco = ?8, white_elo = ?9, black_elo = ?10, plies = ?11, pgn = ?12, updated_at = ?13
         WHERE id = ?14",
        values.as_slice(),
    )?;
    Ok(())
}

/// The fields stored as columns: header tags plus the length of the main line.
struct Headers {
    event: String,
    site: String,
    date: String,
    round: String,
    white: String,
    black: String,
    result: String,
    eco: String,
    white_elo: Option<i64>,
    black_elo: Option<i64>,
    plies: i64,
    updated_at: i64,
}

impl Headers {
    /// Reads the columns of a game, failing if its moves are not legal.
    fn from_pgn(pgn: &str) -> Result<Self> {
        let main_line = validate::main_line(pgn).map_err(Error::InvalidGame)?;
        let elo = |name| tag(pgn, name).trim().parse::<i64>().ok().filter(|&elo| elo > 0);
        Ok(Headers {
            event: tag(pgn, "Event"),
            site: tag(pgn, "Site"),
            date: tag(pgn, "Date"),
            round: tag(pgn, "Round"),
            white: tag(pgn, "White"),
            black: tag(pgn, "Black"),
            result: tag(pgn, "Result"),
            eco: tag(pgn, "ECO"),
            white_elo: elo("WhiteElo"),
            black_elo: elo("BlackElo"),
            plies: main_line.len() as i64 - 1,
            updated_at: now(),
        })
    }

    /// The values for `INSERT_GAME`, in its order.
    fn insert_params<'a>(&'a self, pgn: &'a String) -> Vec<&'a dyn rusqlite::ToSql> {
        vec![
            &self.event,
            &self.site,
            &self.date,
            &self.round,
            &self.white,
            &self.black,
            &self.result,
            &self.eco,
            &self.white_elo,
            &self.black_elo,
            &self.plies,
            pgn,
            &self.updated_at,
        ]
    }
}

/// Reads one header tag, such as `[White "Name"]`. Returns an empty string if absent.
fn tag(pgn: &str, name: &str) -> String {
    pgn.lines()
        .find_map(|line| {
            let rest = line
                .trim()
                .strip_prefix('[')?
                .strip_prefix(name)?
                .strip_prefix(' ')?
                .strip_prefix('"')?;
            Some(unescape(rest.strip_suffix("\"]")?))
        })
        .unwrap_or_default()
}

/// A tag value without PGN's escapes: `\"` is a quote and `\\` a backslash.
fn unescape(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut chars = value.chars();
    while let Some(c) = chars.next() {
        match (c, chars.clone().next()) {
            ('\\', Some(next @ ('"' | '\\'))) => {
                out.push(next);
                chars.next();
            }
            _ => out.push(c),
        }
    }
    out
}

/// Splits PGN text into games. A game is its tags followed by its moves; a tag line after the
/// moves starts the next game, whichever tag comes first.
fn split_games(text: &str) -> Result<Vec<String>> {
    let mut games: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut in_moves = false;
    for line in text.lines() {
        let is_tag = line.trim_start().starts_with('[');
        if is_tag && in_moves {
            games.push(current.trim().to_string());
            current.clear();
            in_moves = false;
        }
        if !is_tag && !line.trim().is_empty() {
            in_moves = true;
        }
        current.push_str(line);
        current.push('\n');
    }
    if !current.trim().is_empty() {
        games.push(current.trim().to_string());
    }
    for game in &games {
        if !game.starts_with('[') {
            let first = game.lines().next().unwrap_or("");
            return Err(Error::InvalidGame(format!("text before the first game's tags: {first}")));
        }
    }
    Ok(games)
}

/// Returns the text of the only game in `pgn`, or an error if there are none or several.
fn single_game(pgn: &str) -> Result<String> {
    let mut games = split_games(pgn)?;
    match games.len() {
        1 => Ok(games.remove(0)),
        n => Err(Error::InvalidGame(format!("expected one game, found {n}"))),
    }
}

/// Rejects a game whose movetext has illegal or unreadable moves.
fn check_game(pgn: &str) -> Result<()> {
    validate::check_movetext(pgn).map_err(Error::InvalidGame)
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    const GAME_1: &str = "[Event \"Open\"]\n[Site \"Prag\"]\n[Date \"2025.02.27\"]\n[Round \"1\"]\n[White \"Vykouk, Jan\"]\n[Black \"Lysenko, Yuri\"]\n[Result \"1-0\"]\n[ECO \"B03\"]\n\n1. e4 Nf6 2. e5 1-0\n";
    const GAME_2: &str = "[Event \"Club\"]\n[Site \"Bayern\"]\n[Date \"2023.06.14\"]\n[Round \"9\"]\n[White \"Rakhmangulova, Anastasiya\"]\n[Black \"Lysenko, Yuri\"]\n[Result \"0-1\"]\n\n1. d4 d5 0-1\n";

    #[test]
    fn import_and_search_by_player() {
        let mut store = Store::open_in_memory().unwrap();
        let text = format!("{GAME_1}\n{GAME_2}");
        assert_eq!(store.import_pgn(&text).unwrap(), 2);
        assert_eq!(store.count().unwrap(), 2);
        let found = store.search_player("Lysenko", Order::default(), 10, 0).unwrap();
        assert_eq!(found.len(), 2);
        assert_eq!(found[0].white, "Vykouk, Jan");
        assert_eq!(store.search_player("Nobody", Order::default(), 10, 0).unwrap().len(), 0);
        let second_page = store.search_player("Lysenko", Order::default(), 1, 1).unwrap();
        assert_eq!(second_page.len(), 1);
        assert_eq!(second_page[0].id, found[1].id);
    }

    #[test]
    fn edit_keeps_history_and_undo_restores() {
        let mut store = Store::open_in_memory().unwrap();
        store.import_pgn(GAME_1).unwrap();
        let id = store.list(Order::default(), 10, 0).unwrap()[0].id;

        let edited = GAME_1.replace("[Result \"1-0\"]", "[Result \"0-1\"]");
        store.update_pgn(id, &edited).unwrap();
        let game = store.get(id).unwrap().unwrap();
        assert_eq!(game.result, "0-1");
        assert_eq!(game.pgn, edited.trim());

        assert!(store.undo(id).unwrap());
        let game = store.get(id).unwrap().unwrap();
        assert_eq!(game.result, "1-0");
        assert!(!store.undo(id).unwrap());
    }

    #[test]
    fn add_game_returns_its_id() {
        let mut store = Store::open_in_memory().unwrap();
        store.import_pgn(GAME_1).unwrap();
        // As written by the app: variations, comments and symbols.
        let pgn = "[Event \"Training\"]\n[White \"Me\"]\n[Black \"?\"]\n[Result \"*\"]\n\n\
                   1. e4 $1 { Best by test } ( 1. d4 d5 $2 ( 1... Nf6 ) ) 1... e5 *\n";
        let id = store.add_game(pgn).unwrap();
        let game = store.get(id).unwrap().unwrap();
        assert_eq!(game.white, "Me");
        assert_eq!(store.count().unwrap(), 2);
        assert!(store.add_game(&format!("{GAME_1}\n{GAME_2}")).is_err());
        assert!(store.add_game("[White \"Me\"]\n\n1. e5 *").is_err());
    }

    #[test]
    fn export_writes_games_that_import_again() {
        let mut store = Store::open_in_memory().unwrap();
        store.import_pgn(&format!("{GAME_1}\n{GAME_2}")).unwrap();
        let ids: Vec<i64> = store.list(Order::default(), 10, 0).unwrap().iter().map(|g| g.id).collect();

        let mut all = Vec::new();
        assert_eq!(store.export_pgn(&mut all, None).unwrap(), 2);
        let mut copy = Store::open_in_memory().unwrap();
        assert_eq!(copy.import_pgn(&String::from_utf8(all).unwrap()).unwrap(), 2);
        assert_eq!(copy.get(ids[1]).unwrap().unwrap().pgn, GAME_2.trim());

        let mut one = Vec::new();
        assert_eq!(store.export_pgn(&mut one, Some(&ids[1..])).unwrap(), 1);
        assert_eq!(String::from_utf8(one).unwrap(), format!("{}\n\n", GAME_2.trim()));
    }

    #[test]
    fn export_to_a_file_replaces_it() {
        let mut store = Store::open_in_memory().unwrap();
        store.import_pgn(GAME_1).unwrap();
        let dir = temp_dir("export");
        let path = dir.join("out.pgn");
        fs::write(&path, "old").unwrap();
        assert_eq!(store.export_pgn_file(&path, None).unwrap(), 1);
        assert_eq!(fs::read_to_string(&path).unwrap(), format!("{}\n\n", GAME_1.trim()));
        assert!(!dir.join("out.pgn.tmp").exists());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn delete_removes_the_game_and_its_history() {
        let mut store = Store::open_in_memory().unwrap();
        store.import_pgn(&format!("{GAME_1}\n{GAME_2}")).unwrap();
        let id = store.list(Order::default(), 10, 0).unwrap()[0].id;
        store.update_pgn(id, &GAME_1.replace("1-0", "0-1")).unwrap();

        assert!(store.delete_game(id).unwrap());
        assert!(store.get(id).unwrap().is_none());
        assert_eq!(store.count().unwrap(), 1);
        assert!(!store.undo(id).unwrap());
        assert!(!store.delete_game(id).unwrap());
    }

    #[test]
    fn add_game_to_a_pgn_file_creates_or_appends() {
        let dir = temp_dir("add-to-pgn");
        let one = dir.join("one.pgn");
        add_game_to(&one, GAME_1, false).unwrap();
        assert_eq!(fs::read_to_string(&one).unwrap(), format!("{}\n\n", GAME_1.trim()));

        // An existing file without a trailing newline, with a database beside it from opening it.
        let both = dir.join("both.pgn");
        fs::write(&both, GAME_1.trim()).unwrap();
        let crlf = dir.join("crlf.pgn");
        fs::write(&crlf, GAME_1.replace('\n', "\r\n")).unwrap();
        add_game_to(&crlf, GAME_2, false).unwrap();
        let crlf_text = fs::read_to_string(&crlf).unwrap();
        assert!(crlf_text.contains("1-0\r\n\n[Event"));
        assert_eq!(Store::open_in_memory().unwrap().import_pgn(&crlf_text).unwrap(), 2);
        open_path(&both).unwrap();
        add_game_to(&both, GAME_2, false).unwrap();
        let text = fs::read_to_string(&both).unwrap();
        assert_eq!(text, format!("{}\n\n{}\n\n", GAME_1.trim(), GAME_2.trim()));
        assert_eq!(Store::open(&dir.join("both.sqlite")).unwrap().count().unwrap(), 2);
        assert_eq!(Store::open_in_memory().unwrap().import_pgn(&text).unwrap(), 2);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn add_game_to_a_database_creates_it_and_refuses_other_files() {
        let dir = temp_dir("add-to-db");
        let db = dir.join("mine.sqlite");
        add_game_to(&db, GAME_1, false).unwrap();
        add_game_to(&db, GAME_2, false).unwrap();
        assert_eq!(Store::open(&db).unwrap().count().unwrap(), 2);
        assert!(add_game_to(&dir.join("base.cbh"), GAME_1, false).is_err());
        assert!(!dir.join("base.cbh").exists());
        assert!(add_game_to(&dir.join("bad.pgn"), "[White \"Me\"]\n\n1. e5 *", false).is_err());
        assert!(!dir.join("bad.pgn").exists());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn lists_elo_and_moves_and_sorts_by_any_column() {
        let mut store = Store::open_in_memory().unwrap();
        let rated = GAME_2.replace("[Result \"0-1\"]", "[Result \"0-1\"]\n[WhiteElo \"2100\"]\n[BlackElo \"?\"]");
        store.import_pgn(&format!("{GAME_1}\n{rated}")).unwrap();

        let games = store.list(Order::default(), 10, 0).unwrap();
        assert_eq!((games[0].plies, games[0].white_elo, games[0].eco.as_str()), (Some(3), None, "B03"));
        assert_eq!((games[1].plies, games[1].white_elo, games[1].black_elo), (Some(2), Some(2100), None));

        let by = |column, descending| {
            let order = Order { column, descending };
            store.list(order, 10, 0).unwrap().iter().map(|g| g.white.clone()).collect::<Vec<_>>()
        };
        assert_eq!(by(SortColumn::White, false), ["Rakhmangulova, Anastasiya", "Vykouk, Jan"]);
        assert_eq!(by(SortColumn::Date, true), ["Vykouk, Jan", "Rakhmangulova, Anastasiya"]);
        // Games without an Elo come last, ascending or descending.
        assert_eq!(by(SortColumn::WhiteElo, false), ["Rakhmangulova, Anastasiya", "Vykouk, Jan"]);
        assert_eq!(by(SortColumn::WhiteElo, true), ["Rakhmangulova, Anastasiya", "Vykouk, Jan"]);
        let found = store.search_player("Lysenko", Order { column: SortColumn::Plies, descending: true }, 10, 0);
        assert_eq!(found.unwrap()[0].plies, Some(3));
    }

    #[test]
    fn search_matches_every_field_that_is_set() {
        let mut store = Store::open_in_memory().unwrap();
        let rated = GAME_2.replace("[Result \"0-1\"]", "[Result \"0-1\"]\n[ECO \"D02\"]\n[WhiteElo \"2100\"]");
        store.import_pgn(&format!("{GAME_1}\n{rated}")).unwrap();
        let find = |filter: Filter| -> Vec<String> {
            let found = store.search(&filter, Order::default(), 10, 0).unwrap();
            found.into_iter().map(|g| g.white).collect()
        };
        let (vykouk, rakh) = ("Vykouk, Jan".to_string(), "Rakhmangulova, Anastasiya".to_string());

        assert_eq!(find(Filter::default()).len(), 2);
        assert_eq!(find(Filter { white: "vykouk".into(), ..Filter::default() }), [vykouk.clone()]);
        // Lysenko had Black in both games; with colours kept, searching him as White finds none.
        assert!(find(Filter { white: "Lysenko".into(), ..Filter::default() }).is_empty());
        assert_eq!(find(Filter { white: "Lysenko".into(), ignore_colour: true, ..Filter::default() }).len(), 2);
        assert_eq!(
            find(Filter { white: "Lysenko".into(), black: "Vykouk".into(), ignore_colour: true, ..Filter::default() }),
            [vykouk.clone()]
        );
        assert_eq!(find(Filter { result: "0-1".into(), ..Filter::default() }), [rakh.clone()]);
        assert_eq!(find(Filter { eco_from: "b".into(), eco_to: "B0".into(), ..Filter::default() }), [vykouk.clone()]);
        assert_eq!(find(Filter { eco_from: "C00".into(), ..Filter::default() }), [rakh.clone()]);
        assert_eq!(find(Filter { date_from: "2024".into(), ..Filter::default() }), [vykouk.clone()]);
        assert_eq!(find(Filter { date_to: "2023.06".into(), ..Filter::default() }), [rakh.clone()]);
        assert_eq!(find(Filter { min_white_elo: Some(2000), ..Filter::default() }), [rakh.clone()]);
        assert_eq!(find(Filter { event: "club".into(), site: "bay".into(), ..Filter::default() }), [rakh.clone()]);
        assert!(find(Filter { event: "club".into(), result: "1-0".into(), ..Filter::default() }).is_empty());
        // LIKE wildcards in the text are taken literally.
        assert!(find(Filter { white: "%".into(), ..Filter::default() }).is_empty());
    }

    #[test]
    fn game_count_reads_files_without_changing_them() {
        let dir = temp_dir("count");
        let pgn = dir.join("games.pgn");
        fs::write(&pgn, format!("\u{feff}{GAME_1}\n{GAME_2}")).unwrap();
        assert_eq!(game_count(&pgn).unwrap(), Some(2));
        assert!(!dir.join("games.sqlite").exists());

        // Once opened, the PGN file's database counts, edits included.
        let mut opened = open_path(&pgn).unwrap();
        opened.store.add_game(GAME_1).unwrap();
        drop(opened);
        assert_eq!(game_count(&pgn).unwrap(), Some(3));
        assert_eq!(game_count(&dir.join("games.sqlite")).unwrap(), Some(3));

        assert_eq!(game_count(&dir.join("missing.sqlite")).unwrap(), None);
        assert!(!dir.join("missing.sqlite").exists());
        fs::write(dir.join("notes.sqlite"), "These are notes, not a SQLite database file.").unwrap();
        assert!(game_count(&dir.join("notes.sqlite")).is_err());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn an_older_database_gets_the_new_columns_filled_in() {
        let dir = temp_dir("migrate");
        let path = dir.join("old.sqlite");
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(
                "CREATE TABLE games (id INTEGER PRIMARY KEY, event TEXT NOT NULL, site TEXT NOT NULL,
                     date TEXT NOT NULL, round TEXT NOT NULL, white TEXT NOT NULL, black TEXT NOT NULL,
                     result TEXT NOT NULL, eco TEXT NOT NULL, pgn TEXT NOT NULL, updated_at INTEGER NOT NULL);",
            )
            .unwrap();
            let pgn = GAME_1.replace("[ECO \"B03\"]", "[ECO \"B03\"]\n[WhiteElo \"2478\"]");
            conn.execute(
                "INSERT INTO games VALUES (1, 'Open', 'Prag', '2025.02.27', '1', 'Vykouk, Jan', 'Lysenko, Yuri', '1-0', 'B03', ?1, 0)",
                params![pgn],
            )
            .unwrap();
        }
        let store = Store::open(&path).unwrap();
        let game = &store.list(Order::default(), 10, 0).unwrap()[0];
        assert_eq!((game.white_elo, game.plies), (Some(2478), Some(3)));
        drop(store);
        // Opening it again leaves it as it is.
        assert_eq!(Store::open(&path).unwrap().count().unwrap(), 1);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn update_rejects_more_than_one_game() {
        let mut store = Store::open_in_memory().unwrap();
        store.import_pgn(GAME_1).unwrap();
        let id = store.list(Order::default(), 10, 0).unwrap()[0].id;
        let two = format!("{GAME_1}\n{GAME_2}");
        assert!(store.update_pgn(id, &two).is_err());
    }

    /// A fresh, empty directory for one test.
    #[test]
    fn a_batch_leaves_out_illegal_games_and_keeps_the_others() {
        let mut store = Store::open_in_memory().unwrap();
        store.begin_bulk_import().unwrap();
        let good = "[White \"A\"]\n[Black \"B\"]\n[Result \"*\"]\n\n1. e4 *".to_string();
        let illegal = "[White \"C\"]\n[Black \"D\"]\n[Result \"*\"]\n\n1. e5 *".to_string();
        let counts = store.import_batch(&[good.clone(), illegal, good]).unwrap();
        assert_eq!(counts, BatchCounts { added: 2, skipped: 1 });
        store.finish_bulk_import().unwrap();
        assert_eq!(store.count().unwrap(), 2);
        assert_eq!(store.search_player("A", Order::default(), 10, 0).unwrap().len(), 2);
        let indexes: i64 = store
            .conn
            .query_row("SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name LIKE 'games_%'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(indexes, 2);
    }

    #[test]
    fn the_new_errors_read_well() {
        assert_eq!(Error::Cancelled.to_string(), "cancelled");
        assert_eq!(Error::ChessBase("could not read x".into()).to_string(), "could not read x");
    }

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("chessvault-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn opening_a_pgn_creates_a_database_beside_it_once() {
        let dir = temp_dir("open-pgn");
        let pgn = dir.join("games.pgn");
        fs::write(&pgn, format!("{GAME_1}\n{GAME_2}")).unwrap();

        let first = open_path(&pgn).unwrap();
        assert_eq!(first.path, dir.join("games.sqlite"));
        assert_eq!(first.imported, 2);
        drop(first);

        let again = open_path(&pgn).unwrap();
        assert_eq!(again.imported, 0);
        assert_eq!(again.store.count().unwrap(), 2);
        drop(again);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_pgn_that_fails_to_import_leaves_no_database() {
        let dir = temp_dir("bad-pgn");
        let pgn = dir.join("bad.pgn");
        fs::write(&pgn, "[Event \"Bad\"]\n\n1. e4 e5 2. Ke3 *\n").unwrap();
        assert!(open_path(&pgn).is_err());
        assert!(!dir.join("bad.sqlite").exists());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_file_that_is_not_a_database_gets_a_clear_error() {
        let dir = temp_dir("not-db");
        let file = dir.join("notes.txt");
        fs::write(&file, "These are notes, not a SQLite database file.").unwrap();
        match Store::open(&file) {
            Err(Error::NotADatabase(path)) => assert_eq!(path, file),
            other => panic!("unexpected result: {:?}", other.err()),
        }
        fs::remove_dir_all(&dir).unwrap();
    }

    // Review findings of 2026-11-07, each reproduced before it was fixed.

    #[test]
    fn games_may_start_with_any_tag_and_castle_with_zeros() {
        let mut store = Store::open_in_memory().unwrap();
        let text = "[Site \"x\"]\n[Event \"a\"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. 0-0 Nf6 *\n\n\
                    [White \"b\"]\n[Event \"b\"]\n\n1. d4 d5 2. Nc3 Nc6 3. Bf4 Bf5 4. Qd2 Qd7 5. 0-0-0 0-0-0 *\n";
        assert_eq!(store.import_pgn(text).unwrap(), 2);
        let list = store.list(Order::default(), 10, 0).unwrap();
        assert_eq!((list[0].event.as_str(), list[0].plies), ("a", Some(8)));
        assert_eq!((list[1].white.as_str(), list[1].plies), ("b", Some(10)));
    }

    #[test]
    fn a_missing_database_is_not_created_by_opening_it() {
        let dir = temp_dir("missing");
        let missing = dir.join("moved.sqlite");
        assert!(matches!(open_path(&missing), Err(Error::NotFound(_))));
        assert!(!missing.exists());
        assert!(matches!(open_path(&dir.join("moved.pgn")), Err(Error::NotFound(_))));
        assert!(!dir.join("moved.sqlite").exists());

        // Creating one is a separate, deliberate step.
        let created = create_database(&missing).unwrap();
        assert_eq!(created.store.count().unwrap(), 0);
        assert!(missing.exists());
        assert!(matches!(create_database(&dir.join("x.cbh")), Err(Error::WrongFileType(..))));
        drop(created);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn deleting_every_game_does_not_import_the_pgn_again() {
        let dir = temp_dir("reimport");
        let pgn = dir.join("club.pgn");
        fs::write(&pgn, format!("{GAME_1}\n{GAME_2}")).unwrap();
        let mut opened = open_path(&pgn).unwrap();
        assert_eq!(opened.imported, 2);
        for game in opened.store.list(Order::default(), 10, 0).unwrap() {
            opened.store.delete_game(game.id).unwrap();
        }
        drop(opened);
        let again = open_path(&pgn).unwrap();
        assert_eq!((again.imported, again.store.count().unwrap()), (0, 0));
        drop(again);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn export_only_writes_pgn_files() {
        let mut store = Store::open_in_memory().unwrap();
        store.import_pgn(GAME_1).unwrap();
        let dir = temp_dir("export-type");
        for name in ["Big.cbh", "My Games.sqlite", "notes.txt"] {
            let target = dir.join(name);
            fs::write(&target, "keep me").unwrap();
            assert!(matches!(store.export_pgn_file(&target, None), Err(Error::WrongFileType(..))));
            assert_eq!(fs::read_to_string(&target).unwrap(), "keep me");
        }
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_new_file_replaces_an_old_pgn_but_never_a_database() {
        let dir = temp_dir("replace");
        let pgn = dir.join("one.pgn");
        fs::write(&pgn, GAME_2).unwrap();
        add_game_to(&pgn, GAME_1, true).unwrap();
        assert_eq!(fs::read_to_string(&pgn).unwrap(), format!("{}\n\n", GAME_1.trim()));

        let db = dir.join("mine.sqlite");
        add_game_to(&db, GAME_1, false).unwrap();
        assert!(add_game_to(&db, GAME_2, true).is_err());
        assert_eq!(Store::open(&db).unwrap().count().unwrap(), 1);
        let beside = dir.join("mine.pgn");
        fs::write(&beside, GAME_2).unwrap();
        assert!(add_game_to(&beside, GAME_1, true).is_err(), "its database would no longer match");
        assert_eq!(fs::read_to_string(&beside).unwrap(), GAME_2);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn unknown_values_sort_last_like_empty_ones() {
        let mut store = Store::open_in_memory().unwrap();
        let unknown = GAME_2.replace("Rakhmangulova, Anastasiya", "?").replace("2023.06.14", "????.??.??");
        store.import_pgn(&format!("{GAME_1}\n{unknown}")).unwrap();
        for column in [SortColumn::White, SortColumn::Date] {
            for descending in [false, true] {
                let list = store.list(Order { column, descending }, 10, 0).unwrap();
                assert_eq!(list[1].white, "?", "{column:?} descending={descending}");
            }
        }
    }

    #[test]
    fn tag_values_lose_their_escapes() {
        assert_eq!(tag("[White \"O\\\"Brien, Pat\"]\n", "White"), "O\"Brien, Pat");
        assert_eq!(tag("[Site \"C:\\\\Club\"]\n", "Site"), "C:\\Club");
        assert_eq!(tag("[Site \"a\\b\"]\n", "Site"), "a\\b", "a lone backslash stays");
        assert_eq!(unescape("end\\"), "end\\");
    }

    #[test]
    fn import_rejects_text_before_the_first_game() {
        let mut store = Store::open_in_memory().unwrap();
        let text = format!("junk\n{GAME_1}");
        assert!(store.import_pgn(&text).is_err());
        assert_eq!(store.count().unwrap(), 0);
    }
}
