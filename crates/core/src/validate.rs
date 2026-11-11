//! Checks that a game's movetext is legal, including variations, comments and
//! a FEN start position. Every token must parse and play, so a typo is an
//! error instead of being skipped. The same walk also records the main line,
//! so a board can step through the game.
//!
//! Two things some databases contain are accepted as well: a null move `--`, where the side to
//! move passes (used for odds games and for showing a threat), and Chess960 start positions.

use serde::Serialize;
use shakmaty::{
    fen::Fen,
    san::{San, SanPlus},
    CastlingMode, Chess, Color, EnPassantMode, FromSetup, Position,
};

/// One position on the main line. The first step is the start position, with
/// an empty `san`; each later step is the move that reached its position.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Step {
    pub san: String,
    pub fen: String,
}

/// A line of play: the current position, plus the position before its last
/// move, where a following `(` starts a variation.
struct Line {
    pos: Chess,
    before_last: Option<Chess>,
}

/// Returns an error describing the first problem in the game's movetext.
pub fn check_movetext(pgn: &str) -> Result<(), String> {
    walk(pgn).map(|_| ())
}

/// Returns the main line of a game, starting from the start position.
pub fn main_line(pgn: &str) -> Result<Vec<Step>, String> {
    walk(pgn)
}

fn walk(pgn: &str) -> Result<Vec<Step>, String> {
    let start = start_position(pgn)?;
    let mut main = vec![Step { san: String::new(), fen: fen_of(&start) }];
    let text = movetext(pgn);
    let bytes = text.as_bytes();
    let mut lines = vec![Line { pos: start, before_last: None }];
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'{' => i = skip_comment(bytes, i)?,
            b';' => i = skip_line(bytes, i),
            b'%' if i == 0 || bytes[i - 1] == b'\n' => i = skip_line(bytes, i),
            b'(' => {
                let line = lines.last().expect("at least one line");
                let before = line
                    .before_last
                    .clone()
                    .ok_or("a variation '(' has no move to replace")?;
                lines.push(Line { pos: before, before_last: None });
                i += 1;
            }
            b')' => {
                if lines.len() == 1 {
                    return Err("')' has no matching '('".to_string());
                }
                lines.pop();
                i += 1;
            }
            b'$' => {
                i += 1;
                while i < bytes.len() && bytes[i].is_ascii_digit() {
                    i += 1;
                }
            }
            b if b.is_ascii_whitespace() => i += 1,
            _ => {
                let begin = i;
                while i < bytes.len() && !is_delimiter(bytes[i]) {
                    i += 1;
                }
                check_token(&text[begin..i], &mut lines, &mut main)?;
            }
        }
    }
    if lines.len() != 1 {
        return Err("a variation '(' is never closed".to_string());
    }
    Ok(main)
}

fn is_delimiter(b: u8) -> bool {
    b.is_ascii_whitespace() || matches!(b, b'{' | b'}' | b'(' | b')' | b';' | b'$')
}

/// Returns the index just past the `}` that closes the comment starting at `i`.
fn skip_comment(bytes: &[u8], i: usize) -> Result<usize, String> {
    bytes[i..]
        .iter()
        .position(|&b| b == b'}')
        .map(|offset| i + offset + 1)
        .ok_or_else(|| "a comment '{' is never closed".to_string())
}

/// Returns the index just past the end of the line containing `i`.
fn skip_line(bytes: &[u8], i: usize) -> usize {
    bytes[i..]
        .iter()
        .position(|&b| b == b'\n')
        .map_or(bytes.len(), |offset| i + offset + 1)
}

/// Plays one movetext token: a move, a move number, or a game result. A move
/// on the main line is also recorded in `main`.
fn check_token(token: &str, lines: &mut [Line], main: &mut Vec<Step>) -> Result<(), String> {
    if matches!(token, "*" | "1-0" | "0-1" | "1/2-1/2") {
        return Ok(());
    }
    // Some programs write castling with zeros; results like 1-0 were handled above.
    let token = &token.replace("0-0-0", "O-O-O").replace("0-0", "O-O");
    let mut san = token.as_str();
    if san.starts_with(|c: char| c.is_ascii_digit()) {
        let rest = san.trim_start_matches(|c: char| c.is_ascii_digit());
        if !rest.starts_with('.') {
            return Err(format!("invalid token '{token}'"));
        }
        san = rest.trim_start_matches('.');
        if san.is_empty() {
            return Ok(());
        }
    }
    let san = san.trim_end_matches(|c: char| c == '!' || c == '?');
    let parsed = SanPlus::from_ascii(san.as_bytes()).map_err(|_| format!("invalid move '{token}'"))?;
    let is_main = lines.len() == 1;
    let line = lines.last_mut().expect("at least one line");
    let next = play(&line.pos, &parsed.san).ok_or_else(|| format!("illegal move '{token}'"))?;
    line.before_last = Some(std::mem::replace(&mut line.pos, next));
    if is_main {
        // A null move has two spellings; record the usual one.
        let san = if parsed.san == San::Null { "--" } else { san };
        main.push(Step { san: san.to_string(), fen: fen_of(&line.pos) });
    }
    Ok(())
}

/// The position after `san`, or `None` when it is not legal in `pos`.
fn play(pos: &Chess, san: &San) -> Option<Chess> {
    if *san == San::Null {
        return pass(pos);
    }
    let mv = san.to_move(pos).ok()?;
    pos.clone().play(mv).ok()
}

/// The position after the side to move passes. A player in check can't pass.
fn pass(pos: &Chess) -> Option<Chess> {
    let mut setup = pos.to_setup(EnPassantMode::Legal);
    setup.halfmoves = setup.halfmoves.saturating_add(1);
    if pos.turn() == Color::Black {
        setup.fullmoves = setup.fullmoves.saturating_add(1);
    }
    setup.swap_turn();
    // In check, the side that just passed would leave its king attacked, which `from_setup` rejects.
    Chess::from_setup(setup, pos.castles().mode()).ok()
}

fn fen_of(pos: &Chess) -> String {
    Fen::from_position(pos, EnPassantMode::Legal).to_string()
}

/// The position the game starts from: the FEN tag if present, else the standard start.
fn start_position(pgn: &str) -> Result<Chess, String> {
    match header_value(pgn, "FEN") {
        None => Ok(Chess::default()),
        Some(fen) => position_from_fen(fen),
    }
}

/// The position in `fen`. Castling rights that don't fit standard chess, such as those of a
/// Chess960 start with the king and rooks elsewhere, are read the Chess960 way.
pub fn position_from_fen(fen: &str) -> Result<Chess, String> {
    let setup = Fen::from_ascii(fen.as_bytes()).map_err(|_| format!("invalid FEN '{fen}'"))?;
    setup
        .clone()
        .into_position(CastlingMode::Standard)
        .or_else(|_| setup.into_position(CastlingMode::Chess960))
        .map_err(|_| format!("illegal start position '{fen}'"))
}

/// Reads the value of a header tag such as `[FEN "..."]`.
fn header_value<'a>(pgn: &'a str, name: &str) -> Option<&'a str> {
    let prefix = format!("[{name} \"");
    pgn.lines()
        .map(str::trim)
        .find(|line| line.starts_with(&prefix))
        .and_then(|line| line[prefix.len()..].strip_suffix("\"]"))
}

/// The part of the game after its header tags.
fn movetext(pgn: &str) -> &str {
    let mut offset = 0;
    for line in pgn.split_inclusive('\n') {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('[') {
            offset += line.len();
        } else {
            break;
        }
    }
    &pgn[offset..]
}

#[cfg(test)]
mod tests {
    use super::{check_movetext, main_line, position_from_fen};

    const HEADERS: &str = "[Event \"Test\"]\n[Result \"*\"]\n\n";

    fn game(moves: &str) -> String {
        format!("{HEADERS}{moves}\n")
    }

    #[test]
    fn accepts_comments_nags_variations_and_line_comments() {
        let pgn = game("1. e4 {a comment} e5 $1 (1... c5 2. Nf3) 2. Nf3 Nc6 ; a line comment\n3. Bb5 a6!? 1-0");
        assert_eq!(check_movetext(&pgn), Ok(()));
    }

    #[test]
    fn rejects_an_illegal_move() {
        let err = check_movetext(&game("1. e4 e5 2. Ke3 *")).unwrap_err();
        assert!(err.contains("illegal move 'Ke3'"), "{err}");
    }

    #[test]
    fn rejects_a_token_that_is_not_a_move() {
        let err = check_movetext(&game("1. e4 Zz9 *")).unwrap_err();
        assert!(err.contains("Zz9"), "{err}");
    }

    #[test]
    fn rejects_an_unclosed_variation_and_an_unmatched_close() {
        assert!(check_movetext(&game("1. e4 (1. d4 e5 *")).is_err());
        assert!(check_movetext(&game("1. e4 e5) *")).is_err());
    }

    #[test]
    fn rejects_a_variation_before_any_move() {
        assert!(check_movetext(&game("(1. d4) 1. e4 *")).is_err());
    }

    #[test]
    fn uses_the_fen_tag_as_the_start_position() {
        let pgn = "[Event \"Endgame\"]\n[SetUp \"1\"]\n[FEN \"4k3/8/8/8/8/8/8/4K3 w - - 0 1\"]\n\n1. Kd2 Kd7 *\n";
        assert_eq!(check_movetext(pgn), Ok(()));
        let bad = "[Event \"Endgame\"]\n[SetUp \"1\"]\n[FEN \"4k3/8/8/8/8/8/8/4K3 w - - 0 1\"]\n\n1. e4 *\n";
        assert!(check_movetext(bad).is_err());
    }

    #[test]
    fn main_line_skips_variations_and_records_each_position() {
        let steps = main_line(&game("1. e4 e5 (1... c5 2. Nf3) 2. Nf3 *")).unwrap();
        let sans: Vec<&str> = steps.iter().map(|s| s.san.as_str()).collect();
        assert_eq!(sans, ["", "e4", "e5", "Nf3"]);
        assert_eq!(steps[0].fen, "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
        assert_eq!(steps[1].fen, "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1");
    }
    #[test]
    fn a_null_move_passes_the_turn_and_counts_as_a_move() {
        let steps = main_line(&game("1. e4 -- 2. d4 e5 *")).unwrap();
        let sans: Vec<&str> = steps.iter().map(|s| s.san.as_str()).collect();
        assert_eq!(sans, ["", "e4", "--", "d4", "e5"]);
        assert_eq!(steps[2].fen, "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 1 2");
    }

    #[test]
    fn a_null_move_is_accepted_in_a_variation_and_in_its_other_spelling() {
        assert_eq!(check_movetext(&game("1. e4 e5 (1... -- 2. d4) 2. Nf3 Z0 3. d4 *")), Ok(()));
        let steps = main_line(&game("1. Z0 e5 *")).unwrap();
        assert_eq!(steps[1].san, "--");
    }

    #[test]
    fn a_white_null_move_keeps_the_move_number() {
        let steps = main_line(&game("1. -- e5 *")).unwrap();
        assert_eq!(steps[1].fen, "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 1 1");
        assert_eq!(steps[2].fen, "rnbqkbnr/pppp1ppp/8/4p3/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 2");
    }

    #[test]
    fn a_null_move_gives_up_an_en_passant_capture() {
        let steps = main_line(&game("1. e4 Nf6 2. e5 d5 3. -- *")).unwrap();
        assert_eq!(steps[5].fen, "rnbqkb1r/ppp1pppp/5n2/3pP3/8/8/PPPP1PPP/RNBQKBNR b KQkq - 1 3");
        assert!(check_movetext(&game("1. e4 Nf6 2. e5 d5 3. -- Nd7 4. exd6 *")).is_err());
    }

    #[test]
    fn a_player_in_check_cannot_pass() {
        let err = check_movetext(&game("1. e4 f5 2. Qh5+ -- *")).unwrap_err();
        assert!(err.contains("illegal move '--'"), "{err}");
    }

    #[test]
    fn a_chess960_start_castles_with_its_own_rooks() {
        let pgn = "[Event \"960\"]
[SetUp \"1\"]
[FEN \"bbqrknrn/pppppppp/8/8/8/8/PPPPPPPP/BBQRKNRN w KQkq - 0 1\"]

1. Ne3 Ne6 2. O-O O-O *
";
        let steps = main_line(pgn).unwrap();
        assert!(steps[3].fen.ends_with("/BBQR1RKN b kq - 3 2"), "{}", steps[3].fen);
        assert!(steps[4].fen.starts_with("bbqr1rkn/"), "{}", steps[4].fen);
    }

    #[test]
    fn a_start_position_with_move_number_zero_is_read_as_move_one() {
        let pos = position_from_fen("bqnrkbrn/pppppppp/8/8/8/8/PPPPPPPP/BQNRKBRN w KQkq - 0 0").unwrap();
        assert_eq!(u32::from(shakmaty::Position::fullmoves(&pos)), 1);
    }

    #[test]
    fn castling_rights_that_fit_no_start_are_still_an_error() {
        let err = position_from_fen("4k3/8/8/8/8/8/8/4K3 w KQkq - 0 1").unwrap_err();
        assert!(err.contains("illegal start position"), "{err}");
        assert!(position_from_fen("not a fen").unwrap_err().contains("invalid FEN"));
    }
}
