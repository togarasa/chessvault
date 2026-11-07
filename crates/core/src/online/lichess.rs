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
#[derive(Clone)]
pub struct Client {
    http: reqwest::Client,
    /// The explorer's address; tests point it at a local server.
    explorer: String,
}

impl Default for Client {
    fn default() -> Self {
        Client { http: reqwest::Client::default(), explorer: EXPLORER.to_string() }
    }
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
            .get(format!("{}/{path}", self.explorer))
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

    use std::io::{BufRead, BufReader, Write};
    use std::net::TcpListener;
    use std::sync::mpsc;
    use std::thread;

    /// A one-request HTTP server on this computer that answers with `status` and `body`.
    /// Returns the client pointed at it and the request it received (request line and headers).
    fn local_explorer(status: &str, body: &'static str) -> (Client, mpsc::Receiver<Vec<String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let status = status.to_string();
        let (tx, rx) = mpsc::channel();
        thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let request: Vec<String> = BufReader::new(stream.try_clone().unwrap())
                .lines()
                .map_while(Result::ok)
                .take_while(|line| !line.is_empty())
                .collect();
            let reply = format!(
                "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            stream.write_all(reply.as_bytes()).unwrap();
            tx.send(request).unwrap();
        });
        let client = Client { explorer: format!("http://{address}"), ..Client::default() };
        (client, rx)
    }

    const START: &str = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

    #[tokio::test]
    async fn asks_the_masters_database_with_the_token() {
        let body = r#"{"white": 3, "draws": 2, "black": 1, "moves": [{"uci": "e2e4", "san": "e4", "white": 3, "draws": 2, "black": 1}]}"#;
        let (client, request) = local_explorer("200 OK", body);
        let explorer = client.explore(Database::Masters, START, " my-token ").await.unwrap();
        assert_eq!(explorer.moves[0].san, "e4");

        let request = request.recv().unwrap();
        assert!(request[0].starts_with("GET /masters?fen=rnbqkbnr%2Fpppppppp"), "{}", request[0]);
        assert!(request[0].contains("moves=12") && request[0].contains("topGames=0"));
        assert!(!request[0].contains("speeds="), "masters has no speed filter");
        assert!(request.iter().any(|h| h.eq_ignore_ascii_case("authorization: Bearer my-token")), "{request:?}");
    }

    #[tokio::test]
    async fn asks_lichess_games_for_rated_blitz_and_slower() {
        let (client, request) = local_explorer("200 OK", r#"{"white": 0, "draws": 0, "black": 0, "moves": []}"#);
        client.explore(Database::Lichess, START, "token").await.unwrap();
        let line = &request.recv().unwrap()[0];
        assert!(line.starts_with("GET /lichess?"), "{line}");
        assert!(line.contains("speeds=blitz%2Crapid%2Cclassical") && line.contains("ratings=1800%2C2000%2C2200%2C2500"), "{line}");
        assert!(line.contains("recentGames=0"));
    }

    #[tokio::test]
    async fn turns_error_replies_into_clear_errors() {
        for (status, expected) in [
            ("401 Unauthorized", "Lichess rejected the token; check or replace it"),
            ("429 Too Many Requests", "Lichess is limiting requests; wait a minute and try again"),
            ("503 Service Unavailable", "Lichess returned HTTP 503"),
        ] {
            let (client, _request) = local_explorer(status, "{}");
            let error = client.explore(Database::Masters, START, "token").await.unwrap_err();
            assert_eq!(error.to_string(), expected);
        }
    }

    #[tokio::test]
    async fn a_reply_that_is_not_explorer_data_is_an_error() {
        let (client, _request) = local_explorer("200 OK", "not json");
        let error = client.explore(Database::Masters, START, "token").await.unwrap_err();
        assert!(matches!(error, Error::Http(_)), "{error:?}");
    }

    #[tokio::test]
    async fn an_unreachable_server_is_an_error() {
        // Bind and drop a listener to get a port nothing listens on.
        let address = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap();
        let client = Client { explorer: format!("http://{address}"), ..Client::default() };
        let error = client.explore(Database::Masters, START, "token").await.unwrap_err();
        assert!(error.to_string().starts_with("could not reach Lichess"), "{error}");
        assert_eq!(Error::MissingToken.to_string(), "the Lichess explorer needs a token; add one in the explorer panel");
    }

    #[test]
    fn a_missing_opening_is_none() {
        let json = r#"{"white": 0, "draws": 0, "black": 0, "moves": [], "opening": null}"#;
        let explorer: Explorer = serde_json::from_str(json).unwrap();
        assert!(explorer.opening.is_none());
    }
}
