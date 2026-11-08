use std::fs::{self, File};
use std::io::BufWriter;
use std::path::PathBuf;

use chessvault_core::convert::convert_to_pgn;
use chessvault_core::db::{GameSummary, Order, Store};
use chessvault_core::library::convert_chessbase;
use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "chessvault", version, about = "Chess database tools")]
struct Cli {
    /// ChessVault database file.
    #[arg(long, global = true, default_value = "chessvault.sqlite")]
    db: PathBuf,

    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Convert a .cbh database to PGN.
    Convert {
        /// Database path, with or without the .cbh extension.
        database: PathBuf,
        /// Output PGN file.
        #[arg(short, long)]
        output: PathBuf,
        /// Worker threads (0 or 1 runs on one thread).
        #[arg(long, default_value_t = 4)]
        threads: usize,
    },
    /// Convert a .cbh database or .cbv archive into a new ChessVault database.
    ConvertToDatabase {
        /// The .cbh or .cbv file.
        source: PathBuf,
        /// The database to create.
        #[arg(short, long)]
        output: PathBuf,
    },
    /// Import the games in a PGN file into the database.
    Import {
        /// PGN file to import.
        pgn: PathBuf,
    },
    /// List games in import order.
    List {
        #[arg(long, default_value_t = 20)]
        limit: i64,
    },
    /// Find games where a player name appears.
    Search {
        /// Part of a player's name, such as "Lysenko".
        player: String,
        #[arg(long, default_value_t = 20)]
        limit: i64,
    },
    /// Print one game as PGN.
    Show { id: i64 },
    /// Replace a game's PGN with the contents of a file. The old version can be undone.
    Edit {
        id: i64,
        /// PGN file containing exactly one game.
        pgn: PathBuf,
    },
    /// Restore the version of a game from before its last edit.
    Undo { id: i64 },
    /// Delete a game and its saved versions.
    Delete { id: i64 },
    /// Write games from the database to a PGN file.
    Export {
        /// Output PGN file.
        output: PathBuf,
        /// Export only these game ids (default: all games).
        #[arg(long, value_delimiter = ',')]
        ids: Vec<i64>,
    },
}

fn main() {
    let cli = Cli::parse();
    if let Err(error) = run(cli) {
        eprintln!("error: {error}");
        std::process::exit(1);
    }
}

fn run(cli: Cli) -> Result<(), Box<dyn std::error::Error>> {
    let db = cli.db;
    match cli.command {
        Command::Convert { database, output, threads } => {
            let mut out = BufWriter::new(File::create(&output)?);
            let stats = convert_to_pgn(&database, &mut out, threads)?;
            out.into_inner().map_err(|e| e.into_error())?.sync_all()?;
            eprintln!("wrote {} games to {} ({} failures)", stats.games, output.display(), stats.failures);
        }
        Command::ConvertToDatabase { source, output } => {
            let converted = convert_chessbase(&source, &output, &mut |progress| {
                eprint!("\r{} of {} records", progress.done, progress.total);
                true
            })?;
            eprintln!();
            println!("converted {} games to {} ({} left out)", converted.games, output.display(), converted.skipped);
        }
        Command::Import { pgn } => {
            let mut store = Store::open(&db)?;
            let text = fs::read_to_string(&pgn)?;
            let imported = store.import_pgn(&text)?;
            println!("imported {imported} games into {}", db.display());
        }
        Command::List { limit } => {
            let store = Store::open(&db)?;
            print_summaries(&store.list(Order::default(), limit, 0)?);
        }
        Command::Search { player, limit } => {
            let store = Store::open(&db)?;
            print_summaries(&store.search_player(&player, Order::default(), limit, 0)?);
        }
        Command::Show { id } => {
            let store = Store::open(&db)?;
            match store.get(id)? {
                Some(game) => println!("{}", game.pgn),
                None => return Err(format!("no game with id {id}").into()),
            }
        }
        Command::Edit { id, pgn } => {
            let mut store = Store::open(&db)?;
            let text = fs::read_to_string(&pgn)?;
            store.update_pgn(id, &text)?;
            println!("saved game {id}; use `undo {id}` to restore the previous version");
        }
        Command::Undo { id } => {
            let mut store = Store::open(&db)?;
            if store.undo(id)? {
                println!("restored the previous version of game {id}");
            } else {
                println!("game {id} has no earlier version");
            }
        }
        Command::Delete { id } => {
            let mut store = Store::open(&db)?;
            if !store.delete_game(id)? {
                return Err(format!("no game with id {id}").into());
            }
            println!("deleted game {id}");
        }
        Command::Export { output, ids } => {
            let store = Store::open(&db)?;
            let ids = (!ids.is_empty()).then_some(ids.as_slice());
            let written = store.export_pgn_file(&output, ids)?;
            println!("wrote {written} game{} to {}", if written == 1 { "" } else { "s" }, output.display());
        }
    }
    Ok(())
}

fn print_summaries(games: &[GameSummary]) {
    if games.is_empty() {
        println!("no games");
    }
    for g in games {
        println!("{:>6}  {:<10}  {} - {}  {}  {}", g.id, g.date, g.white, g.black, g.result, g.event);
    }
}
