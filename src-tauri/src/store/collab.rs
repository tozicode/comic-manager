//! 共同作業の取り込み（仕様書 5.23）の記録：メンバーと工程の対応、取り込んだ反映、担当の写し、取り込みの状態。
//!
//! 共同作業データを読むのは crate::collab。ここは読んだ結果を自分の記録に写し、
//! メンバーの反映を「そのページ × そのメンバーの工程の完了」にする。適用は反映の版ごとに 1 回だけ。
//! 作家が手で外した完了は、あとからメンバーの工程を変えても戻さない。

use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};

use crate::collab::{Collabo, STATUS_SKIP};
use crate::i18n::{M, tr};

use super::{Result, Store, db_err};

/// メンバーに順に割り当てる色（工程の色とかぶりにくい、落ち着いた並び）
const MEMBER_COLORS: [&str; 8] = ["#b5651d", "#2a9d8f", "#8e44ad", "#c2185b", "#5d8aa8", "#7b8d42", "#e07a5f", "#3d405b"];

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CollabMember {
    /// クリスタのユーザー名
    pub name: String,
    /// この人の反映で完了にする工程。空なら履歴に出すだけ
    pub stage_ids: Vec<i64>,
    pub color: String,
}

/// ボードのページに付ける担当（collab_assign と collab_member を合わせたもの）
#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Assignee {
    pub name: String,
    pub color: String,
    /// 管理者が書いた指示
    pub comment: String,
    /// このメンバーの工程（マスに印を付ける列）
    pub stage_ids: Vec<i64>,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CollabCommitRow {
    pub revision: i64,
    pub user_name: String,
    pub comment: String,
    pub committed_at: i64,
    /// 触ったページファイル名（削除・却下は除く）
    pub files: Vec<String>,
    /// 完了を付けたか
    pub applied: bool,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CollabInfo {
    /// 読んでいる Collabo フォルダ
    pub folder: String,
    pub last_read_at: Option<i64>,
    pub last_error: Option<String>,
    pub members: Vec<CollabMember>,
    /// 新しい順
    pub commits: Vec<CollabCommitRow>,
}

/// 1 回の取り込みの結果（画面の描き直しの要否に使う）
#[derive(Debug, Serialize, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct CollabSummary {
    /// 新しく取り込んだ反映の数
    pub new_commits: i64,
    /// 完了にしたマスの数
    pub applied_cells: i64,
    /// 担当が変わった
    pub assignments_changed: bool,
}

impl Store {
    /// 読んだ共同作業データを記録に写す。メンバーを増やし、新しい反映を取り込んで完了を付け、担当を置き換える。
    /// `admin` は管理者（作家）のユーザー名。その人の反映は作家自身の作業なので取り込まない
    pub fn apply_collabo(&self, work_id: i64, folder: &str, admin: Option<&str>, c: &Collabo, now: i64) -> Result<CollabSummary> {
        let mut summary = CollabSummary::default();
        let stages: Vec<i64> = self.work_stages(work_id)?.into_iter().map(|s| s.id).collect();

        // メンバー（名前が出てきた順に色を付ける）
        let names: Vec<&str> = c
            .commits
            .iter()
            .map(|k| k.user_name.as_str())
            .chain(c.assignments.iter().map(|a| a.user_name.as_str()))
            .filter(|n| !n.is_empty() && Some(*n) != admin)
            .collect();
        for name in names {
            self.ensure_member(work_id, name)?;
        }

        // 反映。版ごとに 1 回だけ
        for commit in &c.commits {
            if commit.user_name.is_empty() || Some(commit.user_name.as_str()) == admin {
                continue;
            }
            let known: bool = self
                .conn
                .query_row(
                    "SELECT COUNT(*) FROM collab_commit WHERE work_id = ?1 AND revision = ?2",
                    params![work_id, commit.revision],
                    |r| r.get::<_, i64>(0),
                )
                .map_err(db_err)?
                > 0;
            if known {
                continue;
            }
            let files: Vec<&str> =
                commit.files.iter().filter(|(_, st)| !STATUS_SKIP.contains(st)).map(|(f, _)| f.as_str()).collect();
            let member = self.find_member(work_id, &commit.user_name)?;
            let mut applied = 0;
            if let Some(m) = member {
                for file in &files {
                    // 見開きを分けている作品は同じファイル名の行が 2 つある。どちらも完了にする
                    let pages: Vec<i64> = self.pages_by_file(work_id, file)?;
                    for page in pages {
                        for stage in m.stage_ids.iter().filter(|s| stages.contains(s)) {
                            if !self.is_done(page, *stage)? {
                                self.set_task_done(page, *stage, true, commit.at_ms)?;
                                applied += 1;
                            }
                        }
                    }
                }
            }
            self.conn
                .execute(
                    "INSERT INTO collab_commit (work_id, revision, user_name, comment, committed_at, files, applied_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![
                        work_id,
                        commit.revision,
                        commit.user_name,
                        commit.comment,
                        commit.at_ms,
                        serde_json::to_string(&files).unwrap_or_default(),
                        if applied > 0 { Some(now) } else { None },
                    ],
                )
                .map_err(db_err)?;
            summary.new_commits += 1;
            summary.applied_cells += applied;
        }

        // 担当は毎回置き換える（解除はファイルが消えるだけで履歴に残らない）
        let before = self.assignment_keys(work_id)?;
        self.conn.execute("DELETE FROM collab_assign WHERE work_id = ?1", [work_id]).map_err(db_err)?;
        for a in &c.assignments {
            if Some(a.user_name.as_str()) == admin {
                continue;
            }
            self.conn
                .execute(
                    "INSERT OR REPLACE INTO collab_assign (work_id, file_name, user_name, comment, since_ms) VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![work_id, a.file_name, a.user_name, a.comment, a.since_ms],
                )
                .map_err(db_err)?;
        }
        summary.assignments_changed = before != self.assignment_keys(work_id)?;

        self.conn
            .execute(
                "INSERT INTO collab_state (work_id, folder, last_read_at, last_error) VALUES (?1, ?2, ?3, NULL)
                 ON CONFLICT(work_id) DO UPDATE SET folder = ?2, last_read_at = ?3, last_error = NULL",
                params![work_id, folder, now],
            )
            .map_err(db_err)?;
        Ok(summary)
    }

    /// 共同作業データが読めなかったことを記録する（前回の担当と履歴はそのまま）
    pub fn mark_collab_error(&self, work_id: i64, folder: &str, error: &str) -> Result<()> {
        self.conn
            .execute(
                "INSERT INTO collab_state (work_id, folder, last_error) VALUES (?1, ?2, ?3)
                 ON CONFLICT(work_id) DO UPDATE SET folder = ?2, last_error = ?3",
                params![work_id, folder, error],
            )
            .map_err(db_err)?;
        Ok(())
    }

    /// 共同作業データが無くなった（共同作業をやめた）。担当と状態を消す。メンバーと取り込んだ履歴は残す
    pub fn clear_collab(&self, work_id: i64) -> Result<()> {
        self.conn
            .execute_batch(&format!(
                "DELETE FROM collab_assign WHERE work_id = {work_id}; DELETE FROM collab_state WHERE work_id = {work_id};"
            ))
            .map_err(db_err)?;
        Ok(())
    }

    /// 共同作業の設定画面に出すもの。共同作業でない作品は None
    pub fn collab_info(&self, work_id: i64) -> Result<Option<CollabInfo>> {
        let state: Option<(String, Option<i64>, Option<String>)> = self
            .conn
            .query_row("SELECT folder, last_read_at, last_error FROM collab_state WHERE work_id = ?1", [work_id], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })
            .optional()
            .map_err(db_err)?;
        let Some((folder, last_read_at, last_error)) = state else { return Ok(None) };
        let mut stmt = self
            .conn
            .prepare(
                "SELECT revision, user_name, comment, committed_at, files, applied_at FROM collab_commit
                 WHERE work_id = ?1 ORDER BY revision DESC LIMIT 100",
            )
            .map_err(db_err)?;
        let commits = stmt
            .query_map([work_id], |r| {
                let files: String = r.get(4)?;
                Ok(CollabCommitRow {
                    revision: r.get(0)?,
                    user_name: r.get(1)?,
                    comment: r.get(2)?,
                    committed_at: r.get(3)?,
                    files: serde_json::from_str(&files).unwrap_or_default(),
                    applied: r.get::<_, Option<i64>>(5)?.is_some(),
                })
            })
            .and_then(|rows| rows.collect())
            .map_err(db_err)?;
        Ok(Some(CollabInfo { folder, last_read_at, last_error, members: self.collab_members(work_id)?, commits }))
    }

    /// メンバーの工程の対応と色を保存する。工程は作品で使っているものだけ受け付ける
    pub fn set_collab_member(&self, work_id: i64, name: &str, stage_ids: &[i64], color: &str) -> Result<CollabMember> {
        let stages: Vec<i64> = self.work_stages(work_id)?.into_iter().map(|s| s.id).collect();
        if stage_ids.iter().any(|s| !stages.contains(s)) {
            return Err(tr(M::CollabStageInvalid).into());
        }
        self.ensure_member(work_id, name)?;
        self.conn
            .execute(
                "UPDATE collab_member SET stage_ids = ?3, color = ?4 WHERE work_id = ?1 AND name = ?2",
                params![work_id, name, serde_json::to_string(stage_ids).unwrap_or_default(), color],
            )
            .map_err(db_err)?;
        self.find_member(work_id, name)?.ok_or_else(|| tr(M::WorkNotFound).into())
    }

    pub(super) fn has_collab(&self, work_id: i64) -> Result<bool> {
        self.conn
            .query_row("SELECT COUNT(*) FROM collab_state WHERE work_id = ?1", [work_id], |r| r.get::<_, i64>(0))
            .map(|n| n > 0)
            .map_err(db_err)
    }

    /// ボードに付ける担当：(ページファイル名, 担当)
    pub(super) fn collab_assignees(&self, work_id: i64) -> Result<Vec<(String, Assignee)>> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT a.file_name, a.user_name, a.comment, m.color, m.stage_ids FROM collab_assign a
                 JOIN collab_member m ON m.work_id = a.work_id AND m.name = a.user_name
                 WHERE a.work_id = ?1 ORDER BY a.file_name, a.user_name",
            )
            .map_err(db_err)?;
        stmt.query_map([work_id], |r| {
            let stage_ids: String = r.get(4)?;
            Ok((
                r.get(0)?,
                Assignee {
                    name: r.get(1)?,
                    comment: r.get(2)?,
                    color: r.get(3)?,
                    stage_ids: serde_json::from_str(&stage_ids).unwrap_or_default(),
                },
            ))
        })
        .and_then(|rows| rows.collect())
        .map_err(db_err)
    }

    fn collab_members(&self, work_id: i64) -> Result<Vec<CollabMember>> {
        let mut stmt = self
            .conn
            .prepare("SELECT name, stage_ids, color FROM collab_member WHERE work_id = ?1 ORDER BY rowid")
            .map_err(db_err)?;
        stmt.query_map([work_id], |r| {
            let stage_ids: String = r.get(1)?;
            Ok(CollabMember { name: r.get(0)?, stage_ids: serde_json::from_str(&stage_ids).unwrap_or_default(), color: r.get(2)? })
        })
        .and_then(|rows| rows.collect())
        .map_err(db_err)
    }

    fn find_member(&self, work_id: i64, name: &str) -> Result<Option<CollabMember>> {
        Ok(self.collab_members(work_id)?.into_iter().find(|m| m.name == name))
    }

    /// メンバーが居なければ、次の色で作る
    fn ensure_member(&self, work_id: i64, name: &str) -> Result<()> {
        let count: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM collab_member WHERE work_id = ?1", [work_id], |r| r.get(0))
            .map_err(db_err)?;
        let color = MEMBER_COLORS[(count as usize) % MEMBER_COLORS.len()];
        self.conn
            .execute(
                "INSERT OR IGNORE INTO collab_member (work_id, name, color) VALUES (?1, ?2, ?3)",
                params![work_id, name, color],
            )
            .map_err(db_err)?;
        Ok(())
    }

    fn pages_by_file(&self, work_id: i64, file_name: &str) -> Result<Vec<i64>> {
        let mut stmt = self
            .conn
            .prepare("SELECT id FROM page WHERE work_id = ?1 AND file_name = ?2 AND missing = 0")
            .map_err(db_err)?;
        stmt.query_map(params![work_id, file_name], |r| r.get(0)).and_then(|rows| rows.collect()).map_err(db_err)
    }

    fn is_done(&self, page_id: i64, stage_id: i64) -> Result<bool> {
        self.conn
            .query_row("SELECT COUNT(*) FROM task_done WHERE page_id = ?1 AND stage_id = ?2", params![page_id, stage_id], |r| {
                r.get::<_, i64>(0)
            })
            .map(|n| n > 0)
            .map_err(db_err)
    }

    fn assignment_keys(&self, work_id: i64) -> Result<Vec<(String, String)>> {
        let mut stmt = self
            .conn
            .prepare("SELECT file_name, user_name FROM collab_assign WHERE work_id = ?1 ORDER BY file_name, user_name")
            .map_err(db_err)?;
        stmt.query_map([work_id], |r| Ok((r.get(0)?, r.get(1)?))).and_then(|rows| rows.collect()).map_err(db_err)
    }
}

#[cfg(test)]
mod tests {
    use super::super::tests::{setup, stage_ids};
    use super::*;
    use crate::collab::{Assignment, Commit};
    use rusqlite::Connection;

    fn commit(revision: i64, user: &str, files: &[(&str, i64)]) -> Commit {
        Commit {
            revision,
            user_name: user.into(),
            comment: format!("c{revision}"),
            at_ms: revision * 1000,
            files: files.iter().map(|(f, s)| (f.to_string(), *s)).collect(),
        }
    }

    fn assign(file: &str, user: &str) -> Assignment {
        Assignment { file_name: file.into(), user_name: user.into(), comment: "指示".into(), since_ms: 5 }
    }

    #[test]
    fn 反映を取り込んでメンバーの工程を完了にし_同じ版は二度適用しない() {
        let (store, id) = setup();
        let st = stage_ids(&store);
        // 管理者 author の反映（版 1）と assistant の反映（版 2）
        let c = Collabo {
            assignments: vec![assign("page0002.clip", "assistant")],
            commits: vec![
                commit(1, "author", &[("page0001.clip", 1), ("page0002.clip", 1)]),
                commit(2, "assistant", &[("page0002.clip", 4), ("page0001.clip", 3)]),
            ],
        };
        // 工程の対応がまだ無いので、取り込むが完了は付かない
        let s = store.apply_collabo(id, "C:/shared/Collabo", Some("author"), &c, 100).unwrap();
        assert_eq!((s.new_commits, s.applied_cells, s.assignments_changed), (1, 0, true));
        let info = store.collab_info(id).unwrap().unwrap();
        assert_eq!(info.members.len(), 1);
        assert_eq!(info.members[0].name, "assistant");
        assert_eq!(info.commits.len(), 1);
        assert!(!info.commits[0].applied);
        assert_eq!(info.commits[0].files, ["page0002.clip"]); // 削除（3）は除く
        assert_eq!((info.last_read_at, info.last_error), (Some(100), None));

        // 工程を対応づけても、過去の版はやり直さない
        store.set_collab_member(id, "assistant", &[st[1]], "#123456").unwrap();
        let s = store.apply_collabo(id, "C:/shared/Collabo", Some("author"), &c, 200).unwrap();
        assert_eq!((s.new_commits, s.applied_cells, s.assignments_changed), (0, 0, false));
        let board = store.board(id, 0).unwrap();
        assert!(board.collab);
        assert!(!board.pages[1].cells[1].done);
        // 担当はページに付く
        let a = &board.pages[1].assignees;
        assert_eq!((a.len(), a[0].name.as_str(), a[0].color.as_str(), a[0].comment.as_str()), (1, "assistant", "#123456", "指示"));
        assert_eq!(a[0].stage_ids, [st[1]]);
        assert!(board.pages[0].assignees.is_empty());

        // 新しい版は完了になる（完了時刻は反映の日時）。見開きの 2 ページ目は 1 行なので 1 マス
        let mut c2 = c;
        c2.commits.push(commit(3, "assistant", &[("page0002.clip", 4)]));
        let s = store.apply_collabo(id, "C:/shared/Collabo", Some("author"), &c2, 300).unwrap();
        assert_eq!((s.new_commits, s.applied_cells), (1, 1));
        let board = store.board(id, 0).unwrap();
        assert_eq!((board.pages[1].cells[1].done, board.pages[1].cells[1].done_at), (true, Some(3000)));
        let info = store.collab_info(id).unwrap().unwrap();
        assert!(info.commits[0].applied && info.commits[0].revision == 3);

        // 作家が外したら、もう一度読んでも戻らない
        store.set_task_done(board.pages[1].id, st[1], false, 0).unwrap();
        store.apply_collabo(id, "C:/shared/Collabo", Some("author"), &c2, 400).unwrap();
        assert!(!store.board(id, 0).unwrap().pages[1].cells[1].done);
    }

    #[test]
    fn 管理者が分からないときは全員がメンバーになる() {
        let (store, id) = setup();
        let c = Collabo { assignments: vec![], commits: vec![commit(1, "author", &[("page0001.clip", 1)])] };
        store.apply_collabo(id, "C:/x/Collabo", None, &c, 1).unwrap();
        let info = store.collab_info(id).unwrap().unwrap();
        assert_eq!(info.members[0].name, "author");
        assert_eq!(info.commits.len(), 1);
    }

    #[test]
    fn 消えたページと知らない工程と知らないファイルは飛ばす() {
        let (store, id) = setup();
        let st = stage_ids(&store);
        store.set_collab_member(id, "b", &[st[0]], "#000").unwrap();
        // 作品で使っていない工程は断る
        assert!(store.set_collab_member(id, "b", &[9999], "#000").is_err());
        let c = Collabo {
            assignments: vec![],
            commits: vec![commit(1, "b", &[("nothere.clip", 4), ("page0001.clip", 4)])],
        };
        let s = store.apply_collabo(id, "C:/x/Collabo", None, &c, 1).unwrap();
        assert_eq!((s.new_commits, s.applied_cells), (1, 1));
        assert!(store.board(id, 0).unwrap().pages[0].cells[0].done);
    }

    #[test]
    fn 担当の解除と失敗の記録とやめたとき() {
        let (store, id) = setup();
        let c = Collabo { assignments: vec![assign("page0001.clip", "a"), assign("page0004.clip", "a")], commits: vec![] };
        let s = store.apply_collabo(id, "C:/x/Collabo", None, &c, 1).unwrap();
        assert!(s.assignments_changed);
        assert_eq!(store.board(id, 0).unwrap().pages.iter().filter(|p| !p.assignees.is_empty()).count(), 2);
        // 解除はファイルが消えるだけ
        let c = Collabo { assignments: vec![assign("page0004.clip", "a")], commits: vec![] };
        let s = store.apply_collabo(id, "C:/x/Collabo", None, &c, 2).unwrap();
        assert!(s.assignments_changed);
        let board = store.board(id, 0).unwrap();
        assert!(board.pages[0].assignees.is_empty() && !board.pages[2].assignees.is_empty());
        // 読めなかった記録。担当はそのまま
        store.mark_collab_error(id, "C:/x/Collabo", "壊れている").unwrap();
        let info = store.collab_info(id).unwrap().unwrap();
        assert_eq!((info.last_read_at, info.last_error.as_deref()), (Some(2), Some("壊れている")));
        assert!(!store.board(id, 0).unwrap().pages[2].assignees.is_empty());
        // 共同作業をやめた
        store.clear_collab(id).unwrap();
        assert!(store.collab_info(id).unwrap().is_none());
        let board = store.board(id, 0).unwrap();
        assert!(!board.collab && board.pages.iter().all(|p| p.assignees.is_empty()));
    }

    #[test]
    fn 版8のデータを版9に移しても作品は残り共同作業は無い扱い() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        let old = Store { conn };
        old.migrate(8).unwrap();
        old.conn
            .execute("INSERT INTO work (id, title, cmc_path, created_at, kind, set_id) VALUES (7, '旧作品', 'C:/old.cmc', 0, 'comic', 1)", [])
            .unwrap();
        old.migrate(super::super::LATEST).unwrap();
        assert!(old.collab_info(7).unwrap().is_none());
        assert!(!old.board(7, 0).unwrap().collab);
        assert_eq!(old.list_works().unwrap().len(), 1);
    }
}
