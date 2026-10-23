//! デスクトップまわり：ミニタイマー窓、グローバルショートカット、PC の無操作時間

use tauri::{AppHandle, Emitter, LogicalSize, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

pub const MINI_LABEL: &str = "mini";
/// ショートカットが押されたときに画面へ送るイベント
pub const TOGGLE_EVENT: &str = "otosazu://toggle-timer";

const MINI_SIZE: (f64, f64) = (340.0, 196.0);
const MINI_COMPACT_SIZE: (f64, f64) = (236.0, 64.0);

/// ミニタイマー窓を開く（開いていれば前に出す）。中身は同じ画面で、窓のラベルを見て切り替える
pub fn open_mini(app: &AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(MINI_LABEL) {
        w.show().map_err(err)?;
        return w.set_focus().map_err(err);
    }
    WebviewWindowBuilder::new(app, MINI_LABEL, WebviewUrl::App("index.html".into()))
        .title("Otosazu ミニタイマー")
        .inner_size(MINI_SIZE.0, MINI_SIZE.1)
        .resizable(false)
        .decorations(false)
        .always_on_top(true)
        .build()
        .map_err(err)?;
    Ok(())
}

pub fn set_mini_compact(app: &AppHandle, compact: bool) -> Result<(), String> {
    let w = app.get_webview_window(MINI_LABEL).ok_or("ミニタイマー窓が開いていません")?;
    let (width, height) = if compact { MINI_COMPACT_SIZE } else { MINI_SIZE };
    w.set_size(LogicalSize::new(width, height)).map_err(err)
}

pub fn set_mini_on_top(app: &AppHandle, on_top: bool) -> Result<(), String> {
    let w = app.get_webview_window(MINI_LABEL).ok_or("ミニタイマー窓が開いていません")?;
    w.set_always_on_top(on_top).map_err(err)
}

pub fn close_mini(app: &AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(MINI_LABEL) {
        w.close().map_err(err)?;
    }
    Ok(())
}

pub fn focus_main(app: &AppHandle) -> Result<(), String> {
    let w = app.get_webview_window("main").ok_or("メインの窓が見つかりません")?;
    w.unminimize().map_err(err)?;
    w.show().map_err(err)?;
    w.set_focus().map_err(err)
}

/// ショートカットを登録し直す。空文字なら登録しない
pub fn register_shortcut(app: &AppHandle, shortcut: &str) -> Result<(), String> {
    let gs = app.global_shortcut();
    gs.unregister_all().map_err(err)?;
    if shortcut.trim().is_empty() {
        return Ok(());
    }
    let parsed: Shortcut = shortcut
        .parse()
        .map_err(|_| format!("「{shortcut}」はショートカットとして使えません"))?;
    gs.on_shortcut(parsed, |app, _, event| {
        if event.state == ShortcutState::Pressed {
            let _ = app.emit_to("main", TOGGLE_EVENT, ());
        }
    })
    .map_err(|e| format!("ショートカットを登録できませんでした（他のアプリが使っているかもしれません）: {e}"))
}

/// 最後にキーボードかマウスを操作してからの経過時間（ミリ秒）
#[cfg(windows)]
pub fn idle_ms() -> u64 {
    use windows_sys::Win32::System::SystemInformation::GetTickCount;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
    let mut info = LASTINPUTINFO { cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32, dwTime: 0 };
    // SAFETY: info は正しく初期化した LASTINPUTINFO で、関数の呼び出し中だけ参照される
    unsafe {
        if GetLastInputInfo(&mut info) != 0 {
            return GetTickCount().wrapping_sub(info.dwTime) as u64;
        }
    }
    0
}

/// Mac などはまだ対応していない（常に「操作中」とみなし、止め忘れの確認を出さない）
#[cfg(not(windows))]
pub fn idle_ms() -> u64 {
    0
}

fn err(e: impl std::fmt::Display) -> String {
    format!("窓の操作に失敗しました: {e}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ショートカットの書き方() {
        for ok in ["Ctrl+Alt+Space", "ctrl+shift+P", "Alt+F9"] {
            assert!(ok.parse::<Shortcut>().is_ok(), "{ok}");
        }
        assert!("Ctrl+".parse::<Shortcut>().is_err());
    }
}
