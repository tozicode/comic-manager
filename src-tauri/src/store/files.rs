//! イラストの作品：.clip / .psd のファイルを 1 つ以上束ねた作品。
//!
//! ページの file_name にファイルの場所そのものを入れ、表示名（title）にはファイル名から拡張子を除いたものを入れる。
//! 並び順は利用者が決め、cmc のような同期はない（ファイルがあるかどうかだけ調べる）。

use std::path::Path;

use rusqlite::params;

use super::{KIND_FILES, Result, Store, SyncResult, db_err, valid_name};

/// 登録できるファイルの拡張子
pub const ILLUST_EXTENSIONS: [&str; 3] = ["clip", "psd", "psb"];

fn file_title(path: &str) -> String {
    Path::new(path)
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string())
}

fn check_extension(path: &str) -> Result<()> {
    let ext = Path::new(path)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if ILLUST_EXTENSIONS.contains(&ext.as_str()) {
        Ok(())
    } else {
        Err(format!("{} は登録できない種類のファイルです（.clip / .psd を選んでください）", file_title(path)))
    }
}

impl Store {
    /// イラストの作品を登録する
    pub fn add_files_work(&self, title: &str, paths: &[String], set_id: i64, now: i64) -> Result<i64> {
        let title = valid_name(title)?;
        if paths.is_empty() {
            return Err("ファイルを 1 つ以上選んでください".into());
        }
        for p in paths {
            check_extension(p)?;
        }
        self.conn
            .execute(
                "INSERT INTO work (title, kind, cmc_path, created_at, last_synced_at) VALUES (?1, ?2, NULL, ?3, ?3)",
                params![title, KIND_FILES, now],
            )
            .map_err(db_err)?;
        let work_id = self.conn.last_insert_rowid();
        self.copy_stages(work_id, set_id)?;
        self.add_files(work_id, paths)?;
        Ok(work_id)
    }

    /// イラストの作品にファイルを足す（末尾に並べる）。同じ作品にすでにあるファイルは飛ばす。足した数を返す
    pub fn add_files(&self, work_id: i64, paths: &[String]) -> Result<i64> {
        self.ensure_files_work(work_id)?;
        let tx = self.conn.unchecked_transaction().map_err(db_err)?;
        let mut next: i64 = tx
            .query_row("SELECT COALESCE(MAX(order_index), -1) + 1 FROM page WHERE work_id = ?1", [work_id], |r| r.get(0))
            .map_err(db_err)?;
        let mut added = 0;
        for p in paths {
            check_extension(p)?;
            let n = tx
                .execute(
                    "INSERT OR IGNORE INTO page (work_id, file_name, order_index, number, span, title)
                     VALUES (?1, ?2, ?3, ?4, 1, ?5)",
                    params![work_id, p, next, next + 1, file_title(p)],
                )
                .map_err(db_err)?;
            if n > 0 {
                next += 1;
                added += 1;
            }
        }
        tx.commit().map_err(db_err)?;
        Ok(added)
    }

    /// イラストの作品からファイルを外す（そのファイルの作業記録・完了・タグも消える）
    pub fn remove_file(&self, page_id: i64) -> Result<()> {
        let work_id = self.page_work(page_id)?;
        self.ensure_files_work(work_id)?;
        let rest: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM page WHERE work_id = ?1 AND id != ?2", params![work_id, page_id], |r| r.get(0))
            .map_err(db_err)?;
        if rest == 0 {
            return Err("最後のファイルは外せません（作品ごと外すときは作品一覧から）".into());
        }
        self.conn.execute("DELETE FROM page WHERE id = ?1", [page_id]).map_err(db_err)?;
        self.renumber(work_id)
    }

    /// イラストの作品のファイルをこの順番に並べる
    pub fn set_file_order(&self, work_id: i64, page_ids: &[i64]) -> Result<()> {
        self.ensure_files_work(work_id)?;
        let mut all: Vec<i64> = self.page_states(work_id)?.into_iter().map(|p| p.id).collect();
        let mut sorted = page_ids.to_vec();
        all.sort();
        sorted.sort();
        if all != sorted {
            return Err("ファイルの並びが正しくありません".into());
        }
        let tx = self.conn.unchecked_transaction().map_err(db_err)?;
        for (i, id) in page_ids.iter().enumerate() {
            tx.execute("UPDATE page SET order_index = ?2 WHERE id = ?1", params![id, i as i64])
                .map_err(db_err)?;
        }
        tx.commit().map_err(db_err)?;
        self.renumber(work_id)
    }

    /// ファイルの場所を指定し直す（移動・名前の変更のあと）。記録はそのまま
    pub fn relink_file(&self, page_id: i64, path: &str) -> Result<()> {
        check_extension(path)?;
        let work_id = self.page_work(page_id)?;
        self.ensure_files_work(work_id)?;
        let dup: bool = self
            .conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM page WHERE work_id = ?1 AND file_name = ?2 AND id != ?3",
                params![work_id, path, page_id],
                |r| r.get(0),
            )
            .map_err(db_err)?;
        if dup {
            return Err("このファイルは同じ作品にすでに登録されています".into());
        }
        self.conn
            .execute(
                "UPDATE page SET file_name = ?2, title = ?3, missing = 0 WHERE id = ?1",
                params![page_id, path, file_title(path)],
            )
            .map_err(db_err)?;
        Ok(())
    }

    /// イラストの作品の読み直し：見つからないファイルの数を数える。
    /// ページの missing（漫画の「cmc から消えた」）は使わない。使うと、ファイルを一時的に移しただけで
    /// そのファイルの作業が予測や進捗から外れてしまうため
    pub fn refresh_files(&self, work_id: i64, exists: impl Fn(&str) -> bool, now: i64) -> Result<SyncResult> {
        self.ensure_files_work(work_id)?;
        let missing = self.page_files(work_id)?.iter().filter(|(_, path)| !exists(path)).count() as i64;
        self.conn
            .execute("UPDATE work SET last_synced_at = ?2 WHERE id = ?1", params![work_id, now])
            .map_err(db_err)?;
        Ok(SyncResult { added: 0, missing, merges: Vec::new(), splits: Vec::new() })
    }

    /// 作品の（消えていない）ページのファイルの場所。保存の検知に使う
    pub fn page_paths(&self, work_id: i64) -> Result<Vec<(i64, std::path::PathBuf)>> {
        let cmc = self.work_info(work_id)?.cmc_path;
        Ok(self
            .page_files(work_id)?
            .into_iter()
            .map(|(id, file)| (id, super::page_path(cmc.as_deref(), &file)))
            .collect())
    }

    /// 並び順から番号を振り直す
    fn renumber(&self, work_id: i64) -> Result<()> {
        let ids: Vec<i64> = {
            let mut stmt = self
                .conn
                .prepare("SELECT id FROM page WHERE work_id = ?1 ORDER BY order_index, id")
                .map_err(db_err)?;
            stmt.query_map([work_id], |r| r.get(0))
                .and_then(|rows| rows.collect())
                .map_err(db_err)?
        };
        for (i, id) in ids.iter().enumerate() {
            self.conn
                .execute("UPDATE page SET order_index = ?2, number = ?3 WHERE id = ?1", params![id, i as i64, i as i64 + 1])
                .map_err(db_err)?;
        }
        Ok(())
    }

    fn page_work(&self, page_id: i64) -> Result<i64> {
        self.conn
            .query_row("SELECT work_id FROM page WHERE id = ?1", [page_id], |r| r.get(0))
            .map_err(|_| "ファイルが見つかりませんでした".to_string())
    }

    fn ensure_files_work(&self, work_id: i64) -> Result<()> {
        if self.work_kind(work_id)? == KIND_FILES {
            Ok(())
        } else {
            Err("この操作はイラストの作品でだけ使えます".into())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::tests::{MIN, setup};
    use super::super::{KIND_COMIC, KIND_FILES};
    use super::*;

    fn illust() -> (Store, i64) {
        let store = Store::open_in_memory().unwrap();
        let set = store.default_set(KIND_FILES).unwrap();
        let id = store
            .add_files_work("夏の依頼", &["D:/絵/表紙.clip".into(), "D:/絵/キャラA.psd".into()], set, 0)
            .unwrap();
        (store, id)
    }

    #[test]
    fn イラストの作品はファイル名を表示名にしてイラストの工程を使う() {
        let (store, id) = illust();
        let board = store.board(id, 0).unwrap();
        assert_eq!(board.work.kind, KIND_FILES);
        assert_eq!(board.work.cmc_path, None);
        let rows: Vec<(&str, &str)> = board.pages.iter().map(|p| (p.label.as_str(), p.path.as_str())).collect();
        assert_eq!(rows, [("表紙", "D:/絵/表紙.clip"), ("キャラA", "D:/絵/キャラA.psd")]);
        let stages: Vec<String> = board.stages.into_iter().map(|s| s.name).collect();
        assert_eq!(stages, ["ラフ", "線画", "塗り", "仕上げ"]);
        assert_eq!(store.list_works().unwrap()[0].page_count, 2);
    }

    #[test]
    fn 登録できるのはclipとpsdだけ() {
        let store = Store::open_in_memory().unwrap();
        let set = store.default_set(KIND_FILES).unwrap();
        let err = store.add_files_work("x", &["D:/a.png".into()], set, 0).unwrap_err();
        assert!(err.contains("登録できない種類"));
        assert!(store.add_files_work("x", &[], set, 0).is_err());
        assert!(store.add_files_work("x", &["D:/a.PSB".into()], set, 0).is_ok());
    }

    #[test]
    fn ファイルの追加_並べ替え_外す() {
        let (store, id) = illust();
        // 同じファイルは二重に足さない
        let added = store.add_files(id, &["D:/絵/背景.clip".into(), "D:/絵/表紙.clip".into()]).unwrap();
        assert_eq!(added, 1);
        let ids: Vec<i64> = store.board(id, 0).unwrap().pages.iter().map(|p| p.id).collect();
        store.set_file_order(id, &[ids[2], ids[0], ids[1]]).unwrap();
        let labels = |s: &Store| s.board(id, 0).unwrap().pages.into_iter().map(|p| p.label).collect::<Vec<_>>();
        assert_eq!(labels(&store), ["背景", "表紙", "キャラA"]);
        assert!(store.set_file_order(id, &ids[0..2]).is_err());

        let finish = store.board(id, 0).unwrap().stages[3].id;
        store.add_session(ids[0], finish, 0, 10 * MIN, 100 * MIN).unwrap();
        store.remove_file(ids[0]).unwrap();
        assert_eq!(labels(&store), ["背景", "キャラA"]);
        assert!(store.list_sessions(id, 0).unwrap().is_empty());
        let rest: Vec<i64> = store.board(id, 0).unwrap().pages.iter().map(|p| p.id).collect();
        store.remove_file(rest[0]).unwrap();
        assert!(store.remove_file(rest[1]).unwrap_err().contains("最後のファイル"));
    }

    #[test]
    fn 見つからないファイルの場所を指定し直すと記録を引き継ぐ() {
        let (store, id) = illust();
        let page = store.board(id, 0).unwrap().pages[1].id;
        let stage = store.board(id, 0).unwrap().stages[0].id;
        store.add_session(page, stage, 0, 30 * MIN, 100 * MIN).unwrap();

        let r = store.refresh_files(id, |p| p.ends_with(".clip"), 5).unwrap();
        assert_eq!(r.missing, 1);
        // 見つからなくても、予測や進捗からは外さない
        let board = store.board(id, 0).unwrap();
        assert!(board.pages.iter().all(|p| !p.missing));
        assert_eq!(store.prediction(id, 0).unwrap().tasks.len(), 8);

        store.relink_file(page, "E:/移動先/キャラA_完成.psd").unwrap();
        let board = store.board(id, 0).unwrap();
        let p = board.pages.iter().find(|p| p.id == page).unwrap();
        assert_eq!((p.label.as_str(), p.missing, p.cells[0].total_ms), ("キャラA_完成", false, 30 * MIN));
        // 同じ作品の別のファイルと同じ場所にはできない
        let other = board.pages.iter().find(|p| p.id != page).unwrap().id;
        assert!(store.relink_file(other, "E:/移動先/キャラA_完成.psd").is_err());
    }

    #[test]
    fn 漫画の作品にはファイルの操作を使えない() {
        let (store, id) = setup();
        assert!(store.add_files(id, &["D:/a.clip".into()]).is_err());
        assert_eq!(store.work_kind(id).unwrap(), KIND_COMIC);
    }
}
