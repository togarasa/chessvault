//! Runs the engine wrapper against the fake engine in `tests/support/fake_engine.rs`, and on
//! request against a real engine.

use std::path::Path;
use std::sync::mpsc;
use std::time::{Duration, Instant};

use chessvault_core::engine::{Engine, EngineLine, Score};
use shakmaty::{fen::Fen, san::SanPlus, CastlingMode, Chess};

const START: &str = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const AFTER_E4: &str = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";

fn start() -> (Engine, mpsc::Receiver<EngineLine>) {
    let (tx, rx) = mpsc::channel();
    let engine = Engine::start(Path::new(env!("CARGO_BIN_EXE_fake-uci-engine")), move |line| {
        let _ = tx.send(line);
    })
    .expect("the fake engine starts");
    (engine, rx)
}

fn next_line(rx: &mpsc::Receiver<EngineLine>) -> EngineLine {
    rx.recv_timeout(Duration::from_secs(5)).expect("the engine reports a line")
}

#[test]
fn reports_lines_for_each_new_position() {
    let (mut engine, rx) = start();

    engine.analyze(START).unwrap();
    let line = next_line(&rx);
    assert_eq!((line.fen.as_str(), line.moves.as_slice(), line.score), (START, &["e4".to_string()][..], Score::Cp(30)));

    // Switching positions stops the running search first; its late reply is ignored.
    engine.analyze(AFTER_E4).unwrap();
    let line = next_line(&rx);
    assert_eq!(line.fen, AFTER_E4);
    assert_eq!(line.moves, ["e5"]);
    assert_eq!(line.score, Score::Cp(20), "Black's -20 is +20 from White's side");

    engine.stop().unwrap();
    engine.stop().unwrap();
    assert!(rx.recv_timeout(Duration::from_millis(300)).is_err(), "nothing after stopping");
}

#[test]
fn tells_the_engine_when_a_position_is_chess960_and_when_it_no_longer_is() {
    // A Chess960 start after 1. Ne3 Ne6: White's rooks are on d1 and g1.
    const CHESS960: &str = "bbqrk1rn/pppppppp/4n3/8/8/4N3/PPPPPPPP/BBQRK1RN w KQkq - 2 2";
    let (mut engine, rx) = start();

    engine.analyze(CHESS960).unwrap();
    assert_eq!(next_line(&rx).moves, ["O-O"], "the king taking its rook is castling");

    // Back in standard chess the engine answers 1. e4 again, which it only does with Chess960 off.
    engine.analyze(START).unwrap();
    assert_eq!(next_line(&rx).moves, ["e4"]);
}

#[test]
fn shuts_the_engine_down_when_dropped() {
    let (mut engine, rx) = start();
    engine.analyze(START).unwrap();
    next_line(&rx);
    drop(engine);
    // The output thread ends with the process, which drops the sender.
    assert!(matches!(rx.recv_timeout(Duration::from_secs(5)), Err(mpsc::RecvTimeoutError::Disconnected)));
}

/// Runs only when asked: `CHESSVAULT_ENGINE=<path> cargo test -- --ignored`.
#[test]
#[ignore = "needs a UCI engine at the path in CHESSVAULT_ENGINE"]
fn analyzes_with_a_real_engine_and_switches_positions() {
    let path = std::env::var("CHESSVAULT_ENGINE").expect("set CHESSVAULT_ENGINE");
    let (tx, rx) = mpsc::channel();
    let mut engine = Engine::start(Path::new(&path), move |line| {
        let _ = tx.send(line);
    })
    .unwrap();

    engine.analyze(START).unwrap();
    std::thread::sleep(Duration::from_millis(300));
    engine.analyze(AFTER_E4).unwrap();
    std::thread::sleep(Duration::from_millis(300));
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
            assert!(line.multipv >= 1 && line.multipv <= chessvault_core::engine::LINES);
            seen += 1;
        }
    }
    assert!(seen > 0, "the engine reported no lines");
    engine.stop().unwrap();
}

/// Runs only when asked, like the test above. Castling appears in the engine's lines of a Chess960
/// position only when the engine was told it is Chess960: otherwise it writes castling as the king's
/// step f1g1, which here is an ordinary king move.
#[test]
#[ignore = "needs a UCI engine at the path in CHESSVAULT_ENGINE"]
fn a_real_engine_castles_in_a_chess960_position() {
    // A Chess960 start after 1. Nf3 Nf6, with the kings on f1 and f8 and rooks in the corners.
    const CHESS960: &str = "rbbnqk1r/pppppppp/5n2/8/8/5N2/PPPPPPPP/RBBNQK1R w KQkq - 2 2";
    let path = std::env::var("CHESSVAULT_ENGINE").expect("set CHESSVAULT_ENGINE");
    let (tx, rx) = mpsc::channel();
    let mut engine = Engine::start(Path::new(&path), move |line| {
        let _ = tx.send(line);
    })
    .unwrap();

    engine.analyze(CHESS960).unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut castled = false;
    while Instant::now() < deadline && !castled {
        if let Ok(line) = rx.recv_timeout(Duration::from_millis(100)) {
            castled = line.moves.iter().any(|m| m.starts_with("O-O"));
        }
    }
    engine.stop().unwrap();
    assert!(castled, "no engine line castled");
}
