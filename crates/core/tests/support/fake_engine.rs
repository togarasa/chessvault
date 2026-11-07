//! A stand-in UCI engine for the engine tests, so they run without Stockfish.
//!
//! It answers `uci` and `isready`, and on `go` reports one line: 1. e4 when White is to move,
//! 1... e5 when Black is. `stop` replies with `bestmove`, `quit` ends it.

use std::io::{self, BufRead, Write};

fn main() {
    let mut out = io::stdout();
    let mut white_to_move = true;
    for line in io::stdin().lock().lines() {
        let Ok(line) = line else { break };
        let reply = match line.split_whitespace().next() {
            Some("uci") => "id name Fake\nuciok".to_string(),
            Some("isready") => "readyok".to_string(),
            Some("position") => {
                white_to_move = !line.contains(" b ");
                continue;
            }
            Some("go") => {
                let (score, mv) = if white_to_move { (30, "e2e4") } else { (-20, "e7e5") };
                format!("info string thinking\ninfo depth 5 multipv 1 score cp {score} pv {mv}")
            }
            Some("stop") => "bestmove e2e4".to_string(),
            Some("quit") => break,
            _ => continue,
        };
        writeln!(out, "{reply}").unwrap();
        out.flush().unwrap();
    }
}
