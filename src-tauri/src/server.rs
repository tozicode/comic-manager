//! 遠隔の画面（別端末のブラウザ）への受け付け（仕様書 5.17）
//!
//! アプリと同じプロセスで小さな HTTP サーバを立てる。データベースは `AppState` の `Store` を
//! そのまま共有するので、別プロセスのサーバは立てない（SQLite の書き込みが衝突する）。
//!
//! - `POST /cmd/<名前>`：下の `ALLOWED` にあるコマンドだけを呼ぶ
//! - それ以外：アプリに埋め込んである画面（dist）を返す
//!
//! 合言葉を確かめるのは記録を扱う `/cmd/` だけにする。画面そのものは配布しているアプリと同じもので、
//! 秘密ではないため。

use std::net::SocketAddr;
use std::sync::Arc;
use std::thread;

use tauri::{AppHandle, Emitter, Manager};
use tiny_http::{Header, Request, Response, Server};

use crate::i18n::{M, trf};
use crate::store::RemotePrefs;

/// 合言葉を送るヘッダ（画面側の api.ts と合わせる）
const TOKEN_HEADER: &str = "x-otosazu-token";

/// 受け付けるコマンド。ここに無い名前は、綴りが合っていても断る（5.17）
const ALLOWED: &[&str] = &[
    "list_works",
    "get_board",
    "get_active_session",
    "start_timer",
    "stop_timer",
    "set_task_done",
    "get_prediction",
    "get_schedule",
    "load_thumbnail",
    "get_display_prefs",
    "get_day_start_hour",
    "list_stage_sets",
];

/// 記録が変わるコマンド。終わったらアプリの窓に知らせて読み直させる
const CHANGING: &[&str] = &["start_timer", "stop_timer", "set_task_done"];

/// データが変わったことを知らせるイベント（画面側の app-context.tsx と同じ）
const CHANGED_EVENT: &str = "otosazu://changed";

/// 設定どおりに受け付けを始める／止める。戻り値は待ち受けている場所（止めているときは None）
pub fn apply(app: &AppHandle, prefs: &RemotePrefs) -> Result<Option<SocketAddr>, String> {
    stop(app);
    if !prefs.enabled {
        return Ok(None);
    }
    let addr: SocketAddr = format!("{}:{}", prefs.bind, prefs.port)
        .parse()
        .map_err(|e| trf(M::RemoteStartFailed, &[("e", &e)]))?;
    let server = Server::http(addr).map_err(|e| trf(M::RemoteStartFailed, &[("e", &e)]))?;
    let addr = server.server_addr().to_ip().unwrap_or(addr);
    let server = Arc::new(server);

    let listening = server.clone();
    let handle = app.clone();
    let token = prefs.token.clone();
    thread::spawn(move || {
        for req in listening.incoming_requests() {
            // 1 つの要求で失敗しても受け付けは続ける（相手が切ったなどはよくある）
            if let Err(e) = serve(&handle, req, &token) {
                eprintln!("遠隔の画面: {e}");
            }
        }
    });

    app.state::<crate::AppState>().remote.lock().map_err(|_| "remote busy".to_string())?.replace(server);
    Ok(Some(addr))
}

/// 受け付けを止める。`unblock` で待っている受け取りが終わり、見張りのスレッドも終わる
pub fn stop(app: &AppHandle) {
    if let Ok(mut slot) = app.state::<crate::AppState>().remote.lock()
        && let Some(server) = slot.take()
    {
        server.unblock();
    }
}

/// PC が持っているアドレスの一覧（設定画面で待ち受ける先を選ぶのに使う）。
/// 127.0.0.1 を先に、あとは見つかった順。IPv6 は出さない（URL が分かりにくいため）
pub fn local_addresses() -> Vec<String> {
    let mut list = vec!["127.0.0.1".to_string()];
    if let Ok(addrs) = if_addrs::get_if_addrs() {
        for a in addrs {
            let ip = a.ip();
            if ip.is_ipv4() && !ip.is_loopback() {
                let text = ip.to_string();
                if !list.contains(&text) {
                    list.push(text);
                }
            }
        }
    }
    list
}

fn serve(app: &AppHandle, req: Request, token: &str) -> Result<(), String> {
    let url = req.url().to_string();
    let path = url.split('?').next().unwrap_or("").to_string();
    match path.strip_prefix("/cmd/") {
        Some(name) => command(app, req, &name.to_string(), token),
        None => asset(app, req, &path),
    }
}

fn command(app: &AppHandle, mut req: Request, name: &str, token: &str) -> Result<(), String> {
    if req.method().as_str() != "POST" {
        return reply(req, 405, br#"{"error":"POST only"}"#.to_vec(), "application/json");
    }
    if !sent_token(&req).is_some_and(|t| t == token) {
        return reply(req, 401, br#"{"error":"bad token"}"#.to_vec(), "application/json");
    }
    if !ALLOWED.contains(&name) {
        return reply(req, 404, br#"{"error":"unknown command"}"#.to_vec(), "application/json");
    }

    // 合言葉の合った要求が来ている間は「操作している」とみなす（止め忘れの検知。5.17）
    app.state::<crate::AppState>().mark_remote();

    let mut body = String::new();
    req.as_reader().read_to_string(&mut body).map_err(|e| e.to_string())?;
    let args: serde_json::Value = if body.trim().is_empty() {
        serde_json::Value::Object(Default::default())
    } else {
        match serde_json::from_str(&body) {
            Ok(v) => v,
            Err(e) => {
                let msg = serde_json::json!({ "error": e.to_string() }).to_string();
                return reply(req, 400, msg.into_bytes(), "application/json");
            }
        }
    };

    match crate::dispatch(app, name, &args) {
        Ok(value) => {
            if CHANGING.contains(&name) {
                let _ = app.emit(CHANGED_EVENT, serde_json::json!({ "from": "remote" }));
            }
            reply(req, 200, value.to_string().into_bytes(), "application/json")
        }
        Err(e) => {
            let msg = serde_json::json!({ "error": e }).to_string();
            reply(req, 400, msg.into_bytes(), "application/json")
        }
    }
}

/// 合言葉。ヘッダか、画面を開くときの `?t=` で受け取る
fn sent_token(req: &Request) -> Option<String> {
    let from_header = req
        .headers()
        .iter()
        .find(|h| h.field.equiv(TOKEN_HEADER))
        .map(|h| h.value.as_str().to_string());
    from_header.or_else(|| {
        let query = req.url().split_once('?')?.1.to_string();
        query.split('&').find_map(|pair| pair.strip_prefix("t=").map(|v| v.to_string()))
    })
}

fn asset(app: &AppHandle, req: Request, path: &str) -> Result<(), String> {
    let name = if path == "/" { "index.html" } else { path.trim_start_matches('/') };
    match app.asset_resolver().get(name.to_string()) {
        Some(a) => {
            let mime = a.mime_type.clone();
            reply(req, 200, a.bytes, &mime)
        }
        // 開発中（devUrl で動かしているとき）は dist が無いことがある
        None => reply(req, 404, b"not found".to_vec(), "text/plain; charset=utf-8"),
    }
}

fn reply(req: Request, status: u16, body: Vec<u8>, mime: &str) -> Result<(), String> {
    let header = Header::from_bytes("Content-Type", mime).map_err(|_| "bad mime".to_string())?;
    let res = Response::from_data(body).with_status_code(status).with_header(header);
    req.respond(res).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 受け付けるコマンドは記録を見るか計測するものだけ() {
        // ファイルを選ぶ・窓を動かす・データを書き出すコマンドは入れない（5.17）
        for name in ["add_work", "open_mini", "backup_data", "set_timer_prefs", "reveal_data", "print_page"] {
            assert!(!ALLOWED.contains(&name), "{name} は受け付けてはいけない");
        }
        // 記録が変わるものは、アプリの窓に知らせる一覧にも入っている
        for name in CHANGING {
            assert!(ALLOWED.contains(name), "{name} が受け付けの一覧に無い");
        }
    }

    #[test]
    fn アドレスの一覧は自分だけを先に出す() {
        let list = local_addresses();
        assert_eq!(list[0], "127.0.0.1");
        // 同じアドレスが二度出ない
        let mut sorted = list.clone();
        sorted.sort();
        sorted.dedup();
        assert_eq!(sorted.len(), list.len());
    }
}
