# otosazu-share（進捗の公開）

仕様書 [5.22](../SPEC.md) の預かり場所。作品ごとの要約 1 件を Cloudflare Workers + D1 に預かり、閲覧鍵を持つ人に配る。
作りは [Family Quest の同期中継](../../family-quest/server) と同じ（Hono + D1 + wrangler、vitest-pool-workers）。

## 口

| 口 | 鍵 | 役目 |
|---|---|---|
| `PUT /p/<公開 ID>` | `Authorization: Bearer <書き込み鍵>` | ボディ `{ readKey, snapshot }`。初回は登録（201）、以後は上書き（200）。閲覧鍵も毎回上書きするので、作り直しは新しい閲覧鍵を送るだけ |
| `DELETE /p/<公開 ID>` | 同上 | 消す。無い行でも 204（アプリのやり直しが安全に効くように） |
| `GET /p/<公開 ID>/snapshot` | `X-Otosazu-Read: <閲覧鍵>` | `{ updatedAt, snapshot }`。`Cache-Control: no-store` |
| `GET /p/<公開 ID>` | なし | 閲覧ページ（`public/p.html`）。鍵は URL のフラグメント `#k=` にあり、サーバには届かない |
| `GET /list` | なし | まとめページ（`public/list.html`）。`#p=<ID>:<閲覧鍵>,…` に一覧を持ち、サーバには何も置かない |

断り方：鍵が無い 401 ／ 鍵が違う 403 ／ ID の形が違う・JSON でない 400 ／ 64 KB 超 413 ／ 同じ ID へ 10 秒以内の再送 429。
上限は `src/limits.ts`。サーバは鍵の SHA-256 だけを持ち、要約の中身は見ない。

毎日 03:00 UTC の cron で、送信が 180 日止まった行を消す。

## 閲覧ページ

`public/` の静的ファイル。ビルドなしの素の HTML / CSS / JS で、`share.js` に言葉（5 言語）・取得・描画をまとめてある。
要約の形は [docs/snapshot-format.md](../docs/snapshot-format.md)。ダミーを入れて見るには `wrangler dev` を起動し、
`PUT` で要約を入れてから `http://127.0.0.1:8787/p/<ID>#k=<閲覧鍵>` を開く（リポジトリ直下の `.claude/launch.json` の `share` でも起動できる）。

## 開発

```bash
npm install
npm test               # 実 Worker + D1（分離ストレージ）で動くテスト
npm run migrate:local  # ローカル D1 にマイグレーションを当てる（初回と、migrations を足したとき）
npm run dev            # http://127.0.0.1:8787
```

手で通すとき（鍵と ID は 16 進 32 文字などの長さがあれば何でもよい）：

```bash
ID=0123456789abcdef0123456789abcdef; W=$(printf 'w%.0s' $(seq 32)); R=$(printf 'r%.0s' $(seq 32)); U=http://127.0.0.1:8787
curl -X PUT "$U/p/$ID" -H "Authorization: Bearer $W" -H "Content-Type: application/json" -d "{\"readKey\":\"$R\",\"snapshot\":{\"progress\":0.42}}"
curl "$U/p/$ID/snapshot" -H "X-Otosazu-Read: $R"
curl -X DELETE "$U/p/$ID" -H "Authorization: Bearer $W"
```

落とし穴：Worker の本体モジュール（`src/index.ts`）は handler 以外を `export` できない（定数を export すると
workerd が起動時に `Incorrect type for map entry` で断る）。テストから使う定数や関数は `src/limits.ts` に置く。

## 配備（初回）

1. Cloudflare のアカウントに `otosazu.com` のゾーンを置く（Family Quest と同じアカウント）
2. `npx wrangler login`
3. `npx wrangler d1 create otosazu-share` → 出てきた `database_id` を `wrangler.toml` に書く
4. `npm run migrate:remote`
5. `npm run deploy` → `share.otosazu.com` のカスタムドメインと DNS レコードが自動で作られる
6. `curl -X PUT https://share.otosazu.com/p/...` で上の手順を本番に対して通す

2 回目以降は `npm run deploy` だけ。マイグレーションを足したときは先に `npm run migrate:remote`。

## 困ったとき

- Cloudflare のダッシュボード → Workers & Pages → otosazu-share → Logs でリアルタイムのログ。`wrangler tail` でも見られる
- D1 の中身：`npx wrangler d1 execute DB --remote --command "SELECT id, updated_at FROM snapshots ORDER BY updated_at DESC LIMIT 20"`
- 行を手で消したいとき（利用者からの依頼）：同じく `DELETE FROM snapshots WHERE id = '...'`
