//! 見開きの統合・分割への追従と、ページ間での作業記録の移動。
//!
//! CLIP STUDIO で 2 ページを見開きにすると、片方の .clip が消えてもう片方が見開き（span = 2）になる。
//! 見開きを解除すると、見開きだったページが単ページに戻り、直後に新しい番号の .clip ができる。
//! 同期の前後のページを見比べてこの 2 つを見つけ、記録をどうするかを画面で確認する。

use rusqlite::params;
use serde::Serialize;

use super::{Result, Store, db_err, page_label};

/// 同期の前後で見比べるためのページの状態
#[derive(Debug, Clone)]
pub(super) struct PageState {
    pub(super) id: i64,
    file_name: String,
    order_index: i64,
    number: i64,
    span: i64,
    missing: bool,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PageMerge {
    /// 消えたページ
    pub from_page_id: i64,
    pub from_file_name: String,
    /// 見開きになったページ
    pub to_page_id: i64,
    pub to_label: String,
    /// 消えたページの作業時間の合計
    pub ms: i64,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PageSplit {
    /// 見開きだったページ
    pub page_id: i64,
    pub label: String,
    /// 新しくできたページ
    pub new_page_id: i64,
    pub new_label: String,
    /// 見開きだったときの作業時間の合計
    pub ms: i64,
}

impl Store {
    pub(super) fn page_states(&self, work_id: i64) -> Result<Vec<PageState>> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, file_name, order_index, number, span, missing FROM page WHERE work_id = ?1")
            .map_err(db_err)?;
        stmt.query_map([work_id], |r| {
            Ok(PageState {
                id: r.get(0)?,
                file_name: r.get(1)?,
                order_index: r.get(2)?,
                number: r.get(3)?,
                span: r.get(4)?,
                missing: r.get(5)?,
            })
        })
        .and_then(|rows| rows.collect())
        .map_err(db_err)
    }

    /// ページに作業記録・完了・タグのどれかがあるか
    fn has_data(&self, page_id: i64) -> Result<bool> {
        self.conn
            .query_row(
                "SELECT EXISTS (SELECT 1 FROM work_session WHERE page_id = ?1)
                     OR EXISTS (SELECT 1 FROM task_done WHERE page_id = ?1)
                     OR EXISTS (SELECT 1 FROM page_tag WHERE page_id = ?1)",
                [page_id],
                |r| r.get(0),
            )
            .map_err(db_err)
    }

    fn page_total(&self, page_id: i64, now: i64) -> Result<i64> {
        self.conn
            .query_row(
                "SELECT COALESCE(SUM(COALESCE(ended_at, ?2) - started_at), 0) FROM work_session WHERE page_id = ?1",
                params![page_id, now],
                |r| r.get(0),
            )
            .map_err(db_err)
    }

    pub(super) fn detect_spread_changes(
        &self,
        old: &[PageState],
        new: &[PageState],
        now: i64,
    ) -> Result<(Vec<PageMerge>, Vec<PageSplit>)> {
        let before = |id: i64| old.iter().find(|p| p.id == id);
        let mut merges = Vec::new();
        let mut splits = Vec::new();

        for gone in new.iter().filter(|p| p.missing && before(p.id).is_some_and(|o| !o.missing)) {
            let gone_old = before(gone.id).unwrap();
            // 消えたページの隣（同期前の並びで）にあって、単ページから見開きになったページ
            let spread = new.iter().find(|p| {
                !p.missing
                    && p.span == 2
                    && before(p.id).is_some_and(|o| o.span == 1 && !o.missing && (o.order_index - gone_old.order_index).abs() == 1)
            });
            if let Some(spread) = spread
                && self.has_data(gone.id)?
            {
                merges.push(PageMerge {
                    from_page_id: gone.id,
                    from_file_name: gone.file_name.clone(),
                    to_page_id: spread.id,
                    to_label: page_label(spread.number, spread.span),
                    ms: self.page_total(gone.id, now)?,
                });
            }
        }

        for page in new.iter().filter(|p| !p.missing && p.span == 1 && before(p.id).is_some_and(|o| o.span == 2)) {
            // 見開きを解除すると、直後に新しいページができる
            let added = new
                .iter()
                .find(|p| !p.missing && before(p.id).is_none() && p.order_index == page.order_index + 1);
            if let Some(added) = added
                && self.has_data(page.id)?
            {
                splits.push(PageSplit {
                    page_id: page.id,
                    label: page_label(page.number, page.span),
                    new_page_id: added.id,
                    new_label: page_label(added.number, added.span),
                    ms: self.page_total(page.id, now)?,
                });
            }
        }
        Ok((merges, splits))
    }

    /// `from` の作業記録・タグを `to` に移し、`from` を消す。
    /// 完了は「両方とも完了していた工程」だけ残す（見開きの片方しか終わっていなければ未完了）
    pub fn merge_pages(&self, from: i64, to: i64) -> Result<()> {
        if from == to {
            return Err("同じページにはまとめられません".into());
        }
        let same_work: bool = self
            .conn
            .query_row(
                "SELECT (SELECT work_id FROM page WHERE id = ?1) = (SELECT work_id FROM page WHERE id = ?2)",
                params![from, to],
                |r| r.get(0),
            )
            .map_err(db_err)?;
        if !same_work {
            return Err("別の作品のページにはまとめられません".into());
        }
        let tx = self.conn.unchecked_transaction().map_err(db_err)?;
        tx.execute("UPDATE work_session SET page_id = ?2 WHERE page_id = ?1", params![from, to])
            .map_err(db_err)?;
        tx.execute(
            "DELETE FROM task_done WHERE page_id = ?2
             AND stage_id NOT IN (SELECT stage_id FROM task_done WHERE page_id = ?1)",
            params![from, to],
        )
        .map_err(db_err)?;
        // タグは足し合わせる。ただし排他グループで移す先にすでにタグがあるときは、移す先のタグを優先する
        tx.execute(
            "INSERT OR IGNORE INTO page_tag (page_id, tag_id)
             SELECT ?2, pt.tag_id FROM page_tag pt JOIN tag_def t ON t.id = pt.tag_id
             JOIN tag_group g ON g.id = t.group_id
             WHERE pt.page_id = ?1 AND NOT (g.exclusive = 1 AND EXISTS (
                SELECT 1 FROM page_tag pt2 JOIN tag_def t2 ON t2.id = pt2.tag_id
                WHERE pt2.page_id = ?2 AND t2.group_id = t.group_id))",
            params![from, to],
        )
        .map_err(db_err)?;
        tx.execute("DELETE FROM page WHERE id = ?1", [from]).map_err(db_err)?;
        tx.commit().map_err(db_err)?;
        Ok(())
    }

    /// 見開きが分かれたとき：完了とタグを新しいページにも写す。
    /// half = true なら、作業記録を 1 件ずつ前半・後半に分けて、後半を新しいページに移す（合計は半分ずつ）
    pub fn split_page(&self, page_id: i64, new_page_id: i64, half: bool) -> Result<()> {
        let tx = self.conn.unchecked_transaction().map_err(db_err)?;
        tx.execute(
            "INSERT OR IGNORE INTO task_done (page_id, stage_id, done_at)
             SELECT ?2, stage_id, done_at FROM task_done WHERE page_id = ?1",
            params![page_id, new_page_id],
        )
        .map_err(db_err)?;
        tx.execute(
            "INSERT OR IGNORE INTO page_tag (page_id, tag_id) SELECT ?2, tag_id FROM page_tag WHERE page_id = ?1",
            params![page_id, new_page_id],
        )
        .map_err(db_err)?;
        if half {
            let sessions: Vec<(i64, i64, i64, i64, bool)> = {
                let mut stmt = tx
                    .prepare(
                        "SELECT id, stage_id, started_at, ended_at, edited FROM work_session
                         WHERE page_id = ?1 AND ended_at IS NOT NULL",
                    )
                    .map_err(db_err)?;
                stmt.query_map([page_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)))
                    .and_then(|rows| rows.collect())
                    .map_err(db_err)?
            };
            for (id, stage, start, end, edited) in sessions {
                let mid = start + (end - start) / 2;
                tx.execute("UPDATE work_session SET ended_at = ?2 WHERE id = ?1", params![id, mid])
                    .map_err(db_err)?;
                tx.execute(
                    "INSERT INTO work_session (page_id, stage_id, started_at, ended_at, edited) VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![new_page_id, stage, mid, end, edited],
                )
                .map_err(db_err)?;
            }
        }
        tx.commit().map_err(db_err)?;
        Ok(())
    }

    /// 作品の（消えていない）ページのファイル名。保存の検知に使う
    pub fn page_files(&self, work_id: i64) -> Result<Vec<(i64, String)>> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, file_name FROM page WHERE work_id = ?1 AND missing = 0 ORDER BY order_index")
            .map_err(db_err)?;
        stmt.query_map([work_id], |r| Ok((r.get(0)?, r.get(1)?)))
            .and_then(|rows| rows.collect())
            .map_err(db_err)
    }
}

#[cfg(test)]
mod tests {
    use super::super::tests::{MIN, comic, stage_ids};
    use super::*;

    fn files(store: &Store, work: i64) -> Vec<(String, i64, bool)> {
        store.board(work, 0).unwrap().pages.into_iter().map(|p| (p.file_name, p.span, p.missing)).collect()
    }

    fn page(store: &Store, work: i64, file: &str) -> i64 {
        store.board(work, 0).unwrap().pages.into_iter().find(|p| p.file_name == file).unwrap().id
    }

    /// p1〜p4 の作品（ダミー cmc の並べ替え前と同じ形）
    fn four() -> (Store, i64) {
        let store = Store::open_in_memory().unwrap();
        let id = store
            .add_work(
                "C:/a.cmc",
                &comic(&[("page0001.clip", 1), ("page0006.clip", 1), ("page0007.clip", 1), ("page0008.clip", 1)]),
                0,
            )
            .unwrap();
        (store, id)
    }

    #[test]
    fn 見開きになって消えたページを見つけてまとめる() {
        let (store, id) = four();
        let st = stage_ids(&store);
        let p6 = page(&store, id, "page0006.clip");
        let p7 = page(&store, id, "page0007.clip");
        store.add_session(p6, st[0], 0, 30 * MIN, i64::MAX).unwrap();
        store.add_session(p7, st[0], 40 * MIN, 60 * MIN, i64::MAX).unwrap();
        store.set_task_done(p6, st[0], true, 0).unwrap();
        store.set_task_done(p7, st[0], true, 0).unwrap();
        store.set_task_done(p6, st[1], true, 0).unwrap(); // p7 のペン入れはまだ

        // CLIP STUDIO で p6 と p7 を見開きにした
        let r = store
            .sync_pages(id, &comic(&[("page0001.clip", 1), ("page0006.clip", 2), ("page0008.clip", 1)]), 0)
            .unwrap();
        assert_eq!(
            r.merges,
            [PageMerge { from_page_id: p7, from_file_name: "page0007.clip".into(), to_page_id: p6, to_label: "p2-3".into(), ms: 20 * MIN }]
        );
        assert!(r.splits.is_empty());

        store.merge_pages(p7, p6).unwrap();
        let board = store.board(id, 0).unwrap();
        assert_eq!(board.pages.len(), 3);
        let spread = board.pages.iter().find(|p| p.id == p6).unwrap();
        assert_eq!(spread.cells[0].total_ms, 50 * MIN);
        // 下書きは両方済み → 完了、ペン入れは片方だけ → 未完了
        assert!(spread.cells[0].done);
        assert!(!spread.cells[1].done);
    }

    #[test]
    fn 記録の無いページが消えても確認しない() {
        let (store, id) = four();
        let r = store
            .sync_pages(id, &comic(&[("page0001.clip", 1), ("page0006.clip", 2), ("page0008.clip", 1)]), 0)
            .unwrap();
        assert!(r.merges.is_empty());
    }

    #[test]
    fn 見開きの解除を見つけて記録を半分ずつ分ける() {
        let store = Store::open_in_memory().unwrap();
        let id = store
            .add_work("C:/a.cmc", &comic(&[("page0005.clip", 1), ("page0006.clip", 2), ("page0008.clip", 1)]), 0)
            .unwrap();
        let st = stage_ids(&store);
        let p6 = page(&store, id, "page0006.clip");
        store.add_session(p6, st[0], 0, 60 * MIN, i64::MAX).unwrap();
        store.add_session(p6, st[1], 100 * MIN, 140 * MIN, i64::MAX).unwrap();
        store.set_task_done(p6, st[0], true, 0).unwrap();

        // 見開きを解除すると page0009 ができる
        let r = store
            .sync_pages(
                id,
                &comic(&[("page0005.clip", 1), ("page0006.clip", 1), ("page0009.clip", 1), ("page0008.clip", 1)]),
                0,
            )
            .unwrap();
        let p9 = page(&store, id, "page0009.clip");
        assert_eq!(
            r.splits,
            [PageSplit { page_id: p6, label: "p2".into(), new_page_id: p9, new_label: "p3".into(), ms: 100 * MIN }]
        );

        store.split_page(p6, p9, true).unwrap();
        let board = store.board(id, 0).unwrap();
        let cells = |pid: i64| board.pages.iter().find(|p| p.id == pid).unwrap().cells.iter().map(|c| (c.total_ms / MIN, c.done)).collect::<Vec<_>>();
        assert_eq!(cells(p6), [(30, true), (20, false), (0, false)]);
        assert_eq!(cells(p9), [(30, true), (20, false), (0, false)]);
        // 合計は変わらない
        assert_eq!(store.spans(0).unwrap().iter().map(|s| s.ended_at.unwrap() - s.started_at).sum::<i64>(), 100 * MIN);
    }

    #[test]
    fn 元のページに残す分け方() {
        let store = Store::open_in_memory().unwrap();
        let id = store.add_work("C:/a.cmc", &comic(&[("a.clip", 2)]), 0).unwrap();
        let st = stage_ids(&store);
        let a = page(&store, id, "a.clip");
        store.add_session(a, st[0], 0, 60 * MIN, i64::MAX).unwrap();
        let r = store.sync_pages(id, &comic(&[("a.clip", 1), ("b.clip", 1)]), 0).unwrap();
        let b = r.splits[0].new_page_id;
        store.split_page(a, b, false).unwrap();
        let board = store.board(id, 0).unwrap();
        assert_eq!(board.pages[0].cells[0].total_ms, 60 * MIN);
        assert_eq!(board.pages[1].cells[0].total_ms, 0);
        assert_eq!(files(&store, id), [("a.clip".into(), 1, false), ("b.clip".into(), 1, false)]);
    }

    #[test]
    fn 消えたページの記録を手で別のページに移せる() {
        let (store, id) = four();
        let st = stage_ids(&store);
        let p8 = page(&store, id, "page0008.clip");
        store.add_session(p8, st[0], 0, 10 * MIN, i64::MAX).unwrap();
        store.sync_pages(id, &comic(&[("page0001.clip", 1), ("page0006.clip", 1), ("page0007.clip", 1)]), 0).unwrap();
        let p1 = page(&store, id, "page0001.clip");
        store.merge_pages(p8, p1).unwrap();
        assert_eq!(store.board(id, 0).unwrap().pages[0].cells[0].total_ms, 10 * MIN);
        assert!(store.merge_pages(p1, p1).is_err());
    }
}
