//! Converts ChessBase databases to PGN, using the `cbvault` reader.

use std::io::Write;
use std::path::Path;

use cbvault::pgn;

/// What a conversion wrote.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ConvertStats {
    /// Games written to the PGN output.
    pub games: u64,
    /// Records that could not be decoded and were left out.
    pub failures: u64,
}

/// Converts the ChessBase database at `database` to PGN, written to `out`.
///
/// `database` is the base path without an extension, for example
/// `Downloads/MyPGNDownloads` for `MyPGNDownloads.cbh` and its sidecar files.
/// `threads` of 0 or 1 runs on the calling thread.
pub fn convert_to_pgn(
    database: &Path,
    out: &mut impl Write,
    threads: usize,
) -> Result<ConvertStats, Box<dyn std::error::Error>> {
    let base = database.with_extension("");
    let stats = pgn::export_parallel(&base, out, threads, pgn::DEFAULT_BATCH, 50)?;
    Ok(ConvertStats {
        games: stats.games,
        failures: stats.failures,
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
    }
}
