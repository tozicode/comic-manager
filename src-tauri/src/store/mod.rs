//! アプリのデータ（作品・ページ・工程・作業記録）を保存する SQLite データベース。
//!
//! 時刻はすべて UNIX 時間のミリ秒（i64）で保存する。日付への変換は画面側（ローカル時刻）で行う。
//! テストしやすいよう、現在時刻 `now` は呼び出し側から渡す。

use std::path::Path;

use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;

use crate::cmc::Comic;
use crate::i18n::{M, tr, trf};

mod files;
mod localize;
mod pages;
mod predict;
mod prefs;
mod rows;
mod schedule;
mod tags;

pub use pages::{PageMerge, PageSplit};
pub use predict::{ModelStats, Prediction};
pub use prefs::{DisplayPrefs, TimerPrefs};
pub use schedule::WorkSchedule;
pub use tags::TagGroup;

pub type Result<T> = std::result::Result<T, String>;

fn db_err(e: rusqlite::Error) -> String {
    trf(M::DbError, &[("e", &e)])
}

// ---------------------------------------------------------------------------
// 画面に返すデータ
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StageDef {
    pub id: i64,
    /// 属する工程のセット（漫画・イラストなど）
    pub set_id: i64,
    pub name: String,
    pub color: String,
    pub sort_order: i64,
    /// 実績がまだ無いときに使う、1ページあたりの目安時間（分）
    pub hint_minutes: i64,
    pub hidden: bool,
}

/// 工程のセット。作品の登録時に選び、そのセットの工程を使う
#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StageSet {
    pub id: i64,
    pub name: String,
    /// 1 単位の呼び方（ページ・枚・パーツ など）
    pub unit: String,
    /// このセットを既定にする作品の種類（comic / files / manual）。利用者が作ったセットは manual
    pub kind: String,
}

/// 作品の種類：漫画（cmc）、イラスト（.clip / .psd を束ねたもの）、ファイルを持たない作品（行を名前で作る）
pub const KIND_COMIC: &str = "comic";
pub const KIND_FILES: &str = "files";
pub const KIND_MANUAL: &str = "manual";

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkSummary {
    pub id: i64,
    pub title: String,
    pub kind: String,
    /// 登録時に選んだ工程のセット（タグの出し分けに使う）
    pub set_id: i64,
    /// セットの単位の言葉（パーツ・章 など。漫画・イラストは画面側が今の言語で出すので使わない）
    pub unit: String,
    /// 漫画の cmc の場所（漫画以外は None）
    pub cmc_path: Option<String>,
    /// 見開きを 2 ページと数えたページ数（イラストはファイルの数）
    pub page_count: i64,
    pub stage_count: i64,
    /// 0.0〜1.0。完了したタスクの割合（見開きは 2 ページ分の重み）
    pub progress: f64,
    pub total_ms: i64,
    pub last_worked_at: Option<i64>,
    /// 登録した場所にファイルが見つからない（移動・名前の変更など）。画面に返す直前に調べる
    pub file_missing: bool,
    /// 作品一覧に出す代表のサムネイル（最初のページ・ファイル）の場所。ファイルを持たない作品は None
    pub thumb_path: Option<String>,
}

/// 別の場所の cmc につなぎ直す前の照らし合わせ
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RelinkCheck {
    /// 新しい cmc の作品名
    pub title: String,
    /// 新しい cmc のページ数（ファイルの数）
    pub new_pages: i64,
    /// 今の作品のページ数（消えたページを除く）
    pub old_pages: i64,
    /// ファイル名が一致したページ数
    pub matched: i64,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkInfo {
    pub id: i64,
    pub title: String,
    pub kind: String,
    pub set_id: i64,
    pub unit: String,
    pub cmc_path: Option<String>,
    pub last_synced_at: Option<i64>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StageRef {
    pub id: i64,
    pub name: String,
    pub color: String,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Cell {
    pub stage_id: i64,
    pub done: bool,
    pub total_ms: i64,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BoardPage {
    pub id: i64,
    pub file_name: String,
    /// ページのファイルの場所（サムネイルと保存の検知に使う）
    pub path: String,
    pub label: String,
    pub number: i64,
    pub span: i64,
    /// cmc から消えたページ（漫画のみ。予測や進捗から外す）
    pub missing: bool,
    /// ファイルが今の場所にあるか（画面に返す直前に調べる。イラストの「場所を指定」に使う）
    pub found: bool,
    /// 付いているタグ（自動で付く「見開き」も含む。隠したタグは含まない）
    pub tags: Vec<i64>,
    /// 工程の順（`Board::stages` と同じ並び）
    pub cells: Vec<Cell>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Board {
    pub work: WorkInfo,
    pub stages: Vec<StageRef>,
    pub pages: Vec<BoardPage>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ActiveSession {
    pub id: i64,
    pub work_id: i64,
    pub work_title: String,
    pub page_id: i64,
    pub page_label: String,
    pub stage_id: i64,
    pub stage_name: String,
    pub stage_color: String,
    pub started_at: i64,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StopResult {
    /// 止めた作業記録の ID
    pub session_id: i64,
    pub page_id: i64,
    pub page_label: String,
    pub stage_id: i64,
    pub stage_name: String,
    /// 今回の計測時間
    pub duration_ms: i64,
    /// このタスクの合計時間
    pub total_ms: i64,
    pub already_done: bool,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionRow {
    pub id: i64,
    pub page_id: i64,
    pub page_label: String,
    pub stage_id: i64,
    pub stage_name: String,
    pub stage_color: String,
    pub started_at: i64,
    /// 計測中なら None
    pub ended_at: Option<i64>,
    pub edited: bool,
}

/// ヒートマップ用。全作品の作業記録を工程つきで返す
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Span {
    pub work_id: i64,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    pub stage_name: String,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
    pub added: i64,
    pub missing: i64,
    /// 見開きになって消えたページ（記録をまとめるか確認する）
    pub merges: Vec<PageMerge>,
    /// 見開きが単ページに戻ったページ（記録の分け方を確認する）
    pub splits: Vec<PageSplit>,
}

pub fn page_label(number: i64, span: i64) -> String {
    if span == 2 {
        format!("p{}-{}", number, number + 1)
    } else {
        format!("p{number}")
    }
}

/// 行の表示名。イラストのファイルとファイルを持たない作品の行は名前（title）、漫画のページは p 番号
pub fn row_label(title: Option<String>, number: i64, span: i64) -> String {
    title.unwrap_or_else(|| page_label(number, span))
}

/// ページのファイルの場所。漫画は cmc と同じフォルダ、イラストは file_name に場所そのものが入っている
/// （ファイルを持たない作品では呼ばない）
pub fn page_path(cmc_path: Option<&str>, file_name: &str) -> std::path::PathBuf {
    match cmc_path {
        Some(cmc) => crate::cmc::page_path(Path::new(cmc), file_name),
        None => std::path::PathBuf::from(file_name),
    }
}

// ---------------------------------------------------------------------------
// データベース本体
// ---------------------------------------------------------------------------

pub struct Store {
    conn: Connection,
}

/// 初期状態の工程（名前, 色, 目安の分）
const DEFAULT_STAGES: [(&str, &str, i64); 3] = [
    ("下書き", "#5b7fb8", 60),
    ("ペン入れ", "#c8553d", 90),
    ("トーン", "#4f8a5b", 60),
];

/// イラスト用の初期の工程（版 3 で追加）
const ILLUST_STAGES: [(&str, &str, i64); 4] = [
    ("ラフ", "#9a7fb8", 60),
    ("線画", "#5b7fb8", 120),
    ("塗り", "#d0913a", 180),
    ("仕上げ", "#4f8a5b", 60),
];

/// スキーマの最新の版
const LATEST: i64 = 4;

impl Store {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| trf(M::DataDirCreateFailed, &[("e", &e)]))?;
        }
        Self::init(Connection::open(path).map_err(db_err)?)
    }

    #[cfg(test)]
    pub fn open_in_memory() -> Result<Self> {
        Self::init(Connection::open_in_memory().map_err(db_err)?)
    }

    fn init(conn: Connection) -> Result<Self> {
        conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")
            .map_err(db_err)?;
        let store = Self { conn };
        let fresh: i64 = store.conn.query_row("PRAGMA user_version", [], |r| r.get(0)).map_err(db_err)?;
        store.migrate(LATEST)?;
        // 初めて作ったデータベースなら、初期の工程・タグの名前を今の言語にする
        if fresh == 0 {
            store.localize_defaults(crate::i18n::current())?;
        }
        Ok(store)
    }

    /// `PRAGMA user_version` でスキーマの版を管理する。`target` の版まで上げる（テストでは古い版を作るのに使う）
    fn migrate(&self, target: i64) -> Result<()> {
        let version: i64 = self
            .conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .map_err(db_err)?;
        if version < 1 && target >= 1 {
            self.conn
                .execute_batch(
                    "BEGIN;
                    CREATE TABLE stage_def (
                        id INTEGER PRIMARY KEY,
                        name TEXT NOT NULL,
                        color TEXT NOT NULL,
                        sort_order INTEGER NOT NULL,
                        hint_minutes INTEGER NOT NULL DEFAULT 60,
                        hidden INTEGER NOT NULL DEFAULT 0
                    );
                    CREATE TABLE work (
                        id INTEGER PRIMARY KEY,
                        title TEXT NOT NULL,
                        cmc_path TEXT NOT NULL UNIQUE,
                        created_at INTEGER NOT NULL,
                        last_synced_at INTEGER
                    );
                    CREATE TABLE work_stage (
                        work_id INTEGER NOT NULL REFERENCES work(id) ON DELETE CASCADE,
                        stage_id INTEGER NOT NULL REFERENCES stage_def(id),
                        sort_order INTEGER NOT NULL,
                        PRIMARY KEY (work_id, stage_id)
                    );
                    CREATE TABLE page (
                        id INTEGER PRIMARY KEY,
                        work_id INTEGER NOT NULL REFERENCES work(id) ON DELETE CASCADE,
                        file_name TEXT NOT NULL,
                        order_index INTEGER NOT NULL,
                        number INTEGER NOT NULL,
                        span INTEGER NOT NULL DEFAULT 1,
                        memo TEXT NOT NULL DEFAULT '',
                        missing INTEGER NOT NULL DEFAULT 0,
                        UNIQUE (work_id, file_name)
                    );
                    CREATE TABLE task_done (
                        page_id INTEGER NOT NULL REFERENCES page(id) ON DELETE CASCADE,
                        stage_id INTEGER NOT NULL REFERENCES stage_def(id),
                        done_at INTEGER NOT NULL,
                        PRIMARY KEY (page_id, stage_id)
                    );
                    CREATE TABLE work_session (
                        id INTEGER PRIMARY KEY,
                        page_id INTEGER NOT NULL REFERENCES page(id) ON DELETE CASCADE,
                        stage_id INTEGER NOT NULL REFERENCES stage_def(id),
                        started_at INTEGER NOT NULL,
                        ended_at INTEGER,
                        edited INTEGER NOT NULL DEFAULT 0
                    );
                    CREATE INDEX work_session_task ON work_session (page_id, stage_id);
                    CREATE INDEX work_session_started ON work_session (started_at);
                    PRAGMA user_version = 1;
                    COMMIT;",
                )
                .map_err(db_err)?;
            for (i, (name, color, hint)) in DEFAULT_STAGES.iter().enumerate() {
                self.conn
                    .execute(
                        "INSERT INTO stage_def (name, color, sort_order, hint_minutes) VALUES (?1, ?2, ?3, ?4)",
                        params![name, color, i as i64, hint],
                    )
                    .map_err(db_err)?;
            }
        }
        if version < 2 && target >= 2 {
            self.conn
                .execute_batch(
                    "BEGIN;
                    CREATE TABLE tag_group (
                        id INTEGER PRIMARY KEY,
                        name TEXT NOT NULL,
                        exclusive INTEGER NOT NULL DEFAULT 0,
                        sort_order INTEGER NOT NULL
                    );
                    CREATE TABLE tag_def (
                        id INTEGER PRIMARY KEY,
                        group_id INTEGER NOT NULL REFERENCES tag_group(id),
                        name TEXT NOT NULL,
                        initial_factor REAL NOT NULL DEFAULT 1.0,
                        system TEXT,
                        hidden INTEGER NOT NULL DEFAULT 0,
                        sort_order INTEGER NOT NULL
                    );
                    CREATE TABLE page_tag (
                        page_id INTEGER NOT NULL REFERENCES page(id) ON DELETE CASCADE,
                        tag_id INTEGER NOT NULL REFERENCES tag_def(id),
                        PRIMARY KEY (page_id, tag_id)
                    );
                    CREATE TABLE setting (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                    CREATE TABLE day_off (date TEXT PRIMARY KEY);
                    ALTER TABLE work ADD COLUMN deadline TEXT;
                    ALTER TABLE work ADD COLUMN work_order TEXT NOT NULL DEFAULT 'stage';
                    ALTER TABLE work ADD COLUMN weekday_hours TEXT;
                    PRAGMA user_version = 2;
                    COMMIT;",
                )
                .map_err(db_err)?;
            self.seed_tags()?;
            self.seed_schedule()?;
        }
        if version < 3 && target >= 3 {
            self.migrate_v3()?;
        }
        if version < 4 && target >= 4 {
            self.migrate_v4()?;
        }
        Ok(())
    }

    /// 版 4：ファイルを持たない作品と工程セットの自作（仕様書 5.16）。
    /// 作品に工程セットを持たせ、タグの出し分けを「作品の種類」から「工程セット」に変える
    fn migrate_v4(&self) -> Result<()> {
        // 既存の作品のセットは、使っている工程のセットから決める（工程が無ければ種類の既定のセット）。
        // ADD COLUMN では既定値のある列に REFERENCES を付けられないので、外部キーは付けない
        self.conn
            .execute_batch(
                "BEGIN;
                ALTER TABLE work ADD COLUMN set_id INTEGER NOT NULL DEFAULT 1;
                UPDATE work SET set_id = COALESCE(
                    (SELECT sd.set_id FROM work_stage ws JOIN stage_def sd ON sd.id = ws.stage_id
                        WHERE ws.work_id = work.id ORDER BY ws.sort_order, sd.id LIMIT 1),
                    CASE kind WHEN 'files' THEN 2 ELSE 1 END);
                CREATE TABLE tag_group_set (
                    group_id INTEGER NOT NULL REFERENCES tag_group(id) ON DELETE CASCADE,
                    set_id INTEGER NOT NULL REFERENCES stage_set(id) ON DELETE CASCADE,
                    PRIMARY KEY (group_id, set_id)
                );
                INSERT INTO tag_group_set (group_id, set_id) SELECT id, 1 FROM tag_group WHERE applies = 'comic';
                INSERT INTO tag_group_set (group_id, set_id) SELECT id, 2 FROM tag_group WHERE applies = 'files';
                ALTER TABLE tag_group DROP COLUMN applies;
                PRAGMA user_version = 4;
                COMMIT;",
            )
            .map_err(db_err)?;
        let broken: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| r.get(0))
            .map_err(db_err)?;
        if broken > 0 {
            return Err(tr(M::MigrationBroken).into());
        }
        Ok(())
    }

    /// 版 3：イラスト作品（.clip / .psd を束ねる）と工程のセット、タグの出し分け
    fn migrate_v3(&self) -> Result<()> {
        // work の cmc_path を NULL にできるよう作り直す。作り直しの間は外部キーを止める
        // （止めないと DROP TABLE work でページや記録まで消える）。SQLite の公式の手順に沿う
        self.conn
            .execute_batch(
                "PRAGMA foreign_keys = OFF;
                BEGIN;
                CREATE TABLE stage_set (
                    id INTEGER PRIMARY KEY,
                    name TEXT NOT NULL,
                    unit TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    sort_order INTEGER NOT NULL
                );
                INSERT INTO stage_set (id, name, unit, kind, sort_order) VALUES
                    (1, '漫画', 'ページ', 'comic', 0),
                    (2, 'イラスト', '枚', 'files', 1);
                ALTER TABLE stage_def ADD COLUMN set_id INTEGER NOT NULL DEFAULT 1;
                CREATE TABLE work_new (
                    id INTEGER PRIMARY KEY,
                    title TEXT NOT NULL,
                    kind TEXT NOT NULL DEFAULT 'comic',
                    cmc_path TEXT UNIQUE,
                    created_at INTEGER NOT NULL,
                    last_synced_at INTEGER,
                    deadline TEXT,
                    work_order TEXT NOT NULL DEFAULT 'stage',
                    weekday_hours TEXT
                );
                INSERT INTO work_new (id, title, kind, cmc_path, created_at, last_synced_at, deadline, work_order, weekday_hours)
                    SELECT id, title, 'comic', cmc_path, created_at, last_synced_at, deadline, work_order, weekday_hours FROM work;
                DROP TABLE work;
                ALTER TABLE work_new RENAME TO work;
                ALTER TABLE page ADD COLUMN title TEXT;
                ALTER TABLE tag_group ADD COLUMN applies TEXT NOT NULL DEFAULT 'both';
                UPDATE tag_group SET applies = 'comic'
                    WHERE id IN (SELECT group_id FROM tag_def WHERE system IS NOT NULL)
                       OR id IN (SELECT group_id FROM tag_def WHERE name IN ('コマ少', 'コマ普通', 'コマ多'));
                PRAGMA user_version = 3;
                COMMIT;
                PRAGMA foreign_keys = ON;",
            )
            .map_err(db_err)?;
        let broken: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| r.get(0))
            .map_err(db_err)?;
        if broken > 0 {
            return Err(tr(M::MigrationBroken).into());
        }
        let base: i64 = self
            .conn
            .query_row("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM stage_def", [], |r| r.get(0))
            .map_err(db_err)?;
        for (i, (name, color, hint)) in ILLUST_STAGES.iter().enumerate() {
            self.conn
                .execute(
                    "INSERT INTO stage_def (name, color, sort_order, hint_minutes, set_id) VALUES (?1, ?2, ?3, ?4, 2)",
                    params![name, color, base + i as i64, hint],
                )
                .map_err(db_err)?;
        }
        self.seed_illust_tags()?;
        Ok(())
    }

    // ----- 工程 -----

    pub fn list_stages(&self) -> Result<Vec<StageDef>> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, set_id, name, color, sort_order, hint_minutes, hidden FROM stage_def ORDER BY set_id, sort_order, id",
            )
            .map_err(db_err)?;
        stmt.query_map([], |r| {
            Ok(StageDef {
                id: r.get(0)?,
                set_id: r.get(1)?,
                name: r.get(2)?,
                color: r.get(3)?,
                sort_order: r.get(4)?,
                hint_minutes: r.get(5)?,
                hidden: r.get(6)?,
            })
        })
        .and_then(|rows| rows.collect())
        .map_err(db_err)
    }

    pub fn list_stage_sets(&self) -> Result<Vec<StageSet>> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, name, unit, kind FROM stage_set ORDER BY sort_order, id")
            .map_err(db_err)?;
        stmt.query_map([], |r| Ok(StageSet { id: r.get(0)?, name: r.get(1)?, unit: r.get(2)?, kind: r.get(3)? }))
            .and_then(|rows| rows.collect())
            .map_err(db_err)
    }

    /// 作品の種類の既定の工程セット
    #[cfg(test)]
    pub fn default_set(&self, kind: &str) -> Result<i64> {
        self.conn
            .query_row(
                "SELECT id FROM stage_set WHERE kind = ?1 ORDER BY sort_order, id LIMIT 1",
                [kind],
                |r| r.get(0),
            )
            .optional()
            .map_err(db_err)?
            .ok_or_else(|| "工程のセットが見つかりませんでした".into())
    }

    fn stage_set(&self, id: i64) -> Result<StageSet> {
        self.list_stage_sets()?
            .into_iter()
            .find(|s| s.id == id)
            .ok_or_else(|| tr(M::SetNotFound).into())
    }

    /// 利用者が工程のセットを作る（ファイルを持たない作品用）。工程は空なので、あとから足してもらう
    pub fn add_stage_set(&self, name: &str, unit: &str) -> Result<StageSet> {
        let name = valid_name(name)?;
        let unit = valid_unit(unit)?;
        self.conn
            .execute(
                "INSERT INTO stage_set (name, unit, kind, sort_order)
                 VALUES (?1, ?2, ?3, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM stage_set))",
                params![name, unit, KIND_MANUAL],
            )
            .map_err(db_err)?;
        self.stage_set(self.conn.last_insert_rowid())
    }

    /// セットの名前と単位の言葉を変える（組み込みの漫画・イラストは変えられない）
    pub fn update_stage_set(&self, id: i64, name: &str, unit: &str) -> Result<StageSet> {
        let name = valid_name(name)?;
        let unit = valid_unit(unit)?;
        self.ensure_manual_set(id)?;
        self.conn
            .execute("UPDATE stage_set SET name = ?2, unit = ?3 WHERE id = ?1", params![id, name, unit])
            .map_err(db_err)?;
        self.stage_set(id)
    }

    /// セットを工程ごと消す。使っている作品があれば消せない（記録が工程を参照しているため）。
    /// タグの出し分けでこのセットだけを選んでいたグループは「すべてのセット」に戻る
    pub fn remove_stage_set(&self, id: i64) -> Result<()> {
        self.ensure_manual_set(id)?;
        let used: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM work WHERE set_id = ?1", [id], |r| r.get(0))
            .map_err(db_err)?;
        if used > 0 {
            return Err(tr(M::SetInUse).into());
        }
        let tx = self.conn.unchecked_transaction().map_err(db_err)?;
        tx.execute("DELETE FROM stage_def WHERE set_id = ?1", [id]).map_err(db_err)?;
        tx.execute("DELETE FROM stage_set WHERE id = ?1", [id]).map_err(db_err)?;
        tx.commit().map_err(db_err)?;
        Ok(())
    }

    fn ensure_manual_set(&self, id: i64) -> Result<()> {
        if self.stage_set(id)?.kind == KIND_MANUAL { Ok(()) } else { Err(tr(M::BuiltinSet).into()) }
    }

    /// 同じセットの工程の ID（並び順）
    fn set_stage_ids(&self, set_id: i64) -> Result<Vec<i64>> {
        Ok(self.list_stages()?.into_iter().filter(|s| s.set_id == set_id).map(|s| s.id).collect())
    }

    fn stage_set_of(&self, stage_id: i64) -> Result<i64> {
        self.conn
            .query_row("SELECT set_id FROM stage_def WHERE id = ?1", [stage_id], |r| r.get(0))
            .optional()
            .map_err(db_err)?
            .ok_or_else(|| tr(M::StageNotFound).into())
    }

    /// 漫画のセットに工程を追加する
    #[cfg(test)]
    pub fn add_stage(&self, name: &str, color: &str) -> Result<StageDef> {
        self.add_stage_in_set(self.default_set(KIND_COMIC)?, name, color)
    }

    /// 工程を追加する。これから登録する作品だけが使い、登録済みの作品には加えない
    /// （制作途中の作品に、未着手の工程が急に増えないようにするため）
    pub fn add_stage_in_set(&self, set_id: i64, name: &str, color: &str) -> Result<StageDef> {
        let name = valid_name(name)?;
        self.stage_set(set_id)?;
        let next: i64 = self
            .conn
            .query_row("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM stage_def", [], |r| r.get(0))
            .map_err(db_err)?;
        self.conn
            .execute(
                "INSERT INTO stage_def (name, color, sort_order, set_id) VALUES (?1, ?2, ?3, ?4)",
                params![name, color, next, set_id],
            )
            .map_err(db_err)?;
        self.stage(self.conn.last_insert_rowid())
    }

    pub fn update_stage(&self, id: i64, name: &str, color: &str, hint_minutes: i64) -> Result<StageDef> {
        let name = valid_name(name)?;
        if hint_minutes < 1 {
            return Err(tr(M::HintTooShort).into());
        }
        self.conn
            .execute(
                "UPDATE stage_def SET name = ?2, color = ?3, hint_minutes = ?4 WHERE id = ?1",
                params![id, name, color, hint_minutes],
            )
            .map_err(db_err)?;
        self.stage(id)
    }

    pub fn set_stage_hidden(&self, id: i64, hidden: bool) -> Result<()> {
        if hidden {
            let visible: i64 = self
                .conn
                .query_row(
                    "SELECT COUNT(*) FROM stage_def WHERE hidden = 0 AND id != ?1
                     AND set_id = (SELECT set_id FROM stage_def WHERE id = ?1)",
                    [id],
                    |r| r.get(0),
                )
                .map_err(db_err)?;
            if visible == 0 {
                return Err(tr(M::KeepOneStage).into());
            }
        }
        self.conn
            .execute("UPDATE stage_def SET hidden = ?2 WHERE id = ?1", params![id, hidden])
            .map_err(db_err)?;
        Ok(())
    }

    /// 工程を同じセットの中で 1 つ上（delta = -1）または下（delta = 1）へ動かす。全作品の並び順にも反映する
    pub fn move_stage(&self, id: i64, delta: i64) -> Result<()> {
        let mut ids = self.set_stage_ids(self.stage_set_of(id)?)?;
        let Some(pos) = ids.iter().position(|&x| x == id) else {
            return Err(tr(M::StageNotFound).into());
        };
        let to = pos as i64 + delta;
        if to < 0 || to >= ids.len() as i64 {
            return Ok(());
        }
        ids.swap(pos, to as usize);
        self.set_stage_order(&ids)
    }

    /// 同じセットの工程をこの順番に並べる（ドラッグでの並べ替え用）。全作品の並び順にも反映する
    pub fn set_stage_order(&self, ids: &[i64]) -> Result<()> {
        let Some(&first) = ids.first() else {
            return Err(tr(M::StageOrderInvalid).into());
        };
        let mut all = self.set_stage_ids(self.stage_set_of(first)?)?;
        let mut sorted = ids.to_vec();
        sorted.sort();
        all.sort();
        if sorted != all {
            return Err(tr(M::StageOrderInvalid).into());
        }
        let tx = self.conn.unchecked_transaction().map_err(db_err)?;
        for (i, id) in ids.iter().enumerate() {
            tx.execute("UPDATE stage_def SET sort_order = ?2 WHERE id = ?1", params![id, i as i64])
                .map_err(db_err)?;
            tx.execute("UPDATE work_stage SET sort_order = ?2 WHERE stage_id = ?1", params![id, i as i64])
                .map_err(db_err)?;
        }
        tx.commit().map_err(db_err)?;
        Ok(())
    }

    fn stage(&self, id: i64) -> Result<StageDef> {
        self.list_stages()?
            .into_iter()
            .find(|s| s.id == id)
            .ok_or_else(|| tr(M::StageNotFound).into())
    }

    // ----- 作品 -----

    /// 漫画の作品を、漫画の既定の工程セットで登録する
    #[cfg(test)]
    pub fn add_work(&self, cmc_path: &str, comic: &Comic, now: i64) -> Result<i64> {
        self.add_work_in_set(cmc_path, comic, self.default_set(KIND_COMIC)?, now)
    }

    pub fn add_work_in_set(&self, cmc_path: &str, comic: &Comic, set_id: i64, now: i64) -> Result<i64> {
        let exists: bool = self
            .conn
            .query_row("SELECT COUNT(*) > 0 FROM work WHERE cmc_path = ?1", [cmc_path], |r| r.get(0))
            .map_err(db_err)?;
        if exists {
            return Err(tr(M::CmcAlreadyAdded).into());
        }
        self.conn
            .execute(
                "INSERT INTO work (title, kind, set_id, cmc_path, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![comic.title, KIND_COMIC, set_id, cmc_path, now],
            )
            .map_err(db_err)?;
        let work_id = self.conn.last_insert_rowid();
        self.copy_stages(work_id, set_id)?;
        self.sync_pages(work_id, comic, now)?;
        Ok(work_id)
    }

    /// 作品で使う工程は、登録時点でそのセットの表示している工程
    fn copy_stages(&self, work_id: i64, set_id: i64) -> Result<()> {
        self.stage_set(set_id)?;
        let n = self
            .conn
            .execute(
                "INSERT INTO work_stage (work_id, stage_id, sort_order)
                 SELECT ?1, id, sort_order FROM stage_def WHERE hidden = 0 AND set_id = ?2",
                params![work_id, set_id],
            )
            .map_err(db_err)?;
        if n == 0 {
            return Err(tr(M::SetHasNoVisibleStage).into());
        }
        Ok(())
    }

    fn work_kind(&self, work_id: i64) -> Result<String> {
        Ok(self.work_info(work_id)?.kind)
    }

    /// 別の場所の cmc が、この作品と同じものかを照らし合わせる（ページのファイル名で比べる）
    pub fn check_relink(&self, work_id: i64, comic: &Comic) -> Result<RelinkCheck> {
        let old: Vec<String> = self.page_files(work_id)?.into_iter().map(|(_, f)| f).collect();
        let matched = comic.pages.iter().filter(|p| old.contains(&p.file_name)).count();
        Ok(RelinkCheck {
            title: comic.title.clone(),
            new_pages: comic.pages.len() as i64,
            old_pages: old.len() as i64,
            matched: matched as i64,
        })
    }

    /// 作品の cmc の場所を変えて読み直す。記録はページのファイル名で引き継がれる
    pub fn relink_work(&self, work_id: i64, cmc_path: &str, comic: &Comic, now: i64) -> Result<SyncResult> {
        if self.work_kind(work_id)? != KIND_COMIC {
            return Err(tr(M::IllustNeedsFiles).into());
        }
        let other: Option<String> = self
            .conn
            .query_row("SELECT title FROM work WHERE cmc_path = ?1 AND id != ?2", params![cmc_path, work_id], |r| r.get(0))
            .optional()
            .map_err(db_err)?;
        if let Some(title) = other {
            return Err(trf(M::CmcRegisteredAs, &[("title", &title)]));
        }
        self.conn
            .execute("UPDATE work SET cmc_path = ?2 WHERE id = ?1", params![work_id, cmc_path])
            .map_err(db_err)?;
        let result = self.sync_pages(work_id, comic, now)?;
        self.remove_empty_missing_pages(work_id)?;
        Ok(result)
    }

    pub fn remove_work(&self, work_id: i64) -> Result<()> {
        self.conn.execute("DELETE FROM work WHERE id = ?1", [work_id]).map_err(db_err)?;
        Ok(())
    }

    /// 作品名を変える（漫画は登録時に cmc から取った名前だが、読み直しでは上書きしないので、変えた名前が残る）
    pub fn rename_work(&self, work_id: i64, title: &str) -> Result<()> {
        let title = valid_name(title)?;
        let n = self
            .conn
            .execute("UPDATE work SET title = ?2 WHERE id = ?1", params![work_id, title])
            .map_err(db_err)?;
        if n == 0 { Err(tr(M::WorkNotFound).into()) } else { Ok(()) }
    }

    pub fn work_info(&self, work_id: i64) -> Result<WorkInfo> {
        self.conn
            .query_row(
                "SELECT w.id, w.title, w.kind, w.set_id, w.cmc_path, w.last_synced_at, COALESCE(s.unit, '')
                 FROM work w LEFT JOIN stage_set s ON s.id = w.set_id WHERE w.id = ?1",
                [work_id],
                |r| {
                    Ok(WorkInfo {
                        id: r.get(0)?,
                        title: r.get(1)?,
                        kind: r.get(2)?,
                        set_id: r.get(3)?,
                        cmc_path: r.get(4)?,
                        last_synced_at: r.get(5)?,
                        unit: r.get(6)?,
                    })
                },
            )
            .optional()
            .map_err(db_err)?
            .ok_or_else(|| tr(M::WorkNotFound).into())
    }

    pub fn list_works(&self) -> Result<Vec<WorkSummary>> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT w.id, w.title, w.cmc_path, w.kind,
                    (SELECT COALESCE(SUM(span), 0) FROM page WHERE work_id = w.id AND missing = 0),
                    (SELECT COUNT(*) FROM work_stage ws JOIN stage_def s ON s.id = ws.stage_id
                        WHERE ws.work_id = w.id AND s.hidden = 0),
                    (SELECT COALESCE(SUM(p.span), 0) FROM task_done t
                        JOIN page p ON p.id = t.page_id
                        JOIN work_stage ws ON ws.work_id = p.work_id AND ws.stage_id = t.stage_id
                        JOIN stage_def s ON s.id = t.stage_id
                        WHERE p.work_id = w.id AND p.missing = 0 AND s.hidden = 0),
                    (SELECT COALESCE(SUM(COALESCE(ss.ended_at, ?1) - ss.started_at), 0)
                        FROM work_session ss JOIN page p ON p.id = ss.page_id WHERE p.work_id = w.id),
                    (SELECT MAX(COALESCE(ss.ended_at, ss.started_at))
                        FROM work_session ss JOIN page p ON p.id = ss.page_id WHERE p.work_id = w.id),
                    w.set_id, COALESCE(s.unit, ''),
                    (SELECT file_name FROM page WHERE work_id = w.id AND missing = 0 ORDER BY order_index, id LIMIT 1)
                 FROM work w LEFT JOIN stage_set s ON s.id = w.set_id ORDER BY w.created_at DESC",
            )
            .map_err(db_err)?;
        let now = now_ms();
        stmt.query_map([now], |r| {
            let pages: i64 = r.get(4)?;
            let stages: i64 = r.get(5)?;
            let done: i64 = r.get(6)?;
            let total = pages * stages;
            let cmc_path: Option<String> = r.get(2)?;
            let kind: String = r.get(3)?;
            let first: Option<String> = r.get(11)?;
            let thumb_path = if kind == KIND_MANUAL {
                None
            } else {
                first.map(|f| page_path(cmc_path.as_deref(), &f).display().to_string())
            };
            Ok(WorkSummary {
                id: r.get(0)?,
                title: r.get(1)?,
                cmc_path,
                kind,
                set_id: r.get(9)?,
                unit: r.get(10)?,
                thumb_path,
                page_count: pages,
                stage_count: stages,
                progress: if total > 0 { done as f64 / total as f64 } else { 0.0 },
                total_ms: r.get(7)?,
                last_worked_at: r.get(8)?,
                file_missing: false,
            })
        })
        .and_then(|rows| rows.collect())
        .map_err(db_err)
    }

    /// cmc の内容をページ一覧に反映する。ページはファイル名で突き合わせる。
    /// cmc から消えたページは記録を残したまま `missing` にする
    pub fn sync_pages(&self, work_id: i64, comic: &Comic, now: i64) -> Result<SyncResult> {
        let old = self.page_states(work_id)?;
        let tx = self.conn.unchecked_transaction().map_err(db_err)?;
        let before: i64 = tx
            .query_row("SELECT COUNT(*) FROM page WHERE work_id = ?1", [work_id], |r| r.get(0))
            .map_err(db_err)?;
        tx.execute("UPDATE page SET missing = 1 WHERE work_id = ?1", [work_id])
            .map_err(db_err)?;
        for (i, p) in comic.pages.iter().enumerate() {
            tx.execute(
                "INSERT INTO page (work_id, file_name, order_index, number, span, memo, missing)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0)
                 ON CONFLICT (work_id, file_name) DO UPDATE SET
                    order_index = excluded.order_index, number = excluded.number,
                    span = excluded.span, memo = excluded.memo, missing = 0",
                params![work_id, p.file_name, i as i64, p.number, p.span, p.memo],
            )
            .map_err(db_err)?;
        }
        let after: i64 = tx
            .query_row("SELECT COUNT(*) FROM page WHERE work_id = ?1", [work_id], |r| r.get(0))
            .map_err(db_err)?;
        let missing: i64 = tx
            .query_row("SELECT COUNT(*) FROM page WHERE work_id = ?1 AND missing = 1", [work_id], |r| r.get(0))
            .map_err(db_err)?;
        tx.execute("UPDATE work SET last_synced_at = ?2 WHERE id = ?1", params![work_id, now])
            .map_err(db_err)?;
        tx.commit().map_err(db_err)?;
        let new = self.page_states(work_id)?;
        let (merges, splits) = self.detect_spread_changes(&old, &new, now)?;
        Ok(SyncResult { added: after - before, missing, merges, splits })
    }

    /// 消えたページのうち、作業記録も完了も無いものを削除する
    pub fn remove_empty_missing_pages(&self, work_id: i64) -> Result<()> {
        self.conn
            .execute(
                "DELETE FROM page WHERE work_id = ?1 AND missing = 1
                 AND NOT EXISTS (SELECT 1 FROM work_session WHERE page_id = page.id)
                 AND NOT EXISTS (SELECT 1 FROM task_done WHERE page_id = page.id)",
                [work_id],
            )
            .map_err(db_err)?;
        Ok(())
    }

    pub fn board(&self, work_id: i64, now: i64) -> Result<Board> {
        let work = self.work_info(work_id)?;
        let stages = self.work_stages(work_id)?;

        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, file_name, number, span, missing, title FROM page
                 WHERE work_id = ?1 ORDER BY missing, order_index, id",
            )
            .map_err(db_err)?;
        let cmc = work.cmc_path.clone();
        let mut pages: Vec<BoardPage> = stmt
            .query_map([work_id], |r| {
                let file_name: String = r.get(1)?;
                let number: i64 = r.get(2)?;
                let span: i64 = r.get(3)?;
                Ok(BoardPage {
                    id: r.get(0)?,
                    path: page_path(cmc.as_deref(), &file_name).display().to_string(),
                    file_name,
                    label: row_label(r.get(5)?, number, span),
                    number,
                    span,
                    missing: r.get(4)?,
                    found: true,
                    tags: Vec::new(),
                    cells: Vec::new(),
                })
            })
            .and_then(|rows| rows.collect())
            .map_err(db_err)?;

        let mut totals = self
            .conn
            .prepare(
                "SELECT ss.page_id, ss.stage_id, SUM(COALESCE(ss.ended_at, ?2) - ss.started_at)
                 FROM work_session ss JOIN page p ON p.id = ss.page_id
                 WHERE p.work_id = ?1 GROUP BY ss.page_id, ss.stage_id",
            )
            .map_err(db_err)?;
        let totals: Vec<(i64, i64, i64)> = totals
            .query_map(params![work_id, now], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .and_then(|rows| rows.collect())
            .map_err(db_err)?;
        let mut dones = self
            .conn
            .prepare("SELECT t.page_id, t.stage_id FROM task_done t JOIN page p ON p.id = t.page_id WHERE p.work_id = ?1")
            .map_err(db_err)?;
        let dones: Vec<(i64, i64)> = dones
            .query_map([work_id], |r| Ok((r.get(0)?, r.get(1)?)))
            .and_then(|rows| rows.collect())
            .map_err(db_err)?;

        let page_tags = self.page_tags(work_id)?;
        for page in &mut pages {
            page.tags = page_tags.iter().filter(|(p, _)| *p == page.id).map(|(_, t)| *t).collect();
            page.cells = stages
                .iter()
                .map(|s| Cell {
                    stage_id: s.id,
                    done: dones.contains(&(page.id, s.id)),
                    total_ms: totals
                        .iter()
                        .find(|(p, st, _)| *p == page.id && *st == s.id)
                        .map(|t| t.2)
                        .unwrap_or(0),
                })
                .collect();
        }
        Ok(Board { work, stages, pages })
    }

    /// 作品で使う工程（隠した工程は除く）を並び順で返す
    fn work_stages(&self, work_id: i64) -> Result<Vec<StageRef>> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT s.id, s.name, s.color FROM work_stage ws JOIN stage_def s ON s.id = ws.stage_id
                 WHERE ws.work_id = ?1 AND s.hidden = 0 ORDER BY ws.sort_order, s.id",
            )
            .map_err(db_err)?;
        stmt.query_map([work_id], |r| Ok(StageRef { id: r.get(0)?, name: r.get(1)?, color: r.get(2)? }))
            .and_then(|rows| rows.collect())
            .map_err(db_err)
    }

    pub fn set_task_done(&self, page_id: i64, stage_id: i64, done: bool, now: i64) -> Result<()> {
        if done {
            self.conn
                .execute(
                    "INSERT OR IGNORE INTO task_done (page_id, stage_id, done_at) VALUES (?1, ?2, ?3)",
                    params![page_id, stage_id, now],
                )
                .map_err(db_err)?;
        } else {
            self.conn
                .execute("DELETE FROM task_done WHERE page_id = ?1 AND stage_id = ?2", params![page_id, stage_id])
                .map_err(db_err)?;
        }
        Ok(())
    }

    // ----- タイマー -----

    /// 計測を始める。別のタスクを計測中なら、そちらはこの時点で止める
    pub fn start_timer(&self, page_id: i64, stage_id: i64, now: i64) -> Result<ActiveSession> {
        self.check_task(page_id, stage_id)?;
        self.close_open_sessions(now)?;
        self.conn
            .execute(
                "INSERT INTO work_session (page_id, stage_id, started_at) VALUES (?1, ?2, ?3)",
                params![page_id, stage_id, now],
            )
            .map_err(db_err)?;
        self.active_session()?
            .ok_or_else(|| tr(M::TrackingStartFailed).into())
    }

    /// 計測を止める。計測していなければ None
    pub fn stop_timer(&self, now: i64) -> Result<Option<StopResult>> {
        let Some(active) = self.active_session()? else {
            return Ok(None);
        };
        self.close_open_sessions(now)?;
        let total_ms: i64 = self
            .conn
            .query_row(
                "SELECT COALESCE(SUM(ended_at - started_at), 0) FROM work_session
                 WHERE page_id = ?1 AND stage_id = ?2 AND ended_at IS NOT NULL",
                params![active.page_id, active.stage_id],
                |r| r.get(0),
            )
            .map_err(db_err)?;
        let already_done: bool = self
            .conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM task_done WHERE page_id = ?1 AND stage_id = ?2",
                params![active.page_id, active.stage_id],
                |r| r.get(0),
            )
            .map_err(db_err)?;
        Ok(Some(StopResult {
            session_id: active.id,
            page_id: active.page_id,
            page_label: active.page_label,
            stage_id: active.stage_id,
            stage_name: active.stage_name,
            duration_ms: (now - active.started_at).max(0),
            total_ms,
            already_done,
        }))
    }

    pub fn active_session(&self) -> Result<Option<ActiveSession>> {
        self.conn
            .query_row(
                "SELECT ss.id, w.id, w.title, p.id, p.number, p.span, s.id, s.name, s.color, ss.started_at, p.title
                 FROM work_session ss
                 JOIN page p ON p.id = ss.page_id
                 JOIN work w ON w.id = p.work_id
                 JOIN stage_def s ON s.id = ss.stage_id
                 WHERE ss.ended_at IS NULL ORDER BY ss.started_at DESC LIMIT 1",
                [],
                |r| {
                    Ok(ActiveSession {
                        id: r.get(0)?,
                        work_id: r.get(1)?,
                        work_title: r.get(2)?,
                        page_id: r.get(3)?,
                        page_label: row_label(r.get(10)?, r.get(4)?, r.get(5)?),
                        stage_id: r.get(6)?,
                        stage_name: r.get(7)?,
                        stage_color: r.get(8)?,
                        started_at: r.get(9)?,
                    })
                },
            )
            .optional()
            .map_err(db_err)
    }

    fn close_open_sessions(&self, now: i64) -> Result<()> {
        // 開始時刻より前には止めない（時計がずれた場合の保険）
        self.conn
            .execute(
                "UPDATE work_session SET ended_at = MAX(?1, started_at) WHERE ended_at IS NULL",
                [now],
            )
            .map_err(db_err)?;
        Ok(())
    }

    /// ページと工程が同じ作品のものか確かめる
    fn check_task(&self, page_id: i64, stage_id: i64) -> Result<()> {
        let ok: bool = self
            .conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM page p JOIN work_stage ws ON ws.work_id = p.work_id
                 WHERE p.id = ?1 AND ws.stage_id = ?2",
                params![page_id, stage_id],
                |r| r.get(0),
            )
            .map_err(db_err)?;
        if ok { Ok(()) } else { Err(tr(M::PageOrStageNotFound).into()) }
    }

    // ----- 作業記録 -----

    /// 作品の作業記録を新しい順に返す（`from` 以降に始まったもの）
    pub fn list_sessions(&self, work_id: i64, from: i64) -> Result<Vec<SessionRow>> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT ss.id, p.id, p.number, p.span, s.id, s.name, s.color, ss.started_at, ss.ended_at, ss.edited, p.title
                 FROM work_session ss
                 JOIN page p ON p.id = ss.page_id
                 JOIN stage_def s ON s.id = ss.stage_id
                 WHERE p.work_id = ?1 AND ss.started_at >= ?2
                 ORDER BY ss.started_at DESC",
            )
            .map_err(db_err)?;
        stmt.query_map(params![work_id, from], |r| {
            Ok(SessionRow {
                id: r.get(0)?,
                page_id: r.get(1)?,
                page_label: row_label(r.get(10)?, r.get(2)?, r.get(3)?),
                stage_id: r.get(4)?,
                stage_name: r.get(5)?,
                stage_color: r.get(6)?,
                started_at: r.get(7)?,
                ended_at: r.get(8)?,
                edited: r.get(9)?,
            })
        })
        .and_then(|rows| rows.collect())
        .map_err(db_err)
    }

    /// 全作品の作業記録（ヒートマップ用）
    pub fn spans(&self, from: i64) -> Result<Vec<Span>> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT p.work_id, ss.started_at, ss.ended_at, s.name FROM work_session ss
                 JOIN stage_def s ON s.id = ss.stage_id
                 JOIN page p ON p.id = ss.page_id
                 WHERE COALESCE(ss.ended_at, ss.started_at) >= ?1 ORDER BY ss.started_at",
            )
            .map_err(db_err)?;
        stmt.query_map([from], |r| {
            Ok(Span { work_id: r.get(0)?, started_at: r.get(1)?, ended_at: r.get(2)?, stage_name: r.get(3)? })
        })
            .and_then(|rows| rows.collect())
            .map_err(db_err)
    }

    /// 作業記録を手で追加する
    pub fn add_session(&self, page_id: i64, stage_id: i64, started_at: i64, ended_at: i64, now: i64) -> Result<()> {
        self.check_task(page_id, stage_id)?;
        check_range(started_at, Some(ended_at), now)?;
        self.conn
            .execute(
                "INSERT INTO work_session (page_id, stage_id, started_at, ended_at, edited) VALUES (?1, ?2, ?3, ?4, 1)",
                params![page_id, stage_id, started_at, ended_at],
            )
            .map_err(db_err)?;
        Ok(())
    }

    /// 作業記録を手で直す。計測中の記録は終了時刻を None のまま渡す
    pub fn update_session(
        &self,
        id: i64,
        page_id: i64,
        stage_id: i64,
        started_at: i64,
        ended_at: Option<i64>,
        now: i64,
    ) -> Result<()> {
        self.check_task(page_id, stage_id)?;
        let running: bool = self
            .conn
            .query_row("SELECT ended_at IS NULL FROM work_session WHERE id = ?1", [id], |r| r.get(0))
            .optional()
            .map_err(db_err)?
            .ok_or_else(|| tr(M::SessionNotFound).to_string())?;
        if running != ended_at.is_none() {
            return Err(tr(M::RunningSessionEnd).into());
        }
        check_range(started_at, ended_at, now)?;
        self.conn
            .execute(
                "UPDATE work_session SET page_id = ?2, stage_id = ?3, started_at = ?4, ended_at = ?5, edited = 1
                 WHERE id = ?1",
                params![id, page_id, stage_id, started_at, ended_at],
            )
            .map_err(db_err)?;
        Ok(())
    }

    /// 止め忘れの確認で、止めた記録の終了時刻を動かす（手修正の印は付けない）
    pub fn set_session_end(&self, id: i64, ended_at: i64, now: i64) -> Result<()> {
        let started: i64 = self
            .conn
            .query_row("SELECT started_at FROM work_session WHERE id = ?1 AND ended_at IS NOT NULL", [id], |r| r.get(0))
            .optional()
            .map_err(db_err)?
            .ok_or_else(|| tr(M::SessionNotFound).to_string())?;
        let end = ended_at.clamp(started, now);
        self.conn
            .execute("UPDATE work_session SET ended_at = ?2 WHERE id = ?1", params![id, end])
            .map_err(db_err)?;
        Ok(())
    }

    /// データベースをまるごと 1 つのファイルに書き出す（使用中でも一貫した内容になる）
    pub fn backup_to(&self, dest: &Path) -> Result<()> {
        if dest.exists() {
            std::fs::remove_file(dest).map_err(|e| trf(M::ReplaceFileFailed, &[("e", &e)]))?;
        }
        self.conn
            .execute("VACUUM INTO ?1", [dest.to_string_lossy()])
            .map_err(|e| trf(M::BackupFailed, &[("e", &e)]))?;
        Ok(())
    }

    pub fn delete_session(&self, id: i64) -> Result<()> {
        self.conn.execute("DELETE FROM work_session WHERE id = ?1", [id]).map_err(db_err)?;
        Ok(())
    }
}

fn valid_name(name: &str) -> Result<&str> {
    let name = name.trim();
    if name.is_empty() { Err(tr(M::NameRequired).into()) } else { Ok(name) }
}

fn valid_unit(unit: &str) -> Result<&str> {
    let unit = unit.trim();
    if unit.is_empty() { Err(tr(M::UnitRequired).into()) } else { Ok(unit) }
}

fn check_range(started_at: i64, ended_at: Option<i64>, now: i64) -> Result<()> {
    if started_at > now {
        return Err(tr(M::StartInFuture).into());
    }
    if let Some(end) = ended_at {
        if end <= started_at {
            return Err(tr(M::EndBeforeStart).into());
        }
        if end > now {
            return Err(tr(M::EndInFuture).into());
        }
    }
    Ok(())
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cmc::Page;

    pub(crate) const MIN: i64 = 60_000;

    pub(crate) fn comic(pages: &[(&str, u32)]) -> Comic {
        let mut number = 1;
        Comic {
            title: "テスト作品".into(),
            pages: pages
                .iter()
                .map(|(f, span)| {
                    let p = Page { file_name: f.to_string(), number, span: *span, memo: String::new() };
                    number += span;
                    p
                })
                .collect(),
        }
    }

    pub(crate) fn setup() -> (Store, i64) {
        let store = Store::open_in_memory().unwrap();
        let id = store
            .add_work("C:/a.cmc", &comic(&[("page0001.clip", 1), ("page0002.clip", 2), ("page0004.clip", 1)]), 0)
            .unwrap();
        (store, id)
    }

    /// 漫画のセットの工程の ID（テストの作品は漫画なので）
    pub(crate) fn stage_ids(store: &Store) -> Vec<i64> {
        store.set_stage_ids(store.default_set(KIND_COMIC).unwrap()).unwrap()
    }

    #[test]
    fn 初期状態の工程は漫画とイラストのセット() {
        let store = Store::open_in_memory().unwrap();
        let names = |set: i64| -> Vec<String> {
            store.list_stages().unwrap().into_iter().filter(|s| s.set_id == set).map(|s| s.name).collect()
        };
        assert_eq!(names(store.default_set(KIND_COMIC).unwrap()), ["下書き", "ペン入れ", "トーン"]);
        assert_eq!(names(store.default_set(KIND_FILES).unwrap()), ["ラフ", "線画", "塗り", "仕上げ"]);
    }

    #[test]
    fn 作品を登録するとページと工程のボードができる() {
        let (store, id) = setup();
        let board = store.board(id, 0).unwrap();
        assert_eq!(board.work.title, "テスト作品");
        assert_eq!(board.stages.len(), 3);
        let labels: Vec<&str> = board.pages.iter().map(|p| p.label.as_str()).collect();
        assert_eq!(labels, ["p1", "p2-3", "p4"]);
        assert!(board.pages.iter().all(|p| p.cells.len() == 3));
    }

    #[test]
    fn 同じcmcは二重に登録できない() {
        let (store, _) = setup();
        let err = store.add_work("C:/a.cmc", &comic(&[]), 0).unwrap_err();
        assert!(err.contains("すでに登録"));
    }

    #[test]
    fn 同期で並び替え_追加_消えたページを反映する() {
        let (store, id) = setup();
        let result = store
            .sync_pages(id, &comic(&[("page0004.clip", 1), ("page0001.clip", 1), ("page0005.clip", 1)]), 10)
            .unwrap();
        assert_eq!((result.added, result.missing), (1, 1));
        let board = store.board(id, 0).unwrap();
        let files: Vec<(&str, bool)> = board.pages.iter().map(|p| (p.file_name.as_str(), p.missing)).collect();
        assert_eq!(
            files,
            [("page0004.clip", false), ("page0001.clip", false), ("page0005.clip", false), ("page0002.clip", true)]
        );
        assert_eq!(board.work.last_synced_at, Some(10));

        // 記録の無い消えたページは掃除できる
        store.remove_empty_missing_pages(id).unwrap();
        assert_eq!(store.board(id, 0).unwrap().pages.len(), 3);
    }

    #[test]
    fn 記録のある消えたページは残す() {
        let (store, id) = setup();
        let page = store.board(id, 0).unwrap().pages[1].id;
        store.start_timer(page, stage_ids(&store)[0], 0).unwrap();
        store.stop_timer(MIN).unwrap();
        store.sync_pages(id, &comic(&[("page0001.clip", 1)]), 0).unwrap();
        store.remove_empty_missing_pages(id).unwrap();
        let board = store.board(id, 0).unwrap();
        assert_eq!(board.pages.len(), 2);
        assert!(board.pages[1].missing);
    }

    #[test]
    fn タイマーは同時に1つだけ動き_止めると合計を返す() {
        let (store, id) = setup();
        let pages = store.board(id, 0).unwrap().pages;
        let st = stage_ids(&store);

        store.start_timer(pages[0].id, st[0], 0).unwrap();
        // 別のタスクを始めると、前のタスクは自動で止まる
        let active = store.start_timer(pages[1].id, st[0], 10 * MIN).unwrap();
        assert_eq!(active.page_label, "p2-3");
        assert_eq!(active.stage_name, "下書き");

        let stopped = store.stop_timer(40 * MIN).unwrap().unwrap();
        assert_eq!(stopped.duration_ms, 30 * MIN);
        assert_eq!(stopped.total_ms, 30 * MIN);
        assert!(store.active_session().unwrap().is_none());
        assert!(store.stop_timer(50 * MIN).unwrap().is_none());

        // 2 回目の計測は合計に足される
        store.start_timer(pages[1].id, st[0], 60 * MIN).unwrap();
        let stopped = store.stop_timer(70 * MIN).unwrap().unwrap();
        assert_eq!(stopped.total_ms, 40 * MIN);

        let board = store.board(id, 0).unwrap();
        assert_eq!(board.pages[0].cells[0].total_ms, 10 * MIN);
        assert_eq!(board.pages[1].cells[0].total_ms, 40 * MIN);
    }

    #[test]
    fn 計測中の時間もボードに含める() {
        let (store, id) = setup();
        let page = store.board(id, 0).unwrap().pages[0].id;
        store.start_timer(page, stage_ids(&store)[1], 0).unwrap();
        assert_eq!(store.board(id, 5 * MIN).unwrap().pages[0].cells[1].total_ms, 5 * MIN);
    }

    #[test]
    fn 完了の付け外しと進捗() {
        let (store, id) = setup();
        let pages = store.board(id, 0).unwrap().pages;
        let st = stage_ids(&store);
        // 見開き（2ページ分）の下書きを完了 → 4ページ × 3工程 = 12 のうち 2
        store.set_task_done(pages[1].id, st[0], true, 0).unwrap();
        store.set_task_done(pages[1].id, st[0], true, 0).unwrap();
        let works = store.list_works().unwrap();
        assert_eq!(works[0].page_count, 4);
        assert!((works[0].progress - 2.0 / 12.0).abs() < 1e-9);
        assert!(store.board(id, 0).unwrap().pages[1].cells[0].done);

        store.set_task_done(pages[1].id, st[0], false, 0).unwrap();
        assert_eq!(store.list_works().unwrap()[0].progress, 0.0);
    }

    #[test]
    fn 追加した工程はこれから登録する作品だけが使う() {
        let (store, old) = setup();
        let added = store.add_stage(" ネーム ", "#9a7fb8").unwrap();
        assert_eq!(added.name, "ネーム");
        // 先頭まで動かす
        store.move_stage(added.id, -1).unwrap();
        store.move_stage(added.id, -1).unwrap();
        store.move_stage(added.id, -1).unwrap();
        store.move_stage(added.id, -1).unwrap(); // 先頭より上には行かない
        let names = |work| -> Vec<String> { store.board(work, 0).unwrap().stages.into_iter().map(|s| s.name).collect() };

        // 登録済みの作品には加わらない
        assert_eq!(names(old), ["下書き", "ペン入れ", "トーン"]);
        // これから登録する作品は使う
        let new = store.add_work("C:/b.cmc", &comic(&[("page0001.clip", 1)]), 0).unwrap();
        assert_eq!(names(new), ["ネーム", "下書き", "ペン入れ", "トーン"]);

        // 並べ替えと隠すは登録済みの作品にも反映する
        let st = stage_ids(&store);
        store.move_stage(st[3], -1).unwrap(); // トーンをペン入れの前へ
        assert_eq!(names(old), ["下書き", "トーン", "ペン入れ"]);
        store.set_stage_hidden(added.id, true).unwrap();
        assert_eq!(names(new).len(), 3);
        assert!(store.list_works().unwrap().iter().all(|w| w.stage_count == 3));

        store.update_stage(added.id, "ネーム（ラフ）", "#000000", 30).unwrap();
        let s = store.list_stages().unwrap().into_iter().find(|s| s.id == added.id).unwrap();
        assert_eq!((s.name.as_str(), s.hint_minutes, s.hidden), ("ネーム（ラフ）", 30, true));
    }

    #[test]
    fn 工程をまとめて並べ替える() {
        let (store, id) = setup();
        let st = stage_ids(&store);
        store.set_stage_order(&[st[2], st[0], st[1]]).unwrap();
        let names: Vec<String> = store.board(id, 0).unwrap().stages.into_iter().map(|s| s.name).collect();
        assert_eq!(names, ["トーン", "下書き", "ペン入れ"]);
        assert!(store.set_stage_order(&[st[0], st[1]]).is_err());
    }

    #[test]
    fn 止めた記録の終了時刻を動かす() {
        let (store, id) = setup();
        let page = store.board(id, 0).unwrap().pages[0].id;
        store.start_timer(page, stage_ids(&store)[0], 0).unwrap();
        // 10 分から操作がなく、30 分に気づいて止めた
        let stopped = store.stop_timer(10 * MIN).unwrap().unwrap();
        // 「作業していた」なら気づいた時刻まで伸ばす
        store.set_session_end(stopped.session_id, 30 * MIN, 30 * MIN).unwrap();
        let row = &store.list_sessions(id, 0).unwrap()[0];
        assert_eq!((row.ended_at, row.edited), (Some(30 * MIN), false));
        // 開始より前や未来にはしない
        store.set_session_end(stopped.session_id, -5, 30 * MIN).unwrap();
        assert_eq!(store.list_sessions(id, 0).unwrap()[0].ended_at, Some(0));
    }

    #[test]
    fn バックアップから同じ内容を開ける() {
        let (store, id) = setup();
        let page = store.board(id, 0).unwrap().pages[0].id;
        store.add_session(page, stage_ids(&store)[0], 0, 10 * MIN, MIN * 100).unwrap();
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("backup.db");
        store.backup_to(&dest).unwrap();
        // 同じ名前でもう一度作っても置き換わる
        store.backup_to(&dest).unwrap();
        let copy = Store::open(&dest).unwrap();
        assert_eq!(copy.list_works().unwrap()[0].total_ms, 10 * MIN);
    }

    #[test]
    fn 場所を変えても記録を引き継ぐ() {
        let (store, id) = setup();
        let st = stage_ids(&store);
        let page = store.board(id, 0).unwrap().pages[0].id;
        store.add_session(page, st[0], 0, 10 * MIN, 100 * MIN).unwrap();
        store.set_task_done(page, st[0], true, 0).unwrap();

        // 移動先では 1 ページ増えている
        let moved = comic(&[("page0001.clip", 1), ("page0002.clip", 2), ("page0004.clip", 1), ("page0005.clip", 1)]);
        let check = store.check_relink(id, &moved).unwrap();
        assert_eq!((check.old_pages, check.new_pages, check.matched), (3, 4, 3));

        let r = store.relink_work(id, "E:/漫画/a.cmc", &moved, 0).unwrap();
        assert_eq!(r.added, 1);
        let board = store.board(id, 0).unwrap();
        assert_eq!(board.work.cmc_path.as_deref(), Some("E:/漫画/a.cmc"));
        assert_eq!(board.pages.len(), 4);
        assert_eq!((board.pages[0].cells[0].total_ms, board.pages[0].cells[0].done), (10 * MIN, true));
    }

    #[test]
    fn 別の作品と照らし合わせるとほとんど一致しない() {
        let (store, id) = setup();
        let other = comic(&[("page0101.clip", 1), ("page0102.clip", 1)]);
        let check = store.check_relink(id, &other).unwrap();
        assert_eq!(check.matched, 0);
    }

    #[test]
    fn 別の作品として登録済みのcmcにはつなぎ直せない() {
        let (store, id) = setup();
        store.add_work("C:/b.cmc", &comic(&[("x.clip", 1)]), 0).unwrap();
        let err = store.relink_work(id, "C:/b.cmc", &comic(&[("x.clip", 1)]), 0).unwrap_err();
        assert!(err.contains("として登録されています"));
        // 自分と同じ場所なら（読み直しと同じなので）通る
        assert!(store.relink_work(id, "C:/a.cmc", &comic(&[("page0001.clip", 1)]), 0).is_ok());
    }

    #[test]
    fn 版3のデータを版4に移すと作品にセットが付きタグの対象が表に移る() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        let old = Store { conn };
        old.migrate(3).unwrap();
        // 漫画（工程あり）、イラスト（工程あり）、工程を全部外した漫画。タグのグループは comic / files / both
        old.conn
            .execute_batch(
                "INSERT INTO work (id, title, kind, cmc_path, created_at) VALUES
                    (1, '漫画', 'comic', 'C:/a.cmc', 0), (2, '絵', 'files', NULL, 0), (3, '工程なし', 'comic', 'C:/b.cmc', 0);
                 INSERT INTO work_stage (work_id, stage_id, sort_order) VALUES (1, 1, 0), (2, 4, 0), (2, 5, 1);
                 INSERT INTO tag_group (name, exclusive, applies, sort_order) VALUES ('追加', 0, 'files', 99);",
            )
            .unwrap();
        old.migrate(LATEST).unwrap();
        let version: i64 = old.conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(version, 4);

        let sets: Vec<(i64, i64)> = old.list_works().unwrap().into_iter().map(|w| (w.id, w.set_id)).collect();
        assert_eq!(sets, [(1, 1), (2, 2), (3, 1)]);
        assert_eq!(old.board(2, 0).unwrap().work.set_id, 2);
        let groups: Vec<(String, Vec<i64>)> = old.list_tags().unwrap().into_iter().map(|g| (g.name, g.set_ids)).collect();
        assert_eq!(groups[0], ("コマ数".to_string(), vec![1]));
        assert_eq!(groups[1], ("特徴".to_string(), vec![]));
        assert_eq!(groups.last().unwrap(), &("追加".to_string(), vec![2]));
        // applies 列は消えている
        assert!(old.conn.prepare("SELECT applies FROM tag_group").is_err());
    }

    #[test]
    fn 工程セットの追加_変更_削除() {
        let (store, _) = setup();
        let set = store.add_stage_set(" ガレージキット ", "パーツ").unwrap();
        assert_eq!((set.name.as_str(), set.unit.as_str(), set.kind.as_str()), ("ガレージキット", "パーツ", KIND_MANUAL));
        assert!(store.add_stage_set("x", " ").unwrap_err().contains("単位"));
        assert!(store.add_stage_set("", "章").is_err());
        let names: Vec<String> = store.list_stage_sets().unwrap().into_iter().map(|s| s.name).collect();
        assert_eq!(names, ["漫画", "イラスト", "ガレージキット"]);

        let set = store.update_stage_set(set.id, "模型", "部品").unwrap();
        assert_eq!((set.name.as_str(), set.unit.as_str()), ("模型", "部品"));
        // 組み込みのセットは変えられず、消せない
        assert!(store.update_stage_set(1, "x", "y").unwrap_err().contains("漫画"));
        assert!(store.remove_stage_set(2).is_err());
        assert!(store.add_stage_in_set(999, "x", "#000000").is_err());

        // 使っている作品があると消せない。作品を消せば工程ごと消える
        store.add_stage_in_set(set.id, "原型", "#111111").unwrap();
        let work = store.add_manual_work("竜", &["頭".to_string()], set.id, 0).unwrap();
        assert!(store.remove_stage_set(set.id).unwrap_err().contains("使っている"));
        store.remove_work(work).unwrap();
        store.remove_stage_set(set.id).unwrap();
        assert!(store.list_stages().unwrap().iter().all(|s| s.set_id != set.id));
        assert!(store.remove_stage_set(set.id).is_err());
    }

    #[test]
    fn 版2のデータを版3に移しても記録は残る() {
        // 0.1.2 までの形（版 2）のデータベースを作って、データを入れる
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        let old = Store { conn };
        old.migrate(2).unwrap();
        old.conn
            .execute_batch(
                "INSERT INTO work (id, title, cmc_path, created_at, deadline) VALUES (7, '旧作品', 'C:/old.cmc', 0, '2026-12-01');
                 INSERT INTO work_stage (work_id, stage_id, sort_order) VALUES (7, 1, 0), (7, 2, 1), (7, 3, 2);
                 INSERT INTO page (id, work_id, file_name, order_index, number) VALUES (70, 7, 'page0001.clip', 0, 1);
                 INSERT INTO work_session (page_id, stage_id, started_at, ended_at) VALUES (70, 1, 0, 600000);
                 INSERT INTO task_done (page_id, stage_id, done_at) VALUES (70, 1, 0);
                 INSERT INTO page_tag (page_id, tag_id) VALUES (70, 1);",
            )
            .unwrap();

        old.migrate(LATEST).unwrap();
        let version: i64 = old.conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(version, LATEST);
        let fk: bool = old.conn.query_row("PRAGMA foreign_keys", [], |r| r.get(0)).unwrap();
        assert!(fk, "移行のあとは外部キーが有効に戻っている");

        let board = old.board(7, 0).unwrap();
        assert_eq!((board.work.kind.as_str(), board.work.cmc_path.as_deref()), (KIND_COMIC, Some("C:/old.cmc")));
        assert_eq!(board.work.set_id, 1);
        assert_eq!(board.pages[0].label, "p1");
        assert_eq!((board.pages[0].cells[0].total_ms, board.pages[0].cells[0].done), (600000, true));
        assert_eq!(board.pages[0].tags, [1]);
        assert_eq!(old.schedule(7).unwrap().deadline.as_deref(), Some("2026-12-01"));
        // 既存の工程は「漫画」セット、イラストのセットが増えている
        let sets: Vec<String> = old.list_stage_sets().unwrap().into_iter().map(|s| s.name).collect();
        assert_eq!(sets, ["漫画", "イラスト"]);
        assert!(old.list_stages().unwrap().iter().filter(|s| s.set_id == 1).count() == 3);
        // 作品を消すと、ページと記録も一緒に消える（外部キーの CASCADE が生きている）
        old.remove_work(7).unwrap();
        let left: i64 = old.conn.query_row("SELECT COUNT(*) FROM work_session", [], |r| r.get(0)).unwrap();
        assert_eq!(left, 0);
    }

    #[test]
    fn 工程はセットごとに並べ替え_隠す() {
        let store = Store::open_in_memory().unwrap();
        let comic = store.default_set(KIND_COMIC).unwrap();
        let illust = store.default_set(KIND_FILES).unwrap();
        let ids = store.set_stage_ids(illust).unwrap();
        store.move_stage(ids[3], -1).unwrap();
        let names: Vec<String> = store
            .list_stages()
            .unwrap()
            .into_iter()
            .filter(|s| s.set_id == illust)
            .map(|s| s.name)
            .collect();
        assert_eq!(names, ["ラフ", "線画", "仕上げ", "塗り"]);
        // 別のセットの工程を混ぜた並びは受け付けない
        let mixed = [store.set_stage_ids(comic).unwrap()[0], ids[0], ids[1], ids[2], ids[3]];
        assert!(store.set_stage_order(&mixed).is_err());
        // 隠すときの「1 つ以上表示」はセットごとに数える
        for id in &ids[..3] {
            store.set_stage_hidden(*id, true).unwrap();
        }
        assert!(store.set_stage_hidden(ids[3], true).is_err());
        let added = store.add_stage_in_set(illust, "下塗り", "#888888").unwrap();
        assert_eq!(added.set_id, illust);
    }

    #[test]
    fn すべての工程は隠せない() {
        let store = Store::open_in_memory().unwrap();
        let st = stage_ids(&store);
        store.set_stage_hidden(st[0], true).unwrap();
        store.set_stage_hidden(st[1], true).unwrap();
        assert!(store.set_stage_hidden(st[2], true).unwrap_err().contains("1 つ以上"));
        assert!(store.update_stage(st[0], "  ", "#000", 60).unwrap_err().contains("名前"));
    }

    #[test]
    fn 作業記録の追加_修正_削除() {
        let (store, id) = setup();
        let pages = store.board(id, 0).unwrap().pages;
        let st = stage_ids(&store);
        let now = 100 * MIN;

        store.add_session(pages[0].id, st[0], 0, 20 * MIN, now).unwrap();
        store.start_timer(pages[1].id, st[1], 90 * MIN).unwrap();
        let rows = store.list_sessions(id, 0).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].ended_at, None); // 新しい順
        assert!(rows[1].edited);

        // 止め忘れを直す
        store.update_session(rows[1].id, pages[2].id, st[2], 5 * MIN, Some(15 * MIN), now).unwrap();
        let fixed = &store.list_sessions(id, 0).unwrap()[1];
        assert_eq!((fixed.page_label.as_str(), fixed.stage_name.as_str()), ("p4", "トーン"));
        assert_eq!((fixed.started_at, fixed.ended_at), (5 * MIN, Some(15 * MIN)));

        // おかしな時刻は受け付けない
        let e = store.update_session(rows[1].id, pages[2].id, st[2], 15 * MIN, Some(5 * MIN), now).unwrap_err();
        assert!(e.contains("開始時刻より後"));
        let e = store.add_session(pages[0].id, st[0], 0, now + MIN, now).unwrap_err();
        assert!(e.contains("未来"));
        let e = store.update_session(rows[0].id, pages[1].id, st[1], 90 * MIN, Some(95 * MIN), now).unwrap_err();
        assert!(e.contains("計測中"));

        store.delete_session(rows[1].id).unwrap();
        assert_eq!(store.list_sessions(id, 0).unwrap().len(), 1);
        assert_eq!(store.spans(0).unwrap().len(), 1);
    }

    #[test]
    fn 作品を外すとページと記録も消える() {
        let (store, id) = setup();
        let page = store.board(id, 0).unwrap().pages[0].id;
        store.start_timer(page, stage_ids(&store)[0], 0).unwrap();
        store.remove_work(id).unwrap();
        assert!(store.list_works().unwrap().is_empty());
        assert!(store.active_session().unwrap().is_none());
        assert!(store.spans(0).unwrap().is_empty());
    }

    #[test]
    fn 作品名を変えられ_読み直しても戻らない() {
        let (store, id) = setup();
        store.rename_work(id, " 本番のタイトル ").unwrap();
        assert!(store.rename_work(id, " ").is_err());
        assert!(store.rename_work(999, "x").is_err());
        store.sync_pages(id, &comic(&[("page0001.clip", 1)]), 0).unwrap();
        assert_eq!(store.list_works().unwrap()[0].title, "本番のタイトル");
        assert_eq!(store.board(id, 0).unwrap().work.title, "本番のタイトル");
    }

    #[test]
    fn ファイルに保存して開き直せる() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sub/otosazu.db");
        {
            let store = Store::open(&path).unwrap();
            store.add_stage("ベタ", "#333333").unwrap();
        }
        let store = Store::open(&path).unwrap();
        assert_eq!(stage_ids(&store).len(), 4);
    }
}
