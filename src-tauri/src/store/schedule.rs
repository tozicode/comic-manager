//! スケジュールの設定：曜日ごとの作業時間、休みの日、締切、作業順。
//! 曜日ごとの作業時間は全作品の既定値があり、作品ごとに上書きできる。休みの日は全作品で共通。

use rusqlite::{OptionalExtension, params};
use serde::Serialize;

use super::{Result, Store, db_err};

/// 月〜日の作業時間（時間）
pub type WeekHours = [f64; 7];

const DEFAULT_HOURS_KEY: &str = "default_weekday_hours";
const DEFAULT_HOURS: WeekHours = [3.0, 3.0, 3.0, 3.0, 3.0, 6.0, 6.0];

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkSchedule {
    /// この作品で使う曜日ごとの作業時間（月〜日）
    pub weekday_hours: WeekHours,
    /// 作品独自の作業時間を設定しているか
    pub custom_hours: bool,
    pub default_weekday_hours: WeekHours,
    /// 完成目標日（YYYY-MM-DD）
    pub deadline: Option<String>,
    /// "stage"（工程ごと）または "page"（ページごと）
    pub work_order: String,
    /// 休みの日（YYYY-MM-DD、全作品共通）
    pub days_off: Vec<String>,
}

impl Store {
    pub(super) fn seed_schedule(&self) -> Result<()> {
        self.conn
            .execute(
                "INSERT OR IGNORE INTO setting (key, value) VALUES (?1, ?2)",
                params![DEFAULT_HOURS_KEY, to_json(&DEFAULT_HOURS)],
            )
            .map_err(db_err)?;
        Ok(())
    }

    pub fn default_hours(&self) -> Result<WeekHours> {
        let raw: Option<String> = self
            .conn
            .query_row("SELECT value FROM setting WHERE key = ?1", [DEFAULT_HOURS_KEY], |r| r.get(0))
            .optional()
            .map_err(db_err)?;
        Ok(raw.and_then(|s| from_json(&s)).unwrap_or(DEFAULT_HOURS))
    }

    pub fn set_default_hours(&self, hours: WeekHours) -> Result<()> {
        check_hours(&hours)?;
        self.conn
            .execute(
                "INSERT INTO setting (key, value) VALUES (?1, ?2)
                 ON CONFLICT (key) DO UPDATE SET value = excluded.value",
                params![DEFAULT_HOURS_KEY, to_json(&hours)],
            )
            .map_err(db_err)?;
        Ok(())
    }

    pub fn schedule(&self, work_id: i64) -> Result<WorkSchedule> {
        let (hours, deadline, work_order): (Option<String>, Option<String>, String) = self
            .conn
            .query_row(
                "SELECT weekday_hours, deadline, work_order FROM work WHERE id = ?1",
                [work_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()
            .map_err(db_err)?
            .ok_or_else(|| "作品が見つかりませんでした".to_string())?;
        let default = self.default_hours()?;
        let custom = hours.as_deref().and_then(from_json);
        Ok(WorkSchedule {
            weekday_hours: custom.unwrap_or(default),
            custom_hours: custom.is_some(),
            default_weekday_hours: default,
            deadline,
            work_order,
            days_off: self.days_off()?,
        })
    }

    /// 作品の作業時間を設定する。None なら全作品の既定値に戻す
    pub fn set_work_hours(&self, work_id: i64, hours: Option<WeekHours>) -> Result<()> {
        if let Some(h) = &hours {
            check_hours(h)?;
        }
        self.conn
            .execute(
                "UPDATE work SET weekday_hours = ?2 WHERE id = ?1",
                params![work_id, hours.as_ref().map(to_json)],
            )
            .map_err(db_err)?;
        Ok(())
    }

    pub fn set_deadline(&self, work_id: i64, deadline: Option<&str>) -> Result<()> {
        if let Some(d) = deadline {
            check_date(d)?;
        }
        self.conn
            .execute("UPDATE work SET deadline = ?2 WHERE id = ?1", params![work_id, deadline])
            .map_err(db_err)?;
        Ok(())
    }

    pub fn set_work_order(&self, work_id: i64, order: &str) -> Result<()> {
        if order != "stage" && order != "page" {
            return Err("作業順の指定が正しくありません".into());
        }
        self.conn
            .execute("UPDATE work SET work_order = ?2 WHERE id = ?1", params![work_id, order])
            .map_err(db_err)?;
        Ok(())
    }

    pub fn days_off(&self) -> Result<Vec<String>> {
        let mut stmt = self.conn.prepare("SELECT date FROM day_off ORDER BY date").map_err(db_err)?;
        stmt.query_map([], |r| r.get(0)).and_then(|rows| rows.collect()).map_err(db_err)
    }

    pub fn set_day_off(&self, date: &str, off: bool) -> Result<()> {
        check_date(date)?;
        let sql = if off {
            "INSERT OR IGNORE INTO day_off (date) VALUES (?1)"
        } else {
            "DELETE FROM day_off WHERE date = ?1"
        };
        self.conn.execute(sql, [date]).map_err(db_err)?;
        Ok(())
    }
}

fn to_json(h: &WeekHours) -> String {
    serde_json::to_string(h).unwrap_or_default()
}

fn from_json(s: &str) -> Option<WeekHours> {
    serde_json::from_str(s).ok()
}

fn check_hours(h: &WeekHours) -> Result<()> {
    if h.iter().all(|v| (0.0..=24.0).contains(v)) {
        Ok(())
    } else {
        Err("作業時間は 0〜24 時間の範囲にしてください".into())
    }
}

/// YYYY-MM-DD の形かどうか（暦として正しいかは画面側の日付入力に任せる）
fn check_date(d: &str) -> Result<()> {
    let ok = d.len() == 10
        && d.chars().enumerate().all(|(i, c)| if i == 4 || i == 7 { c == '-' } else { c.is_ascii_digit() });
    if ok { Ok(()) } else { Err("日付の形式が正しくありません".into()) }
}

#[cfg(test)]
mod tests {
    use super::super::tests::setup;
    use super::*;

    #[test]
    fn 作業時間は既定値と作品ごとの上書きがある() {
        let (store, id) = setup();
        let s = store.schedule(id).unwrap();
        assert_eq!(s.weekday_hours, DEFAULT_HOURS);
        assert!(!s.custom_hours);
        assert_eq!(s.work_order, "stage");
        assert_eq!(s.deadline, None);

        store.set_default_hours([2.0, 2.0, 2.0, 2.0, 2.0, 5.0, 0.0]).unwrap();
        assert_eq!(store.schedule(id).unwrap().weekday_hours[6], 0.0);

        let mine = [1.0, 1.0, 1.0, 1.0, 1.0, 8.0, 8.0];
        store.set_work_hours(id, Some(mine)).unwrap();
        let s = store.schedule(id).unwrap();
        assert_eq!((s.weekday_hours, s.custom_hours, s.default_weekday_hours[5]), (mine, true, 5.0));

        store.set_work_hours(id, None).unwrap();
        assert!(!store.schedule(id).unwrap().custom_hours);
        assert!(store.set_work_hours(id, Some([25.0; 7])).is_err());
    }

    #[test]
    fn 締切_作業順_休みの日() {
        let (store, id) = setup();
        store.set_deadline(id, Some("2026-11-30")).unwrap();
        store.set_work_order(id, "page").unwrap();
        store.set_day_off("2026-11-03", true).unwrap();
        store.set_day_off("2026-11-15", true).unwrap();
        store.set_day_off("2026-11-15", true).unwrap();
        let s = store.schedule(id).unwrap();
        assert_eq!(s.deadline.as_deref(), Some("2026-11-30"));
        assert_eq!(s.work_order, "page");
        assert_eq!(s.days_off, ["2026-11-03", "2026-11-15"]);

        store.set_day_off("2026-11-03", false).unwrap();
        store.set_deadline(id, None).unwrap();
        let s = store.schedule(id).unwrap();
        assert_eq!((s.deadline, s.days_off.len()), (None, 1));

        assert!(store.set_deadline(id, Some("11/30")).is_err());
        assert!(store.set_work_order(id, "random").is_err());
    }
}
