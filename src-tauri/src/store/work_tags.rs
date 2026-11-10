//! 作品のタグ（仕様書 5.26）。名前だけのタグで、作品一覧の絞り込みに使う。
//! ページのタグ（tags.rs。倍率とグループを持ち予測に効く）とは別物。
//! タグを管理する画面は置かないので、どの作品にも付いていないタグは付け外しのたびに消す。

use std::collections::HashMap;

use rusqlite::params;
use serde::Serialize;

use super::{Result, Store, db_err, valid_name};

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkTag {
    pub id: i64,
    pub name: String,
}

impl Store {
    /// 今あるタグ（名前の順）
    pub fn list_work_tags(&self) -> Result<Vec<WorkTag>> {
        let mut stmt = self.conn.prepare("SELECT id, name FROM work_tag ORDER BY name, id").map_err(db_err)?;
        stmt.query_map([], |r| Ok(WorkTag { id: r.get(0)?, name: r.get(1)? }))
            .and_then(|rows| rows.collect())
            .map_err(db_err)
    }

    /// 作品ごとの付いているタグ（名前の順。作品一覧に添える）
    pub(super) fn work_tags_by_work(&self) -> Result<HashMap<i64, Vec<WorkTag>>> {
        let mut stmt = self
            .conn
            .prepare("SELECT l.work_id, t.id, t.name FROM work_tag_link l JOIN work_tag t ON t.id = l.tag_id ORDER BY t.name, t.id")
            .map_err(db_err)?;
        let rows: Vec<(i64, WorkTag)> = stmt
            .query_map([], |r| Ok((r.get(0)?, WorkTag { id: r.get(1)?, name: r.get(2)? })))
            .and_then(|rows| rows.collect())
            .map_err(db_err)?;
        let mut map: HashMap<i64, Vec<WorkTag>> = HashMap::new();
        for (work, tag) in rows {
            map.entry(work).or_default().push(tag);
        }
        Ok(map)
    }

    /// 名前でタグを付ける。同じ名前のタグがあればそれを、無ければ作って付ける
    pub fn add_work_tag(&self, work_id: i64, name: &str) -> Result<WorkTag> {
        let name = valid_name(name)?;
        self.conn
            .execute("INSERT OR IGNORE INTO work_tag (name) VALUES (?1)", [name])
            .map_err(db_err)?;
        let id: i64 = self
            .conn
            .query_row("SELECT id FROM work_tag WHERE name = ?1", [name], |r| r.get(0))
            .map_err(db_err)?;
        self.set_work_tag(work_id, id, true)?;
        Ok(WorkTag { id, name: name.to_string() })
    }

    /// 今あるタグを付け外しする。外して誰にも付いていなくなったタグは消す
    pub fn set_work_tag(&self, work_id: i64, tag_id: i64, on: bool) -> Result<()> {
        if on {
            self.conn
                .execute("INSERT OR IGNORE INTO work_tag_link (work_id, tag_id) VALUES (?1, ?2)", params![work_id, tag_id])
                .map_err(db_err)?;
        } else {
            self.conn
                .execute("DELETE FROM work_tag_link WHERE work_id = ?1 AND tag_id = ?2", params![work_id, tag_id])
                .map_err(db_err)?;
        }
        self.prune_work_tags()
    }

    /// どの作品にも付いていないタグを消す
    pub(super) fn prune_work_tags(&self) -> Result<()> {
        self.conn
            .execute("DELETE FROM work_tag WHERE id NOT IN (SELECT tag_id FROM work_tag_link)", [])
            .map_err(db_err)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::super::tests::{comic, setup};
    use super::*;

    fn names(store: &Store, work: i64) -> Vec<String> {
        let works = store.list_works().unwrap();
        works.into_iter().find(|w| w.id == work).unwrap().tags.into_iter().map(|t| t.name).collect()
    }

    #[test]
    fn 名前でタグを作って付け_同じ名前は同じタグを使う() {
        let (store, a) = setup();
        let b = store.add_work("C:/b.cmc", &comic(&[("page0001.clip", 1)]), 0).unwrap();
        let skeb = store.add_work_tag(a, " Skeb ").unwrap();
        assert_eq!(skeb.name, "Skeb");
        assert_eq!(store.add_work_tag(b, "Skeb").unwrap().id, skeb.id);
        store.add_work_tag(a, "個人絵").unwrap();
        // 二度付けても 1 つ
        store.add_work_tag(a, "Skeb").unwrap();
        assert_eq!(names(&store, a), ["Skeb", "個人絵"]);
        assert_eq!(names(&store, b), ["Skeb"]);
        assert_eq!(store.list_work_tags().unwrap().len(), 2);
        assert!(store.add_work_tag(a, "  ").is_err());
    }

    #[test]
    fn 誰にも付いていないタグは消える() {
        let (store, a) = setup();
        let b = store.add_work("C:/b.cmc", &comic(&[("page0001.clip", 1)]), 0).unwrap();
        let tag = store.add_work_tag(a, "合作").unwrap();
        store.set_work_tag(b, tag.id, true).unwrap();
        store.set_work_tag(a, tag.id, false).unwrap();
        assert_eq!(store.list_work_tags().unwrap(), [tag.clone()]);
        // 最後の作品を外すと消える
        store.remove_work(b).unwrap();
        assert!(store.list_work_tags().unwrap().is_empty());
        assert!(names(&store, a).is_empty());
    }
}
