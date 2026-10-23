//! タイマーまわりの設定：止め忘れを検知するまでの時間、グローバルショートカット、保存の検知

use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};

use super::{Result, Store, db_err};

const KEY: &str = "timer_prefs";

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TimerPrefs {
    /// この時間（分）PC の操作がなければ一時停止して確認する。0 なら確認しない
    pub idle_minutes: i64,
    /// 一時停止・再開のショートカット（例: "Ctrl+Alt+Space"）。空なら使わない
    pub shortcut: String,
    /// 計測中に別のページが保存されたら知らせる
    pub watch_saves: bool,
}

impl Default for TimerPrefs {
    fn default() -> Self {
        Self { idle_minutes: 10, shortcut: "Ctrl+Alt+Space".into(), watch_saves: true }
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
            return Err("確認するまでの時間は 0〜240 分にしてください".into());
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 既定値と保存() {
        let store = Store::open_in_memory().unwrap();
        assert_eq!(store.timer_prefs().unwrap(), TimerPrefs::default());
        let p = TimerPrefs { idle_minutes: 15, shortcut: "Ctrl+Shift+P".into(), watch_saves: false };
        store.set_timer_prefs(&p).unwrap();
        assert_eq!(store.timer_prefs().unwrap(), p);
        assert!(store.set_timer_prefs(&TimerPrefs { idle_minutes: -1, ..p }).is_err());
    }
}
