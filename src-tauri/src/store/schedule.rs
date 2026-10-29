//! スケジュールの設定：曜日ごとの作業時間、休みの日、締切（複数。5.19）、作業順。
//! 曜日ごとの作業時間は全作品の既定値があり、作品ごとに上書きできる。休みの日は全作品で共通。

use rusqlite::{OptionalExtension, params};
use serde::Serialize;

use crate::i18n::{M, tr};

use super::{Result, Store, db_err};

/// 月〜日の作業時間（時間）
pub type WeekHours = [f64; 7];

const DEFAULT_HOURS_KEY: &str = "default_weekday_hours";
/// 1 日の区切り（時）。0 なら午前 0 時、5 なら朝 5 時から次の日の 4:59 までを 1 日とする
const DAY_START_KEY: &str = "day_start_hour";
const DEFAULT_HOURS: WeekHours = [3.0, 3.0, 3.0, 3.0, 3.0, 6.0, 6.0];

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkSchedule {
    /// この作品で使う曜日ごとの作業時間（月〜日）
    pub weekday_hours: WeekHours,
    /// 作品独自の作業時間を設定しているか
    pub custom_hours: bool,
    pub default_weekday_hours: WeekHours,
    /// 締切（日付順）
    pub deadlines: Vec<Deadline>,
    /// いま見ている締切の id（消した締切を指していることもある。どれで計算するかは画面側で決める）
    pub selected_deadline: Option<i64>,
    /// "stage"（工程ごと）または "page"（ページごと）
    pub work_order: String,
    /// 休みの日（YYYY-MM-DD、全作品共通）
    pub days_off: Vec<String>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Deadline {
    pub id: i64,
    /// 空なら画面で「締切」と出す
    pub name: String,
    /// YYYY-MM-DD
    pub date: String,
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
        let (hours, selected_deadline, work_order): (Option<String>, Option<i64>, String) = self
            .conn
            .query_row(
                "SELECT weekday_hours, selected_deadline, work_order FROM work WHERE id = ?1",
                [work_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()
            .map_err(db_err)?
            .ok_or_else(|| tr(M::WorkNotFound).to_string())?;
        let default = self.default_hours()?;
        let custom = hours.as_deref().and_then(from_json);
        Ok(WorkSchedule {
            weekday_hours: custom.unwrap_or(default),
            custom_hours: custom.is_some(),
            default_weekday_hours: default,
            deadlines: self.deadlines(work_id)?,
            selected_deadline,
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

    fn deadlines(&self, work_id: i64) -> Result<Vec<Deadline>> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, name, date FROM deadline WHERE work_id = ?1 ORDER BY date, id")
            .map_err(db_err)?;
        stmt.query_map([work_id], |r| Ok(Deadline { id: r.get(0)?, name: r.get(1)?, date: r.get(2)? }))
            .and_then(|rows| rows.collect())
            .map_err(db_err)
    }

    /// 締切を足す。戻り値は新しい締切の id
    pub fn add_deadline(&self, work_id: i64, name: &str, date: &str) -> Result<i64> {
        check_date(date)?;
        self.conn
            .execute(
                "INSERT INTO deadline (work_id, name, date) VALUES (?1, ?2, ?3)",
                params![work_id, name.trim(), date],
            )
            .map_err(db_err)?;
        Ok(self.conn.last_insert_rowid())
    }

    pub fn update_deadline(&self, id: i64, name: &str, date: &str) -> Result<()> {
        check_date(date)?;
        let n = self
            .conn
            .execute("UPDATE deadline SET name = ?2, date = ?3 WHERE id = ?1", params![id, name.trim(), date])
            .map_err(db_err)?;
        if n == 0 { Err(tr(M::DeadlineNotFound).into()) } else { Ok(()) }
    }

    pub fn remove_deadline(&self, id: i64) -> Result<()> {
        self.conn.execute("DELETE FROM deadline WHERE id = ?1", [id]).map_err(db_err)?;
        Ok(())
    }

    /// いま見ている締切を覚える。None なら「今日以降でいちばん早い締切」に任せる
    pub fn select_deadline(&self, work_id: i64, id: Option<i64>) -> Result<()> {
        self.conn
            .execute("UPDATE work SET selected_deadline = ?2 WHERE id = ?1", params![work_id, id])
            .map_err(db_err)?;
        Ok(())
    }

    pub fn set_work_order(&self, work_id: i64, order: &str) -> Result<()> {
        if order != "stage" && order != "page" {
            return Err(tr(M::WorkOrderInvalid).into());
        }
        self.conn
            .execute("UPDATE work SET work_order = ?2 WHERE id = ?1", params![work_id, order])
            .map_err(db_err)?;
        Ok(())
    }

    pub fn day_start_hour(&self) -> Result<i64> {
        let raw: Option<String> = self
            .conn
            .query_row("SELECT value FROM setting WHERE key = ?1", [DAY_START_KEY], |r| r.get(0))
            .optional()
            .map_err(db_err)?;
        Ok(raw.and_then(|s| s.parse().ok()).unwrap_or(0))
    }

    pub fn set_day_start_hour(&self, hour: i64) -> Result<()> {
        if !(0..=12).contains(&hour) {
            return Err(tr(M::DayStartRange).into());
        }
        self.conn
            .execute(
                "INSERT INTO setting (key, value) VALUES (?1, ?2)
                 ON CONFLICT (key) DO UPDATE SET value = excluded.value",
                params![DAY_START_KEY, hour.to_string()],
            )
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
        Err(tr(M::HoursRange).into())
    }
}

/// YYYY-MM-DD の形かどうか（暦として正しいかは画面側の日付入力に任せる）
fn check_date(d: &str) -> Result<()> {
    let ok = d.len() == 10
        && d.chars().enumerate().all(|(i, c)| if i == 4 || i == 7 { c == '-' } else { c.is_ascii_digit() });
    if ok { Ok(()) } else { Err(tr(M::DateFormatInvalid).into()) }
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
        assert!(s.deadlines.is_empty());

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
        store.set_work_order(id, "page").unwrap();
        store.set_day_off("2026-11-03", true).unwrap();
        store.set_day_off("2026-11-15", true).unwrap();
        store.set_day_off("2026-11-15", true).unwrap();
        let s = store.schedule(id).unwrap();
        assert_eq!(s.work_order, "page");
        assert_eq!(s.days_off, ["2026-11-03", "2026-11-15"]);

        store.set_day_off("2026-11-03", false).unwrap();
        assert_eq!(store.schedule(id).unwrap().days_off.len(), 1);

        assert_eq!(store.day_start_hour().unwrap(), 0);
        store.set_day_start_hour(5).unwrap();
        assert_eq!(store.day_start_hour().unwrap(), 5);
        assert!(store.set_day_start_hour(13).is_err());
        assert!(store.set_work_order(id, "random").is_err());
    }

    #[test]
    fn 締切は複数持てて日付順に並ぶ() {
        let (store, id) = setup();
        let normal = store.add_deadline(id, " 通常 ", "2026-11-27").unwrap();
        let early = store.add_deadline(id, "早割", "2026-11-20").unwrap();
        let extra = store.add_deadline(id, "割増", "2026-12-01").unwrap();
        let names = |store: &Store| -> Vec<String> {
            store.schedule(id).unwrap().deadlines.into_iter().map(|d| d.name).collect()
        };
        assert_eq!(names(&store), ["早割", "通常", "割増"]);

        store.select_deadline(id, Some(normal)).unwrap();
        assert_eq!(store.schedule(id).unwrap().selected_deadline, Some(normal));

        // 日付を変えると並びも変わる
        store.update_deadline(early, "早割", "2026-11-28").unwrap();
        assert_eq!(names(&store), ["通常", "早割", "割増"]);
        assert!(store.update_deadline(extra, "割増", "12/1").is_err());
        assert!(store.add_deadline(id, "", "12/1").is_err());
        assert!(store.update_deadline(9999, "x", "2026-12-01").is_err());

        // 選んでいる締切を消しても、選んだ id は残る（どれで計算するかは画面側で決める）
        store.remove_deadline(normal).unwrap();
        let s = store.schedule(id).unwrap();
        assert_eq!((s.deadlines.len(), s.selected_deadline), (2, Some(normal)));
        store.select_deadline(id, None).unwrap();
        assert_eq!(store.schedule(id).unwrap().selected_deadline, None);

        // 作品を消すと締切も消える
        store.remove_work(id).unwrap();
        let left: i64 = store.conn.query_row("SELECT COUNT(*) FROM deadline", [], |r| r.get(0)).unwrap();
        assert_eq!(left, 0);
    }
}
