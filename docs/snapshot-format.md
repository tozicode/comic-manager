# 進捗の公開で送る要約（snapshot）の形

仕様書 5.22 でアプリが Worker（`server/`）に預け、閲覧ページ（`server/public/`）が読む JSON。
作るのは `src/publish.ts`、描くのは `server/public/share.js`。どちらを変えるときもここを先に直す。

Worker は中身を見ないので、形を変えても Worker の更新は要らない。古いアプリが古い形を送り続けることがあるため、
閲覧ページは `v` を見て、知らない版でも進み具合と最終更新だけは出す。

## v1

```jsonc
{
  "v": 1,
  "generatedAt": 1793593991204,        // 作った時刻（ms）。閲覧ページは Worker の updatedAt を「最終更新」に使い、こちらは参考
  "app": "2.6.0",                       // アプリの版
  "work": {
    "title": "冬の新刊",                 // 隠すときは null
    "kind": "comic",                    // comic / files / manual
    "unit": "ページ",                    // 行の単位の言葉。comic / files は閲覧ページが自分の言語で言い換える。manual はそのまま出す
    "rows": 24                          // 行（ページ・ファイル）の数。見開きは 1 行
  },
  "stages": [{ "name": "ネーム", "color": "#7fb3d5" }],   // 工程の名前と色（この作品で使う順）
  "cells": [[2, 2, 1, 0], [2, 1, 0, 0]],  // 行 × 工程。0 未着手 / 1 作業中（今日手を付けた・計測中） / 2 完了。隠すときは null
  "spans": [1, 2],                        // 行の幅（見開きは 2）。cells と同じ並び。cells が null のときは null
  "labels": ["p1", "p2-3"],               // 行の名前。cells と同じ並び。cells が null のときは null
  "progress": 0.48,                       // 全体の進み具合（0〜1）。作品一覧と同じ数え方（完了したタスクの数。見開きは 2 ページ分）
  "todayProgress": 0.04,                  // そのうち今日完了にしたぶん
  "completed": false,                     // 全部完了した
  "deadlines": [                          // 今日以降の締切（日付順）。無ければ []
    { "name": "", "date": "2026-11-10", "selected": true }   // name が空なら「締切」と出す。selected はいま見ている締切
  ],
  "finish": { "low": "2026-11-05", "mid": "2026-11-08", "high": "2026-11-14" },  // 完成見込み（少なめ・標準・多め）。隠すとき・見込みが無いときは null
  "time": { "todayMs": 12300000, "totalMs": 99000000 },  // 作業時間。隠すときは null
  "lastWorkedOn": "2026-11-01"            // 最後に作業した日（アプリの 1 日の区切りで）。一度も無ければ null
}
```

- 日付はすべて `YYYY-MM-DD`（作者の PC のローカル日付）。時刻は ms の UNIX 時間
- 送らないもの：原稿のサムネイル、メモ、タグ、作業記録の一覧、ファイルの場所
- 大きさの目安：100 行 × 8 工程で 5 KB 前後。Worker の上限は 64 KB

## 閲覧ページが導くもの

- 締切の状態（5.5 と同じ）：`finish.mid <= date` なら、`finish.high <= date` で「間に合う」、そうでなければ「厳しい」。
  `finish.mid > date` なら「遅れる」。`finish` が null なら出さない
- 古さ：Worker の `updatedAt` が 3 日より前なら「しばらく更新されていません」を目立たせる
- 工程ごとの完了数：`cells` の各列で 2 の行の `spans` を足す（cells が null なら出さない）
