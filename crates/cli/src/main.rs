use std::fs::File;
use std::io::BufWriter;
use std::path::PathBuf;

use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "chessvault", version, about = "Chess database tools")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Convert a ChessBase database to PGN.
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
}

fn main() {
    let cli = Cli::parse();
    if let Err(error) = run(cli) {
        eprintln!("error: {error}");
        std::process::exit(1);
    }
}

fn run(cli: Cli) -> Result<(), Box<dyn std::error::Error>> {
    match cli.command {
        Command::Convert { database, output, threads } => {
            let mut out = BufWriter::new(File::create(&output)?);
            let stats = chessvault_core::convert::convert_to_pgn(&database, &mut out, threads)?;
            out.into_inner().map_err(|e| e.into_error())?.sync_all()?;
            eprintln!("wrote {} games to {} ({} failures)", stats.games, output.display(), stats.failures);
            Ok(())
        }
    }
}
