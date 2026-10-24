//! 設定：タイマーまわり（止め忘れを検知するまでの時間、グローバルショートカット、保存の検知）と表示、更新の確認

use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};

use crate::i18n::{M, tr};

use super::{Result, Store, db_err};

const KEY: &str = "timer_prefs";
const DISPLAY_KEY: &str = "display_prefs";
const CHECK_UPDATES_KEY: &str = "check_updates";

/// 表示の設定
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct DisplayPrefs {
    /// 時間の表記："hm"（1時間30分）/ "clock"（1:30）/ "decimal"（1.5h）
    pub time_format: String,
    /// 色："system"（OS に合わせる）/ "light" / "dark"
    pub theme: String,
    /// 言語："system"（OS に合わせる）/ "ja" / "en" / "ko" / "zh-Hans" / "zh-Hant"
    pub language: String,
}

impl Default for DisplayPrefs {
    fn default() -> Self {
        Self { time_format: "hm".into(), theme: "system".into(), language: "system".into() }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct TimerPrefs {
    /// この時間（分）PC の操作がなければ一時停止して確認する。0 なら確認しない
    pub idle_minutes: i64,
    /// 一時停止・再開のショートカット（例: "Ctrl+Alt+Space"）。空なら使わない
    pub shortcut: String,
    /// 計測中に別のページが保存されたら知らせる
    pub watch_saves: bool,
    /// ポモドーロを使う
    pub pomodoro: bool,
    /// ポモドーロの作業・短い休憩・長い休憩の長さ（分）
    pub pomo_work_min: i64,
    pub pomo_short_min: i64,
    pub pomo_long_min: i64,
    /// 何回ごとに長い休憩にするか
    pub pomo_long_every: i64,
    /// 時間になったら音で知らせる
    pub pomo_sound: bool,
}

impl Default for TimerPrefs {
    fn default() -> Self {
        Self {
            idle_minutes: 10,
            shortcut: "Ctrl+Alt+Space".into(),
            watch_saves: true,
            pomodoro: false,
            pomo_work_min: 25,
            pomo_short_min: 5,
            pomo_long_min: 15,
            pomo_long_every: 4,
            pomo_sound: true,
        }
    }
}

impl Store {
    pub fn timer_prefs(&self) -> Result<TimerPrefs> {
        let raw: Option<String> = self
            .conn
            .query_row("SELECT value FROM setting WHERE key = ?1", [KEY], |r| r.get(0))
            .optional()
            .map_err(db_err)?;
        Ok(raw.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default())
    }

    pub fn set_timer_prefs(&self, prefs: &TimerPrefs) -> Result<()> {
        if !(0..=240).contains(&prefs.idle_minutes) {
            return Err(tr(M::IdleMinutesRange).into());
        }
        let minutes_ok = |m: i64| (1..=180).contains(&m);
        if !minutes_ok(prefs.pomo_work_min)
            || !minutes_ok(prefs.pomo_short_min)
            || !minutes_ok(prefs.pomo_long_min)
            || !(1..=12).contains(&prefs.pomo_long_every)
        {
            return Err(tr(M::PomodoroRange).into());
        }
        self.conn
            .execute(
                "INSERT INTO setting (key, value) VALUES (?1, ?2)
                 ON CONFLICT (key) DO UPDATE SET value = excluded.value",
                params![KEY, serde_json::to_string(prefs).unwrap_or_default()],
            )
            .map_err(db_err)?;
        Ok(())
    }
}

impl Store {
    pub fn display_prefs(&self) -> Result<DisplayPrefs> {
        let raw: Option<String> = self
            .conn
            .query_row("SELECT value FROM setting WHERE key = ?1", [DISPLAY_KEY], |r| r.get(0))
            .optional()
            .map_err(db_err)?;
        Ok(raw.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default())
    }

    pub fn set_display_prefs(&self, prefs: &DisplayPrefs) -> Result<()> {
        if !["hm", "clock", "decimal"].contains(&prefs.time_format.as_str()) {
            return Err(tr(M::TimeFormatInvalid).into());
        }
        if !["system", "light", "dark"].contains(&prefs.theme.as_str()) {
            return Err(tr(M::ThemeInvalid).into());
        }
        if !["system", "ja", "en", "ko", "zh-Hans", "zh-Hant"].contains(&prefs.language.as_str()) {
            return Err(tr(M::LanguageInvalid).into());
        }
        self.conn
            .execute(
                "INSERT INTO setting (key, value) VALUES (?1, ?2)
                 ON CONFLICT (key) DO UPDATE SET value = excluded.value",
                params![DISPLAY_KEY, serde_json::to_string(prefs).unwrap_or_default()],
            )
            .map_err(db_err)?;
        Ok(())
    }
}

impl Store {
    /// 起動時に新しい版を確認するか（既定はする）
    pub fn check_updates(&self) -> Result<bool> {
        let raw: Option<String> = self
            .conn
            .query_row("SELECT value FROM setting WHERE key = ?1", [CHECK_UPDATES_KEY], |r| r.get(0))
            .optional()
            .map_err(db_err)?;
        Ok(raw.as_deref() != Some("0"))
    }

    pub fn set_check_updates(&self, on: bool) -> Result<()> {
        self.conn
            .execute(
                "INSERT INTO setting (key, value) VALUES (?1, ?2)
                 ON CONFLICT (key) DO UPDATE SET value = excluded.value",
                params![CHECK_UPDATES_KEY, if on { "1" } else { "0" }],
            )
            .map_err(db_err)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 既定値と保存() {
        let store = Store::open_in_memory().unwrap();
        assert_eq!(store.timer_prefs().unwrap(), TimerPrefs::default());
        let p = TimerPrefs {
            idle_minutes: 15,
            shortcut: "Ctrl+Shift+P".into(),
            watch_saves: false,
            pomodoro: true,
            pomo_work_min: 50,
            ..Default::default()
        };
        store.set_timer_prefs(&p).unwrap();
        assert_eq!(store.timer_prefs().unwrap(), p);
        assert!(store.set_timer_prefs(&TimerPrefs { idle_minutes: -1, ..p.clone() }).is_err());
        assert!(store.set_timer_prefs(&TimerPrefs { pomo_work_min: 0, ..p.clone() }).is_err());
        assert!(store.set_timer_prefs(&TimerPrefs { pomo_long_every: 13, ..p }).is_err());
    }

    #[test]
    fn ポモドーロの項目が無かった版のタイマー設定も読める() {
        let store = Store::open_in_memory().unwrap();
        // 2.0.0 までの設定（ポモドーロの項目が無い）
        store
            .conn
            .execute(
                "INSERT INTO setting (key, value) VALUES ('timer_prefs', ?1)",
                [r#"{"idleMinutes":20,"shortcut":"Ctrl+Alt+P","watchSaves":false}"#],
            )
            .unwrap();
        let p = store.timer_prefs().unwrap();
        assert_eq!((p.idle_minutes, p.shortcut.as_str(), p.watch_saves), (20, "Ctrl+Alt+P", false));
        assert!(!p.pomodoro);
        assert_eq!(p.pomo_work_min, 25);
    }

    #[test]
    fn 時間の表記は既定が時間と分() {
        let store = Store::open_in_memory().unwrap();
        assert_eq!(store.display_prefs().unwrap().time_format, "hm");
        store.set_display_prefs(&DisplayPrefs { time_format: "clock".into(), ..Default::default() }).unwrap();
        assert_eq!(store.display_prefs().unwrap().time_format, "clock");
        assert!(store.set_display_prefs(&DisplayPrefs { time_format: "x".into(), ..Default::default() }).is_err());
    }

    #[test]
    fn 色は既定が自動で_前の版の設定も読める() {
        let store = Store::open_in_memory().unwrap();
        assert_eq!(store.display_prefs().unwrap().theme, "system");
        // 色の項目が無かった版（1.0.0）で保存した設定
        store
            .conn
            .execute("INSERT INTO setting (key, value) VALUES (?1, ?2)", params![DISPLAY_KEY, r#"{"timeFormat":"clock"}"#])
            .unwrap();
        assert_eq!(
            store.display_prefs().unwrap(),
            DisplayPrefs { time_format: "clock".into(), theme: "system".into(), language: "system".into() }
        );
        store.set_display_prefs(&DisplayPrefs { theme: "dark".into(), ..Default::default() }).unwrap();
        assert_eq!(store.display_prefs().unwrap().theme, "dark");
        assert!(store.set_display_prefs(&DisplayPrefs { theme: "x".into(), ..Default::default() }).is_err());
        store.set_display_prefs(&DisplayPrefs { language: "zh-Hant".into(), ..Default::default() }).unwrap();
        assert_eq!(store.display_prefs().unwrap().language, "zh-Hant");
        assert!(store.set_display_prefs(&DisplayPrefs { language: "fr".into(), ..Default::default() }).is_err());
    }

    #[test]
    fn 更新の確認は既定でする() {
        let store = Store::open_in_memory().unwrap();
        assert!(store.check_updates().unwrap());
        store.set_check_updates(false).unwrap();
        assert!(!store.check_updates().unwrap());
        store.set_check_updates(true).unwrap();
        assert!(store.check_updates().unwrap());
    }
}
