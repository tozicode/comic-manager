mod cmc;
mod store;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;

use base64::Engine;
use tauri::{Manager, State};

use store::{Store, now_ms};

/// サムネイルの最大幅（px）
const THUMBNAIL_WIDTH: u32 = 240;

struct AppState {
    store: Mutex<Store>,
    /// ページファイルのパス → (更新日時, data URL)。ファイルが保存し直されたら作り直す
    thumbnails: Mutex<HashMap<PathBuf, (SystemTime, String)>>,
}

type Cmd<T> = Result<T, String>;

fn with_store<T>(state: &State<AppState>, f: impl FnOnce(&Store) -> store::Result<T>) -> Cmd<T> {
    let store = state.store.lock().map_err(|_| "データベースが使えない状態です".to_string())?;
    f(&store)
}

// ----- 作品 -----

#[tauri::command]
fn list_works(state: State<AppState>) -> Cmd<Vec<store::WorkSummary>> {
    with_store(&state, |s| s.list_works())
}

#[tauri::command]
fn add_work(state: State<AppState>, cmc_path: String) -> Cmd<i64> {
    let comic = cmc::read_comic(Path::new(&cmc_path))?;
    with_store(&state, |s| s.add_work(&cmc_path, &comic, now_ms()))
}

#[tauri::command]
fn remove_work(state: State<AppState>, work_id: i64) -> Cmd<()> {
    with_store(&state, |s| s.remove_work(work_id))
}

/// cmc を読み直してページ一覧に反映する
#[tauri::command]
fn sync_work(state: State<AppState>, work_id: i64) -> Cmd<store::SyncResult> {
    let path = with_store(&state, |s| s.work_info(work_id))?.cmc_path;
    let comic = cmc::read_comic(Path::new(&path))?;
    with_store(&state, |s| {
        let result = s.sync_pages(work_id, &comic, now_ms())?;
        s.remove_empty_missing_pages(work_id)?;
        Ok(result)
    })
}

#[tauri::command]
fn get_board(state: State<AppState>, work_id: i64) -> Cmd<store::Board> {
    with_store(&state, |s| s.board(work_id, now_ms()))
}

#[tauri::command]
fn set_task_done(state: State<AppState>, page_id: i64, stage_id: i64, done: bool) -> Cmd<()> {
    with_store(&state, |s| s.set_task_done(page_id, stage_id, done, now_ms()))
}

/// ページのサムネイルを data URL で返す
#[tauri::command]
async fn load_thumbnail(state: State<'_, AppState>, cmc_path: String, file_name: String) -> Cmd<String> {
    let path = cmc::page_path(Path::new(&cmc_path), &file_name);
    let modified = std::fs::metadata(&path)
        .and_then(|m| m.modified())
        .map_err(|e| format!("ページファイルが見つかりませんでした: {e}"))?;
    if let Some((time, url)) = state.thumbnails.lock().unwrap().get(&path)
        && *time == modified
    {
        return Ok(url.clone());
    }
    let png = cmc::read_thumbnail(&path, THUMBNAIL_WIDTH)?;
    let url = format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(png));
    state.thumbnails.lock().unwrap().insert(path, (modified, url.clone()));
    Ok(url)
}

// ----- タイマー -----

#[tauri::command]
fn get_active_session(state: State<AppState>) -> Cmd<Option<store::ActiveSession>> {
    with_store(&state, |s| s.active_session())
}

#[tauri::command]
fn start_timer(state: State<AppState>, page_id: i64, stage_id: i64) -> Cmd<store::ActiveSession> {
    with_store(&state, |s| s.start_timer(page_id, stage_id, now_ms()))
}

#[tauri::command]
fn stop_timer(state: State<AppState>) -> Cmd<Option<store::StopResult>> {
    with_store(&state, |s| s.stop_timer(now_ms()))
}

// ----- 作業記録 -----

#[tauri::command]
fn list_sessions(state: State<AppState>, work_id: i64, from: i64) -> Cmd<Vec<store::SessionRow>> {
    with_store(&state, |s| s.list_sessions(work_id, from))
}

#[tauri::command]
fn list_spans(state: State<AppState>, from: i64) -> Cmd<Vec<store::Span>> {
    with_store(&state, |s| s.spans(from))
}

#[tauri::command]
fn add_session(state: State<AppState>, page_id: i64, stage_id: i64, started_at: i64, ended_at: i64) -> Cmd<()> {
    with_store(&state, |s| s.add_session(page_id, stage_id, started_at, ended_at, now_ms()))
}

#[tauri::command]
fn update_session(
    state: State<AppState>,
    id: i64,
    page_id: i64,
    stage_id: i64,
    started_at: i64,
    ended_at: Option<i64>,
) -> Cmd<()> {
    with_store(&state, |s| s.update_session(id, page_id, stage_id, started_at, ended_at, now_ms()))
}

#[tauri::command]
fn delete_session(state: State<AppState>, id: i64) -> Cmd<()> {
    with_store(&state, |s| s.delete_session(id))
}

// ----- 工程 -----

#[tauri::command]
fn list_stages(state: State<AppState>) -> Cmd<Vec<store::StageDef>> {
    with_store(&state, |s| s.list_stages())
}

#[tauri::command]
fn add_stage(state: State<AppState>, name: String, color: String) -> Cmd<store::StageDef> {
    with_store(&state, |s| s.add_stage(&name, &color))
}

#[tauri::command]
fn update_stage(state: State<AppState>, id: i64, name: String, color: String, hint_minutes: i64) -> Cmd<store::StageDef> {
    with_store(&state, |s| s.update_stage(id, &name, &color, hint_minutes))
}

#[tauri::command]
fn set_stage_hidden(state: State<AppState>, id: i64, hidden: bool) -> Cmd<()> {
    with_store(&state, |s| s.set_stage_hidden(id, hidden))
}

#[tauri::command]
fn move_stage(state: State<AppState>, id: i64, delta: i64) -> Cmd<()> {
    with_store(&state, |s| s.move_stage(id, delta))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // 開発・確認用に、環境変数 OTOSAZU_DB で保存先を差し替えられる
            let path = match std::env::var_os("OTOSAZU_DB") {
                Some(p) => PathBuf::from(p),
                None => app.path().app_data_dir()?.join("otosazu.db"),
            };
            let store = Store::open(&path)?;
            app.manage(AppState { store: Mutex::new(store), thumbnails: Mutex::new(HashMap::new()) });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_works,
            add_work,
            remove_work,
            sync_work,
            get_board,
            set_task_done,
            load_thumbnail,
            get_active_session,
            start_timer,
            stop_timer,
            list_sessions,
            list_spans,
            add_session,
            update_session,
            delete_session,
            list_stages,
            add_stage,
            update_stage,
            set_stage_hidden,
            move_stage,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
