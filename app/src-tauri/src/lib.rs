use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use chessvault_core::db::{self, Game, GameSummary, Store};
use chessvault_core::engine::{Engine, EngineLine};
use chessvault_core::online::lichess::{self, Database, Explorer};
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default)]
struct AppState {
    /// The database currently open, if any.
    store: Mutex<Option<Store>>,
    /// The running engine and the path it was started from.
    engine: Mutex<Option<(PathBuf, Engine)>>,
    lichess: lichess::Client,
}

/// Runs `f` against the open database, or fails if none is open.
fn with_store<T>(
    state: &State<'_, AppState>,
    f: impl FnOnce(&mut Store) -> Result<T, String>,
) -> Result<T, String> {
    let mut guard = state.store.lock().map_err(|e| e.to_string())?;
    let store = guard.as_mut().ok_or("open a database first")?;
    f(store)
}

/// What opening a file did, for the status bar.
#[derive(serde::Serialize)]
struct OpenResult {
    database: String,
    games: i64,
    imported: usize,
}

/// Opens a database, or a PGN file through a database beside it.
#[tauri::command]
fn open_database(path: String, state: State<'_, AppState>) -> Result<OpenResult, String> {
    let opened = db::open_path(Path::new(&path)).map_err(|e| e.to_string())?;
    let games = opened.store.count().map_err(|e| e.to_string())?;
    let database = opened.path.display().to_string();
    *state.store.lock().map_err(|e| e.to_string())? = Some(opened.store);
    Ok(OpenResult { database, games, imported: opened.imported })
}

#[tauri::command]
fn import_pgn(path: String, state: State<'_, AppState>) -> Result<usize, String> {
    let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    with_store(&state, |store| store.import_pgn(&text).map_err(|e| e.to_string()))
}

#[tauri::command]
fn list_games(limit: i64, offset: i64, state: State<'_, AppState>) -> Result<Vec<GameSummary>, String> {
    with_store(&state, |store| store.list(limit, offset).map_err(|e| e.to_string()))
}

#[tauri::command]
fn search_games(
    player: String,
    limit: i64,
    offset: i64,
    state: State<'_, AppState>,
) -> Result<Vec<GameSummary>, String> {
    with_store(&state, |store| store.search_player(&player, limit, offset).map_err(|e| e.to_string()))
}

#[tauri::command]
fn get_game(id: i64, state: State<'_, AppState>) -> Result<Option<Game>, String> {
    with_store(&state, |store| store.get(id).map_err(|e| e.to_string()))
}

/// Adds a new game and returns its id.
#[tauri::command]
fn add_game(pgn: String, state: State<'_, AppState>) -> Result<i64, String> {
    with_store(&state, |store| store.add_game(&pgn).map_err(|e| e.to_string()))
}

#[tauri::command]
fn save_game(id: i64, pgn: String, state: State<'_, AppState>) -> Result<(), String> {
    with_store(&state, |store| store.update_pgn(id, &pgn).map_err(|e| e.to_string()))
}

#[tauri::command]
fn delete_game(id: i64, state: State<'_, AppState>) -> Result<bool, String> {
    with_store(&state, |store| store.delete_game(id).map_err(|e| e.to_string()))
}

/// Adds a game to another database or PGN file, creating it if needed.
#[tauri::command]
fn add_game_to(path: String, pgn: String) -> Result<(), String> {
    db::add_game_to(Path::new(path.trim().trim_matches('"')), &pgn).map_err(|e| e.to_string())
}

/// Writes games to a PGN file: the games in `ids`, or all games. Returns how many were written.
#[tauri::command]
fn export_pgn(path: String, ids: Option<Vec<i64>>, state: State<'_, AppState>) -> Result<usize, String> {
    let path = PathBuf::from(path.trim().trim_matches('"'));
    with_store(&state, |store| store.export_pgn_file(&path, ids.as_deref()).map_err(|e| e.to_string()))
}

#[tauri::command]
fn file_exists(path: String) -> bool {
    Path::new(path.trim().trim_matches('"')).exists()
}

#[tauri::command]
fn undo_game(id: i64, state: State<'_, AppState>) -> Result<bool, String> {
    with_store(&state, |store| store.undo(id).map_err(|e| e.to_string()))
}

/// Analyzes `fen`, starting the engine at `engine_path` if it isn't running.
/// Lines arrive as `engine-line` events.
#[tauri::command]
fn start_analysis(engine_path: String, fen: String, app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let path = PathBuf::from(engine_path.trim().trim_matches('"'));
    let mut slot = state.engine.lock().map_err(|e| e.to_string())?;
    if slot.as_ref().is_none_or(|(running, _)| *running != path) {
        *slot = None;
        let engine = Engine::start(&path, move |line: EngineLine| {
            let _ = app.emit("engine-line", line);
        })
        .map_err(|e| format!("could not start the engine at {}: {e}", path.display()))?;
        *slot = Some((path, engine));
    }
    let (_, engine) = slot.as_mut().expect("the engine is running");
    if let Err(e) = engine.analyze(&fen) {
        // The engine process has gone; start a fresh one next time.
        *slot = None;
        return Err(format!("the engine stopped responding: {e}"));
    }
    Ok(())
}

#[tauri::command]
fn stop_analysis(state: State<'_, AppState>) -> Result<(), String> {
    let mut slot = state.engine.lock().map_err(|e| e.to_string())?;
    if let Some((_, engine)) = slot.as_mut() {
        engine.stop().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Where the Lichess token is kept: a file in the app's config folder on this computer.
fn token_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("lichess-token"))
}

/// Saves the Lichess token, or removes it when `token` is empty.
#[tauri::command]
fn set_lichess_token(token: String, app: AppHandle) -> Result<(), String> {
    let path = token_path(&app)?;
    let token = token.trim();
    if token.is_empty() {
        let _ = fs::remove_file(&path);
        return Ok(());
    }
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    fs::write(&path, token).map_err(|e| e.to_string())
}

#[tauri::command]
fn has_lichess_token(app: AppHandle) -> Result<bool, String> {
    Ok(token_path(&app)?.exists())
}

#[tauri::command]
async fn explore(database: Database, fen: String, app: AppHandle, state: State<'_, AppState>) -> Result<Explorer, String> {
    let token = fs::read_to_string(token_path(&app)?).unwrap_or_default();
    let client = state.lichess.clone();
    client.explore(database, &fen, &token).await.map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            open_database,
            import_pgn,
            list_games,
            search_games,
            get_game,
            add_game,
            save_game,
            undo_game,
            delete_game,
            add_game_to,
            export_pgn,
            file_exists,
            start_analysis,
            stop_analysis,
            set_lichess_token,
            has_lichess_token,
            explore
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
