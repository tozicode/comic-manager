//! CLIP STUDIO PAINT の漫画ファイル（.cmc）とページファイル（.clip）の読み取り。
//!
//! 構造の詳細は docs/cmc-format.md を参照。
//! 元のファイルには絶対に書き込まない。CLIP STUDIO で開いている最中でも安全に読めるよう、
//! 中身をいったんメモリに読み込み、一時ファイルに書き出したものを SQLite で開く。

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags};
use serde::Serialize;

use crate::i18n::{M, tr, trf};

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Comic {
    /// 作品名。cmc に設定が無ければ cmc のファイル名
    pub title: String,
    /// 右綴じか（見開きを左右に分けたとき、若い番号のページがどちら側かを決める）
    pub right_bound: bool,
    pub pages: Vec<Page>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    /// ページファイル名（例: page0001.clip）。作品内でのページ ID として使う
    pub file_name: String,
    /// 先頭ページを 1 としたページ番号。見開きは左右 2 ページ分のうち小さい方
    pub number: u32,
    /// 1 = 単ページ、2 = 見開き
    pub span: u32,
    pub memo: String,
}

/// cmc を読み、作品名とページ一覧（表示順）を返す。
pub fn read_comic(cmc_path: &Path) -> Result<Comic, String> {
    let bytes = std::fs::read(cmc_path)
        .map_err(|e| trf(M::CmcOpenFailed, &[("path", &cmc_path.display()), ("e", &e)]))?;
    let db = TempDb::new(&bytes)?;
    let conn = db.open()?;

    let title: String = conn
        .query_row("SELECT ComicStoryStoryName FROM Project LIMIT 1", [], |r| {
            r.get::<_, Option<String>>(0)
        })
        .ok()
        .flatten()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| file_stem(cmc_path));
    // 綴じ方向。1 = 右綴じ（日本語の既定）、0 = 左綴じ。列が無い古い cmc は右綴じとみなす
    let right_bound = conn
        .query_row("SELECT ComicBindPosition FROM Project LIMIT 1", [], |r| r.get::<_, Option<i64>>(0))
        .ok()
        .flatten()
        .is_none_or(|v| v == 1);

    let nodes = read_nodes(&conn)?;
    let ordered = order_pages(&nodes);

    let mut pages = Vec::with_capacity(ordered.len());
    let mut number = 1;
    for node in ordered {
        let span = if node.page_flag == 1 { 2 } else { 1 };
        pages.push(Page {
            file_name: link_file_name(&node.link_path),
            number,
            span,
            memo: node.memo.clone(),
        });
        number += span;
    }
    Ok(Comic { title, right_bound, pages })
}

/// ページファイルのパスを返す。LinkPath の `.:` は cmc と同じフォルダを指す。
pub fn page_path(cmc_path: &Path, file_name: &str) -> PathBuf {
    cmc_path.parent().unwrap_or(Path::new(".")).join(file_name)
}

/// .clip に埋め込まれたサムネイル（PNG）を、幅 `max_width` 以下に縮小して PNG で返す。
pub fn read_thumbnail(clip_path: &Path, max_width: u32) -> Result<Vec<u8>, String> {
    let sqlite = read_clip_sqlite(clip_path)?;
    let db = TempDb::new(&sqlite)?;
    let conn = db.open()?;
    let png: Vec<u8> = conn
        .query_row("SELECT ImageData FROM CanvasPreview LIMIT 1", [], |r| r.get(0))
        .map_err(|e| trf(M::ThumbNotFound, &[("e", &e)]))?;

    let img = image::load_from_memory_with_format(&png, image::ImageFormat::Png)
        .map_err(|e| trf(M::ThumbReadFailed, &[("e", &e)]))?;
    let img = if img.width() > max_width {
        img.resize(max_width, u32::MAX, image::imageops::FilterType::Triangle)
    } else {
        img
    };
    let mut out = Vec::new();
    img.write_to(&mut std::io::Cursor::new(&mut out), image::ImageFormat::Png)
        .map_err(|e| trf(M::ThumbConvertFailed, &[("e", &e)]))?;
    Ok(out)
}

/// .psd / .psb の画像リソース 1036 に埋め込まれた JPEG サムネイルを取り出す。
/// CLIP STUDIO や Photoshop で保存したファイルには通常入っている（CLIP STUDIO の書き出しは 160×120）。
/// 画像そのもの（合成画像）は大きい絵だと読むのが重いので、ここでは読まない
pub fn read_psd_thumbnail(path: &Path) -> Result<Vec<u8>, String> {
    let err = |e: std::io::Error| trf(M::ImageReadFailed, &[("path", &path.display()), ("e", &e)]);
    let mut f = File::open(path).map_err(err)?;
    let mut header = [0u8; 26];
    f.read_exact(&mut header).map_err(err)?;
    if &header[0..4] != b"8BPS" {
        return Err(tr(M::NotPsd).into());
    }
    let mut len = [0u8; 4];
    f.read_exact(&mut len).map_err(err)?;
    f.seek(SeekFrom::Current(u32::from_be_bytes(len) as i64)).map_err(err)?; // カラーモードのデータ
    f.read_exact(&mut len).map_err(err)?;
    let size = u32::from_be_bytes(len) as usize;
    if size > 64 * 1024 * 1024 {
        return Err(tr(M::ImageResourceTooLarge).into());
    }
    let mut res = vec![0u8; size];
    f.read_exact(&mut res).map_err(err)?;

    let mut pos = 0;
    while pos + 12 <= res.len() {
        if &res[pos..pos + 4] != b"8BIM" {
            break;
        }
        let id = u16::from_be_bytes([res[pos + 4], res[pos + 5]]);
        // 名前は Pascal 文字列で、長さのバイトを含めて偶数に揃える
        let name_len = 1 + res[pos + 6] as usize;
        let at = pos + 6 + name_len + name_len % 2;
        if at + 4 > res.len() {
            break;
        }
        let data_len = u32::from_be_bytes(res[at..at + 4].try_into().unwrap()) as usize;
        let data = at + 4;
        if data + data_len > res.len() {
            break;
        }
        // 1036 のデータ：形式(4) 幅(4) 高さ(4) 行のバイト数(4) 全体の大きさ(4) 圧縮後の大きさ(4) ビット数(2) 面の数(2) → JPEG
        if id == 1036 && data_len > 28 && res[data..data + 4] == [0, 0, 0, 1] {
            return Ok(res[data + 28..data + data_len].to_vec());
        }
        pos = data + data_len + data_len % 2;
    }
    Err(tr(M::NoThumbnail).into())
}

struct Node {
    main_id: i64,
    kind: i64,
    next: i64,
    first_child: i64,
    page_flag: i64,
    memo: String,
    link_path: String,
}

fn read_nodes(conn: &Connection) -> Result<Vec<Node>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT MainId, Type, NextIndex, FirstChildIndex, PageFlag, Memo, LinkPath
             FROM CanvasNode ORDER BY _PW_ID",
        )
        .map_err(|e| trf(M::PageListUnsupported, &[("e", &e)]))?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Node {
                main_id: r.get(0)?,
                kind: r.get::<_, Option<i64>>(1)?.unwrap_or(-1),
                next: r.get::<_, Option<i64>>(2)?.unwrap_or(0),
                first_child: r.get::<_, Option<i64>>(3)?.unwrap_or(0),
                page_flag: r.get::<_, Option<i64>>(4)?.unwrap_or(0),
                memo: r.get::<_, Option<String>>(5)?.unwrap_or_default(),
                link_path: r.get::<_, Option<String>>(6)?.unwrap_or_default(),
            })
        })
        .and_then(|rows| rows.collect::<Result<Vec<_>, _>>())
        .map_err(|e| trf(M::PageListReadFailed, &[("e", &e)]))?;
    Ok(rows)
}

const NODE_ROOT: i64 = 0;
const NODE_PAGE: i64 = 2;

/// ルートの FirstChildIndex から NextIndex をたどってページを表示順に並べる。
/// 連結リストが壊れていたら（循環・欠損）、たどれなかったページを行の順で末尾に足す。
fn order_pages(nodes: &[Node]) -> Vec<&Node> {
    let find = |id: i64| nodes.iter().find(|n| n.main_id == id);
    let mut ordered: Vec<&Node> = Vec::new();

    if let Some(root) = nodes.iter().find(|n| n.kind == NODE_ROOT) {
        let mut id = root.first_child;
        while id != 0 {
            let Some(node) = find(id) else { break };
            if ordered.iter().any(|n| n.main_id == id) {
                break;
            }
            if node.kind == NODE_PAGE {
                ordered.push(node);
            }
            id = node.next;
        }
    }
    for node in nodes.iter().filter(|n| n.kind == NODE_PAGE) {
        if !ordered.iter().any(|n| n.main_id == node.main_id) {
            ordered.push(node);
        }
    }
    ordered
}

/// `.:page0001.clip` → `page0001.clip`
fn link_file_name(link_path: &str) -> String {
    let path = link_path.strip_prefix(".:").unwrap_or(link_path);
    Path::new(path)
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string())
}

fn file_stem(path: &Path) -> String {
    path.file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// .clip のチャンクをたどり、CHNKSQLi の中身（SQLite データベース）を取り出す。
/// レイヤー画像のチャンクは大きいので、読み飛ばして SQLite の部分だけ読む。
fn read_clip_sqlite(clip_path: &Path) -> Result<Vec<u8>, String> {
    let err = |e: std::io::Error| trf(M::PageFileReadFailed, &[("path", &clip_path.display()), ("e", &e)]);
    let mut f = File::open(clip_path).map_err(err)?;

    let mut header = [0u8; 24];
    f.read_exact(&mut header).map_err(err)?;
    if &header[0..8] != b"CSFCHUNK" {
        return Err(tr(M::NotClipPageFile).into());
    }
    let mut chunk = [0u8; 16];
    loop {
        if f.read_exact(&mut chunk).is_err() {
            return Err(tr(M::PageDbNotFound).into());
        }
        let size = u64::from_be_bytes(chunk[8..16].try_into().unwrap());
        match &chunk[0..8] {
            b"CHNKSQLi" => {
                let mut buf = vec![0u8; size as usize];
                f.read_exact(&mut buf).map_err(err)?;
                return Ok(buf);
            }
            b"CHNKFoot" => return Err(tr(M::PageDbNotFound).into()),
            _ => {
                f.seek(SeekFrom::Current(size as i64)).map_err(err)?;
            }
        }
    }
}

/// SQLite の中身を一時ファイルに書き出し、読み取り専用で開くためのもの。
/// drop 時に一時ファイルは消える。
struct TempDb(tempfile::NamedTempFile);

impl TempDb {
    fn new(bytes: &[u8]) -> Result<Self, String> {
        use std::io::Write;
        let mut f = tempfile::NamedTempFile::new().map_err(|e| trf(M::TempCreateFailed, &[("e", &e)]))?;
        f.write_all(bytes).map_err(|e| trf(M::TempWriteFailed, &[("e", &e)]))?;
        Ok(Self(f))
    }

    fn open(&self) -> Result<Connection, String> {
        Connection::open_with_flags(self.0.path(), OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|e| trf(M::DbOpenUnsupported, &[("e", &e)]))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dummy_dir() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../dummy-cmc/コミック 20261023")
    }

    fn dummy_cmc() -> PathBuf {
        dummy_dir().join("コミック 20261023.cmc")
    }

    fn summary(comic: &Comic) -> Vec<(&str, u32, u32)> {
        comic.pages.iter().map(|p| (p.file_name.as_str(), p.number, p.span)).collect()
    }

    #[test]
    fn 並べ替え済みのページ順を連結リストから読める() {
        let comic = read_comic(&dummy_cmc()).unwrap();
        // 作品名が未設定なので cmc のファイル名になる
        assert_eq!(comic.title, "コミック 20261023");
        assert_eq!(
            summary(&comic),
            vec![
                ("page0001.clip", 1, 1),
                ("page0003.clip", 2, 1),
                ("page0005.clip", 3, 1),
                ("page0006.clip", 4, 1),
                ("page0009.clip", 5, 1),
                ("page0008.clip", 6, 1),
                ("page0004.clip", 7, 1),
                ("page0002.clip", 8, 1),
            ]
        );
    }

    #[test]
    fn 見開きは2ページ分として数える() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("testdata/spread.cmc");
        let comic = read_comic(&path).unwrap();
        assert!(comic.right_bound);
        assert_eq!(
            summary(&comic),
            vec![
                ("page0001.clip", 1, 1),
                ("page0003.clip", 2, 1),
                ("page0005.clip", 3, 1),
                ("page0006.clip", 4, 2),
                ("page0008.clip", 6, 1),
                ("page0004.clip", 7, 1),
                ("page0002.clip", 8, 1),
            ]
        );
    }

    #[test]
    fn 存在しないファイルは日本語のエラーになる() {
        let err = read_comic(Path::new("no-such-file.cmc")).unwrap_err();
        assert!(err.contains("漫画ファイルを開けませんでした"));
    }

    #[test]
    fn clip_からサムネイルを縮小して取り出せる() {
        let png = read_thumbnail(&page_path(&dummy_cmc(), "page0001.clip"), 240).unwrap();
        let img = image::load_from_memory(&png).unwrap();
        assert_eq!(img.width(), 240);
        // 元は 1240 × 1754 なので縦横比を保つ
        assert!((339..=340).contains(&img.height()), "height = {}", img.height());
    }

    /// テスト用の小さな .psd（サムネイルのリソースを入れるかどうかを選べる）
    fn tiny_psd(with_thumb: bool) -> tempfile::NamedTempFile {
        use std::io::Write;
        let mut res = Vec::new();
        // 関係のないリソースを先に置く（名前が空で、長さが奇数のデータ）
        res.extend_from_slice(b"8BIM");
        res.extend_from_slice(&1005u16.to_be_bytes());
        res.extend_from_slice(&[0, 0]);
        res.extend_from_slice(&3u32.to_be_bytes());
        res.extend_from_slice(&[1, 2, 3, 0]);
        if with_thumb {
            let jpeg = [0xff, 0xd8, 0xff, 0xe0, 0x11, 0x22, 0xff, 0xd9];
            res.extend_from_slice(b"8BIM");
            res.extend_from_slice(&1036u16.to_be_bytes());
            res.extend_from_slice(&[0, 0]);
            res.extend_from_slice(&((28 + jpeg.len()) as u32).to_be_bytes());
            res.extend_from_slice(&[0, 0, 0, 1]);
            res.extend_from_slice(&[0; 24]);
            res.extend_from_slice(&jpeg);
        }
        let mut f = tempfile::NamedTempFile::new().unwrap();
        f.write_all(b"8BPS\0\x01").unwrap();
        f.write_all(&[0; 20]).unwrap();
        f.write_all(&0u32.to_be_bytes()).unwrap(); // カラーモードのデータ
        f.write_all(&(res.len() as u32).to_be_bytes()).unwrap();
        f.write_all(&res).unwrap();
        f.write_all(&[0; 16]).unwrap(); // レイヤーと画像のデータ（読まない）
        f
    }

    #[test]
    fn psd_に埋め込まれたサムネイルを取り出せる() {
        let f = tiny_psd(true);
        let jpeg = read_psd_thumbnail(f.path()).unwrap();
        assert_eq!(jpeg, [0xff, 0xd8, 0xff, 0xe0, 0x11, 0x22, 0xff, 0xd9]);
        assert!(read_psd_thumbnail(tiny_psd(false).path()).unwrap_err().contains("入っていません"));
        assert!(read_psd_thumbnail(&dummy_cmc()).unwrap_err().contains(".psd"));
    }

    #[test]
    fn clip_以外のファイルは拒否する() {
        let err = read_thumbnail(&dummy_cmc(), 240).unwrap_err();
        assert!(err.contains("ページファイルではありません"));
    }
}
