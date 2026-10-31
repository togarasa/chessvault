use std::fs;
use std::path::Path;
use std::sync::Mutex;

use chessvault_core::db::{Game, GameSummary, Store};
use tauri::State;

/// The database currently open in the app, if any.
#[derive(Default)]
struct AppState {
    store: Mutex<Option<Store>>,
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

#[tauri::command]
fn open_database(path: String, state: State<'_, AppState>) -> Result<i64, String> {
    let store = Store::open(Path::new(&path)).map_err(|e| e.to_string())?;
    let count = store.count().map_err(|e| e.to_string())?;
    *state.store.lock().map_err(|e| e.to_string())? = Some(store);
    Ok(count)
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
fn search_games(player: String, limit: i64, state: State<'_, AppState>) -> Result<Vec<GameSummary>, String> {
    with_store(&state, |store| store.search_player(&player, limit).map_err(|e| e.to_string()))
}

#[tauri::command]
fn get_game(id: i64, state: State<'_, AppState>) -> Result<Option<Game>, String> {
    with_store(&state, |store| store.get(id).map_err(|e| e.to_string()))
}

#[tauri::command]
fn save_game(id: i64, pgn: String, state: State<'_, AppState>) -> Result<(), String> {
    with_store(&state, |store| store.update_pgn(id, &pgn).map_err(|e| e.to_string()))
}

#[tauri::command]
fn undo_game(id: i64, state: State<'_, AppState>) -> Result<bool, String> {
    with_store(&state, |store| store.undo(id).map_err(|e| e.to_string()))
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
            save_game,
            undo_game
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
