//! ChessVault core library. No UI code lives here.

pub mod convert;

/// Returns the crate version, used by the CLI and app to report their build.
pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}
