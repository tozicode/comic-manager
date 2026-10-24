//! デスクトップまわり：ミニタイマー窓、グローバルショートカット、PC の無操作時間

use tauri::{AppHandle, Emitter, LogicalSize, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use crate::i18n::{M, tr, trf};

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
        .title(tr(M::MiniTitle))
        .inner_size(MINI_SIZE.0, MINI_SIZE.1)
        .resizable(false)
        .decorations(false)
        .always_on_top(true)
        .build()
        .map_err(err)?;
    Ok(())
}

pub fn set_mini_compact(app: &AppHandle, compact: bool) -> Result<(), String> {
    let w = app.get_webview_window(MINI_LABEL).ok_or(tr(M::MiniNotOpen))?;
    let (width, height) = if compact { MINI_COMPACT_SIZE } else { MINI_SIZE };
    w.set_size(LogicalSize::new(width, height)).map_err(err)
}

pub fn set_mini_on_top(app: &AppHandle, on_top: bool) -> Result<(), String> {
    let w = app.get_webview_window(MINI_LABEL).ok_or(tr(M::MiniNotOpen))?;
    w.set_always_on_top(on_top).map_err(err)
}

pub fn close_mini(app: &AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(MINI_LABEL) {
        w.close().map_err(err)?;
    }
    Ok(())
}

pub fn focus_main(app: &AppHandle) -> Result<(), String> {
    let w = app.get_webview_window("main").ok_or(tr(M::MainWindowNotFound))?;
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
        .map_err(|_| trf(M::ShortcutInvalid, &[("shortcut", &shortcut)]))?;
    gs.on_shortcut(parsed, |app, _, event| {
        if event.state == ShortcutState::Pressed {
            let _ = app.emit_to("main", TOGGLE_EVENT, ());
        }
    })
    .map_err(|e| trf(M::ShortcutRegisterFailed, &[("e", &e)]))
}

/// 印刷の画面を A4 横・余白なしで開く（Mac）。WKWebView の印刷は CSS の @page（用紙と向き）を見ず、
/// wry の print() も向きを決めないので、ここで決める。余白は印刷用の CSS で取る
#[cfg(target_os = "macos")]
pub fn print_landscape(webview: &tauri::Webview) -> tauri::Result<()> {
    use objc2_app_kit::{NSPaperOrientation, NSPrintInfo};
    use objc2_foundation::NSSize;
    use objc2_web_kit::WKWebView;

    webview.with_webview(|wv| {
        // SAFETY: with_webview はメインスレッドで呼ばれ、inner() はこの窓の WKWebView を指す
        unsafe {
            let view = &*wv.inner().cast::<WKWebView>();
            let Some(window) = view.window() else { return };
            // 共有の設定を使い、前回選んだプリンターなどは引き継ぐ。用紙と向きは毎回 A4 横に戻す
            // （横のまま縦の大きさを入れると縦になるので、いったん縦にしてから大きさを入れる）
            let info = NSPrintInfo::sharedPrintInfo();
            info.setOrientation(NSPaperOrientation::Portrait);
            info.setPaperSize(NSSize::new(595.276, 841.89));
            info.setOrientation(NSPaperOrientation::Landscape);
            info.setTopMargin(0.0);
            info.setRightMargin(0.0);
            info.setBottomMargin(0.0);
            info.setLeftMargin(0.0);
            let op = view.printOperationWithPrintInfo(&info);
            op.setCanSpawnSeparateThread(true);
            op.runOperationModalForWindow_delegate_didRunSelector_contextInfo(&window, None, None, std::ptr::null_mut());
        }
    })
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

#[cfg(target_os = "macos")]
pub fn idle_ms() -> u64 {
    #[link(name = "CoreGraphics", kind = "framework")]
    unsafe extern "C" {
        fn CGEventSourceSecondsSinceLastEventType(state_id: i32, event_type: u32) -> f64;
    }
    /// kCGEventSourceStateCombinedSessionState
    const COMBINED_SESSION: i32 = 0;
    /// kCGAnyInputEventType
    const ANY_INPUT: u32 = !0;
    // SAFETY: 値を渡して秒数を受け取るだけの関数で、ポインタは扱わない
    let secs = unsafe { CGEventSourceSecondsSinceLastEventType(COMBINED_SESSION, ANY_INPUT) };
    (secs.max(0.0) * 1000.0) as u64
}

/// その他の OS はまだ対応していない（常に「操作中」とみなし、止め忘れの確認を出さない）
#[cfg(not(any(windows, target_os = "macos")))]
pub fn idle_ms() -> u64 {
    0
}

fn err(e: impl std::fmt::Display) -> String {
    trf(M::WindowOpFailed, &[("e", &e)])
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
