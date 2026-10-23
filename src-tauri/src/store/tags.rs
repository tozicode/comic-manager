//! ページのタグ。タグはグループに属し、排他グループではグループ内で 1 つだけ付けられる。
//! 「見開き」はシステムタグで、ページに保存せず cmc の見開き設定（span = 2）から自動で付く。

use rusqlite::params;
use serde::Serialize;

use super::{Result, Store, db_err};

/// システムタグの種類（tag_def.system）
pub const SYSTEM_SPREAD: &str = "spread";

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub id: i64,
    pub group_id: i64,
    pub name: String,
    /// 予測に使う倍率（最初の目安）
    pub initial_factor: f64,
    /// アプリが自動で付け外しするタグ（手では付け外しできない）
    pub system: bool,
    pub hidden: bool,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TagGroup {
    pub id: i64,
    pub name: String,
    /// true ならグループ内で 1 つだけ選べる
    pub exclusive: bool,
    /// 使う作品の種類："comic"（漫画）/ "files"（イラスト）/ "both"（両方）
    pub applies: String,
    /// システムタグだけのグループ（タグの追加・名前変更はできない）
    pub system: bool,
    pub tags: Vec<Tag>,
}

/// 初期状態のタグ（グループ名, 排他, [(タグ名, 倍率, システム)]）
type SeedGroup = (&'static str, bool, &'static [(&'static str, f64, Option<&'static str>)]);
const DEFAULT_TAGS: [SeedGroup; 3] = [
    ("コマ数", true, &[("コマ少", 0.8, None), ("コマ普通", 1.0, None), ("コマ多", 1.3, None)]),
    ("特徴", false, &[("資料必要", 1.3, None), ("背景多め", 1.3, None), ("モブ多い", 1.2, None)]),
    ("自動", false, &[("見開き", 2.0, Some(SYSTEM_SPREAD))]),
];

/// イラスト用の初期のタグ（版 3 で追加。どれも「どれか 1 つ」）
const ILLUST_TAGS: [(&str, &[(&str, f64)]); 3] = [
    ("規模", &[("小さめ", 0.6), ("普通", 1.0), ("大作", 2.0)]),
    ("背景", &[("なし", 0.8), ("簡単", 1.0), ("しっかり", 1.5)]),
    ("人数", &[("1人", 1.0), ("2〜3人", 1.5), ("大勢", 2.5)]),
];

const APPLIES: [&str; 3] = ["comic", "files", "both"];

impl Store {
    pub(super) fn seed_tags(&self) -> Result<()> {
        for (gi, (group, exclusive, tags)) in DEFAULT_TAGS.iter().enumerate() {
            self.conn
                .execute(
                    "INSERT INTO tag_group (name, exclusive, sort_order) VALUES (?1, ?2, ?3)",
                    params![group, exclusive, gi as i64],
                )
                .map_err(db_err)?;
            let group_id = self.conn.last_insert_rowid();
            for (ti, (name, factor, system)) in tags.iter().enumerate() {
                self.conn
                    .execute(
                        "INSERT INTO tag_def (group_id, name, initial_factor, system, sort_order)
                         VALUES (?1, ?2, ?3, ?4, ?5)",
                        params![group_id, name, factor, system, ti as i64],
                    )
                    .map_err(db_err)?;
            }
        }
        Ok(())
    }

    pub(super) fn seed_illust_tags(&self) -> Result<()> {
        for (name, tags) in ILLUST_TAGS {
            let group = self.add_tag_group(name, true, "files")?;
            for (tag, factor) in tags {
                self.add_tag(group, tag, *factor)?;
            }
        }
        Ok(())
    }

    pub fn list_tags(&self) -> Result<Vec<TagGroup>> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, name, exclusive, applies FROM tag_group ORDER BY sort_order, id")
            .map_err(db_err)?;
        let mut groups: Vec<TagGroup> = stmt
            .query_map([], |r| {
                Ok(TagGroup {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    exclusive: r.get(2)?,
                    applies: r.get(3)?,
                    system: false,
                    tags: Vec::new(),
                })
            })
            .and_then(|rows| rows.collect())
            .map_err(db_err)?;
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, group_id, name, initial_factor, system IS NOT NULL, hidden FROM tag_def
                 ORDER BY sort_order, id",
            )
            .map_err(db_err)?;
        let tags: Vec<Tag> = stmt
            .query_map([], |r| {
                Ok(Tag {
                    id: r.get(0)?,
                    group_id: r.get(1)?,
                    name: r.get(2)?,
                    initial_factor: r.get(3)?,
                    system: r.get(4)?,
                    hidden: r.get(5)?,
                })
            })
            .and_then(|rows| rows.collect())
            .map_err(db_err)?;
        for group in &mut groups {
            group.tags = tags.iter().filter(|t| t.group_id == group.id).cloned().collect();
            group.system = !group.tags.is_empty() && group.tags.iter().all(|t| t.system);
        }
        Ok(groups)
    }

    /// 作品のページに付いているタグ（ページ ID, タグ ID）。見開きのシステムタグも含め、隠したタグは除く
    pub(super) fn page_tags(&self, work_id: i64) -> Result<Vec<(i64, i64)>> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT pt.page_id, pt.tag_id FROM page_tag pt
                 JOIN page p ON p.id = pt.page_id JOIN tag_def t ON t.id = pt.tag_id
                 WHERE p.work_id = ?1 AND t.hidden = 0
                 UNION ALL
                 SELECT p.id, t.id FROM page p JOIN tag_def t ON t.system = ?2
                 WHERE p.work_id = ?1 AND p.span = 2 AND t.hidden = 0",
            )
            .map_err(db_err)?;
        stmt.query_map(params![work_id, SYSTEM_SPREAD], |r| Ok((r.get(0)?, r.get(1)?)))
            .and_then(|rows| rows.collect())
            .map_err(db_err)
    }

    /// 複数のページにまとめてタグを付ける（on = false なら外す）。
    /// 排他グループのタグを付けると、同じグループの別のタグは外れる
    pub fn set_page_tag(&self, page_ids: &[i64], tag_id: i64, on: bool) -> Result<()> {
        let (group_id, exclusive, system): (i64, bool, bool) = self
            .conn
            .query_row(
                "SELECT t.group_id, g.exclusive, t.system IS NOT NULL FROM tag_def t
                 JOIN tag_group g ON g.id = t.group_id WHERE t.id = ?1",
                [tag_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .map_err(|_| "タグが見つかりませんでした".to_string())?;
        if system {
            return Err("このタグは CLIP STUDIO の設定から自動で付きます".into());
        }
        let tx = self.conn.unchecked_transaction().map_err(db_err)?;
        for page_id in page_ids {
            if on {
                if exclusive {
                    tx.execute(
                        "DELETE FROM page_tag WHERE page_id = ?1
                         AND tag_id IN (SELECT id FROM tag_def WHERE group_id = ?2)",
                        params![page_id, group_id],
                    )
                    .map_err(db_err)?;
                }
                tx.execute(
                    "INSERT OR IGNORE INTO page_tag (page_id, tag_id) VALUES (?1, ?2)",
                    params![page_id, tag_id],
                )
                .map_err(db_err)?;
            } else {
                tx.execute("DELETE FROM page_tag WHERE page_id = ?1 AND tag_id = ?2", params![page_id, tag_id])
                    .map_err(db_err)?;
            }
        }
        tx.commit().map_err(db_err)?;
        Ok(())
    }

    pub fn add_tag_group(&self, name: &str, exclusive: bool, applies: &str) -> Result<i64> {
        let name = valid(name)?;
        check_applies(applies)?;
        self.conn
            .execute(
                "INSERT INTO tag_group (name, exclusive, applies, sort_order)
                 VALUES (?1, ?2, ?3, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM tag_group))",
                params![name, exclusive, applies],
            )
            .map_err(db_err)?;
        Ok(self.conn.last_insert_rowid())
    }

    /// グループの名前・排他・使う作品の種類を変える。排他にしたとき、2 つ以上付いているページは最初のタグだけ残す
    pub fn update_tag_group(&self, id: i64, name: &str, exclusive: bool, applies: &str) -> Result<()> {
        let name = valid(name)?;
        check_applies(applies)?;
        self.conn
            .execute(
                "UPDATE tag_group SET name = ?2, exclusive = ?3, applies = ?4 WHERE id = ?1",
                params![id, name, exclusive, applies],
            )
            .map_err(db_err)?;
        if exclusive {
            self.conn
                .execute(
                    "DELETE FROM page_tag WHERE tag_id IN (SELECT id FROM tag_def WHERE group_id = ?1)
                     AND EXISTS (
                        SELECT 1 FROM page_tag pt2 JOIN tag_def t2 ON t2.id = pt2.tag_id
                        WHERE pt2.page_id = page_tag.page_id AND t2.group_id = ?1
                          AND (t2.sort_order, t2.id) < (
                            SELECT sort_order, id FROM tag_def WHERE id = page_tag.tag_id))",
                    [id],
                )
                .map_err(db_err)?;
        }
        Ok(())
    }

    pub fn add_tag(&self, group_id: i64, name: &str, initial_factor: f64) -> Result<i64> {
        let name = valid(name)?;
        check_factor(initial_factor)?;
        let system: bool = self
            .conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM tag_def WHERE group_id = ?1 AND system IS NOT NULL",
                [group_id],
                |r| r.get(0),
            )
            .map_err(db_err)?;
        if system {
            return Err("このグループにはタグを追加できません".into());
        }
        self.conn
            .execute(
                "INSERT INTO tag_def (group_id, name, initial_factor, sort_order)
                 VALUES (?1, ?2, ?3, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM tag_def WHERE group_id = ?1))",
                params![group_id, name, initial_factor],
            )
            .map_err(db_err)?;
        Ok(self.conn.last_insert_rowid())
    }

    /// タグの名前と倍率を変える。システムタグは倍率だけ変えられる
    pub fn update_tag(&self, id: i64, name: &str, initial_factor: f64) -> Result<()> {
        let name = valid(name)?;
        check_factor(initial_factor)?;
        self.conn
            .execute(
                "UPDATE tag_def SET initial_factor = ?3,
                    name = CASE WHEN system IS NULL THEN ?2 ELSE name END WHERE id = ?1",
                params![id, name, initial_factor],
            )
            .map_err(db_err)?;
        Ok(())
    }

    /// 隠したタグは一覧に出ず、予測にも使わない（付けた記録は残る）
    pub fn set_tag_hidden(&self, id: i64, hidden: bool) -> Result<()> {
        self.conn
            .execute("UPDATE tag_def SET hidden = ?2 WHERE id = ?1", params![id, hidden])
            .map_err(db_err)?;
        Ok(())
    }
}

fn valid(name: &str) -> Result<&str> {
    let name = name.trim();
    if name.is_empty() { Err("名前を入力してください".into()) } else { Ok(name) }
}

fn check_applies(applies: &str) -> Result<()> {
    if APPLIES.contains(&applies) { Ok(()) } else { Err("使う作品の種類の指定が正しくありません".into()) }
}

fn check_factor(f: f64) -> Result<()> {
    if (0.1..=10.0).contains(&f) { Ok(()) } else { Err("倍率は ×0.1 〜 ×10 の範囲にしてください".into()) }
}

#[cfg(test)]
mod tests {
    use super::super::tests::{comic, setup};
    use super::*;

    fn tag_id(store: &Store, name: &str) -> i64 {
        store.list_tags().unwrap().iter().flat_map(|g| g.tags.iter()).find(|t| t.name == name).unwrap().id
    }

    fn names(store: &Store, work: i64, page: usize) -> Vec<String> {
        let groups = store.list_tags().unwrap();
        let all: Vec<&Tag> = groups.iter().flat_map(|g| g.tags.iter()).collect();
        store.board(work, 0).unwrap().pages[page]
            .tags
            .iter()
            .map(|id| all.iter().find(|t| t.id == *id).unwrap().name.clone())
            .collect()
    }

    #[test]
    fn 初期状態のタグ() {
        let (store, _) = setup();
        let groups = store.list_tags().unwrap();
        let summary: Vec<(&str, bool, bool, &str, usize)> = groups
            .iter()
            .map(|g| (g.name.as_str(), g.exclusive, g.system, g.applies.as_str(), g.tags.len()))
            .collect();
        assert_eq!(
            summary,
            [
                ("コマ数", true, false, "comic", 3),
                ("特徴", false, false, "both", 3),
                ("自動", false, true, "comic", 1),
                ("規模", true, false, "files", 3),
                ("背景", true, false, "files", 3),
                ("人数", true, false, "files", 3),
            ]
        );
    }

    #[test]
    fn 排他グループは選び直すと入れ替わる() {
        let (store, id) = setup();
        let pages: Vec<i64> = store.board(id, 0).unwrap().pages.iter().map(|p| p.id).collect();
        store.set_page_tag(&pages[0..1], tag_id(&store, "コマ多"), true).unwrap();
        store.set_page_tag(&pages[0..1], tag_id(&store, "資料必要"), true).unwrap();
        store.set_page_tag(&pages[0..1], tag_id(&store, "背景多め"), true).unwrap();
        store.set_page_tag(&pages[0..1], tag_id(&store, "コマ少"), true).unwrap();
        let mut got = names(&store, id, 0);
        got.sort();
        assert_eq!(got, ["コマ少", "背景多め", "資料必要"]);

        store.set_page_tag(&pages[0..1], tag_id(&store, "資料必要"), false).unwrap();
        let mut got = names(&store, id, 0);
        got.sort();
        assert_eq!(got, ["コマ少", "背景多め"]);
    }

    #[test]
    fn まとめて付けられる() {
        let (store, id) = setup();
        let pages: Vec<i64> = store.board(id, 0).unwrap().pages.iter().map(|p| p.id).collect();
        store.set_page_tag(&pages, tag_id(&store, "モブ多い"), true).unwrap();
        for i in 0..pages.len() {
            assert!(names(&store, id, i).contains(&"モブ多い".to_string()));
        }
    }

    #[test]
    fn 見開きは自動で付き_手では付け外しできない() {
        let (store, id) = setup();
        // setup の 2 ページ目（page0002）は見開き
        assert_eq!(names(&store, id, 1), ["見開き"]);
        assert!(names(&store, id, 0).is_empty());
        let spread = tag_id(&store, "見開き");
        let page = store.board(id, 0).unwrap().pages[0].id;
        assert!(store.set_page_tag(&[page], spread, true).unwrap_err().contains("自動"));

        // 単ページに戻ると外れる
        store.sync_pages(id, &comic(&[("page0001.clip", 1), ("page0002.clip", 1)]), 0).unwrap();
        assert!(names(&store, id, 1).is_empty());
    }

    #[test]
    fn 隠したタグはボードに出ない() {
        let (store, id) = setup();
        let page = store.board(id, 0).unwrap().pages[0].id;
        let mob = tag_id(&store, "モブ多い");
        store.set_page_tag(&[page], mob, true).unwrap();
        store.set_tag_hidden(mob, true).unwrap();
        assert!(names(&store, id, 0).is_empty());
        store.set_tag_hidden(mob, false).unwrap();
        assert_eq!(names(&store, id, 0), ["モブ多い"]);
    }

    #[test]
    fn タグとグループの追加と変更() {
        let (store, id) = setup();
        let group = store.add_tag_group("背景の色", false, "both").unwrap();
        assert!(store.add_tag_group("x", false, "anime").is_err());
        let city = store.add_tag(group, "街", 1.4).unwrap();
        let nature = store.add_tag(group, "自然", 1.1).unwrap();
        assert!(store.add_tag(group, "海", 20.0).unwrap_err().contains("倍率"));
        let spread_group = store.list_tags().unwrap().into_iter().find(|g| g.system).unwrap().id;
        assert!(store.add_tag(spread_group, "x", 1.0).is_err());

        // 排他にすると、2 つ付いているページは先に並んでいるタグだけ残る
        let page = store.board(id, 0).unwrap().pages[0].id;
        store.set_page_tag(&[page], nature, true).unwrap();
        store.set_page_tag(&[page], city, true).unwrap();
        store.update_tag_group(group, "背景の種類", true, "files").unwrap();
        assert_eq!(names(&store, id, 0), ["街"]);

        // システムタグは名前を変えられず、倍率だけ変わる
        let spread = tag_id(&store, "見開き");
        store.update_tag(spread, "2ページ", 1.8).unwrap();
        let t = store.list_tags().unwrap().into_iter().flat_map(|g| g.tags).find(|t| t.id == spread).unwrap();
        assert_eq!((t.name.as_str(), t.initial_factor), ("見開き", 1.8));
    }
}
