//! 見開きの統合・分割への追従と、ページ間での作業記録の移動。
//!
//! CLIP STUDIO で 2 ページを見開きにすると、片方の .clip が消えてもう片方が見開き（span = 2）になる。
//! 見開きを解除すると、見開きだったページが単ページに戻り、直後に新しい番号の .clip ができる。
//! 同期の前後のページを見比べてこの 2 つを見つけ、記録をどうするかを画面で確認する。
//!
//! 「見開きを 1 ページずつ管理する」作品（5.18）では、見開きを同じ .clip を指す 2 行（half = 1, 2）で持つ。
//! 2 行が常に 2 ページに対応するので、見開き化・解除のときは確認せずに行を付け替える（`follow_split_spreads`）。

use std::collections::HashSet;

use rusqlite::params;
use serde::Serialize;

use crate::cmc::Comic;
use crate::i18n::{M, tr};

use super::{KIND_COMIC, Result, Store, db_err, page_label};

/// 同期の前後で見比べるためのページの状態
#[derive(Debug, Clone)]
pub(super) struct PageState {
    pub(super) id: i64,
    file_name: String,
    order_index: i64,
    number: i64,
    span: i64,
    half: i64,
    missing: bool,
}

/// 同期で page 表に書く 1 行ぶん（見開きを分ける作品では、見開き 1 ページが 2 行になる）
pub(super) struct PageRow<'a> {
    pub(super) file_name: &'a str,
    /// cmc での並び（見開きを分けた 2 行は同じ値）
    pub(super) order_index: i64,
    pub(super) number: i64,
    pub(super) span: i64,
    pub(super) half: i64,
    pub(super) memo: &'a str,
}

/// cmc のページを page 表の行に直す。`split` なら見開きを half = 1, 2 の 2 行（各 1 ページ）にする
pub(super) fn page_rows(comic: &Comic, split: bool) -> Vec<PageRow<'_>> {
    let mut rows = Vec::with_capacity(comic.pages.len());
    for (i, p) in comic.pages.iter().enumerate() {
        let (file_name, order_index, memo) = (p.file_name.as_str(), i as i64, p.memo.as_str());
        if split && p.span == 2 {
            rows.push(PageRow { file_name, order_index, number: p.number as i64, span: 1, half: 1, memo });
            rows.push(PageRow { file_name, order_index, number: p.number as i64 + 1, span: 1, half: 2, memo });
        } else {
            rows.push(PageRow { file_name, order_index, number: p.number as i64, span: p.span as i64, half: 0, memo });
        }
    }
    rows
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
            .prepare("SELECT id, file_name, order_index, number, span, missing, half FROM page WHERE work_id = ?1")
            .map_err(db_err)?;
        stmt.query_map([work_id], |r| {
            Ok(PageState {
                id: r.get(0)?,
                file_name: r.get(1)?,
                order_index: r.get(2)?,
                number: r.get(3)?,
                span: r.get(4)?,
                missing: r.get(5)?,
                half: r.get(6)?,
            })
        })
        .and_then(|rows| rows.collect())
        .map_err(db_err)
    }

    /// 見開きを分ける作品で、cmc の見開き化・解除に行を追従させる（同期の upsert の前に呼ぶ）。
    /// - 単ページが見開きになった：その行を若い番号の側（half = 1）にし、隣にあって消えたページの行を次のページの側（half = 2）にする
    /// - 見開きが解除された：若い番号の側を単ページ（half = 0）に戻し、次のページの側を直後にできた新しいファイルの行にする
    /// どちらも記録・完了・タグは行に付いたまま動くので、確認はしない
    pub(super) fn follow_split_spreads(&self, old: &[PageState], comic: &Comic) -> Result<()> {
        let find = |file: &str, half: i64| old.iter().find(|p| p.file_name == file && p.half == half);
        let in_comic = |file: &str| comic.pages.iter().any(|p| p.file_name == file);
        let mut used: HashSet<i64> = HashSet::new();
        for (i, p) in comic.pages.iter().enumerate() {
            let f = p.file_name.as_str();
            if p.span == 2 {
                if let Some(whole) = find(f, 0)
                    && find(f, 1).is_none()
                {
                    self.conn.execute("UPDATE page SET half = 1 WHERE id = ?1", [whole.id]).map_err(db_err)?;
                }
                if find(f, 2).is_none()
                    && let Some(base) = old.iter().find(|q| q.file_name == f && q.half != 2)
                    && let Some(gone) = old.iter().find(|q| {
                        !q.missing
                            && q.half == 0
                            && !used.contains(&q.id)
                            && !in_comic(&q.file_name)
                            && (q.order_index - base.order_index).abs() == 1
                    })
                {
                    used.insert(gone.id);
                    self.conn
                        .execute("UPDATE page SET file_name = ?2, half = 2 WHERE id = ?1", params![gone.id, f])
                        .map_err(db_err)?;
                }
            } else {
                if let Some(first) = find(f, 1)
                    && find(f, 0).is_none()
                {
                    self.conn.execute("UPDATE page SET half = 0 WHERE id = ?1", [first.id]).map_err(db_err)?;
                }
                if let Some(second) = find(f, 2)
                    && let Some(next) = comic.pages.get(i + 1)
                    && old.iter().all(|q| q.file_name != next.file_name)
                {
                    self.conn
                        .execute("UPDATE page SET file_name = ?2, half = 0 WHERE id = ?1", params![second.id, next.file_name])
                        .map_err(db_err)?;
                }
            }
        }
        Ok(())
    }

    /// 「見開きを 1 ページずつ管理する」の切り替え（漫画のみ）。
    /// オン：見開きの行を 2 行に分ける。作業記録は半分ずつ、完了とタグは両方に付ける（見開きの解除と同じ扱い）。
    /// オフ：2 行を 1 つの見開きにまとめる。記録は合計し、完了は両方とも完了していた工程だけ残す（見開きの統合と同じ扱い）
    pub fn set_split_spreads(&self, work_id: i64, on: bool) -> Result<()> {
        let work = self.work_info(work_id)?;
        if work.kind != KIND_COMIC {
            return Err(tr(M::SplitSpreadsComicOnly).into());
        }
        if work.split_spreads == on {
            return Ok(());
        }
        let tx = self.conn.unchecked_transaction().map_err(db_err)?;
        if on {
            let spreads: Vec<(i64, String, i64, i64, String, bool)> = {
                let mut stmt = tx
                    .prepare(
                        "SELECT id, file_name, order_index, number, memo, missing FROM page
                         WHERE work_id = ?1 AND span = 2 AND half = 0",
                    )
                    .map_err(db_err)?;
                stmt.query_map([work_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)))
                    .and_then(|rows| rows.collect())
                    .map_err(db_err)?
            };
            for (id, file_name, order_index, number, memo, missing) in spreads {
                tx.execute("UPDATE page SET half = 1, span = 1 WHERE id = ?1", [id]).map_err(db_err)?;
                tx.execute(
                    "INSERT INTO page (work_id, file_name, order_index, number, span, memo, missing, half)
                     VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6, 2)",
                    params![work_id, file_name, order_index, number + 1, memo, missing],
                )
                .map_err(db_err)?;
                self.split_page_in(id, tx.last_insert_rowid(), true)?;
            }
        } else {
            let pairs: Vec<(i64, i64)> = {
                let mut stmt = tx
                    .prepare(
                        "SELECT a.id, b.id FROM page a JOIN page b
                           ON b.work_id = a.work_id AND b.file_name = a.file_name AND b.half = 2
                         WHERE a.work_id = ?1 AND a.half = 1",
                    )
                    .map_err(db_err)?;
                stmt.query_map([work_id], |r| Ok((r.get(0)?, r.get(1)?)))
                    .and_then(|rows| rows.collect())
                    .map_err(db_err)?
            };
            for (first, second) in pairs {
                self.merge_pages_in(second, first)?;
            }
            // 相方の無い若い番号の側（次のページの側が消えたまま）も、見開き 1 行に戻す。
            // 相方の無い次のページの側（消えたページ）は、記録を移す先を選べるようそのまま残す
            tx.execute("UPDATE page SET half = 0, span = 2 WHERE work_id = ?1 AND half = 1", [work_id])
                .map_err(db_err)?;
        }
        tx.execute("UPDATE work SET split_spreads = ?2 WHERE id = ?1", params![work_id, on])
            .map_err(db_err)?;
        tx.commit().map_err(db_err)?;
        Ok(())
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
            return Err(tr(M::MergeSamePage).into());
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
            return Err(tr(M::MergeOtherWork).into());
        }
        let tx = self.conn.unchecked_transaction().map_err(db_err)?;
        self.merge_pages_in(from, to)?;
        tx.commit().map_err(db_err)?;
        Ok(())
    }

    /// `merge_pages` の中身（呼ぶ側でトランザクションを開く）
    fn merge_pages_in(&self, from: i64, to: i64) -> Result<()> {
        let tx = &self.conn;
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
        Ok(())
    }

    /// 見開きが分かれたとき：完了とタグを新しいページにも写す。
    /// half = true なら、作業記録を 1 件ずつ前半・後半に分けて、後半を新しいページに移す（合計は半分ずつ）
    pub fn split_page(&self, page_id: i64, new_page_id: i64, half: bool) -> Result<()> {
        let tx = self.conn.unchecked_transaction().map_err(db_err)?;
        self.split_page_in(page_id, new_page_id, half)?;
        tx.commit().map_err(db_err)?;
        Ok(())
    }

    /// `split_page` の中身（呼ぶ側でトランザクションを開く）
    fn split_page_in(&self, page_id: i64, new_page_id: i64, half: bool) -> Result<()> {
        let tx = &self.conn;
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
        Ok(())
    }

    /// 作品の（消えていない）ページのファイル名。保存の検知に使う（見開きを分けた 2 行は同じファイルが並ぶ）
    pub fn page_files(&self, work_id: i64) -> Result<Vec<(i64, String)>> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, file_name FROM page WHERE work_id = ?1 AND missing = 0 ORDER BY order_index, half, id")
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

    // ----- 見開きを 1 ページずつ管理する（5.18） -----

    /// (表示名, ファイル名, half, 消えたか) の並び
    fn rows(store: &Store, work: i64) -> Vec<(String, String, i64, bool)> {
        store.board(work, 0).unwrap().pages.into_iter().map(|p| (p.label, p.file_name, p.half, p.missing)).collect()
    }

    fn split_work(store: &Store, pages: &[(&str, u32)]) -> i64 {
        let set = store.default_set(super::super::KIND_COMIC).unwrap();
        store.add_work_in_set("C:/a.cmc", &comic(pages), set, true, 0).unwrap()
    }

    #[test]
    fn 見開きを分ける作品では見開きが2行になり見開きタグは付かない() {
        let store = Store::open_in_memory().unwrap();
        let id = split_work(&store, &[("page0001.clip", 1), ("page0002.clip", 2), ("page0004.clip", 1)]);
        let board = store.board(id, 0).unwrap();
        assert!(board.work.split_spreads && board.work.right_bound);
        assert_eq!(
            rows(&store, id),
            [
                ("p1".into(), "page0001.clip".into(), 0, false),
                ("p2".into(), "page0002.clip".into(), 1, false),
                ("p3".into(), "page0002.clip".into(), 2, false),
                ("p4".into(), "page0004.clip".into(), 0, false),
            ]
        );
        // 2 行とも同じ .clip を指し、どちらも単ページ（見開きのシステムタグは付かない）
        assert_eq!(board.pages[1].path, board.pages[2].path);
        assert!(board.pages.iter().all(|p| p.span == 1 && p.tags.is_empty()));
        assert_eq!(store.list_works().unwrap()[0].page_count, 4);
    }

    #[test]
    fn 見開きを分ける作品では見開きになっても行を付け替えるだけで記録は残る() {
        let store = Store::open_in_memory().unwrap();
        let id = split_work(&store, &[("page0001.clip", 1), ("page0006.clip", 1), ("page0007.clip", 1), ("page0008.clip", 1)]);
        let st = stage_ids(&store);
        let p6 = page(&store, id, "page0006.clip");
        let p7 = page(&store, id, "page0007.clip");
        store.add_session(p6, st[0], 0, 30 * MIN, i64::MAX).unwrap();
        store.add_session(p7, st[0], 40 * MIN, 60 * MIN, i64::MAX).unwrap();
        store.set_task_done(p7, st[0], true, 0).unwrap();

        // CLIP STUDIO で p2 と p3 を見開きにした（page0007 が消える）
        let r = store
            .sync_pages(id, &comic(&[("page0001.clip", 1), ("page0006.clip", 2), ("page0008.clip", 1)]), 0)
            .unwrap();
        assert!(r.merges.is_empty() && r.splits.is_empty() && r.missing == 0);
        assert_eq!(
            rows(&store, id),
            [
                ("p1".into(), "page0001.clip".into(), 0, false),
                ("p2".into(), "page0006.clip".into(), 1, false),
                ("p3".into(), "page0006.clip".into(), 2, false),
                ("p4".into(), "page0008.clip".into(), 0, false),
            ]
        );
        let board = store.board(id, 0).unwrap();
        // 消えた page0007 の行がそのまま次のページの側になり、記録と完了は付いたまま
        assert_eq!((board.pages[2].id, board.pages[2].cells[0].total_ms, board.pages[2].cells[0].done), (p7, 20 * MIN, true));
        assert_eq!((board.pages[1].id, board.pages[1].cells[0].total_ms), (p6, 30 * MIN));
    }

    #[test]
    fn 見開きを分ける作品では見開きの解除も行を付け替える() {
        let store = Store::open_in_memory().unwrap();
        let id = split_work(&store, &[("page0005.clip", 1), ("page0006.clip", 2), ("page0008.clip", 1)]);
        let st = stage_ids(&store);
        let board = store.board(id, 0).unwrap();
        let (first, second) = (board.pages[1].id, board.pages[2].id);
        store.add_session(second, st[0], 0, 60 * MIN, i64::MAX).unwrap();

        // 見開きを解除すると page0009 ができる
        let r = store
            .sync_pages(
                id,
                &comic(&[("page0005.clip", 1), ("page0006.clip", 1), ("page0009.clip", 1), ("page0008.clip", 1)]),
                0,
            )
            .unwrap();
        assert!(r.merges.is_empty() && r.splits.is_empty() && r.added == 0 && r.missing == 0);
        assert_eq!(
            rows(&store, id),
            [
                ("p1".into(), "page0005.clip".into(), 0, false),
                ("p2".into(), "page0006.clip".into(), 0, false),
                ("p3".into(), "page0009.clip".into(), 0, false),
                ("p4".into(), "page0008.clip".into(), 0, false),
            ]
        );
        let board = store.board(id, 0).unwrap();
        assert_eq!((board.pages[1].id, board.pages[2].id), (first, second));
        assert_eq!(board.pages[2].cells[0].total_ms, 60 * MIN);
    }

    #[test]
    fn 見開きの分け方を切り替えると記録を分けたりまとめたりする() {
        let store = Store::open_in_memory().unwrap();
        let id = store
            .add_work("C:/a.cmc", &comic(&[("page0001.clip", 1), ("page0002.clip", 2), ("page0004.clip", 1)]), 0)
            .unwrap();
        let st = stage_ids(&store);
        let spread = page(&store, id, "page0002.clip");
        store.add_session(spread, st[0], 0, 60 * MIN, i64::MAX).unwrap();
        store.set_task_done(spread, st[0], true, 0).unwrap();
        let tag = store.list_tags().unwrap().iter().flat_map(|g| g.tags.iter()).find(|t| !t.system).unwrap().id;
        store.set_page_tag(&[spread], tag, true).unwrap();

        // オン：2 行に分かれ、記録は半分ずつ、完了とタグは両方に
        store.set_split_spreads(id, true).unwrap();
        assert!(store.work_info(id).unwrap().split_spreads);
        assert_eq!(
            rows(&store, id),
            [
                ("p1".into(), "page0001.clip".into(), 0, false),
                ("p2".into(), "page0002.clip".into(), 1, false),
                ("p3".into(), "page0002.clip".into(), 2, false),
                ("p4".into(), "page0004.clip".into(), 0, false),
            ]
        );
        let board = store.board(id, 0).unwrap();
        for p in &board.pages[1..3] {
            assert_eq!((p.cells[0].total_ms, p.cells[0].done, p.tags.clone()), (30 * MIN, true, vec![tag]));
        }
        // 読み直しても 2 行のまま
        store.sync_pages(id, &comic(&[("page0001.clip", 1), ("page0002.clip", 2), ("page0004.clip", 1)]), 0).unwrap();
        assert_eq!(rows(&store, id).len(), 4);
        store.set_task_done(board.pages[2].id, st[1], true, 0).unwrap(); // p3 のペン入れだけ完了

        // オフ：1 つの見開きに戻り、記録は合計、完了は両方とも完了していた工程だけ
        store.set_split_spreads(id, false).unwrap();
        assert_eq!(
            rows(&store, id),
            [
                ("p1".into(), "page0001.clip".into(), 0, false),
                ("p2-3".into(), "page0002.clip".into(), 0, false),
                ("p4".into(), "page0004.clip".into(), 0, false),
            ]
        );
        let board = store.board(id, 0).unwrap();
        let p = &board.pages[1];
        assert_eq!((p.span, p.cells[0].total_ms, p.cells[0].done, p.cells[1].done), (2, 60 * MIN, true, false));
        assert!(p.tags.contains(&tag));

        // 漫画以外では切り替えられない
        let manual = store.add_manual_work("竜", &["頭".to_string()], store.default_set(super::super::KIND_COMIC).unwrap(), 0).unwrap();
        assert!(store.set_split_spreads(manual, true).is_err());
    }
}
