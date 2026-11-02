# 実装計画：進捗の公開（仕様書 5.22、2.6.0）

主催・編集者が別の場所から進み具合を見られるようにする。仕様は [SPEC.md](SPEC.md) の 5.22 が正本で、
ここには「どの順で、何を作り、何で確かめるか」だけを書く。終わった工程は見出しに（済）を付ける。

## 0. 先に決めること（コードを書く前）

| 決めごと | 案 | 状態 |
|---|---|---|
| ドメイン | `otosazu.com` か `otosazu.app` を取り、`share.<ドメイン>` を Worker に向ける。Cloudflare にゾーンを置く（Family Quest と同じ） | 未 |
| 保存期間 | 送信が 180 日止まった行は消す | 仕様に書いた |
| 見せる粒度 | マスまで見せる。隠したい人はマスを隠せる | 仕様に書いた |
| 公開停止時 | サーバの行を消す | 仕様に書いた |
| 有料化 | 2.6.0 では無料。費用が無料枠を超える見込みが立ったら考える | 保留 |

ドメインが決まるまでは `workers.dev` で開発し、**アプリのリリース前に必ず差し替える**（基底 URL は 1 定数）。

## 1. Worker（`server/`）

Family Quest の `../family-quest/server` を雛形にする（Hono + D1 + wrangler、vitest-pool-workers）。
FCM まわりは持ち込まない。

**ファイル**
- `server/wrangler.toml`：name `otosazu-share`、D1 binding `DB`、`[assets]` で `public/` を配る、カスタムドメイン、cron（日次の掃除）
- `server/migrations/0001_init.sql`
  ```sql
  CREATE TABLE snapshots (
    id          TEXT PRIMARY KEY,   -- 公開 ID
    write_hash  TEXT NOT NULL,      -- 書き込み鍵の SHA-256
    read_hash   TEXT NOT NULL,      -- 閲覧鍵の SHA-256（送信のたびに更新。作り直しはこれだけ）
    body        TEXT NOT NULL,      -- 要約の JSON そのまま
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );
  ```
- `server/src/index.ts`
  - `PUT /p/:id`：`Authorization: Bearer <書き込み鍵>`、ボディ `{ readKey, snapshot }`。
    未登録なら登録（TOFU）、登録済みなら書き込み鍵の一致を確かめて上書き。
    64 KB 超は 413、前回から 10 秒未満は 429、鍵違いは 403
  - `DELETE /p/:id`：書き込み鍵で消す。無くても 204（やり直しが安全に効くように）
  - `GET /p/:id/snapshot`：`X-Otosazu-Read: <閲覧鍵>` ヘッダで返す。`Cache-Control: no-store`。無ければ 404、鍵違いは 403
    （閲覧鍵は URL のフラグメントにあるので、ページの JS がヘッダに載せる。鍵がクエリに出ない）
  - `GET /p/:id` と `GET /list`：`public/` の静的ページ（assets が返す。Worker は触らない）
  - `scheduled`：`updated_at` が 180 日より前の行を消す
- `server/test/*.spec.ts`：登録・上書き・鍵違い・サイズ・間隔・削除・掃除

**確かめ方**
- `npm test` が通る
- `wrangler dev` に curl で PUT → GET → DELETE が通る（手順を `server/README.md` に書く）

## 2. 閲覧ページ（`server/public/`）

ビルドなしの静的 HTML + 素の JS（React は持ち込まない。配るものを小さく保つ）。

- `public/p/index.html`：作品 1 つのページ。URL の `#k=` から閲覧鍵を取り、`/p/<id>/snapshot` を読んで描く。
  描くもの：作品名・進み具合・締切と見込みの関係・工程ごとの数・マス（5.20 の並べ方）・最後に作業した日・最終更新。
  最終更新が 3 日より前なら目立たせる。404 なら「公開が終わっています」
  - assets の経路：`/p/<id>` を `public/p/index.html` に当てるため、`[assets]` の `not_found_handling = "single-page-application"` か、
    Worker 側で `/p/:id` を `index.html` に書き換える。どちらが素直か最初に試す
- `public/list/index.html`：まとめページ。`#p=<id>:<鍵>,…` を読み、各作品の JSON を並べて締切の近い順に表。
  閲覧 URL の貼り付け欄で足す・外す（URL のフラグメントを書き換える）。作者名の欄は localStorage
- `public/i18n.js`：見出しの訳（ja / en / ko / zh。アプリの `src/i18n/share.ts` の言葉を揃える）。`navigator.language` で選ぶ
- 色：`prefers-color-scheme` でライト／ダーク。マスの色は JSON の工程の色をそのまま使う

**確かめ方**
- `wrangler dev` にダミーの要約を PUT して、PC・スマホ幅・ダークで表示を見る（Browser pane）
- 鍵違い・404・3 日より古い、の 3 つの表示

## 3. アプリ：鍵と設定（Rust）

- `store/mod.rs`：版 8。`publish` 表を足す
  ```sql
  CREATE TABLE publish (
    work_id     INTEGER PRIMARY KEY REFERENCES work(id) ON DELETE CASCADE,
    enabled     INTEGER NOT NULL DEFAULT 0,
    publish_id  TEXT NOT NULL,
    write_key   TEXT NOT NULL,
    read_key    TEXT NOT NULL,
    hide        TEXT NOT NULL DEFAULT '[]',   -- 隠す項目 ["title","time","finish","cells"]
    last_sent_at INTEGER,                     -- 最後に送れた時刻
    last_error  TEXT,                         -- 最後の失敗（送れたら NULL）
    pending_delete INTEGER NOT NULL DEFAULT 0 -- オフにしたがサーバを消せていない
  );
  ```
- `store/publish.rs`：`publish_prefs(work_id)`（無ければ鍵を作って行を作る）、`set_publish_prefs`、`new_read_key`、
  `mark_sent(work_id, ok, error)`、`list_publishing()`（有効な作品と、消し残しの行）
- `lib.rs`：上をコマンドとして出す。**`server.rs` の `ALLOWED` には入れない**（遠隔の画面から鍵を読めないように）
- 既存のテストの流儀に合わせて、版 7 → 8 の移行と、鍵の生成のテスト

**確かめ方**：`cargo test`

## 4. アプリ：要約を作って送る（TypeScript）

- `src/publish.ts`
  - `snapshot(board, sessions, forecast, prefs, deadlines): Snapshot`：`shareData()` と `Forecast` から 5.22 の JSON を組む。
    隠す項目は `null` にする。純粋関数にして `publish.test.ts` で確かめる
  - `send(prefs, snapshot)`：`PUT`。`remove(prefs)`：`DELETE`。基底 URL は `PUBLISH_BASE` 定数 1 つ
  - `computeForecast()` を hook なしで呼べるか確かめ、足りなければ `forecast.ts` に取り出す（`useForecast` の中身を分けるだけで、振る舞いは変えない）
- `src/components/Publisher.tsx`：main の窓だけに置く（`isRemote` と `isMini` のとき何もしない）。
  起動 10 秒後に 1 回、`otosazu://changed` を受けるたび 30 秒のデバウンスで 1 回、有効な作品をぜんぶ送る。
  消し残し（`pending_delete`）もここで片付ける。失敗は `mark_sent` に記録するだけで、知らせは出さない
- `src/components/PublishDialog.tsx`：ボードの［進捗を共有］の隣に［公開］。
  オン／オフ、隠す項目のチェック、閲覧 URL（コピー・QR は `Qr.tsx` を再利用）、［URL を作り直す］、最後に送れた時刻と失敗の旨。
  オンにした直後と作り直した直後は、その場で 1 回送る
- `src/i18n/publish.ts`：4 言語。文言は `settings.ts` / `share.ts` の調子に合わせる
- `src/api.ts`：コマンドの型と呼び口

**確かめ方**
- `npm test`（`publish.test.ts`：隠す項目・見開き・消えたページ・締切なし・見込みなし）
- `tauri dev` を `OTOSAZU_DB` で起動し、`wrangler dev` に向けて実際に送る → 閲覧ページで見える → オフにすると 404

## 5. 説明書・配布

- `docs/guide/guide.html`：「8. スマホやタブレットから見る」の次に「9. 主催者や編集者に進み具合を見せる」。
  何を送って何を送らないか、URL を知っている人は誰でも見られること、作り直し方、止め方（オフにすると消える）
- `docs/booth.md`：2.6.0 の更新履歴
- `server/README.md`：配備の手順（D1 作成・migrate・deploy・ドメイン）、掃除の cron、障害時に見る場所
- 版を 2.6.0 に上げる（`package.json` / `Cargo.toml` / `tauri.conf.json` / 説明書）。`PUBLISH_BASE` が本番ドメインか確かめてからビルド

## 順番と区切り

1 → 2 → 3 → 4 → 5 の順。1 と 2 はアプリに触らないので先に配備まで済ませられる。
3 は DB の版を上げるので、4 と同じ版（2.6.0）で出す。コミットは工程ごとに分ける。

## やらないこと（2.6.0 では）

- 閲覧側からの操作（応援のひとこと、催促）
- 履歴（日ごとの推移）。預かるのは最新 1 件だけ
- 主催者のアカウント・ログイン
- 作者側の「主催者が見たか」の表示
