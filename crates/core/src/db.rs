//! Game storage in SQLite. Games are kept as PGN with indexed headers, and
//! every edit saves the previous version so it can be undone.

use std::fmt;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension, Transaction};

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
    pgn        TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS revisions (
    id       INTEGER PRIMARY KEY,
    game_id  INTEGER NOT NULL,
    pgn      TEXT NOT NULL,
    saved_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS games_white ON games(white);
CREATE INDEX IF NOT EXISTS games_black ON games(black);
CREATE INDEX IF NOT EXISTS revisions_game ON revisions(game_id);
";

const INSERT_GAME: &str = "INSERT INTO games (event, site, date, round, white, black, result, eco, pgn, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)";

/// Errors from the store.
#[derive(Debug)]
pub enum Error {
    Sql(rusqlite::Error),
    InvalidGame(String),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Sql(e) => write!(f, "database error: {e}"),
            Error::InvalidGame(msg) => write!(f, "invalid game: {msg}"),
        }
    }
}

impl std::error::Error for Error {}

impl From<rusqlite::Error> for Error {
    fn from(e: rusqlite::Error) -> Self {
        Error::Sql(e)
    }
}

pub type Result<T> = std::result::Result<T, Error>;

/// A game as shown in lists and search results.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct GameSummary {
    pub id: i64,
    pub event: String,
    pub date: String,
    pub white: String,
    pub black: String,
    pub result: String,
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
        Self::from_connection(Connection::open(path)?)
    }

    /// Opens a throwaway in-memory database, for tests.
    pub fn open_in_memory() -> Result<Self> {
        Self::from_connection(Connection::open_in_memory()?)
    }

    fn from_connection(conn: Connection) -> Result<Self> {
        conn.execute_batch(SCHEMA)?;
        Ok(Store { conn })
    }

    /// Imports every game in `text`. Either all games are imported or none are.
    pub fn import_pgn(&mut self, text: &str) -> Result<usize> {
        let games = split_games(text.trim_start_matches('\u{feff}'))?;
        let tx = self.conn.transaction()?;
        for pgn in &games {
            check_game(pgn)?;
            let h = Headers::from_pgn(pgn);
            tx.execute(
                INSERT_GAME,
                params![h.event, h.site, h.date, h.round, h.white, h.black, h.result, h.eco, pgn, now()],
            )?;
        }
        tx.commit()?;
        Ok(games.len())
    }

    /// Number of games in the database.
    pub fn count(&self) -> Result<i64> {
        Ok(self.conn.query_row("SELECT COUNT(*) FROM games", [], |r| r.get(0))?)
    }

    /// Lists games in the order they were imported.
    pub fn list(&self, limit: i64, offset: i64) -> Result<Vec<GameSummary>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, event, date, white, black, result FROM games ORDER BY id LIMIT ?1 OFFSET ?2",
        )?;
        let rows = stmt.query_map(params![limit, offset], summary_row)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// Finds games where `name` appears as either player.
    pub fn search_player(&self, name: &str, limit: i64) -> Result<Vec<GameSummary>> {
        let pattern = format!("%{name}%");
        let mut stmt = self.conn.prepare(
            "SELECT id, event, date, white, black, result FROM games
             WHERE white LIKE ?1 OR black LIKE ?1 ORDER BY id LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![pattern, limit], summary_row)?;
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
        check_game(&pgn)?;
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
        date: r.get(2)?,
        white: r.get(3)?,
        black: r.get(4)?,
        result: r.get(5)?,
    })
}

fn write_game(tx: &Transaction<'_>, id: i64, pgn: &str) -> Result<()> {
    let h = Headers::from_pgn(pgn);
    tx.execute(
        "UPDATE games SET event = ?1, site = ?2, date = ?3, round = ?4, white = ?5,
             black = ?6, result = ?7, eco = ?8, pgn = ?9, updated_at = ?10
         WHERE id = ?11",
        params![h.event, h.site, h.date, h.round, h.white, h.black, h.result, h.eco, pgn, now(), id],
    )?;
    Ok(())
}

/// The header fields stored as columns.
struct Headers {
    event: String,
    site: String,
    date: String,
    round: String,
    white: String,
    black: String,
    result: String,
    eco: String,
}

impl Headers {
    fn from_pgn(pgn: &str) -> Self {
        Headers {
            event: tag(pgn, "Event"),
            site: tag(pgn, "Site"),
            date: tag(pgn, "Date"),
            round: tag(pgn, "Round"),
            white: tag(pgn, "White"),
            black: tag(pgn, "Black"),
            result: tag(pgn, "Result"),
            eco: tag(pgn, "ECO"),
        }
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
            Some(rest.strip_suffix("\"]")?.to_string())
        })
        .unwrap_or_default()
}

/// Splits PGN text into games. Each game starts at an `[Event` tag.
fn split_games(text: &str) -> Result<Vec<String>> {
    let mut games: Vec<String> = Vec::new();
    let mut current = String::new();
    for line in text.lines() {
        if line.starts_with("[Event ") && !current.trim().is_empty() {
            games.push(current.trim().to_string());
            current.clear();
        }
        current.push_str(line);
        current.push('\n');
    }
    if !current.trim().is_empty() {
        games.push(current.trim().to_string());
    }
    for game in &games {
        if !game.starts_with("[Event ") {
            let first = game.lines().next().unwrap_or("");
            return Err(Error::InvalidGame(format!(
                "game does not start with an [Event] tag: {first}"
            )));
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
        let found = store.search_player("Lysenko", 10).unwrap();
        assert_eq!(found.len(), 2);
        assert_eq!(found[0].white, "Vykouk, Jan");
        assert_eq!(store.search_player("Nobody", 10).unwrap().len(), 0);
    }

    #[test]
    fn edit_keeps_history_and_undo_restores() {
        let mut store = Store::open_in_memory().unwrap();
        store.import_pgn(GAME_1).unwrap();
        let id = store.list(10, 0).unwrap()[0].id;

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
    fn update_rejects_more_than_one_game() {
        let mut store = Store::open_in_memory().unwrap();
        store.import_pgn(GAME_1).unwrap();
        let id = store.list(10, 0).unwrap()[0].id;
        let two = format!("{GAME_1}\n{GAME_2}");
        assert!(store.update_pgn(id, &two).is_err());
    }

    #[test]
    fn import_rejects_text_before_the_first_game() {
        let mut store = Store::open_in_memory().unwrap();
        let text = format!("junk\n{GAME_1}");
        assert!(store.import_pgn(&text).is_err());
        assert_eq!(store.count().unwrap(), 0);
    }
}
