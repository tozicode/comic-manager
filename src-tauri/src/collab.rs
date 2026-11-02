//! CLIP STUDIO PAINT EX の「共同作業」データの読み取り（仕様書 5.23）。
//!
//! 形式は非公開で、観察した範囲を docs/clip-collabo-format.md にまとめてある。
//! ここは読むだけで、cmc / clip / 共同作業データには一切書き込まない。
//! Dropbox の同期中など読めないことは普通にあるので、どの段階で失敗しても `Err` を返すだけにする（panic しない）。

use std::path::{Path, PathBuf};

use chrono::{Local, TimeZone};
use rusqlite::Connection;
use serde::Serialize;

use crate::cmc::TempDb;
use crate::i18n::{M, trf};

/// 共同作業データの中の、履歴と担当が入るフォルダ
const COLLABO_DIR: &str = "Collabo";
/// 各自の作業フォルダに置かれる、自分の役割と取り込み状態のファイル
const LOCAL_FILE: &str = "CollaborateLocal.tclo";
/// Collabo の中の反映履歴
const LOG_FILE: &str = "CollaborateLog.tclg";

/// `File.Status`：3 = 削除、5 = 却下（管理者の操作）は作業の反映ではないので飛ばす
pub const STATUS_SKIP: [i64; 2] = [3, 5];

/// 共同作業データの場所と、この作品での自分の役割
#[derive(Debug, PartialEq)]
pub struct CollaboLocation {
    /// `Collabo/` フォルダ
    pub dir: PathBuf,
    /// 管理者（作家）のユーザー名。管理者の作業フォルダから見つけたときだけ分かる
    pub admin: Option<String>,
}

/// ページの担当（`.tced` 1 つ）
#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Assignment {
    /// ページファイル名（page0001.clip）
    pub file_name: String,
    pub user_name: String,
    /// 管理者が書いた指示
    pub comment: String,
    /// 担当にした時刻（ファイルの更新時刻。ms）
    pub since_ms: i64,
}

/// 反映 1 回（`CommitInfo` 1 行）
#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Commit {
    pub revision: i64,
    pub user_name: String,
    pub comment: String,
    /// 反映の日時（ms）
    pub at_ms: i64,
    /// その反映で触ったファイル名と `Status`（1 追加 / 2 更新 / 3 削除 / 4 提出 / 5 却下）
    pub files: Vec<(String, i64)>,
}

#[derive(Debug, Serialize, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Collabo {
    pub assignments: Vec<Assignment>,
    /// 版の順
    pub commits: Vec<Commit>,
}

/// cmc の場所から共同作業データの `Collabo/` を見つける。
/// 1. cmc と同じフォルダの `CollaborateLocal.tclo` の `CommonFolder`（管理者・利用者の作業フォルダ）
/// 2. cmc と同じフォルダに `Collabo/` が直接ある（共有側の cmc を登録している）
/// どちらも無ければ共同作業ではない
pub fn find_collabo(cmc_path: &Path) -> Option<CollaboLocation> {
    let folder = cmc_path.parent()?;
    let local = folder.join(LOCAL_FILE);
    if local.is_file() {
        if let Ok((common, user, admin)) = read_local(&local) {
            let dir = Path::new(&common).join(COLLABO_DIR);
            if dir.is_dir() {
                return Some(CollaboLocation { dir, admin: admin.then_some(user) });
            }
        }
    }
    let dir = folder.join(COLLABO_DIR);
    if dir.is_dir() {
        return Some(CollaboLocation { dir, admin: None });
    }
    None
}

/// `CollaborateLocal.tclo` の (共同作業データの場所, ユーザー名, 管理者か)
fn read_local(path: &Path) -> Result<(String, String, bool), String> {
    let conn = open_sqlite(path)?;
    conn.query_row("SELECT CommonFolder, UserName, Administrator FROM Common LIMIT 1", [], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)? != 0))
    })
    .map_err(read_err)
}

/// `Collabo/` を読み、担当と反映履歴を返す
pub fn read_collabo(dir: &Path) -> Result<Collabo, String> {
    Ok(Collabo { assignments: read_assignments(dir)?, commits: read_commits(&dir.join(LOG_FILE))? })
}

/// `Collabo/<ページファイル名の . を _ にしたもの>/<ユーザー名の UTF-16BE 16 進>.tced`
fn read_assignments(dir: &Path) -> Result<Vec<Assignment>, String> {
    let mut out = Vec::new();
    for entry in std::fs::read_dir(dir).map_err(read_err)? {
        let entry = entry.map_err(read_err)?;
        if !entry.path().is_dir() {
            continue;
        }
        let Some(file_name) = entry.file_name().to_str().map(folder_to_file_name) else { continue };
        for tced in std::fs::read_dir(entry.path()).map_err(read_err)? {
            let tced = tced.map_err(read_err)?;
            let path = tced.path();
            if path.extension().and_then(|e| e.to_str()) != Some("tced") {
                continue;
            }
            let Some(user_name) = path.file_stem().and_then(|s| s.to_str()).and_then(decode_hex_utf16) else { continue };
            let bytes = std::fs::read(&path).map_err(read_err)?;
            let since_ms = tced
                .metadata()
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);
            out.push(Assignment { file_name: file_name.clone(), user_name, comment: tced_comment(&bytes), since_ms });
        }
    }
    out.sort_by(|a, b| (&a.file_name, &a.user_name).cmp(&(&b.file_name, &b.user_name)));
    Ok(out)
}

/// `page0001_clip` → `page0001.clip`（最後の `_` だけを `.` に戻す）
fn folder_to_file_name(folder: &str) -> String {
    match folder.rfind('_') {
        Some(i) => format!("{}.{}", &folder[..i], &folder[i + 1..]),
        None => folder.to_string(),
    }
}

/// `0061007300730069007300740061006E0074` → `assistant`
fn decode_hex_utf16(hex: &str) -> Option<String> {
    if hex.len() % 4 != 0 || hex.is_empty() {
        return None;
    }
    let units: Option<Vec<u16>> = (0..hex.len()).step_by(4).map(|i| u16::from_str_radix(&hex[i..i + 4], 16).ok()).collect();
    String::from_utf16(&units?).ok()
}

/// `.tced` の中身：u32 BE の版、u32 BE の文字数（UTF-16 単位）、UTF-16BE の指示コメント。読めなければ空
fn tced_comment(bytes: &[u8]) -> String {
    if bytes.len() < 8 {
        return String::new();
    }
    let n = u32::from_be_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]) as usize;
    let body = &bytes[8..];
    let n = n.min(body.len() / 2);
    let units: Vec<u16> = (0..n).map(|i| u16::from_be_bytes([body[i * 2], body[i * 2 + 1]])).collect();
    String::from_utf16_lossy(&units)
}

/// `CollaborateLog.tclg` の `CommitInfo` と `File`
fn read_commits(path: &Path) -> Result<Vec<Commit>, String> {
    let conn = open_sqlite(path)?;
    let mut stmt = conn
        .prepare("SELECT Revision, UserName, Comment, Year, Month, Day, Hour, Minute, Second FROM CommitInfo ORDER BY Revision")
        .map_err(read_err)?;
    let mut commits: Vec<Commit> = stmt
        .query_map([], |r| {
            let ymd: [i64; 6] = [r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?, r.get(8)?];
            Ok(Commit {
                revision: r.get(0)?,
                user_name: r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                comment: r.get::<_, Option<String>>(2)?.unwrap_or_default(),
                at_ms: local_ms(ymd),
                files: Vec::new(),
            })
        })
        .and_then(|rows| rows.collect())
        .map_err(read_err)?;
    let mut files = conn.prepare("SELECT Revision, Path, Status FROM File ORDER BY _PW_ID").map_err(read_err)?;
    let files: Vec<(i64, String, i64)> = files
        .query_map([], |r| Ok((r.get(0)?, r.get::<_, Option<String>>(1)?.unwrap_or_default(), r.get::<_, Option<i64>>(2)?.unwrap_or(0))))
        .and_then(|rows| rows.collect())
        .map_err(read_err)?;
    for (revision, path, status) in files {
        if let Some(c) = commits.iter_mut().find(|c| c.revision == revision) {
            // `.:page0001.clip` の `.:` は共同作業データのフォルダを指す
            c.files.push((path.trim_start_matches(".:").to_string(), status));
        }
    }
    Ok(commits)
}

/// 現地時刻の年月日時分秒をミリ秒にする。ありえない日時は 0
fn local_ms([y, mo, d, h, mi, s]: [i64; 6]) -> i64 {
    Local
        .with_ymd_and_hms(y as i32, mo as u32, d as u32, h as u32, mi as u32, s as u32)
        .single()
        .map(|t| t.timestamp_millis())
        .unwrap_or(0)
}

/// CLIP STUDIO が開いている最中でも安全に読めるよう、中身を一時ファイルに写してから開く（cmc と同じ）
fn open_sqlite(path: &Path) -> Result<Connection, String> {
    let bytes = std::fs::read(path).map_err(read_err)?;
    TempDb::new(&bytes)?.open()
}

fn read_err(e: impl std::fmt::Display) -> String {
    trf(M::CollabReadFailed, &[("e", &e)])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn testdata() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("testdata/collabo")
    }

    #[test]
    fn 共有側のフォルダに直接ある_collabo_を見つける() {
        let loc = find_collabo(&testdata().join("shared/test.cmc")).unwrap();
        assert_eq!(loc, CollaboLocation { dir: testdata().join("shared/Collabo"), admin: None });
        // 共同作業でないフォルダ
        assert!(find_collabo(&testdata().join("nowhere/test.cmc")).is_none());
    }

    #[test]
    fn 作業フォルダの_tclo_から共同作業データの場所と役割を読む() {
        // 素材の tclo の CommonFolder は作ったときの絶対パス（D:\...\dummy-cmc\shared\test）で、
        // この環境には無いので場所は見つからない。役割と場所の読み取りだけ確かめる
        let (common, user, admin) = read_local(&testdata().join("author/CollaborateLocal.tclo")).unwrap();
        assert!(common.ends_with("shared\\test"));
        assert_eq!((user.as_str(), admin), ("author", true));
        let (_, user, admin) = read_local(&testdata().join("assistant/CollaborateLocal.tclo")).unwrap();
        assert_eq!((user.as_str(), admin), ("assistant", false));
    }

    #[test]
    fn 担当と反映履歴を読む() {
        let c = read_collabo(&testdata().join("shared/Collabo")).unwrap();
        assert_eq!(c.assignments.len(), 1);
        let a = &c.assignments[0];
        assert_eq!((a.file_name.as_str(), a.user_name.as_str(), a.comment.as_str()), ("page0001.clip", "assistant", "アシスタントへの指示"));
        assert!(a.since_ms > 0);

        assert_eq!(c.commits.len(), 2);
        let first = &c.commits[0];
        assert_eq!((first.revision, first.user_name.as_str(), first.comment.as_str()), (1, "author", "共同作業テストです"));
        assert_eq!(first.files.len(), 9);
        assert_eq!(first.files[0], ("page0001.clip".to_string(), 1));
        let second = &c.commits[1];
        assert_eq!((second.revision, second.user_name.as_str(), second.comment.as_str()), (2, "assistant", "アシスタントからのコメント"));
        assert_eq!(second.files, vec![("page0001.clip".to_string(), 4)]);
        // 2026-11-02 17:56:14（現地時刻）
        assert_eq!(second.at_ms, local_ms([2026, 11, 2, 17, 56, 14]));
        assert!(second.at_ms > first.at_ms);
    }

    #[test]
    fn フォルダ名とユーザー名の復号() {
        assert_eq!(folder_to_file_name("page0001_clip"), "page0001.clip");
        assert_eq!(folder_to_file_name("my_page_01_clip"), "my_page_01.clip");
        assert_eq!(decode_hex_utf16("0061007300730069007300740061006E0074").as_deref(), Some("assistant"));
        assert_eq!(decode_hex_utf16("30A230B7").as_deref(), Some("アシ"));
        assert!(decode_hex_utf16("xyz").is_none());
        assert_eq!(tced_comment(&[0, 0, 0, 1, 0, 0, 0, 2, 0x30, 0xA2, 0x30, 0xB7]), "アシ");
        assert_eq!(tced_comment(&[0, 0]), "");
    }

    #[test]
    fn 壊れたファイルは_err_になり_panic_しない() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("page0002_clip")).unwrap();
        std::fs::write(dir.path().join("page0002_clip/0061.tced"), [1, 2, 3]).unwrap();
        std::fs::write(dir.path().join(LOG_FILE), b"not sqlite").unwrap();
        assert!(read_collabo(dir.path()).is_err());
        // 履歴が無いだけなら担当は読める
        std::fs::remove_file(dir.path().join(LOG_FILE)).unwrap();
        assert!(read_collabo(dir.path()).is_err());
        assert_eq!(read_assignments(dir.path()).unwrap()[0].user_name, "a");
    }
}
