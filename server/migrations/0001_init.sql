-- 進捗の公開（仕様書 5.22）。作品ごとに最新の要約 1 件だけを預かる。履歴は持たない。
-- 鍵は SHA-256 だけを持つ。書き込み鍵は初回の PUT で登録（TOFU）、閲覧鍵は PUT のたびに上書き（作り直しはこれだけ）。
CREATE TABLE snapshots (
  id          TEXT PRIMARY KEY,   -- 公開 ID（アプリが作る 16 進）
  write_hash  TEXT NOT NULL,      -- 書き込み鍵の SHA-256
  read_hash   TEXT NOT NULL,      -- 閲覧鍵の SHA-256
  body        TEXT NOT NULL,      -- 要約の JSON そのまま
  created_at  INTEGER NOT NULL,   -- ms
  updated_at  INTEGER NOT NULL    -- ms。掃除と書き込み間隔の判定に使う
);

CREATE INDEX snapshots_updated_at ON snapshots (updated_at);
