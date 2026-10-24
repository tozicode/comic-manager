//! 初回起動時に作る工程・タグの名前を、その時の言語にする（仕様書 5.14）。
//! 初期の名前はマイグレーションで日本語のまま作り、新しく作ったデータベースだけここで置き換える。
//! 置き換えた後は利用者が付けた名前と同じ扱いで、言語を切り替えても変わらない。

use rusqlite::params;

use crate::i18n::Lang;

use super::{Result, Store, db_err};

/// [日本語, 英語, 韓国語, 簡体字, 繁体字]。狭いマスに出るので短くする
type Names = [&'static str; 5];

/// 工程のセット（id, 名前, 単位）
const SETS: [(i64, Names, Names); 2] = [
    (1, ["漫画", "Comic", "만화", "漫画", "漫畫"], ["ページ", "page", "페이지", "页", "頁"]),
    (2, ["イラスト", "Illustration", "일러스트", "插画", "插畫"], ["枚", "file", "장", "张", "張"]),
];

/// 初期の工程（セットの id, 名前）。DEFAULT_STAGES・ILLUST_STAGES と同じ名前
const STAGES: [(i64, Names); 7] = [
    (1, ["下書き", "Sketch", "밑그림", "草稿", "草稿"]),
    (1, ["ペン入れ", "Inking", "펜선", "描线", "描線"]),
    (1, ["トーン", "Screentone", "톤", "网点", "網點"]),
    (2, ["ラフ", "Rough", "러프", "草图", "草圖"]),
    (2, ["線画", "Line art", "선화", "线稿", "線稿"]),
    (2, ["塗り", "Coloring", "채색", "上色", "上色"]),
    (2, ["仕上げ", "Finishing", "마무리", "收尾", "收尾"]),
];

/// 初期のタググループとタグ。DEFAULT_TAGS・ILLUST_TAGS と同じ名前
const TAGS: [(Names, &[Names]); 6] = [
    (
        ["コマ数", "Panels", "컷 수", "分格数", "分格數"],
        &[
            ["コマ少", "Few panels", "컷 적음", "分格少", "分格少"],
            ["コマ普通", "Avg. panels", "컷 보통", "分格普通", "分格普通"],
            ["コマ多", "Many panels", "컷 많음", "分格多", "分格多"],
        ],
    ),
    (
        ["特徴", "Features", "특징", "特点", "特點"],
        &[
            ["資料必要", "Needs refs", "자료 필요", "需要资料", "需要資料"],
            ["背景多め", "Many BGs", "배경 많음", "背景较多", "背景較多"],
            ["モブ多い", "Many extras", "엑스트라 많음", "路人多", "路人多"],
        ],
    ),
    (["自動", "Auto", "자동", "自动", "自動"], &[["見開き", "Spread", "펼침면", "跨页", "跨頁"]]),
    (
        ["規模", "Size", "규모", "规模", "規模"],
        &[
            ["小さめ", "Small", "작음", "较小", "較小"],
            ["普通", "Medium", "보통", "普通", "普通"],
            ["大作", "Large", "대작", "大作", "大作"],
        ],
    ),
    (
        ["背景", "Background", "배경", "背景", "背景"],
        &[
            ["なし", "None", "없음", "无", "無"],
            ["簡単", "Simple", "간단", "简单", "簡單"],
            ["しっかり", "Detailed", "상세", "精细", "精細"],
        ],
    ),
    (
        ["人数", "People", "인원", "人数", "人數"],
        &[
            ["1人", "1 person", "1명", "1人", "1人"],
            ["2〜3人", "2–3 people", "2~3명", "2~3人", "2~3人"],
            ["大勢", "Crowd", "여러 명", "多人", "多人"],
        ],
    ),
];

impl Store {
    pub(super) fn localize_defaults(&self, lang: Lang) -> Result<()> {
        if lang == Lang::Ja {
            return Ok(());
        }
        let i = lang as usize;
        let tx = self.conn.unchecked_transaction().map_err(db_err)?;
        for (id, name, unit) in SETS {
            tx.execute(
                "UPDATE stage_set SET name = ?2, unit = ?3 WHERE id = ?1 AND name = ?4 AND unit = ?5",
                params![id, name[i], unit[i], name[0], unit[0]],
            )
            .map_err(db_err)?;
        }
        for (set_id, name) in STAGES {
            tx.execute(
                "UPDATE stage_def SET name = ?2 WHERE set_id = ?1 AND name = ?3",
                params![set_id, name[i], name[0]],
            )
            .map_err(db_err)?;
        }
        // タグはグループの名前で絞ってから置き換え、そのあとグループの名前を変える
        for (group, tags) in TAGS {
            for tag in tags {
                tx.execute(
                    "UPDATE tag_def SET name = ?1
                     WHERE name = ?2 AND group_id IN (SELECT id FROM tag_group WHERE name = ?3)",
                    params![tag[i], tag[0], group[0]],
                )
                .map_err(db_err)?;
            }
            tx.execute("UPDATE tag_group SET name = ?1 WHERE name = ?2", params![group[i], group[0]])
                .map_err(db_err)?;
        }
        tx.commit().map_err(db_err)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::{KIND_COMIC, KIND_FILES};

    fn stage_names(store: &Store, set_id: i64) -> Vec<String> {
        store.list_stages().unwrap().into_iter().filter(|s| s.set_id == set_id).map(|s| s.name).collect()
    }

    // 言語はテスト全体で共有しているので、ここでは切り替えず localize_defaults を直接呼ぶ

    #[test]
    fn 初期の名前を英語にする() {
        let store = Store::open_in_memory().unwrap();
        store.localize_defaults(Lang::En).unwrap();

        let sets: Vec<(String, String)> = store.list_stage_sets().unwrap().into_iter().map(|s| (s.name, s.unit)).collect();
        assert_eq!(sets, [("Comic".into(), "page".into()), ("Illustration".into(), "file".into())]);
        let comic = store.default_set(KIND_COMIC).unwrap();
        let files = store.default_set(KIND_FILES).unwrap();
        assert_eq!(stage_names(&store, comic), ["Sketch", "Inking", "Screentone"]);
        assert_eq!(stage_names(&store, files), ["Rough", "Line art", "Coloring", "Finishing"]);

        let groups = store.list_tags().unwrap();
        let summary: Vec<(&str, Vec<&str>)> =
            groups.iter().map(|g| (g.name.as_str(), g.tags.iter().map(|t| t.name.as_str()).collect())).collect();
        assert_eq!(
            summary,
            [
                ("Panels", vec!["Few panels", "Avg. panels", "Many panels"]),
                ("Features", vec!["Needs refs", "Many BGs", "Many extras"]),
                ("Auto", vec!["Spread"]),
                ("Size", vec!["Small", "Medium", "Large"]),
                ("Background", vec!["None", "Simple", "Detailed"]),
                ("People", vec!["1 person", "2–3 people", "Crowd"]),
            ]
        );
        // 見開きはシステムタグのまま
        assert!(groups[2].system && groups[2].tags[0].system);
    }

    #[test]
    fn 繁体字でも全部置き換わる() {
        let store = Store::open_in_memory().unwrap();
        store.localize_defaults(Lang::ZhHant).unwrap();
        let jp = |s: &str| s.chars().any(|c| ('\u{3040}'..='\u{30ff}').contains(&c));
        let sets = store.list_stage_sets().unwrap();
        assert!(sets.iter().all(|s| !jp(&s.name) && !jp(&s.unit)));
        let stages = store.list_stages().unwrap();
        assert_eq!(stages.iter().map(|s| s.name.as_str()).collect::<Vec<_>>()[..3], ["草稿", "描線", "網點"]);
        for g in store.list_tags().unwrap() {
            assert!(!jp(&g.name), "{}", g.name);
            assert!(g.tags.iter().all(|t| !jp(&t.name)));
        }
    }

    #[test]
    fn 利用者が変えた名前と日本語はそのまま() {
        let store = Store::open_in_memory().unwrap();
        store.localize_defaults(Lang::Ja).unwrap();
        assert_eq!(stage_names(&store, 1), ["下書き", "ペン入れ", "トーン"]);

        // 名前を変えた工程や、後から足したタグは置き換えない
        let first = store.list_stages().unwrap()[0].id;
        store.update_stage(first, "ネーム", "#000000", 60).unwrap();
        let group = store.add_tag_group("独自", false, "both").unwrap();
        store.add_tag(group, "普通", 1.0).unwrap();
        store.localize_defaults(Lang::Ko).unwrap();
        assert_eq!(stage_names(&store, 1), ["ネーム", "펜선", "톤"]);
        let mine = store.list_tags().unwrap().into_iter().find(|g| g.id == group).unwrap();
        assert_eq!((mine.name.as_str(), mine.tags[0].name.as_str()), ("独自", "普通"));
    }
}
