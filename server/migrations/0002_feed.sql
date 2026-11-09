-- みんなの作業（仕様書 5.25）。ほかの利用者の作業の知らせを 3 日だけ預かる。
-- 送り手は作品ごとにアプリが作る乱数の ID。名前・作品名・自由な文字は持たない。時刻はサーバが付ける。
CREATE TABLE feed (
  seq     INTEGER PRIMARY KEY AUTOINCREMENT,  -- 取得の続きに使う番号
  sender  TEXT NOT NULL,     -- 送り手の ID（16 進 32 文字）
  e1      INTEGER NOT NULL,  -- 絵文字の番号（表示する側が絵にする）
  e2      INTEGER NOT NULL,
  kind    TEXT NOT NULL,     -- start ／ stage ／ page ／ work
  stage   TEXT,              -- 工程の鍵（stage のときだけ。知らない工程なら NULL）
  unit    TEXT,              -- page ／ sheet ／ item（page のときだけ）
  count   INTEGER,           -- 仕上げたページの数（page のときだけ）
  at      INTEGER NOT NULL   -- 受け取った時刻（ms）
);

CREATE INDEX feed_at ON feed (at);
CREATE INDEX feed_sender_at ON feed (sender, at);
