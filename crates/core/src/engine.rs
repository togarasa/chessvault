//! Runs a UCI chess engine such as Stockfish and reports its analysis as lines
//! of SAN moves, with scores from White's point of view.

use std::io::{self, BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;

use serde::Serialize;
use shakmaty::{fen::Fen, san::SanPlus, uci::UciMove, CastlingMode, Chess, Color, Position};

/// How many lines the engine reports for each position.
pub const LINES: u32 = 3;

/// An engine evaluation, from White's point of view.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", content = "value", rename_all = "lowercase")]
pub enum Score {
    /// Centipawns: positive is better for White.
    Cp(i32),
    /// Mate in this many moves: positive means White mates.
    Mate(i32),
}

impl Score {
    fn flipped(self) -> Score {
        match self {
            Score::Cp(v) => Score::Cp(-v),
            Score::Mate(v) => Score::Mate(-v),
        }
    }
}

/// One line of engine analysis.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct EngineLine {
    /// The analyzed position, so late lines from an old position can be told apart.
    pub fen: String,
    /// The line's rank, 1 for the best.
    pub multipv: u32,
    pub depth: u32,
    pub score: Score,
    /// The principal variation in SAN, starting from the analyzed position.
    pub moves: Vec<String>,
}

/// What the output thread needs to know about the search.
struct Search {
    /// The position being analyzed.
    fen: Option<String>,
    /// Whether a search is running.
    running: bool,
    /// `bestmove` replies still due from searches that were stopped. Output
    /// before they arrive belongs to an old position and is ignored.
    stale: u32,
}

fn lock(search: &Mutex<Search>) -> MutexGuard<'_, Search> {
    search.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// A running UCI engine. Dropping it shuts the engine down.
pub struct Engine {
    child: Child,
    stdin: ChildStdin,
    search: Arc<Mutex<Search>>,
}

impl Engine {
    /// Starts the engine at `path`. `on_line` is called on a background thread
    /// for each analysis line of the current position.
    pub fn start(path: &Path, mut on_line: impl FnMut(EngineLine) + Send + 'static) -> io::Result<Engine> {
        let mut child = Command::new(path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()?;
        let stdin = child.stdin.take().expect("stdin is piped");
        let stdout = child.stdout.take().expect("stdout is piped");
        let search = Arc::new(Mutex::new(Search { fen: None, running: false, stale: 0 }));

        let shared = Arc::clone(&search);
        thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else { break };
                if line.starts_with("bestmove") {
                    let mut s = lock(&shared);
                    if s.stale > 0 {
                        s.stale -= 1;
                    } else {
                        // The current search ended on its own, e.g. at checkmate.
                        s.running = false;
                    }
                    continue;
                }
                let Some(info) = parse_info(&line) else { continue };
                let fen = {
                    let s = lock(&shared);
                    if s.stale > 0 {
                        continue;
                    }
                    s.fen.clone()
                };
                if let Some(engine_line) = fen.and_then(|fen| info.into_line(&fen)) {
                    on_line(engine_line);
                }
            }
        });

        let mut engine = Engine { child, stdin, search };
        engine.send("uci")?;
        engine.send(&format!("setoption name MultiPV value {LINES}"))?;
        engine.send("isready")?;
        Ok(engine)
    }

    /// Analyzes `fen` until stopped, replacing any search in progress.
    pub fn analyze(&mut self, fen: &str) -> io::Result<()> {
        let was_running = {
            let mut s = lock(&self.search);
            let was_running = s.running;
            if was_running {
                s.stale += 1;
            }
            s.fen = Some(fen.to_string());
            s.running = true;
            was_running
        };
        if was_running {
            self.send("stop")?;
        }
        self.send(&format!("position fen {fen}"))?;
        self.send("go infinite")
    }

    /// Stops the current search, if any.
    pub fn stop(&mut self) -> io::Result<()> {
        let was_running = {
            let mut s = lock(&self.search);
            let was_running = s.running;
            if was_running {
                s.stale += 1;
                s.running = false;
            }
            was_running
        };
        if was_running {
            self.send("stop")?;
        }
        Ok(())
    }

    fn send(&mut self, command: &str) -> io::Result<()> {
        writeln!(self.stdin, "{command}")?;
        self.stdin.flush()
    }
}

impl Drop for Engine {
    fn drop(&mut self) {
        let _ = self.send("quit");
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// The parts of a UCI `info` line that make up an analysis line.
#[derive(Debug, PartialEq)]
struct Info {
    depth: u32,
    multipv: u32,
    /// From the side to move's point of view, as UCI reports it.
    score: Score,
    /// Moves in UCI notation, such as `e2e4`.
    pv: Vec<String>,
}

/// Parses a UCI `info` line. Lines without a depth, score and principal
/// variation, such as `info string` or `info currmove`, return `None`.
fn parse_info(line: &str) -> Option<Info> {
    let mut tokens = line.split_whitespace();
    if tokens.next()? != "info" {
        return None;
    }
    let mut depth = None;
    let mut multipv = 1;
    let mut score = None;
    let mut pv = Vec::new();
    while let Some(token) = tokens.next() {
        match token {
            "string" => return None,
            "depth" => depth = tokens.next()?.parse().ok(),
            "multipv" => multipv = tokens.next()?.parse().ok()?,
            "score" => {
                let kind = tokens.next()?;
                let value = tokens.next()?.parse().ok()?;
                score = Some(match kind {
                    "cp" => Score::Cp(value),
                    "mate" => Score::Mate(value),
                    _ => return None,
                });
            }
            "pv" => pv = tokens.by_ref().map(str::to_string).collect(),
            _ => {}
        }
    }
    if pv.is_empty() {
        return None;
    }
    Some(Info { depth: depth?, multipv, score: score?, pv })
}

impl Info {
    /// Converts the line to SAN from `fen`, with the score from White's side.
    /// Returns `None` if the moves aren't legal from `fen`.
    fn into_line(self, fen: &str) -> Option<EngineLine> {
        let mut pos: Chess = Fen::from_ascii(fen.as_bytes())
            .ok()?
            .into_position(CastlingMode::Standard)
            .ok()?;
        let white_to_move = pos.turn() == Color::White;
        let mut moves = Vec::with_capacity(self.pv.len());
        for uci in &self.pv {
            let m = UciMove::from_ascii(uci.as_bytes()).ok()?.to_move(&pos).ok()?;
            moves.push(SanPlus::from_move_and_play_unchecked(&mut pos, m).to_string());
        }
        let score = if white_to_move { self.score } else { self.score.flipped() };
        Some(EngineLine { fen: fen.to_string(), multipv: self.multipv, depth: self.depth, score, moves })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const START: &str = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    const AFTER_E4: &str = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";

    #[test]
    fn parses_a_stockfish_info_line() {
        let line = "info depth 12 seldepth 16 multipv 2 score cp 32 nodes 19250 nps 1375000 hashfull 6 tbhits 0 time 14 pv e2e4 c7c5 g1f3";
        let info = parse_info(line).unwrap();
        assert_eq!(info.depth, 12);
        assert_eq!(info.multipv, 2);
        assert_eq!(info.score, Score::Cp(32));
        assert_eq!(info.pv, ["e2e4", "c7c5", "g1f3"]);
    }

    #[test]
    fn ignores_lines_without_analysis() {
        assert_eq!(parse_info("info string NNUE evaluation enabled"), None);
        assert_eq!(parse_info("info depth 5 currmove e2e4 currmovenumber 1"), None);
        assert_eq!(parse_info("bestmove e2e4 ponder c7c5"), None);
    }

    #[test]
    fn converts_moves_to_san_with_white_scores() {
        let white = parse_info("info depth 10 score cp 32 pv e2e4 c7c5 g1f3").unwrap();
        let line = white.into_line(START).unwrap();
        assert_eq!(line.moves, ["e4", "c5", "Nf3"]);
        assert_eq!(line.score, Score::Cp(32));

        let black = parse_info("info depth 10 score mate 3 pv c7c5").unwrap();
        let line = black.into_line(AFTER_E4).unwrap();
        assert_eq!(line.moves, ["c5"]);
        assert_eq!(line.score, Score::Mate(-3));
    }

    #[test]
    fn rejects_moves_that_are_illegal_in_the_position() {
        let info = parse_info("info depth 10 score cp 10 pv e2e4").unwrap();
        assert_eq!(info.into_line(AFTER_E4), None);
    }

    /// Runs only when asked: `CHESSVAULT_ENGINE=<path> cargo test -- --ignored`.
    #[test]
    #[ignore = "needs a UCI engine at the path in CHESSVAULT_ENGINE"]
    fn analyzes_with_a_real_engine_and_switches_positions() {
        use std::sync::mpsc;
        use std::time::{Duration, Instant};

        let path = std::env::var("CHESSVAULT_ENGINE").expect("set CHESSVAULT_ENGINE");
        let (tx, rx) = mpsc::channel();
        let mut engine = Engine::start(Path::new(&path), move |line| {
            let _ = tx.send(line);
        })
        .unwrap();

        engine.analyze(START).unwrap();
        thread::sleep(Duration::from_millis(300));
        engine.analyze(AFTER_E4).unwrap();
        thread::sleep(Duration::from_millis(300));
        while rx.try_recv().is_ok() {}

        // Every line from now on must be for the position after 1. e4.
        let deadline = Instant::now() + Duration::from_secs(2);
        let mut seen = 0;
        while Instant::now() < deadline {
            if let Ok(line) = rx.recv_timeout(Duration::from_millis(100)) {
                let reparsed = SanPlus::from_ascii(line.moves[0].as_bytes()).unwrap();
                let pos: Chess = Fen::from_ascii(AFTER_E4.as_bytes())
                    .unwrap()
                    .into_position(CastlingMode::Standard)
                    .unwrap();
                assert!(reparsed.san.to_move(&pos).is_ok(), "{line:?} is not for 1. e4");
                assert!(line.multipv >= 1 && line.multipv <= LINES);
                seen += 1;
            }
        }
        assert!(seen > 0, "the engine reported no lines");
        engine.stop().unwrap();
    }
}
