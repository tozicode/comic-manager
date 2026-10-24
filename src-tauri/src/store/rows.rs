//! ファイルを持たない作品（仕様書 5.16）：ぬいぐるみ・模型・小説など、行を名前で作る作品。
//!
//! 行は page 表をそのまま使う。表示名は title、file_name は `row:{id}` という一意の値を入れるだけで
//! 場所としては使わない（サムネイル・保存の検知・場所の指定はこの種類では出さない）。
//! 並べ替えと削除はイラストのファイルと同じ関数（set_file_order / remove_file）を使う。

use rusqlite::params;

use crate::i18n::{M, tr, trf};

use super::{KIND_MANUAL, Result, Store, db_err, valid_name};

/// 行の名前の入力を整える。空行は飛ばし、数字だけ（例「12」）なら 1〜12 の行にする
pub fn row_names(names: &[String]) -> Vec<String> {
    let trimmed: Vec<&str> = names.iter().map(|n| n.trim()).filter(|n| !n.is_empty()).collect();
    if let [one] = trimmed[..]
        && let Ok(n) = one.parse::<u32>()
        && (1..=999).contains(&n)
    {
        return (1..=n).map(|i| i.to_string()).collect();
    }
    trimmed.into_iter().map(str::to_string).collect()
}

impl Store {
    /// ファイルを持たない作品を登録する。行が 1 つも無ければ登録しない
    pub fn add_manual_work(&self, title: &str, names: &[String], set_id: i64, now: i64) -> Result<i64> {
        let title = valid_name(title)?;
        let names = row_names(names);
        if names.is_empty() {
            return Err(trf(M::NoRowsGiven, &[("unit", &self.stage_set(set_id)?.unit)]));
        }
        self.conn
            .execute(
                "INSERT INTO work (title, kind, set_id, cmc_path, created_at, last_synced_at) VALUES (?1, ?2, ?3, NULL, ?4, ?4)",
                params![title, KIND_MANUAL, set_id, now],
            )
            .map_err(db_err)?;
        let work_id = self.conn.last_insert_rowid();
        self.copy_stages(work_id, set_id)?;
        self.add_rows(work_id, &names)?;
        Ok(work_id)
    }

    /// 行を末尾に足す。足した数を返す
    pub fn add_rows(&self, work_id: i64, names: &[String]) -> Result<i64> {
        self.ensure_manual_work(work_id)?;
        let names = row_names(names);
        if names.is_empty() {
            return Err(trf(M::NoRowsGiven, &[("unit", &self.work_info(work_id)?.unit)]));
        }
        let tx = self.conn.unchecked_transaction().map_err(db_err)?;
        let mut next: i64 = tx
            .query_row("SELECT COALESCE(MAX(order_index), -1) + 1 FROM page WHERE work_id = ?1", [work_id], |r| r.get(0))
            .map_err(db_err)?;
        for name in &names {
            // file_name は一意なら何でもよいので、入れたあとに行の id から付け直す
            tx.execute(
                "INSERT INTO page (work_id, file_name, order_index, number, span, title) VALUES (?1, ?2, ?3, ?4, 1, ?5)",
                params![work_id, format!("row:new:{next}"), next, next + 1, name],
            )
            .map_err(db_err)?;
            let id = tx.last_insert_rowid();
            tx.execute("UPDATE page SET file_name = ?2 WHERE id = ?1", params![id, format!("row:{id}")])
                .map_err(db_err)?;
            next += 1;
        }
        tx.commit().map_err(db_err)?;
        Ok(names.len() as i64)
    }

    /// 行の名前を変える
    pub fn rename_row(&self, page_id: i64, title: &str) -> Result<()> {
        let title = valid_name(title)?;
        self.ensure_manual_work(self.page_work(page_id)?)?;
        self.conn
            .execute("UPDATE page SET title = ?2 WHERE id = ?1", params![page_id, title])
            .map_err(db_err)?;
        Ok(())
    }

    fn ensure_manual_work(&self, work_id: i64) -> Result<()> {
        if self.work_kind(work_id)? == KIND_MANUAL { Ok(()) } else { Err(tr(M::RowsOnly).into()) }
    }
}

#[cfg(test)]
mod tests {
    use super::super::tests::{MIN, setup};
    use super::super::{KIND_COMIC, KIND_MANUAL};
    use super::*;

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }

    /// 単位「パーツ」のセットに工程を 2 つ作り、ガレージキットの作品を登録する
    fn kit() -> (Store, i64, i64) {
        let store = Store::open_in_memory().unwrap();
        let set = store.add_stage_set("ガレージキット", "パーツ").unwrap();
        store.add_stage_in_set(set.id, "原型", "#111111").unwrap();
        store.add_stage_in_set(set.id, "塗装", "#222222").unwrap();
        let id = store.add_manual_work("ドラゴン", &s(&["頭", "胴", "右腕"]), set.id, 0).unwrap();
        (store, id, set.id)
    }

    #[test]
    fn 行の名前の整え方() {
        assert_eq!(row_names(&s(&[" 頭 ", "", "胴"])), ["頭", "胴"]);
        assert_eq!(row_names(&s(&["3"])), ["1", "2", "3"]);
        assert_eq!(row_names(&s(&["3", "4"])), ["3", "4"]);
        // 0 は番号の行にせず、そのまま名前にする
        assert_eq!(row_names(&s(&["0"])), ["0"]);
        assert!(row_names(&s(&["", "  "])).is_empty());
    }

    #[test]
    fn ファイルを持たない作品は行の名前を表示名にして自作の工程を使う() {
        let (store, id, set) = kit();
        let board = store.board(id, 0).unwrap();
        assert_eq!((board.work.kind.as_str(), board.work.set_id, board.work.cmc_path), (KIND_MANUAL, set, None));
        let labels: Vec<&str> = board.pages.iter().map(|p| p.label.as_str()).collect();
        assert_eq!(labels, ["頭", "胴", "右腕"]);
        let stages: Vec<String> = board.stages.into_iter().map(|s| s.name).collect();
        assert_eq!(stages, ["原型", "塗装"]);
        let w = &store.list_works().unwrap()[0];
        assert_eq!((w.page_count, w.set_id, w.kind.as_str()), (3, set, KIND_MANUAL));
        // 行の file_name は一意の合成キーで、重なった名前の行も作れる
        store.add_rows(id, &s(&["頭"])).unwrap();
        assert_eq!(store.board(id, 0).unwrap().pages.len(), 4);
    }

    #[test]
    fn 行の追加_名前の変更_並べ替え_外す() {
        let (store, id, _) = kit();
        assert_eq!(store.add_rows(id, &s(&["左腕", ""])).unwrap(), 1);
        assert!(store.add_rows(id, &s(&[""])).is_err());
        let ids: Vec<i64> = store.board(id, 0).unwrap().pages.iter().map(|p| p.id).collect();
        store.rename_row(ids[3], "左腕（差し替え）").unwrap();
        assert!(store.rename_row(ids[3], " ").is_err());
        store.set_file_order(id, &[ids[3], ids[0], ids[1], ids[2]]).unwrap();
        let labels = |s: &Store| s.board(id, 0).unwrap().pages.into_iter().map(|p| p.label).collect::<Vec<_>>();
        assert_eq!(labels(&store), ["左腕（差し替え）", "頭", "胴", "右腕"]);

        let stage = store.board(id, 0).unwrap().stages[0].id;
        store.add_session(ids[0], stage, 0, 10 * MIN, 100 * MIN).unwrap();
        store.remove_file(ids[0]).unwrap();
        assert_eq!(labels(&store), ["左腕（差し替え）", "胴", "右腕"]);
        assert!(store.list_sessions(id, 0).unwrap().is_empty());
        for pid in [ids[3], ids[1]] {
            store.remove_file(pid).unwrap();
        }
        assert!(store.remove_file(ids[2]).unwrap_err().contains("最後のパーツ"));
    }

    #[test]
    fn 行が無ければ登録できず_漫画には行の操作を使えない() {
        let (store, id) = setup();
        let set = store.add_stage_set("小説", "章").unwrap();
        assert!(store.add_manual_work("x", &s(&[""]), set.id, 0).unwrap_err().contains("章の名前"));
        // 工程の無いセットでは登録できない
        assert!(store.add_manual_work("x", &s(&["1"]), set.id, 0).is_err());
        assert!(store.add_rows(id, &s(&["a"])).is_err());
        assert!(store.rename_row(store.board(id, 0).unwrap().pages[0].id, "a").is_err());
        assert_eq!(store.work_kind(id).unwrap(), KIND_COMIC);
    }

    #[test]
    fn 数字だけなら番号の行を作る() {
        let store = Store::open_in_memory().unwrap();
        let set = store.add_stage_set("小説", "章").unwrap();
        store.add_stage_in_set(set.id, "初稿", "#111111").unwrap();
        let id = store.add_manual_work("長編", &s(&["5"]), set.id, 0).unwrap();
        let labels: Vec<String> = store.board(id, 0).unwrap().pages.into_iter().map(|p| p.label).collect();
        assert_eq!(labels, ["1", "2", "3", "4", "5"]);
    }
}
