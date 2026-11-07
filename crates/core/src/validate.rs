//! Checks that a game's movetext is legal, including variations, comments and
//! a FEN start position. Every token must parse and play, so a typo is an
//! error instead of being skipped. The same walk also records the main line,
//! so a board can step through the game.

use serde::Serialize;
use shakmaty::{fen::Fen, san::SanPlus, CastlingMode, Chess, EnPassantMode, Position};

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
    let mv = parsed
        .san
        .to_move(&line.pos)
        .map_err(|_| format!("illegal move '{token}'"))?;
    let next = line
        .pos
        .clone()
        .play(mv)
        .map_err(|_| format!("illegal move '{token}'"))?;
    line.before_last = Some(std::mem::replace(&mut line.pos, next));
    if is_main {
        main.push(Step { san: san.to_string(), fen: fen_of(&line.pos) });
    }
    Ok(())
}

fn fen_of(pos: &Chess) -> String {
    Fen::from_position(pos, EnPassantMode::Legal).to_string()
}

/// The position the game starts from: the FEN tag if present, else the standard start.
fn start_position(pgn: &str) -> Result<Chess, String> {
    match header_value(pgn, "FEN") {
        None => Ok(Chess::default()),
        Some(fen) => {
            let setup = Fen::from_ascii(fen.as_bytes()).map_err(|_| format!("invalid FEN '{fen}'"))?;
            setup
                .into_position(CastlingMode::Standard)
                .map_err(|_| format!("illegal start position '{fen}'"))
        }
    }
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
    use super::{check_movetext, main_line};

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
}
