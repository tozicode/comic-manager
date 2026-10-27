mod cmc;
mod desktop;
mod i18n;
mod server;
mod store;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::SystemTime;

use base64::Engine;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;

use i18n::{M, tr, trf};
use store::{Store, now_ms};

/// サムネイルの最大幅（px）
const THUMBNAIL_WIDTH: u32 = 240;

struct AppState {
    store: Mutex<Store>,
    /// データベースのファイルの場所（設定画面に表示し、バックアップに使う）
    db_path: PathBuf,
    /// ページファイルのパス → (更新日時, data URL)。ファイルが保存し直されたら作り直す
    thumbnails: Mutex<HashMap<PathBuf, (SystemTime, String)>>,
    /// 動いている遠隔の画面の受け付け（5.17）。設定を変えたら止めて立て直す
    remote: Mutex<Option<Arc<tiny_http::Server>>>,
    /// 遠隔の画面から最後に要求が来た時刻（UNIX 時間のミリ秒）。0 なら一度も来ていない
    last_remote: AtomicU64,
}

impl AppState {
    fn new(store: Store, db_path: PathBuf) -> Self {
        Self {
            store: Mutex::new(store),
            db_path,
            thumbnails: Mutex::new(HashMap::new()),
            remote: Mutex::new(None),
            last_remote: AtomicU64::new(0),
        }
    }

    /// 遠隔の画面から要求が来たことを控える（操作しているとみなす。5.17）
    fn mark_remote(&self) {
        self.last_remote.store(now_ms() as u64, Ordering::Relaxed);
    }

    /// 遠隔の画面から最後に要求が来てからの時間。一度も来ていなければ、無いものとして扱う
    fn remote_idle_ms(&self) -> u64 {
        match self.last_remote.load(Ordering::Relaxed) {
            0 => u64::MAX,
            at => (now_ms() as u64).saturating_sub(at),
        }
    }
}

type Cmd<T> = Result<T, String>;

fn with_store<T>(state: &State<AppState>, f: impl FnOnce(&Store) -> store::Result<T>) -> Cmd<T> {
    let store = state.store.lock().map_err(|_| tr(M::DbBusy).to_string())?;
    f(&store)
}

// ----- 作品 -----

#[tauri::command]
fn list_works(state: State<AppState>) -> Cmd<Vec<store::WorkSummary>> {
    let mut works = with_store(&state, |s| s.list_works())?;
    for w in &mut works {
        w.file_missing = match (w.kind.as_str(), &w.cmc_path) {
            (store::KIND_COMIC, Some(cmc)) => !Path::new(cmc).exists(),
            // イラストは、どれか 1 つでもファイルが見つからなければ知らせる
            (store::KIND_FILES, _) => with_store(&state, |s| s.page_paths(w.id))?.iter().any(|(_, p)| !p.exists()),
            // ファイルを持たない作品には、見つからないものがない
            _ => false,
        };
    }
    Ok(works)
}

// ----- ファイルを持たない作品 -----

#[tauri::command]
fn add_manual_work(state: State<AppState>, title: String, names: Vec<String>, set_id: i64) -> Cmd<i64> {
    with_store(&state, |s| s.add_manual_work(&title, &names, set_id, now_ms()))
}

#[tauri::command]
fn add_rows(state: State<AppState>, work_id: i64, names: Vec<String>) -> Cmd<i64> {
    with_store(&state, |s| s.add_rows(work_id, &names))
}

#[tauri::command]
fn rename_row(state: State<AppState>, page_id: i64, title: String) -> Cmd<()> {
    with_store(&state, |s| s.rename_row(page_id, &title))
}

/// 別の場所の cmc がこの作品と同じものかを照らし合わせる
#[tauri::command]
fn check_relink(state: State<AppState>, work_id: i64, cmc_path: String) -> Cmd<store::RelinkCheck> {
    let comic = cmc::read_comic(Path::new(&cmc_path))?;
    with_store(&state, |s| s.check_relink(work_id, &comic))
}

/// 作品の cmc の場所を指定し直す（移動・名前の変更のあとに使う）
#[tauri::command]
fn relink_work(state: State<AppState>, work_id: i64, cmc_path: String) -> Cmd<store::SyncResult> {
    let comic = cmc::read_comic(Path::new(&cmc_path))?;
    with_store(&state, |s| s.relink_work(work_id, &cmc_path, &comic, now_ms()))
}

#[tauri::command]
fn add_work(state: State<AppState>, cmc_path: String, set_id: i64, split_spreads: bool) -> Cmd<i64> {
    let comic = cmc::read_comic(Path::new(&cmc_path))?;
    with_store(&state, |s| s.add_work_in_set(&cmc_path, &comic, set_id, split_spreads, now_ms()))
}

/// 「見開きを 1 ページずつ管理する」の切り替え（5.18）
#[tauri::command]
fn set_split_spreads(state: State<AppState>, work_id: i64, on: bool) -> Cmd<()> {
    with_store(&state, |s| s.set_split_spreads(work_id, on))
}

// ----- イラストの作品 -----

#[tauri::command]
fn add_files_work(state: State<AppState>, title: String, paths: Vec<String>, set_id: i64) -> Cmd<i64> {
    with_store(&state, |s| s.add_files_work(&title, &paths, set_id, now_ms()))
}

#[tauri::command]
fn add_files(state: State<AppState>, work_id: i64, paths: Vec<String>) -> Cmd<i64> {
    with_store(&state, |s| s.add_files(work_id, &paths))
}

#[tauri::command]
fn remove_file(state: State<AppState>, page_id: i64) -> Cmd<()> {
    with_store(&state, |s| s.remove_file(page_id))
}

#[tauri::command]
fn set_file_order(state: State<AppState>, work_id: i64, page_ids: Vec<i64>) -> Cmd<()> {
    with_store(&state, |s| s.set_file_order(work_id, &page_ids))
}

#[tauri::command]
fn relink_file(state: State<AppState>, page_id: i64, path: String) -> Cmd<()> {
    with_store(&state, |s| s.relink_file(page_id, &path))
}

#[tauri::command]
fn list_stage_sets(state: State<AppState>) -> Cmd<Vec<store::StageSet>> {
    with_store(&state, |s| s.list_stage_sets())
}

#[tauri::command]
fn add_stage_set(state: State<AppState>, name: String, unit: String) -> Cmd<store::StageSet> {
    with_store(&state, |s| s.add_stage_set(&name, &unit))
}

#[tauri::command]
fn update_stage_set(state: State<AppState>, id: i64, name: String, unit: String) -> Cmd<store::StageSet> {
    with_store(&state, |s| s.update_stage_set(id, &name, &unit))
}

#[tauri::command]
fn remove_stage_set(state: State<AppState>, id: i64) -> Cmd<()> {
    with_store(&state, |s| s.remove_stage_set(id))
}

#[tauri::command]
fn remove_work(state: State<AppState>, work_id: i64) -> Cmd<()> {
    with_store(&state, |s| s.remove_work(work_id))
}

#[tauri::command]
fn rename_work(state: State<AppState>, work_id: i64, title: String) -> Cmd<()> {
    with_store(&state, |s| s.rename_work(work_id, &title))
}

/// cmc を読み直してページ一覧に反映する（イラストはファイルがあるかを調べ直す。ファイルを持たない作品は何もしない）
#[tauri::command]
fn sync_work(state: State<AppState>, work_id: i64) -> Cmd<store::SyncResult> {
    let work = with_store(&state, |s| s.work_info(work_id))?;
    let path = match (work.kind.as_str(), work.cmc_path) {
        (store::KIND_COMIC, Some(path)) => path,
        (store::KIND_FILES, _) => {
            return with_store(&state, |s| s.refresh_files(work_id, |p| Path::new(p).exists(), now_ms()));
        }
        _ => return Ok(store::SyncResult { added: 0, missing: 0, merges: Vec::new(), splits: Vec::new() }),
    };
    if !Path::new(&path).exists() {
        return Err(trf(M::CmcMissing, &[("path", &path)]));
    }
    let comic = cmc::read_comic(Path::new(&path))?;
    with_store(&state, |s| {
        let result = s.sync_pages(work_id, &comic, now_ms())?;
        s.remove_empty_missing_pages(work_id)?;
        Ok(result)
    })
}

#[tauri::command]
fn get_board(state: State<AppState>, work_id: i64) -> Cmd<store::Board> {
    let mut board = with_store(&state, |s| s.board(work_id, now_ms()))?;
    // ファイルを持たない作品の行には、見つからないものがない
    if board.work.kind != store::KIND_MANUAL {
        for page in &mut board.pages {
            page.found = Path::new(&page.path).exists();
        }
    }
    Ok(board)
}

#[tauri::command]
fn set_task_done(state: State<AppState>, page_id: i64, stage_id: i64, done: bool) -> Cmd<()> {
    with_store(&state, |s| s.set_task_done(page_id, stage_id, done, now_ms()))
}

/// ページのサムネイルを data URL で返す（重いので、Tauri からは別のスレッドで呼ばせる）
#[tauri::command]
async fn load_thumbnail(state: State<'_, AppState>, path: String) -> Cmd<String> {
    thumbnail(&state, path)
}

fn thumbnail(state: &AppState, path: String) -> Cmd<String> {
    let path = PathBuf::from(path);
    let modified = std::fs::metadata(&path)
        .and_then(|m| m.modified())
        .map_err(|e| trf(M::PageFileNotFound, &[("e", &e)]))?;
    if let Some((time, url)) = state.thumbnails.lock().unwrap().get(&path)
        && *time == modified
    {
        return Ok(url.clone());
    }
    let is_psd = path
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("psd") || e.eq_ignore_ascii_case("psb"));
    let (mime, bytes) = if is_psd {
        ("image/jpeg", cmc::read_psd_thumbnail(&path)?)
    } else {
        ("image/png", cmc::read_thumbnail(&path, THUMBNAIL_WIDTH)?)
    };
    let url = format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes));
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
fn add_stage(state: State<AppState>, set_id: i64, name: String, color: String) -> Cmd<store::StageDef> {
    with_store(&state, |s| s.add_stage_in_set(set_id, &name, &color))
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

// ----- タグ -----

#[tauri::command]
fn list_tags(state: State<AppState>) -> Cmd<Vec<store::TagGroup>> {
    with_store(&state, |s| s.list_tags())
}

#[tauri::command]
fn set_page_tag(state: State<AppState>, page_ids: Vec<i64>, tag_id: i64, on: bool) -> Cmd<()> {
    with_store(&state, |s| s.set_page_tag(&page_ids, tag_id, on))
}

#[tauri::command]
fn add_tag_group(state: State<AppState>, name: String, exclusive: bool, set_ids: Vec<i64>) -> Cmd<i64> {
    with_store(&state, |s| s.add_tag_group(&name, exclusive, &set_ids))
}

#[tauri::command]
fn update_tag_group(state: State<AppState>, id: i64, name: String, exclusive: bool, set_ids: Vec<i64>) -> Cmd<()> {
    with_store(&state, |s| s.update_tag_group(id, &name, exclusive, &set_ids))
}

#[tauri::command]
fn add_tag(state: State<AppState>, group_id: i64, name: String, initial_factor: f64) -> Cmd<i64> {
    with_store(&state, |s| s.add_tag(group_id, &name, initial_factor))
}

#[tauri::command]
fn update_tag(state: State<AppState>, id: i64, name: String, initial_factor: f64) -> Cmd<()> {
    with_store(&state, |s| s.update_tag(id, &name, initial_factor))
}

#[tauri::command]
fn set_tag_hidden(state: State<AppState>, id: i64, hidden: bool) -> Cmd<()> {
    with_store(&state, |s| s.set_tag_hidden(id, hidden))
}

// ----- 予測・スケジュール -----

#[tauri::command]
fn get_prediction(state: State<AppState>, work_id: i64) -> Cmd<store::Prediction> {
    with_store(&state, |s| s.prediction(work_id, now_ms()))
}

#[tauri::command]
fn get_model_stats(state: State<AppState>) -> Cmd<store::ModelStats> {
    with_store(&state, |s| s.model_stats())
}

#[tauri::command]
fn get_schedule(state: State<AppState>, work_id: i64) -> Cmd<store::WorkSchedule> {
    with_store(&state, |s| s.schedule(work_id))
}

#[tauri::command]
fn set_work_hours(state: State<AppState>, work_id: i64, hours: Option<[f64; 7]>) -> Cmd<()> {
    with_store(&state, |s| s.set_work_hours(work_id, hours))
}

#[tauri::command]
fn set_default_hours(state: State<AppState>, hours: [f64; 7]) -> Cmd<()> {
    with_store(&state, |s| s.set_default_hours(hours))
}

#[tauri::command]
fn set_deadline(state: State<AppState>, work_id: i64, deadline: Option<String>) -> Cmd<()> {
    with_store(&state, |s| s.set_deadline(work_id, deadline.as_deref()))
}

#[tauri::command]
fn set_work_order(state: State<AppState>, work_id: i64, order: String) -> Cmd<()> {
    with_store(&state, |s| s.set_work_order(work_id, &order))
}

#[tauri::command]
fn get_day_start_hour(state: State<AppState>) -> Cmd<i64> {
    with_store(&state, |s| s.day_start_hour())
}

#[tauri::command]
fn set_day_start_hour(state: State<AppState>, hour: i64) -> Cmd<()> {
    with_store(&state, |s| s.set_day_start_hour(hour))
}

/// 全作品の既定の作業時間（月〜日）と休みの日
#[tauri::command]
fn get_calendar(state: State<AppState>) -> Cmd<([f64; 7], Vec<String>)> {
    with_store(&state, |s| Ok((s.default_hours()?, s.days_off()?)))
}

#[tauri::command]
fn set_day_off(state: State<AppState>, date: String, off: bool) -> Cmd<()> {
    with_store(&state, |s| s.set_day_off(&date, off))
}

// ----- ステップ4：止め忘れ・保存の検知・見開き・ミニ窓 -----

/// 指定した時刻で計測を止める（止め忘れの確認で、操作が無くなった時刻に戻すため）
#[tauri::command]
fn stop_timer_at(state: State<AppState>, at: i64) -> Cmd<Option<store::StopResult>> {
    with_store(&state, |s| s.stop_timer(at.min(now_ms())))
}

#[tauri::command]
fn set_session_end(state: State<AppState>, id: i64, ended_at: i64) -> Cmd<()> {
    with_store(&state, |s| s.set_session_end(id, ended_at, now_ms()))
}

/// 最後に操作してからの経過時間（ミリ秒）。PC のキーボード・マウスの操作と、
/// 遠隔の画面から要求が来たことのうち、新しい方を見る（5.17）
#[tauri::command]
fn idle_ms(state: State<AppState>) -> u64 {
    desktop::idle_ms().min(state.remote_idle_ms())
}

/// 作品のページファイルの更新日時（ページ ID, ミリ秒）。保存の検知に使う
#[tauri::command]
fn page_mtimes(state: State<AppState>, work_id: i64) -> Cmd<Vec<(i64, i64)>> {
    if with_store(&state, |s| s.work_info(work_id))?.kind == store::KIND_MANUAL {
        return Ok(Vec::new());
    }
    let (files, active) = with_store(&state, |s| Ok((s.page_paths(work_id)?, s.active_session()?)))?;
    // 見開きを分けた 2 行は同じファイルなので、計測中のページと同じファイルの行は「別のページ」にしない
    let active_path = active
        .filter(|a| a.work_id == work_id)
        .and_then(|a| files.iter().find(|(id, _)| *id == a.page_id).map(|(_, p)| p.clone()));
    Ok(files
        .into_iter()
        .filter(|(_, path)| active_path.as_ref() != Some(path))
        .filter_map(|(id, path)| {
            let modified = std::fs::metadata(path).and_then(|m| m.modified()).ok()?;
            let ms = modified.duration_since(std::time::UNIX_EPOCH).ok()?.as_millis() as i64;
            Some((id, ms))
        })
        .collect())
}

#[tauri::command]
fn merge_pages(state: State<AppState>, from: i64, to: i64) -> Cmd<()> {
    with_store(&state, |s| s.merge_pages(from, to))
}

#[tauri::command]
fn split_page(state: State<AppState>, page_id: i64, new_page_id: i64, half: bool) -> Cmd<()> {
    with_store(&state, |s| s.split_page(page_id, new_page_id, half))
}

#[tauri::command]
fn set_stage_order(state: State<AppState>, ids: Vec<i64>) -> Cmd<()> {
    with_store(&state, |s| s.set_stage_order(&ids))
}

#[tauri::command]
fn get_timer_prefs(state: State<AppState>) -> Cmd<store::TimerPrefs> {
    with_store(&state, |s| s.timer_prefs())
}

/// タイマーの設定を保存する。ショートカットが登録できないときは保存しない
#[tauri::command]
fn set_timer_prefs(app: AppHandle, state: State<AppState>, prefs: store::TimerPrefs) -> Cmd<()> {
    let old = with_store(&state, |s| s.timer_prefs())?;
    if let Err(e) = desktop::register_shortcut(&app, &prefs.shortcut) {
        let _ = desktop::register_shortcut(&app, &old.shortcut);
        return Err(e);
    }
    with_store(&state, |s| s.set_timer_prefs(&prefs))
}

#[tauri::command]
fn get_display_prefs(state: State<AppState>) -> Cmd<store::DisplayPrefs> {
    with_store(&state, |s| s.display_prefs())
}

#[tauri::command]
fn get_check_updates(state: State<AppState>) -> Cmd<bool> {
    with_store(&state, |s| s.check_updates())
}

#[tauri::command]
fn set_check_updates(state: State<AppState>, on: bool) -> Cmd<()> {
    with_store(&state, |s| s.set_check_updates(on))
}

#[tauri::command]
fn set_display_prefs(state: State<AppState>, prefs: store::DisplayPrefs) -> Cmd<()> {
    with_store(&state, |s| s.set_display_prefs(&prefs))?;
    i18n::set(i18n::Lang::from_pref(&prefs.language));
    Ok(())
}

/// OS の言語（設定が「自動」のときに使う）
#[tauri::command]
fn get_system_language() -> String {
    i18n::Lang::system().code().into()
}

/// Windows では同期コマンドの中で窓を作るとデッドロックするため、窓の操作は async にする
#[tauri::command]
async fn open_mini(app: AppHandle) -> Cmd<()> {
    desktop::open_mini(&app)
}

#[tauri::command]
async fn close_mini(app: AppHandle) -> Cmd<()> {
    desktop::close_mini(&app)
}

#[tauri::command]
async fn set_mini_compact(app: AppHandle, compact: bool) -> Cmd<()> {
    desktop::set_mini_compact(&app, compact)
}

#[tauri::command]
async fn set_mini_on_top(app: AppHandle, on_top: bool) -> Cmd<()> {
    desktop::set_mini_on_top(&app, on_top)
}

#[tauri::command]
async fn focus_main(app: AppHandle) -> Cmd<()> {
    desktop::focus_main(&app)
}

// ----- ステップ5：データ -----

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DataInfo {
    db_path: String,
    version: String,
}

#[tauri::command]
fn data_info(app: AppHandle, state: State<AppState>) -> DataInfo {
    DataInfo { db_path: state.db_path.display().to_string(), version: app.package_info().version.to_string() }
}

#[tauri::command]
fn backup_data(state: State<AppState>, dest: String) -> Cmd<()> {
    with_store(&state, |s| s.backup_to(Path::new(&dest)))
}

/// 月の予定の .ics を保存する（中身は画面側で作る）
#[tauri::command]
fn save_calendar(dest: String, text: String) -> Cmd<()> {
    std::fs::write(&dest, text).map_err(|e| trf(M::CalendarSaveFailed, &[("e", &e)]))
}

/// 今の画面を印刷する（印刷の画面で PDF にも保存できる）。Mac の WKWebView は window.print() が効かないため Tauri 経由で呼ぶ
#[tauri::command]
fn print_page(webview: tauri::Webview) -> Cmd<()> {
    #[cfg(target_os = "macos")]
    let r = desktop::print_landscape(&webview);
    #[cfg(not(target_os = "macos"))]
    let r = webview.print();
    r.map_err(|e| trf(M::PrintFailed, &[("e", &e)]))
}

/// データの保存場所をエクスプローラーで開く
#[tauri::command]
fn reveal_data(app: AppHandle, state: State<AppState>) -> Cmd<()> {
    app.opener()
        .reveal_item_in_dir(&state.db_path)
        .map_err(|e| trf(M::OpenDataDirFailed, &[("e", &e)]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 遠隔からの合図が無ければ無操作の判定に混ざらない() {
        let state = AppState::new(Store::open_in_memory().unwrap(), PathBuf::from("otosazu.db"));
        // 一度も来ていなければ、PC の無操作時間がそのまま使われる（min を取るので大きい値を返す）
        assert_eq!(state.remote_idle_ms(), u64::MAX);
        assert_eq!(1_000_u64.min(state.remote_idle_ms()), 1_000);

        // 合図が来たら、そこからの経過時間になる。PC を触っていなくても「操作中」と見なされる
        state.mark_remote();
        assert!(state.remote_idle_ms() < 1_000, "合図の直後は無操作の時間がほぼ 0");
        assert_eq!(600_000_u64.min(state.remote_idle_ms()), state.remote_idle_ms());
    }
}

// ----- 遠隔の画面（別端末のブラウザ。5.17） -----

#[tauri::command]
fn get_remote_prefs(state: State<AppState>) -> Cmd<store::RemotePrefs> {
    with_store(&state, |s| s.remote_prefs())
}

/// 設定を保存して受け付けを立て直す。戻り値は保存した設定（合言葉が作られることがある）
#[tauri::command]
fn set_remote_prefs(app: AppHandle, state: State<AppState>, prefs: store::RemotePrefs) -> Cmd<store::RemotePrefs> {
    let saved = with_store(&state, |s| s.set_remote_prefs(&prefs))?;
    server::apply(&app, &saved)?;
    Ok(saved)
}

/// 合言葉を作り直す。別端末はもう一度 URL から読み込み直すことになる
#[tauri::command]
fn new_remote_token(app: AppHandle, state: State<AppState>) -> Cmd<store::RemotePrefs> {
    let saved = with_store(&state, |s| s.new_remote_token())?;
    server::apply(&app, &saved)?;
    Ok(saved)
}

/// PC が持っているアドレス（設定画面で待ち受ける先を選ぶのに使う）
#[tauri::command]
fn local_addresses() -> Vec<String> {
    server::local_addresses()
}

/// 遠隔の画面（server.rs）からコマンドを呼ぶ。呼べる名前は server.rs の `ALLOWED` で絞ってある
fn dispatch(app: &AppHandle, name: &str, args: &serde_json::Value) -> Result<serde_json::Value, String> {
    /// 引数を 1 つ取り出す。名前は Tauri と同じ camelCase
    fn arg<T: serde::de::DeserializeOwned>(args: &serde_json::Value, key: &str) -> Result<T, String> {
        serde_json::from_value(args.get(key).cloned().unwrap_or(serde_json::Value::Null))
            .map_err(|e| format!("{key}: {e}"))
    }
    fn out<T: serde::Serialize>(result: Cmd<T>) -> Result<serde_json::Value, String> {
        result.and_then(|v| serde_json::to_value(v).map_err(|e| e.to_string()))
    }

    let state = app.state::<AppState>();
    match name {
        "list_works" => out(list_works(state)),
        "get_board" => out(get_board(state, arg(args, "workId")?)),
        "set_task_done" => out(set_task_done(state, arg(args, "pageId")?, arg(args, "stageId")?, arg(args, "done")?)),
        "get_active_session" => out(get_active_session(state)),
        "start_timer" => out(start_timer(state, arg(args, "pageId")?, arg(args, "stageId")?)),
        "stop_timer" => out(stop_timer(state)),
        "get_prediction" => out(get_prediction(state, arg(args, "workId")?)),
        "get_schedule" => out(get_schedule(state, arg(args, "workId")?)),
        "list_spans" => out(list_spans(state, arg(args, "from")?)),
        "get_day_start_hour" => out(get_day_start_hour(state)),
        "get_display_prefs" => out(get_display_prefs(state)),
        "get_system_language" => Ok(serde_json::Value::String(get_system_language())),
        "load_thumbnail" => out(thumbnail(&state, arg(args, "path")?)),
        _ => Err(format!("unknown command: {name}")),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // 開発・確認用に、環境変数 OTOSAZU_DB で保存先を差し替えられる
            let path = match std::env::var_os("OTOSAZU_DB") {
                Some(p) => PathBuf::from(p),
                None => app.path().app_data_dir()?.join("otosazu.db"),
            };
            // 初回起動ならデータベースの初期の工程・タグを OS の言語で作るので、先に OS の言語にしておく
            i18n::set(i18n::Lang::system());
            let store = Store::open(&path)?;
            if let Ok(prefs) = store.display_prefs() {
                i18n::set(i18n::Lang::from_pref(&prefs.language));
            }
            // ショートカットが他のアプリと重なっていても、起動は続ける（設定画面で変えられる）
            if let Ok(prefs) = store.timer_prefs()
                && let Err(e) = desktop::register_shortcut(app.handle(), &prefs.shortcut)
            {
                eprintln!("{e}");
            }
            app.manage(AppState::new(store, path));
            // 遠隔の画面の受け付け（既定はオフ）。ポートが使えなくても起動は続ける（設定画面で変えられる）
            let remote = app.state::<AppState>().store.lock().ok().and_then(|s| s.remote_prefs().ok());
            if let Some(prefs) = remote
                && let Err(e) = server::apply(app.handle(), &prefs)
            {
                eprintln!("{e}");
            }
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
            list_tags,
            set_page_tag,
            add_tag_group,
            update_tag_group,
            add_tag,
            update_tag,
            set_tag_hidden,
            get_prediction,
            get_model_stats,
            get_schedule,
            set_work_hours,
            set_default_hours,
            set_deadline,
            set_work_order,
            set_day_off,
            get_calendar,
            stop_timer_at,
            set_session_end,
            idle_ms,
            page_mtimes,
            merge_pages,
            split_page,
            set_stage_order,
            get_timer_prefs,
            set_timer_prefs,
            open_mini,
            close_mini,
            set_mini_compact,
            set_mini_on_top,
            focus_main,
            data_info,
            backup_data,
            save_calendar,
            print_page,
            reveal_data,
            check_relink,
            relink_work,
            get_display_prefs,
            set_display_prefs,
            get_system_language,
            get_check_updates,
            set_check_updates,
            add_files_work,
            add_files,
            remove_file,
            set_file_order,
            relink_file,
            list_stage_sets,
            get_day_start_hour,
            set_day_start_hour,
            add_manual_work,
            set_split_spreads,
            add_rows,
            rename_row,
            rename_work,
            add_stage_set,
            update_stage_set,
            remove_stage_set,
            get_remote_prefs,
            set_remote_prefs,
            new_remote_token,
            local_addresses,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
