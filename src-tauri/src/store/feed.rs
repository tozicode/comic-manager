//! みんなの作業（仕様書 5.25）：節目の判定、送り待ち、作品ごとの送り手、設定。
//!
//! 送るのは画面側（src/feed.ts）。ここは「何を、いつ送るか」を決めて持っておくだけで、HTTP は扱わない。
//! 名前・作品名・工程名は送らない。工程は知っている名前のときだけ鍵（`inking` など）にする。

use std::collections::{HashMap, HashSet};

use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};

use crate::i18n::{M, tr};

use super::localize::stage_key;
use super::{Result, Store, db_err};

const PREFS_KEY: &str = "feed_prefs";
/// 絵文字の一覧の数（src/feed-emoji.ts の長さと合わせる。並びは後ろに足すだけ）
pub const EMOJI_COUNT: i64 = 200;
/// 出来事から送るまでの待ち（完了の取り消しに備える）と、それに足す乱数の幅（SNS の時刻と並べにくくする）
const DELAY_MS: i64 = 30_000;
const JITTER_MS: i64 = 300_000;
/// その作品の前の「開始」からこれだけ空いたら、また「開始」を送る
const START_GAP_MS: i64 = 3 * 60 * 60 * 1000;
/// 送れないまま、これより古くなった送り待ちは捨てる
const OUTBOX_MAX_AGE_MS: i64 = 24 * 60 * 60 * 1000;

/// みんなの作業の設定（アプリ全体で 1 つ）
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct FeedPrefs {
    /// 自分の作業を知らせる（既定はオン。ただし案内を閉じるまでは送らない）
    pub send: bool,
    /// ほかの人の知らせを受け取る
    pub receive: bool,
    /// はじめての案内を出し終えた
    pub guided: bool,
}

impl Default for FeedPrefs {
    fn default() -> Self {
        Self { send: true, receive: true, guided: false }
    }
}

/// 作品ごとの送り手（ランダムな ID と絵文字 2 つ）
#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FeedSender {
    pub work_id: i64,
    pub sender: String,
    pub emoji: [i64; 2],
}

/// 送る時刻になった知らせ 1 件（サーバの POST /feed のボディになる）。送れたら `ids` を `feed_sent` に渡す
#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FeedDue {
    pub ids: Vec<i64>,
    pub sender: String,
    pub emoji: [i64; 2],
    /// start ／ stage ／ page ／ work
    pub kind: String,
    pub stage: Option<String>,
    /// page ／ sheet ／ item
    pub unit: Option<String>,
    pub count: Option<i64>,
}

/// 作品 1 つの揃い具合。「揃う」は完了か対象外。表示している工程と、cmc から消えていないページだけを数える
/// （進捗率・`completed_counts` と同じ数え方）
struct Completion {
    pages: Vec<(i64, i64)>,
    full_pages: HashSet<i64>,
    full_stages: HashSet<i64>,
    work_full: bool,
}

/// 送り待ちに入れる 1 件
struct Event {
    kind: &'static str,
    stage_key: Option<&'static str>,
    unit: Option<&'static str>,
    count: Option<i64>,
    /// この出来事で付けた印（取り消したら外す）
    marks: Vec<(&'static str, i64)>,
}

/// みんなの作業の処理が失敗しても、完了の印や計測は止めない（記録の方が大事）
pub(super) fn feed_quietly(r: Result<()>) {
    if let Err(e) = r {
        eprintln!("みんなの作業: {e}");
    }
}

impl Store {
    pub fn feed_prefs(&self) -> Result<FeedPrefs> {
        let raw: Option<String> = self
            .conn
            .query_row("SELECT value FROM setting WHERE key = ?1", [PREFS_KEY], |r| r.get(0))
            .optional()
            .map_err(db_err)?;
        Ok(raw.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default())
    }

    /// 設定を保存する。送り始めたとき（案内を閉じた・オフからオンにした）は、いま揃っている節目を送ったものとして扱う。
    /// 送るのをやめたら、送り待ちを捨てる
    pub fn set_feed_prefs(&self, prefs: &FeedPrefs) -> Result<()> {
        let before = self.feed_prefs()?;
        self.conn
            .execute(
                "INSERT INTO setting (key, value) VALUES (?1, ?2)
                 ON CONFLICT (key) DO UPDATE SET value = excluded.value",
                params![PREFS_KEY, serde_json::to_string(prefs).unwrap_or_default()],
            )
            .map_err(db_err)?;
        let sending = |p: &FeedPrefs| p.send && p.guided;
        if sending(prefs) && !sending(&before) {
            self.feed_baseline()?;
        }
        if !prefs.send {
            self.conn.execute("DELETE FROM feed_outbox", []).map_err(db_err)?;
        }
        Ok(())
    }

    /// 作品の送り手。無ければ作る
    pub fn feed_sender(&self, work_id: i64) -> Result<FeedSender> {
        if let Some(s) = self.find_feed_sender(work_id)? {
            return Ok(s);
        }
        let exists: bool = self
            .conn
            .query_row("SELECT COUNT(*) > 0 FROM work WHERE id = ?1", [work_id], |r| r.get(0))
            .map_err(db_err)?;
        if !exists {
            return Err(tr(M::WorkNotFound).into());
        }
        let sender = self.new_token()?;
        // 絵文字は 2 つ別のものにする
        let e1 = self.random_below(EMOJI_COUNT)?;
        let e2 = (e1 + 1 + self.random_below(EMOJI_COUNT - 1)?) % EMOJI_COUNT;
        self.conn
            .execute(
                "INSERT INTO feed_sender (work_id, sender, e1, e2) VALUES (?1, ?2, ?3, ?4)",
                params![work_id, sender, e1, e2],
            )
            .map_err(db_err)?;
        self.find_feed_sender(work_id)?.ok_or_else(|| tr(M::WorkNotFound).into())
    }

    /// 作ってある送り手すべて（画面で自分の知らせを見分けるため）
    pub fn feed_senders(&self) -> Result<Vec<FeedSender>> {
        let mut stmt = self
            .conn
            .prepare("SELECT work_id, sender, e1, e2 FROM feed_sender ORDER BY work_id")
            .map_err(db_err)?;
        let rows = stmt.query_map([], row_to_sender).map_err(db_err)?;
        rows.collect::<rusqlite::Result<Vec<_>>>().map_err(db_err)
    }

    /// 送る時刻になった知らせ。1 回の送信で作品（送り手）ごとに 1 件だけ返す（サーバは同じ送り手を 10 秒に 1 件しか受けない）。
    /// 同じ作品の「ページを仕上げた」はまとめて 1 件にする。古すぎるものはここで捨てる
    pub fn feed_due(&self, now: i64) -> Result<Vec<FeedDue>> {
        self.conn
            .execute("DELETE FROM feed_outbox WHERE created_at < ?1", [now - OUTBOX_MAX_AGE_MS])
            .map_err(db_err)?;
        if !self.feed_prefs()?.send {
            return Ok(Vec::new());
        }
        let mut stmt = self
            .conn
            .prepare(
                "SELECT o.id, o.work_id, o.kind, o.stage_key, o.unit, o.count, s.sender, s.e1, s.e2
                 FROM feed_outbox o JOIN feed_sender s ON s.work_id = o.work_id
                 WHERE o.send_after <= ?1 ORDER BY o.id",
            )
            .map_err(db_err)?;
        type Row = (i64, i64, String, Option<String>, Option<String>, Option<i64>, String, i64, i64);
        let rows: Vec<Row> = stmt
            .query_map([now], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?, r.get(8)?))
            })
            .and_then(|rows| rows.collect())
            .map_err(db_err)?;

        let mut out: Vec<FeedDue> = Vec::new();
        let mut by_work: HashMap<i64, usize> = HashMap::new();
        for (id, work, kind, stage, unit, count, sender, e1, e2) in rows {
            match by_work.get(&work) {
                // 先に選んだ 1 件がページなら、同じ作品のページをまとめる。それ以外は次の送信に回す
                Some(&i) => {
                    let due = &mut out[i];
                    if due.kind == "page" && kind == "page" {
                        due.ids.push(id);
                        due.count = Some(due.count.unwrap_or(0) + count.unwrap_or(1));
                    }
                }
                None => {
                    by_work.insert(work, out.len());
                    out.push(FeedDue { ids: vec![id], sender, emoji: [e1, e2], kind, stage, unit, count });
                }
            }
        }
        Ok(out)
    }

    /// 送れた知らせを送り待ちから消す
    pub fn feed_sent(&self, ids: &[i64]) -> Result<()> {
        for id in ids {
            self.conn.execute("DELETE FROM feed_outbox WHERE id = ?1", [id]).map_err(db_err)?;
        }
        Ok(())
    }

    // ----- 判定（Store の set_task_done ／ start_timer から呼ぶ） -----

    fn feed_sending(&self) -> Result<bool> {
        let p = self.feed_prefs()?;
        Ok(p.send && p.guided)
    }

    /// マスに完了の印が新しく付いたとき。揃った節目のうち、まだ知らせていないものを送り待ちに入れる
    pub(super) fn feed_on_done(&self, page_id: i64, stage_id: i64, now: i64) -> Result<()> {
        if !self.feed_sending()? {
            return Ok(());
        }
        let (work_id, set_id, span): (i64, i64, i64) = self
            .conn
            .query_row(
                "SELECT p.work_id, w.set_id, p.span FROM page p JOIN work w ON w.id = p.work_id WHERE p.id = ?1",
                [page_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .map_err(db_err)?;
        let c = self.feed_completion(work_id)?;
        let stage_full = c.full_stages.contains(&stage_id) && !self.feed_marked(work_id, "stage", stage_id)?;
        let page_full = c.full_pages.contains(&page_id) && !self.feed_marked(work_id, "page", page_id)?;

        // 作品が完成したら、それだけを送る（同時に揃った工程とページの分は印だけ付ける）
        if c.work_full && !self.feed_marked(work_id, "work", 0)? {
            let mut marks = vec![("work", 0)];
            if stage_full {
                marks.push(("stage", stage_id));
            }
            if page_full {
                marks.push(("page", page_id));
            }
            let event = Event { kind: "work", stage_key: None, unit: None, count: None, marks };
            return self.feed_enqueue(work_id, event, now);
        }
        if stage_full {
            let name: String = self
                .conn
                .query_row("SELECT name FROM stage_def WHERE id = ?1", [stage_id], |r| r.get(0))
                .map_err(db_err)?;
            let event = Event { kind: "stage", stage_key: stage_key(&name), unit: None, count: None, marks: vec![("stage", stage_id)] };
            self.feed_enqueue(work_id, event, now)?;
        }
        // ページが 1 つしかない作品では、ページを仕上げた＝作品の完成なので送らない
        if page_full && c.pages.len() > 1 {
            let unit = match set_id {
                1 => "page",
                2 => "sheet",
                _ => "item",
            };
            let event = Event { kind: "page", stage_key: None, unit: Some(unit), count: Some(span), marks: vec![("page", page_id)] };
            self.feed_enqueue(work_id, event, now)?;
        }
        Ok(())
    }

    /// 完了の印を外したとき。その工程・そのページ・作品の完成のうち、まだ送っていない知らせは成り立たなくなったので捨て、
    /// 印も外す（付け直したらまた送れる）。送ったあとなら何もしない（取り消しは送らない。付け直しても二度は送らない）
    pub(super) fn feed_on_undone(&self, page_id: i64, stage_id: i64) -> Result<()> {
        let work_id: i64 = self
            .conn
            .query_row("SELECT work_id FROM page WHERE id = ?1", [page_id], |r| r.get(0))
            .map_err(db_err)?;
        let mut stmt = self
            .conn
            .prepare("SELECT id, marks FROM feed_outbox WHERE work_id = ?1")
            .map_err(db_err)?;
        let rows: Vec<(i64, String)> = stmt
            .query_map([work_id], |r| Ok((r.get(0)?, r.get(1)?)))
            .and_then(|rows| rows.collect())
            .map_err(db_err)?;
        for (id, marks) in rows {
            let marks: Vec<(String, i64)> = serde_json::from_str(&marks).unwrap_or_default();
            let broken = marks.iter().any(|(kind, key)| match kind.as_str() {
                "stage" => *key == stage_id,
                "page" => *key == page_id,
                "work" => true,
                _ => false,
            });
            if !broken {
                continue;
            }
            for (kind, key) in marks {
                self.conn
                    .execute("DELETE FROM feed_mark WHERE work_id = ?1 AND kind = ?2 AND key = ?3", params![work_id, kind, key])
                    .map_err(db_err)?;
            }
            self.conn.execute("DELETE FROM feed_outbox WHERE id = ?1", [id]).map_err(db_err)?;
        }
        Ok(())
    }

    /// 計測を始めたとき。その作品の前の「開始」から 3 時間以上たっていれば送り待ちに入れる
    pub(super) fn feed_on_start(&self, page_id: i64, now: i64) -> Result<()> {
        if !self.feed_sending()? {
            return Ok(());
        }
        let work_id: i64 = self
            .conn
            .query_row("SELECT work_id FROM page WHERE id = ?1", [page_id], |r| r.get(0))
            .map_err(db_err)?;
        let last: Option<i64> = self
            .conn
            .query_row("SELECT at FROM feed_last_start WHERE work_id = ?1", [work_id], |r| r.get(0))
            .optional()
            .map_err(db_err)?;
        if last.is_some_and(|at| now - at < START_GAP_MS) {
            return Ok(());
        }
        self.conn
            .execute(
                "INSERT INTO feed_last_start (work_id, at) VALUES (?1, ?2)
                 ON CONFLICT (work_id) DO UPDATE SET at = excluded.at",
                params![work_id, now],
            )
            .map_err(db_err)?;
        let event = Event { kind: "start", stage_key: None, unit: None, count: None, marks: Vec::new() };
        self.feed_enqueue(work_id, event, now)
    }

    /// いま揃っている節目すべてに、送ったものとして印を付ける（送り始めたとたんに溢れないように）
    fn feed_baseline(&self) -> Result<()> {
        let works: Vec<i64> = {
            let mut stmt = self.conn.prepare("SELECT id FROM work").map_err(db_err)?;
            stmt.query_map([], |r| r.get(0)).and_then(|rows| rows.collect()).map_err(db_err)?
        };
        for work_id in works {
            let c = self.feed_completion(work_id)?;
            for stage in &c.full_stages {
                self.feed_mark(work_id, "stage", *stage)?;
            }
            for page in &c.full_pages {
                self.feed_mark(work_id, "page", *page)?;
            }
            if c.work_full {
                self.feed_mark(work_id, "work", 0)?;
            }
        }
        Ok(())
    }

    fn feed_completion(&self, work_id: i64) -> Result<Completion> {
        let pages: Vec<(i64, i64)> = {
            let mut stmt = self
                .conn
                .prepare("SELECT id, span FROM page WHERE work_id = ?1 AND missing = 0")
                .map_err(db_err)?;
            stmt.query_map([work_id], |r| Ok((r.get(0)?, r.get(1)?)))
                .and_then(|rows| rows.collect())
                .map_err(db_err)?
        };
        let stages: Vec<i64> = {
            let mut stmt = self
                .conn
                .prepare(
                    "SELECT ws.stage_id FROM work_stage ws JOIN stage_def s ON s.id = ws.stage_id
                     WHERE ws.work_id = ?1 AND s.hidden = 0",
                )
                .map_err(db_err)?;
            stmt.query_map([work_id], |r| r.get(0)).and_then(|rows| rows.collect()).map_err(db_err)?
        };
        let filled: HashSet<(i64, i64)> = {
            let mut stmt = self
                .conn
                .prepare(
                    "SELECT t.page_id, t.stage_id FROM task_done t JOIN page p ON p.id = t.page_id WHERE p.work_id = ?1
                     UNION
                     SELECT x.page_id, x.stage_id FROM task_excluded x JOIN page p ON p.id = x.page_id WHERE p.work_id = ?1",
                )
                .map_err(db_err)?;
            stmt.query_map([work_id], |r| Ok((r.get(0)?, r.get(1)?)))
                .and_then(|rows| rows.collect())
                .map_err(db_err)?
        };
        let full_pages: HashSet<i64> = if stages.is_empty() {
            HashSet::new()
        } else {
            pages
                .iter()
                .filter(|(p, _)| stages.iter().all(|s| filled.contains(&(*p, *s))))
                .map(|(p, _)| *p)
                .collect()
        };
        let full_stages: HashSet<i64> = if pages.is_empty() {
            HashSet::new()
        } else {
            stages
                .iter()
                .filter(|s| pages.iter().all(|(p, _)| filled.contains(&(*p, **s))))
                .copied()
                .collect()
        };
        let work_full = !pages.is_empty() && full_pages.len() == pages.len();
        Ok(Completion { pages, full_pages, full_stages, work_full })
    }

    fn feed_marked(&self, work_id: i64, kind: &str, key: i64) -> Result<bool> {
        self.conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM feed_mark WHERE work_id = ?1 AND kind = ?2 AND key = ?3",
                params![work_id, kind, key],
                |r| r.get(0),
            )
            .map_err(db_err)
    }

    fn feed_mark(&self, work_id: i64, kind: &str, key: i64) -> Result<()> {
        self.conn
            .execute("INSERT OR IGNORE INTO feed_mark (work_id, kind, key) VALUES (?1, ?2, ?3)", params![work_id, kind, key])
            .map_err(db_err)?;
        Ok(())
    }

    /// 送り待ちに入れて印を付ける。送る時刻は 30 秒 ＋ 0〜5 分の乱数後。
    /// 同じ作品にまだ送っていない知らせがあれば、その時刻に揃える（ページのまとめが効くように）
    fn feed_enqueue(&self, work_id: i64, event: Event, now: i64) -> Result<()> {
        self.feed_sender(work_id)?;
        let pending: Option<i64> = self
            .conn
            .query_row("SELECT MAX(send_after) FROM feed_outbox WHERE work_id = ?1", [work_id], |r| r.get(0))
            .map_err(db_err)?;
        let send_after = match pending {
            Some(at) if at >= now + DELAY_MS => at,
            _ => now + DELAY_MS + self.random_below(JITTER_MS + 1)?,
        };
        let marks = serde_json::to_string(&event.marks).unwrap_or_else(|_| "[]".into());
        self.conn
            .execute(
                "INSERT INTO feed_outbox (work_id, kind, stage_key, unit, count, marks, created_at, send_after)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![work_id, event.kind, event.stage_key, event.unit, event.count, marks, now, send_after],
            )
            .map_err(db_err)?;
        for (kind, key) in &event.marks {
            self.feed_mark(work_id, kind, *key)?;
        }
        Ok(())
    }

    fn find_feed_sender(&self, work_id: i64) -> Result<Option<FeedSender>> {
        self.conn
            .query_row("SELECT work_id, sender, e1, e2 FROM feed_sender WHERE work_id = ?1", [work_id], row_to_sender)
            .optional()
            .map_err(db_err)
    }

    /// 0 以上 n 未満の乱数
    fn random_below(&self, n: i64) -> Result<i64> {
        self.conn
            .query_row("SELECT abs(random() % ?1)", [n], |r| r.get(0))
            .map_err(db_err)
    }
}

fn row_to_sender(r: &rusqlite::Row) -> rusqlite::Result<FeedSender> {
    Ok(FeedSender { work_id: r.get(0)?, sender: r.get(1)?, emoji: [r.get(2)?, r.get(3)?] })
}

#[cfg(test)]
mod tests {
    use super::super::tests::{comic, setup, stage_ids};
    use super::*;
    use rusqlite::Connection;

    const MIN: i64 = 60_000;
    const HOUR: i64 = 60 * MIN;
    /// 送り待ちが確実に送る時刻になっている時刻
    const LATER: i64 = 10 * MIN;

    fn pages(store: &Store, work: i64) -> Vec<i64> {
        store.board(work, 0).unwrap().pages.into_iter().map(|p| p.id).collect()
    }

    /// 案内を閉じて送り始めた状態
    fn sending(store: &Store) {
        store.set_feed_prefs(&FeedPrefs { send: true, receive: true, guided: true }).unwrap();
    }

    fn kinds(store: &Store) -> Vec<String> {
        let mut stmt = store.conn.prepare("SELECT kind FROM feed_outbox ORDER BY id").unwrap();
        stmt.query_map([], |r| r.get(0)).unwrap().collect::<rusqlite::Result<Vec<String>>>().unwrap()
    }

    fn done(store: &Store, page: i64, stage: i64) {
        store.set_task_done(page, stage, true, 0).unwrap();
    }

    #[test]
    fn 案内を閉じるまでは何も入らない() {
        let (store, work) = setup();
        let (st, p) = (stage_ids(&store), pages(&store, work));
        assert_eq!(store.feed_prefs().unwrap(), FeedPrefs { send: true, receive: true, guided: false });
        for page in &p {
            done(&store, *page, st[0]);
        }
        store.start_timer(p[0], st[1], 0).unwrap();
        assert!(kinds(&store).is_empty());
    }

    #[test]
    fn 工程を全ページ終えると工程の鍵つきで入る() {
        let (store, work) = setup();
        let (st, p) = (stage_ids(&store), pages(&store, work));
        sending(&store);
        done(&store, p[0], st[1]);
        done(&store, p[1], st[1]);
        assert!(kinds(&store).is_empty());
        done(&store, p[2], st[1]);
        let due = store.feed_due(LATER).unwrap();
        assert_eq!(due.len(), 1);
        assert_eq!((due[0].kind.as_str(), due[0].stage.as_deref()), ("stage", Some("inking")));
        assert_ne!(due[0].emoji[0], due[0].emoji[1]);
        assert_eq!(due[0].sender, store.feed_sender(work).unwrap().sender);
    }

    #[test]
    fn 名前を変えた工程は鍵なしで入る() {
        let (store, work) = setup();
        let (st, p) = (stage_ids(&store), pages(&store, work));
        store.update_stage(st[0], "下描き", "#000000", 60).unwrap();
        sending(&store);
        for page in &p {
            done(&store, *page, st[0]);
        }
        let due = store.feed_due(LATER).unwrap();
        assert_eq!((due[0].kind.as_str(), due[0].stage.clone()), ("stage", None));
    }

    #[test]
    fn ページを全工程終えると入り同じ作品のページはまとまる() {
        let (store, work) = setup();
        let (st, p) = (stage_ids(&store), pages(&store, work));
        sending(&store);
        for s in &st {
            done(&store, p[0], *s);
        }
        for s in &st {
            done(&store, p[1], *s); // 見開き（2 ページ分）
        }
        assert_eq!(kinds(&store), ["page", "page"]);
        let due = store.feed_due(LATER).unwrap();
        assert_eq!(due.len(), 1);
        assert_eq!((due[0].kind.as_str(), due[0].unit.as_deref(), due[0].count), ("page", Some("page"), Some(3)));
        store.feed_sent(&due[0].ids).unwrap();
        assert!(kinds(&store).is_empty());
    }

    #[test]
    fn 作品が完成したら完成だけが入る() {
        let (store, work) = setup();
        let (st, p) = (stage_ids(&store), pages(&store, work));
        sending(&store);
        // 最後の 1 マス（p4 のトーン）以外を埋める
        for page in &p {
            for s in &st {
                if (*page, *s) != (p[2], st[2]) {
                    done(&store, *page, *s);
                }
            }
        }
        store.conn.execute("DELETE FROM feed_outbox", []).unwrap();
        done(&store, p[2], st[2]);
        // トーンが全ページ揃い、p4 も揃ったが、送るのは完成だけ
        assert_eq!(kinds(&store), ["work"]);
        // 取り消すと、印ごと消える
        store.set_task_done(p[2], st[2], false, 0).unwrap();
        assert!(kinds(&store).is_empty());
        assert!(!store.feed_marked(work, "stage", st[2]).unwrap());
        done(&store, p[2], st[2]);
        assert_eq!(kinds(&store), ["work"]);
    }

    #[test]
    fn 対象外のマスは揃ったものとして数え消えたページは数えない() {
        let (store, work) = setup();
        let (st, p) = (stage_ids(&store), pages(&store, work));
        sending(&store);
        store.set_task_excluded(p[1], st[0], true).unwrap();
        store.conn.execute("UPDATE page SET missing = 1 WHERE id = ?1", [p[2]]).unwrap();
        done(&store, p[0], st[0]);
        assert_eq!(kinds(&store), ["stage"]);
        // 対象外にして揃っても送らない（✓を付けたときだけ判定する）
        store.conn.execute("DELETE FROM feed_outbox", []).unwrap();
        done(&store, p[0], st[1]);
        store.set_task_excluded(p[1], st[1], true).unwrap();
        assert!(kinds(&store).is_empty());
    }

    #[test]
    fn 送ったあとは外して付け直しても二度は入らない() {
        let (store, work) = setup();
        let (st, p) = (stage_ids(&store), pages(&store, work));
        sending(&store);
        for page in &p {
            done(&store, *page, st[0]);
        }
        let due = store.feed_due(LATER).unwrap();
        store.feed_sent(&due[0].ids).unwrap();
        store.set_task_done(p[0], st[0], false, 0).unwrap();
        done(&store, p[0], st[0]);
        assert!(kinds(&store).is_empty());
    }

    #[test]
    fn 送る前に外すと消え付け直すとまた入る() {
        let (store, work) = setup();
        let (st, p) = (stage_ids(&store), pages(&store, work));
        sending(&store);
        for page in &p {
            done(&store, *page, st[0]);
        }
        store.set_task_done(p[1], st[0], false, 0).unwrap();
        assert!(kinds(&store).is_empty());
        done(&store, p[1], st[0]);
        assert_eq!(kinds(&store), ["stage"]);
    }

    #[test]
    fn 送り始めた時点で揃っている節目は送らない() {
        let (store, work) = setup();
        let (st, p) = (stage_ids(&store), pages(&store, work));
        for page in &p {
            done(&store, *page, st[0]);
        }
        for s in &st {
            done(&store, p[0], *s);
        }
        sending(&store);
        // 揃っていたものを外して付け直しても、印があるので送らない
        store.set_task_done(p[0], st[0], false, 0).unwrap();
        done(&store, p[0], st[0]);
        assert!(kinds(&store).is_empty());
        // まだ揃っていなかったものは送る
        for page in &p[1..] {
            done(&store, *page, st[1]);
        }
        assert_eq!(kinds(&store), ["stage"]);
    }

    #[test]
    fn ページが1つの作品ではページの知らせを出さない() {
        let store = Store::open_in_memory().unwrap();
        let work = store.add_work("C:/one.cmc", &comic(&[("page0001.clip", 1)]), 0).unwrap();
        let (st, p) = (stage_ids(&store), pages(&store, work));
        sending(&store);
        done(&store, p[0], st[0]);
        done(&store, p[0], st[1]);
        done(&store, p[0], st[2]);
        assert_eq!(kinds(&store), ["stage", "stage", "work"]);
    }

    #[test]
    fn 開始は3時間空いたときだけ入る() {
        let (store, work) = setup();
        let (st, p) = (stage_ids(&store), pages(&store, work));
        sending(&store);
        store.start_timer(p[0], st[0], 0).unwrap();
        store.start_timer(p[1], st[0], HOUR).unwrap();
        store.start_timer(p[1], st[1], 3 * HOUR - 1).unwrap();
        assert_eq!(kinds(&store), ["start"]);
        store.start_timer(p[2], st[0], 3 * HOUR).unwrap();
        assert_eq!(kinds(&store), ["start", "start"]);
    }

    #[test]
    fn 送る時刻は30秒から5分半のあいだで同じ作品は揃う() {
        let (store, work) = setup();
        let (st, p) = (stage_ids(&store), pages(&store, work));
        sending(&store);
        let now = 1_000_000;
        store.start_timer(p[0], st[0], now).unwrap();
        let at: i64 = store.conn.query_row("SELECT send_after FROM feed_outbox", [], |r| r.get(0)).unwrap();
        assert!((now + DELAY_MS..=now + DELAY_MS + JITTER_MS).contains(&at));
        assert!(store.feed_due(now + DELAY_MS - 1).unwrap().is_empty());
        for s in &st {
            store.set_task_done(p[0], *s, true, now).unwrap();
        }
        let ats: Vec<i64> = {
            let mut stmt = store.conn.prepare("SELECT send_after FROM feed_outbox").unwrap();
            stmt.query_map([], |r| r.get(0)).unwrap().collect::<rusqlite::Result<_>>().unwrap()
        };
        assert!(ats.iter().all(|a| *a == at));
    }

    #[test]
    fn 一回の送信では作品ごとに1件だけ返す() {
        let (store, work) = setup();
        let (st, p) = (stage_ids(&store), pages(&store, work));
        sending(&store);
        store.start_timer(p[0], st[0], 0).unwrap();
        for page in &p {
            done(&store, *page, st[0]);
        }
        let due = store.feed_due(LATER).unwrap();
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].kind, "start");
        store.feed_sent(&due[0].ids).unwrap();
        assert_eq!(store.feed_due(LATER).unwrap()[0].kind, "stage");
    }

    #[test]
    fn 一日より古い送り待ちは捨てる() {
        let (store, work) = setup();
        let (st, p) = (stage_ids(&store), pages(&store, work));
        sending(&store);
        store.start_timer(p[0], st[0], 0).unwrap();
        assert!(store.feed_due(OUTBOX_MAX_AGE_MS + 1).unwrap().is_empty());
        assert!(kinds(&store).is_empty());
    }

    #[test]
    fn 送るのをやめると送り待ちを捨てる() {
        let (store, work) = setup();
        let (st, p) = (stage_ids(&store), pages(&store, work));
        sending(&store);
        store.start_timer(p[0], st[0], 0).unwrap();
        store.set_feed_prefs(&FeedPrefs { send: false, receive: true, guided: true }).unwrap();
        assert!(kinds(&store).is_empty());
        store.start_timer(p[1], st[0], 10 * HOUR).unwrap();
        assert!(kinds(&store).is_empty());
    }

    #[test]
    fn 送り手は作品ごとに別で作品を消すと消える() {
        let (store, work) = setup();
        let other = store.add_work("C:/b.cmc", &comic(&[("page0001.clip", 1)]), 0).unwrap();
        let a = store.feed_sender(work).unwrap();
        let b = store.feed_sender(other).unwrap();
        assert_eq!(a.sender.len(), 32);
        assert_ne!(a.sender, b.sender);
        assert!(a.emoji.iter().all(|e| (0..EMOJI_COUNT).contains(e)));
        assert_eq!(store.feed_sender(work).unwrap(), a);
        assert_eq!(store.feed_senders().unwrap().len(), 2);
        assert!(store.feed_sender(99).is_err());
        store.conn.execute("DELETE FROM work WHERE id = ?1", [other]).unwrap();
        assert_eq!(store.feed_senders().unwrap(), [a]);
    }

    #[test]
    fn 知っている工程名だけ鍵になる() {
        assert_eq!(stage_key("ペン入れ"), Some("inking"));
        assert_eq!(stage_key("Inking"), Some("inking"));
        assert_eq!(stage_key(" inking "), Some("inking"));
        assert_eq!(stage_key("펜선"), Some("inking"));
        assert_eq!(stage_key("線稿"), Some("lineart"));
        assert_eq!(stage_key("ネーム"), Some("storyboard"));
        assert_eq!(stage_key("仕上げ"), Some("finishing"));
        assert_eq!(stage_key("ペン入れ（背景）"), None);
    }

    #[test]
    fn 版11のデータを版12に移せる() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        let old = Store { conn };
        old.migrate(11).unwrap();
        old.conn
            .execute("INSERT INTO work (id, title, cmc_path, created_at, kind, set_id) VALUES (7, '旧作品', 'C:/old.cmc', 0, 'comic', 1)", [])
            .unwrap();
        old.migrate(super::super::LATEST).unwrap();
        assert_eq!(old.feed_sender(7).unwrap().work_id, 7);
        assert!(old.feed_due(0).unwrap().is_empty());
    }
}
