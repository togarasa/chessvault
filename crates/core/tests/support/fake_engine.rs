//! A stand-in UCI engine for the engine tests, so they run without Stockfish.
//!
//! It answers `uci` and `isready`, and on `go` reports one line: 1. e4 when White is to move,
//! 1... e5 when Black is. With the option `UCI_Chess960` on, White's move is `e1g1` instead: castling
//! written as the king taking its rook, as Chess960 engines write it. `stop` replies with
//! `bestmove`, `quit` ends it.

use std::io::{self, BufRead, Write};

fn main() {
    let mut out = io::stdout();
    let mut white_to_move = true;
    let mut chess960 = false;
    for line in io::stdin().lock().lines() {
        let Ok(line) = line else { break };
        let reply = match line.split_whitespace().next() {
            Some("uci") => "id name Fake\nuciok".to_string(),
            Some("isready") => "readyok".to_string(),
            Some("position") => {
                white_to_move = !line.contains(" b ");
                continue;
            }
            Some("setoption") => {
                if line.contains("name UCI_Chess960 value") {
                    chess960 = line.ends_with("true");
                }
                continue;
            }
            Some("go") => {
                let white_move = if chess960 { "e1g1" } else { "e2e4" };
                let (score, mv) = if white_to_move { (30, white_move) } else { (-20, "e7e5") };
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
