//! 進捗の公開（仕様書 5.22）の作品ごとの設定：公開のオン／オフ・鍵・隠す項目・最後の送信。
//!
//! 要約を作って送るのは画面側（src/publish.ts）。ここは鍵と設定を持つだけで、HTTP は扱わない。
//! 鍵は遠隔の画面（server.rs の ALLOWED）からは読めないようにする。

use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};

use crate::i18n::{M, tr};

use super::{Result, Store, db_err};

/// 隠せる項目（docs/snapshot-format.md）。これ以外の名前は断る
const HIDEABLE: &[&str] = &["title", "time", "finish", "cells"];

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PublishPrefs {
    pub work_id: i64,
    /// 公開している。オフにしたらサーバの行を消す（消せるまで pending_delete が立つ）
    pub enabled: bool,
    /// 公開 ID（URL の一部）。16 バイトの 16 進
    pub publish_id: String,
    /// 書き込み鍵。アプリだけが持つ
    pub write_key: String,
    /// 閲覧鍵。閲覧 URL のフラグメントに入れる。作り直すと古い URL は見えなくなる
    pub read_key: String,
    /// 隠す項目（"title" / "time" / "finish" / "cells"）
    pub hide: Vec<String>,
    /// 最後に送れた時刻（ms）。一度も送れていなければ None
    pub last_sent_at: Option<i64>,
    /// 最後の送信の失敗。送れたら None
    pub last_error: Option<String>,
    /// オフにしたがサーバの行をまだ消せていない（次の起動でやり直す）
    pub pending_delete: bool,
}

impl Store {
    /// 作品の公開の設定。行が無ければ鍵を作って（オフのまま）保存する
    pub fn publish_prefs(&self, work_id: i64) -> Result<PublishPrefs> {
        if let Some(p) = self.find_publish(work_id)? {
            return Ok(p);
        }
        let exists: bool = self
            .conn
            .query_row("SELECT COUNT(*) FROM work WHERE id = ?1", [work_id], |r| r.get::<_, i64>(0))
            .map_err(db_err)?
            > 0;
        if !exists {
            return Err(tr(M::WorkNotFound).into());
        }
        let (publish_id, write_key, read_key) = (self.new_token()?, self.new_token()?, self.new_token()?);
        self.conn
            .execute(
                "INSERT INTO publish (work_id, publish_id, write_key, read_key) VALUES (?1, ?2, ?3, ?4)",
                params![work_id, publish_id, write_key, read_key],
            )
            .map_err(db_err)?;
        self.find_publish(work_id)?.ok_or_else(|| tr(M::WorkNotFound).into())
    }

    /// 公開のオン／オフと隠す項目を保存する。
    /// オフにしたときは pending_delete を立て、画面側がサーバの行を消してから `mark_unpublished` で下ろす
    pub fn set_publish_prefs(&self, work_id: i64, enabled: bool, hide: &[String]) -> Result<PublishPrefs> {
        if hide.iter().any(|h| !HIDEABLE.contains(&h.as_str())) {
            return Err(tr(M::PublishHideInvalid).into());
        }
        let current = self.publish_prefs(work_id)?;
        let pending_delete = if enabled { false } else { current.enabled || current.pending_delete };
        self.conn
            .execute(
                "UPDATE publish SET enabled = ?2, hide = ?3, pending_delete = ?4, last_error = NULL WHERE work_id = ?1",
                params![work_id, enabled, serde_json::to_string(hide).unwrap_or_default(), pending_delete],
            )
            .map_err(db_err)?;
        self.publish_prefs(work_id)
    }

    /// 閲覧鍵を作り直す（閲覧 URL を知っている人に見せたくなくなったとき用）。次の送信で古い URL は見えなくなる
    pub fn new_publish_read_key(&self, work_id: i64) -> Result<PublishPrefs> {
        self.publish_prefs(work_id)?;
        let key = self.new_token()?;
        self.conn
            .execute("UPDATE publish SET read_key = ?2 WHERE work_id = ?1", params![work_id, key])
            .map_err(db_err)?;
        self.publish_prefs(work_id)
    }

    /// 送信の結果を記録する。`error` が None なら送れた
    pub fn mark_published(&self, work_id: i64, error: Option<&str>, now: i64) -> Result<()> {
        match error {
            None => self
                .conn
                .execute(
                    "UPDATE publish SET last_sent_at = ?2, last_error = NULL WHERE work_id = ?1",
                    params![work_id, now],
                )
                .map_err(db_err)?,
            Some(e) => self
                .conn
                .execute("UPDATE publish SET last_error = ?2 WHERE work_id = ?1", params![work_id, e])
                .map_err(db_err)?,
        };
        Ok(())
    }

    /// サーバの行を消せたので pending_delete を下ろす
    pub fn mark_unpublished(&self, work_id: i64) -> Result<()> {
        self.conn
            .execute("UPDATE publish SET pending_delete = 0 WHERE work_id = ?1", [work_id])
            .map_err(db_err)?;
        Ok(())
    }

    /// 送る必要のある作品：公開中のもの（送る）と、オフにしたが消せていないもの（消す）
    pub fn list_publishing(&self) -> Result<Vec<PublishPrefs>> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT work_id, enabled, publish_id, write_key, read_key, hide, last_sent_at, last_error, pending_delete
                 FROM publish WHERE enabled = 1 OR pending_delete = 1 ORDER BY work_id",
            )
            .map_err(db_err)?;
        let rows = stmt.query_map([], row_to_prefs).map_err(db_err)?;
        rows.collect::<rusqlite::Result<Vec<_>>>().map_err(db_err)
    }

    fn find_publish(&self, work_id: i64) -> Result<Option<PublishPrefs>> {
        self.conn
            .query_row(
                "SELECT work_id, enabled, publish_id, write_key, read_key, hide, last_sent_at, last_error, pending_delete
                 FROM publish WHERE work_id = ?1",
                [work_id],
                row_to_prefs,
            )
            .optional()
            .map_err(db_err)
    }
}

fn row_to_prefs(r: &rusqlite::Row) -> rusqlite::Result<PublishPrefs> {
    let hide: String = r.get(5)?;
    Ok(PublishPrefs {
        work_id: r.get(0)?,
        enabled: r.get(1)?,
        publish_id: r.get(2)?,
        write_key: r.get(3)?,
        read_key: r.get(4)?,
        hide: serde_json::from_str(&hide).unwrap_or_default(),
        last_sent_at: r.get(6)?,
        last_error: r.get(7)?,
        pending_delete: r.get(8)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn store_with_work() -> Store {
        let store = Store::open_in_memory().unwrap();
        store
            .conn
            .execute_batch(
                "INSERT INTO work (id, title, cmc_path, created_at, kind, set_id) VALUES (1, '作品', 'C:/a.cmc', 0, 'comic', 1);
                 INSERT INTO work (id, title, cmc_path, created_at, kind, set_id) VALUES (2, '別の作品', 'C:/b.cmc', 0, 'comic', 1);",
            )
            .unwrap();
        store
    }

    #[test]
    fn 初めて読むと鍵が作られオフのまま保存される() {
        let store = store_with_work();
        let p = store.publish_prefs(1).unwrap();
        assert!(!p.enabled && !p.pending_delete);
        assert_eq!((p.publish_id.len(), p.write_key.len(), p.read_key.len()), (32, 32, 32));
        assert!(p.publish_id != p.write_key && p.write_key != p.read_key);
        assert!(p.hide.is_empty() && p.last_sent_at.is_none());
        // もう一度読んでも同じ鍵
        assert_eq!(store.publish_prefs(1).unwrap(), p);
        // 無い作品は断る
        assert!(store.publish_prefs(99).is_err());
    }

    #[test]
    fn オンにして隠す項目を保存しオフにすると消し残しが立つ() {
        let store = store_with_work();
        let p = store.set_publish_prefs(1, true, &["title".into(), "cells".into()]).unwrap();
        assert!(p.enabled);
        assert_eq!(p.hide, ["title", "cells"]);
        assert_eq!(store.list_publishing().unwrap().len(), 1);

        let p = store.set_publish_prefs(1, false, &[]).unwrap();
        assert!(!p.enabled && p.pending_delete);
        // 消せていない間は一覧に残る
        assert_eq!(store.list_publishing().unwrap().len(), 1);
        store.mark_unpublished(1).unwrap();
        assert!(!store.publish_prefs(1).unwrap().pending_delete);
        assert!(store.list_publishing().unwrap().is_empty());

        // 一度もオンにしていない作品をオフのまま保存しても、消し残しにはならない
        let p = store.set_publish_prefs(2, false, &[]).unwrap();
        assert!(!p.pending_delete);
        // 知らない項目は断る
        assert!(store.set_publish_prefs(1, true, &["memo".into()]).is_err());
    }

    #[test]
    fn 閲覧鍵の作り直しは閲覧鍵だけ変える() {
        let store = store_with_work();
        let before = store.publish_prefs(1).unwrap();
        let after = store.new_publish_read_key(1).unwrap();
        assert_ne!(before.read_key, after.read_key);
        assert_eq!((before.publish_id, before.write_key), (after.publish_id, after.write_key));
    }

    #[test]
    fn 送信の結果を記録する() {
        let store = store_with_work();
        store.set_publish_prefs(1, true, &[]).unwrap();
        store.mark_published(1, Some("HTTP 500"), 100).unwrap();
        let p = store.publish_prefs(1).unwrap();
        assert_eq!((p.last_sent_at, p.last_error.as_deref()), (None, Some("HTTP 500")));
        store.mark_published(1, None, 200).unwrap();
        let p = store.publish_prefs(1).unwrap();
        assert_eq!((p.last_sent_at, p.last_error), (Some(200), None));
        // 設定を保存し直すと失敗の表示は消える
        store.mark_published(1, Some("x"), 300).unwrap();
        assert!(store.set_publish_prefs(1, true, &[]).unwrap().last_error.is_none());
    }

    #[test]
    fn 作品を消すと公開の設定も消える() {
        let store = store_with_work();
        store.set_publish_prefs(1, true, &[]).unwrap();
        store.conn.execute("DELETE FROM work WHERE id = 1", []).unwrap();
        assert!(store.list_publishing().unwrap().is_empty());
    }

    #[test]
    fn 版7のデータを版8に移しても作品は残り公開は作れる() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        let old = Store { conn };
        old.migrate(7).unwrap();
        old.conn
            .execute("INSERT INTO work (id, title, cmc_path, created_at, kind, set_id) VALUES (7, '旧作品', 'C:/old.cmc', 0, 'comic', 1)", [])
            .unwrap();
        old.migrate(super::super::LATEST).unwrap();
        let p = old.publish_prefs(7).unwrap();
        assert!(!p.enabled);
        assert_eq!(old.list_works().unwrap().len(), 1);
    }
}
