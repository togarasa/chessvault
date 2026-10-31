//! The Lichess opening explorer. Lichess requires a personal API token for the
//! explorer; a token with no scopes is enough.

use std::fmt;

use serde::{Deserialize, Serialize};

const EXPLORER: &str = "https://explorer.lichess.org";

/// Which games the explorer counts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Database {
    /// Over-the-board games between masters.
    Masters,
    /// Rated games played on Lichess.
    Lichess,
}

/// Statistics for one move from the explored position.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplorerMove {
    pub uci: String,
    pub san: String,
    pub white: u64,
    pub draws: u64,
    pub black: u64,
    #[serde(default)]
    pub average_rating: Option<u32>,
}

/// The opening the explored position belongs to.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
pub struct Opening {
    pub eco: String,
    pub name: String,
}

/// Results for one position.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
pub struct Explorer {
    pub white: u64,
    pub draws: u64,
    pub black: u64,
    pub moves: Vec<ExplorerMove>,
    #[serde(default)]
    pub opening: Option<Opening>,
}

/// Errors from the explorer.
#[derive(Debug)]
pub enum Error {
    MissingToken,
    Unauthorized,
    RateLimited,
    Status(u16),
    Http(reqwest::Error),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::MissingToken => write!(f, "the Lichess explorer needs a token; add one in the explorer panel"),
            Error::Unauthorized => write!(f, "Lichess rejected the token; check or replace it"),
            Error::RateLimited => write!(f, "Lichess is limiting requests; wait a minute and try again"),
            Error::Status(code) => write!(f, "Lichess returned HTTP {code}"),
            Error::Http(e) => write!(f, "could not reach Lichess: {e}"),
        }
    }
}

impl std::error::Error for Error {}

/// A Lichess client. Create one and reuse it, so connections are shared.
#[derive(Clone, Default)]
pub struct Client {
    http: reqwest::Client,
}

impl Client {
    pub fn new() -> Self {
        Self::default()
    }

    /// Looks up `fen` in the explorer's `database`, using the personal `token`.
    pub async fn explore(&self, database: Database, fen: &str, token: &str) -> Result<Explorer, Error> {
        let token = token.trim();
        if token.is_empty() {
            return Err(Error::MissingToken);
        }
        let path = match database {
            Database::Masters => "masters",
            Database::Lichess => "lichess",
        };
        let mut request = self
            .http
            .get(format!("{EXPLORER}/{path}"))
            .bearer_auth(token)
            .query(&[("fen", fen), ("moves", "12"), ("topGames", "0")]);
        if database == Database::Lichess {
            request = request.query(&[
                ("recentGames", "0"),
                ("speeds", "blitz,rapid,classical"),
                ("ratings", "1800,2000,2200,2500"),
            ]);
        }
        let response = request.send().await.map_err(Error::Http)?;
        match response.status().as_u16() {
            200 => response.json().await.map_err(Error::Http),
            401 => Err(Error::Unauthorized),
            429 => Err(Error::RateLimited),
            code => Err(Error::Status(code)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_an_explorer_response() {
        let json = r#"{
            "white": 1212, "draws": 1690, "black": 898,
            "moves": [
                {"uci": "e2e4", "san": "e4", "averageRating": 2400, "white": 500, "draws": 600, "black": 300, "game": null},
                {"uci": "d2d4", "san": "d4", "white": 400, "draws": 500, "black": 200}
            ],
            "topGames": [],
            "opening": {"eco": "A00", "name": "Start position"}
        }"#;
        let explorer: Explorer = serde_json::from_str(json).unwrap();
        assert_eq!(explorer.moves.len(), 2);
        assert_eq!(explorer.moves[0].san, "e4");
        assert_eq!(explorer.moves[0].average_rating, Some(2400));
        assert_eq!(explorer.moves[1].average_rating, None);
        assert_eq!(explorer.opening.unwrap().eco, "A00");
    }

    /// Runs only when asked, since it needs the network: `cargo test -- --ignored`.
    #[tokio::test]
    #[ignore = "contacts explorer.lichess.org"]
    async fn a_fake_token_is_rejected_by_lichess() {
        let start = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
        let client = Client::new();
        let result = client.explore(Database::Masters, start, "not-a-real-token").await;
        assert!(matches!(result, Err(Error::Unauthorized)), "{result:?}");
    }

    #[tokio::test]
    async fn an_empty_token_fails_without_a_request() {
        let result = Client::new().explore(Database::Masters, "", "  ").await;
        assert!(matches!(result, Err(Error::MissingToken)), "{result:?}");
    }

    #[test]
    fn a_missing_opening_is_none() {
        let json = r#"{"white": 0, "draws": 0, "black": 0, "moves": [], "opening": null}"#;
        let explorer: Explorer = serde_json::from_str(json).unwrap();
        assert!(explorer.opening.is_none());
    }
}
