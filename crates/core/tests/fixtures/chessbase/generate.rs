//! Writes the made-up test database `club` and the archive `club.cbv` in this folder. It isn't
//! part of the build; README.md says how it was run. `cargo run -- <folder>` needs the
//! `cbvault-fixtures` crate from https://github.com/itshak/cbvault (MIT), which isn't published,
//! and the `gigachess` crate.

use std::path::Path;

use cbvault_fixtures::classic::{self, Builder, Tok};
use gigachess::Board;

const MEMBERS: [&str; 7] = ["club.cbh", "club.cbg", "club.cba", "club.cbp", "club.cbt", "club.cbc", "club.cbs"];

/// A date as the format stores it, in a header's bytes.
fn date(year: u32, month: u32, day: u32) -> [u8; 3] {
    let field = (year << 9) | (month << 5) | day;
    [(field >> 16) as u8, (field >> 8) as u8, field as u8]
}

fn moves(toks: &[Tok<'_>]) -> Vec<u8> {
    classic::move_record(0, None, None, &classic::encode(&Board::startpos(), toks, 0, false))
}

/// A database of made-up games: one with a variation and a comment, a draw, a guiding text and
/// a deleted game, so readers can see that only the two real games come out.
fn database() -> Builder {
    let mut b = Builder::new();
    let (anna, bernd, gerd, dora) =
        (b.player("Alpha", "Anna"), b.player("Beta", "Bernd"), b.player("Gamma", "Gerd"), b.player("Delta", "Dora"));
    let club = b.tournament("Club Championship", "Testville");
    let set_players = |h: &mut [u8; 46], white: u32, black: u32| {
        h[0x09..0x0c].copy_from_slice(&white.to_be_bytes()[1..]);
        h[0x0c..0x0f].copy_from_slice(&black.to_be_bytes()[1..]);
        h[0x0f..0x12].copy_from_slice(&club.to_be_bytes()[1..]);
    };

    let first = moves(&[
        Tok::Mv("e2e4"),
        Tok::Var,
        Tok::Mv("c7c5"),
        Tok::End,
        Tok::Mv("e7e5"),
        Tok::Mv("g1f3"),
        Tok::Mv("b8c6"),
        Tok::End,
    ]);
    let h = b.game(&first);
    set_players(h, anna, bernd);
    h[0x18..0x1b].copy_from_slice(&date(2026, 1, 10));
    h[0x1b] = 2;
    h[0x1f..0x21].copy_from_slice(&2100u16.to_be_bytes());
    h[0x21..0x23].copy_from_slice(&1900u16.to_be_bytes());
    let comment = classic::text_item(1, false, 0, "A good start");
    b.annotations(&classic::annotation_items(1, &[comment]));

    b.text(&[(0, b"About this database")]);

    let h = b.game(&moves(&[Tok::Mv("d2d4"), Tok::Mv("d7d5"), Tok::End]));
    set_players(h, gerd, dora);
    h[0x18..0x1b].copy_from_slice(&date(2026, 2, 14));
    h[0x1b] = 1;

    let h = b.game(&moves(&[Tok::Mv("c2c4"), Tok::End]));
    set_players(h, dora, gerd);
    h[0] |= 0x80;
    b
}

/// The archive format's container, with every member stored without compression.
fn archive(folder: &Path) -> Vec<u8> {
    const RECORD: usize = 173;
    const TRIO: usize = 128;
    const SEGMENT: usize = TRIO + 12;
    const QUARTET: usize = SEGMENT + 9;
    let mut out = vec![0x08, 0x00, MEMBERS.len() as u8, 0x00, 0xAD, 0x00, 0x03, 0x00];
    let mut pool = Vec::new();
    let pool_start = 8 + MEMBERS.len() * RECORD;
    for name in MEMBERS {
        let content = std::fs::read(folder.join(name)).expect("a member");
        let mut stream = ((content.len() + 1) as u16).to_le_bytes().to_vec();
        stream.extend(0xA5A5u16.to_le_bytes());
        stream.push(0); // Stored.
        stream.extend(&content);
        let (offset, packed, size) = ((pool_start + pool.len()) as u32, stream.len() as u32, content.len() as u32);
        let mut record = vec![0u8; RECORD];
        record[..name.len()].copy_from_slice(name.as_bytes());
        record[TRIO..TRIO + 4].copy_from_slice(&offset.to_le_bytes());
        record[TRIO + 4..TRIO + 8].copy_from_slice(&packed.to_le_bytes());
        record[TRIO + 8..TRIO + 12].copy_from_slice(&size.to_le_bytes());
        record[SEGMENT..QUARTET].copy_from_slice(&[0x01, 0x70, 0xb3, 0x34, 0x01, 0x80, 0xb1, 0x4f, 0x01]);
        record[QUARTET..QUARTET + 4].copy_from_slice(&offset.to_le_bytes());
        record[QUARTET + 8..QUARTET + 16].copy_from_slice(&u64::from(packed).to_le_bytes());
        record[QUARTET + 16..QUARTET + 24].copy_from_slice(&u64::from(size).to_le_bytes());
        out.extend(record);
        pool.extend(stream);
    }
    out.extend(pool);
    out
}

fn main() {
    let folder = std::env::args().nth(1).expect("the folder to write to");
    let folder = Path::new(&folder);
    let written = database().write("club");
    for name in MEMBERS {
        std::fs::copy(written.dir().join(name), folder.join(name)).expect("a member");
    }
    std::fs::write(folder.join("club.cbv"), archive(folder)).expect("the archive");
}
