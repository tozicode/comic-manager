# 実装計画：共同作業の取り込み（仕様書 5.23、2.7.0）

CLIP STUDIO PAINT EX の共同作業機能で分担している作品について、作家側の Otosazu が共同作業データ（`Collabo/`）を読み、
アシスタントの担当と反映を盤面に映す。仕様は [SPEC.md](SPEC.md) の 5.23 が正本、ファイル形式は
[docs/clip-collabo-format.md](docs/clip-collabo-format.md)。ここには「どの順で、何を作り、何で確かめるか」だけを書く。
前の計画（進捗の公開、2.6.0）は [docs/plan-publish-2.6.0.md](docs/plan-publish-2.6.0.md) に移した。

## 0. 先に決めたこと

| 決めごと | 決定 |
|---|---|
| 正本 | 作家の Otosazu の記録。Collabo は読むだけで、cmc / clip / 共同作業データには書かない |
| 対象 | 共同作業機能だけ。チーム制作は対象外 |
| 工程の対応 | Collabo に工程は無いので、メンバーごとに「反映で完了にする工程」を作家が選ぶ。空なら履歴に出すだけ |
| 完了の付け方 | メンバーの反映の版ごとに 1 回だけ `task_done` に入れる（完了時刻 = 反映の日時）。前の工程が未完了でも付ける。作家が外せば外れたまま |
| 予測 | メンバー担当のマスは作家の残りから外す。メンバーの時間は扱わない |
| 読めないとき | 黙って何もしない。設定画面にだけ失敗の旨を出す |
| 出す版 | 2.7.0。データベースは版 9 |

**リスク**：形式が非公開。クリスタの更新で読めなくなりうるので、読み取りは 1 か所（`collab.rs`）にまとめ、失敗は必ず握りつぶす。
2.6.0（進捗の公開）の配備・リリースが先。これはその後に着手する。

## 1. 読み取り（Rust、`src-tauri/src/collab.rs`）

cmc.rs と同じ立ち位置の純粋な読み取り。DB には触らない。

- `find_collabo(cmc_path) -> Option<PathBuf>`：
  1. cmc と同じフォルダの `CollaborateLocal.tclo` があれば開き、`Common.CommonFolder` の `Collabo/` を返す
  2. 無ければ、cmc と同じフォルダに `Collabo/` があればそれ（共有側の cmc を登録している場合）
  3. どちらも無ければ `None`
- `read_collabo(dir) -> Result<Collabo, String>`
  ```rust
  pub struct Collabo {
      pub admin: Option<String>,            // CollaborateLocal.tclo の UserName（Administrator = 1 のとき）
      pub assignments: Vec<Assignment>,     // { file_name, user_name, comment, since_ms }
      pub commits: Vec<Commit>,             // { revision, user_name, comment, at_ms, files: Vec<(String, i64 /*Status*/)> }
  }
  ```
  - 担当：`Collabo/*/` を列挙。フォルダ名の `_` を最後の 1 つだけ `.` に戻してファイル名にする（`page0001_clip` → `page0001.clip`）。
    中の `*.tced` のファイル名（拡張子を除く 16 進）を UTF-16BE で復号してユーザー名に。中身は
    `u32 BE 版`・`u32 BE 文字数`・UTF-16BE の本文。更新時刻を `since_ms` に
  - 履歴：`CollaborateLog.tclg` を `OpenFlags::SQLITE_OPEN_READ_ONLY` で開き、`CommitInfo` と `File` を読む。
    日時は現地時刻の分解表記なので `chrono::Local` で組み立てる。`Path` の `.:` を剥がす
  - Dropbox の同期中はファイルが読めないことがある。**どの段階で失敗しても `Err` を返すだけ**（panic しない）
- テスト：`dummy-cmc/shared/test/Collabo` と `dummy-cmc/test/CollaborateLocal.tclo` を
  `src-tauri/tests/fixtures/collabo/` に複製して使う（.clip と .cmc は要らない。tclo の `CommonFolder` は絶対パスなので、
  テストでは `find_collabo` の 1 と 2 を別々に確かめる）。確かめること：担当 1 件（assistant、コメント「アシスタントへの指示」）、
  履歴 2 件（Revision 2 が assistant、Status 4 で page0001.clip）、`.tced` が無いフォルダは担当なし、壊れたファイルは `Err`

**確かめ方**：`cargo test collab`

## 2. 記録（Rust、`src-tauri/src/store/collab.rs`、版 9）

```sql
CREATE TABLE collab_member (
  work_id   INTEGER NOT NULL REFERENCES work(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  stage_ids TEXT NOT NULL DEFAULT '[]',   -- この人の反映で完了にする工程
  color     TEXT NOT NULL,
  PRIMARY KEY (work_id, name)
);
CREATE TABLE collab_commit (
  work_id      INTEGER NOT NULL REFERENCES work(id) ON DELETE CASCADE,
  revision     INTEGER NOT NULL,
  user_name    TEXT NOT NULL,
  comment      TEXT NOT NULL DEFAULT '',
  committed_at INTEGER NOT NULL,
  files        TEXT NOT NULL,              -- JSON ["page0001.clip", ...]
  applied_at   INTEGER,                    -- 完了を付けた時刻。付けなかったら NULL
  PRIMARY KEY (work_id, revision)
);
CREATE TABLE collab_state (
  work_id      INTEGER PRIMARY KEY REFERENCES work(id) ON DELETE CASCADE,
  folder       TEXT NOT NULL,
  last_read_at INTEGER,
  last_error   TEXT
);
```

- `apply_collabo(work_id, &Collabo, now) -> CollabSummary`
  1. `admin` と一致するユーザー名の反映は捨てる。残りのユーザー名を `collab_member` に `INSERT OR IGNORE`（色は既存の工程色の並びから順に）
  2. `collab_commit` に無い版を入れる。メンバーの `stage_ids` が空でなければ、`files` のうち作品のページ（`page.file_name` と一致、
     `missing = 0`）× `stage_ids` を `set_task_done(.., true, committed_at)` で完了にし、`applied_at = now`。
     `Status` が 3（削除）と 5（却下。管理者の操作）のファイルは飛ばす
  3. **適用は版ごとに 1 回**。後からメンバーの工程を変えても、過去の版はやり直さない（作家が外した完了を勝手に戻さない）
  4. `collab_state` を更新。失敗は `last_error` に入れて `Ok` を返す（呼び元に知らせは出させない）
- `collab_info(work_id) -> CollabInfo { folder, last_read_at, last_error, members, commits(新しい順 100 件) }`
- `set_collab_member(work_id, name, stage_ids, color)`
- `board()` の各ページに `assignees: Vec<{ name, color, comment }>` を足す（担当は Collabo を読んだ直後の値を `AppState` に
  持つだけで DB には入れない。遠隔の画面と公開の要約が同じ `Board` を使うので、ここに乗せれば工程 5 が楽）
- 版 9 の移行テスト、適用のテスト（同じ版を二度適用しない・admin を捨てる・工程が空なら完了を付けない・消えたページは飛ばす）

**確かめ方**：`cargo test`

## 3. 読むタイミングと画面（Rust コマンド + TypeScript）

- `lib.rs`：`read_collab(work_id) -> CollabSummary`（`find_collabo` → `read_collabo` → `apply_collabo`。Collabo が無ければ何もせず `None`）、
  `get_collab_info`、`set_collab_member`。`sync_work` の最後でも `read_collab` を呼ぶ（作品を開いたとき・起動時に乗る）。
  `server.rs` の `ALLOWED` には `get_collab_info` だけ入れてよい（鍵のような秘密は無い）
- `src/components/Watchers.tsx` の保存検知の隣に、ボードを開いている間 60 秒ごとの `read_collab`。
  完了が増えたら `app.bump()`（既存の変更通知）で盤面と公開（5.22 の Publisher）が追従する
- `src/screens/BoardScreen.tsx`：マスにメンバーの色の丸と頭文字（担当ページ × そのメンバーの工程）。`title` に指示コメント。
  ［共同作業］ボタンは `board.collab` が非 null のときだけ
- `src/components/CollabDialog.tsx`：読んでいる場所、最後に読めた時刻／失敗の旨、メンバーごとの工程チェックと色、履歴の表
  （日時・名前・ページ・コメント・「完了を付けた」印）
- `src/i18n/collab.ts`：5 言語。`src/api.ts` に型と呼び口

**確かめ方**
- `npm test`（既存）。画面は `OTOSAZU_DB` を分けた `tauri dev` に `dummy-cmc/test/test.cmc` を登録して手で確かめる：
  マスに「a」の丸が出る → メンバー assistant の工程に 1 つ付ける → 履歴の Revision 2 はすでに読んでいるので完了は付かない →
  アシスタント側（`dummy-cmc/test-assistant`）で 2 ページ目を反映 → 60 秒以内に 2 ページ目 × その工程が完了になる →
  手で外しても戻らない → 管理者で担当を解除すると丸が消える

## 4. 予測とスケジュールから外す

- `store/predict.rs`：メンバー担当のマス（担当ページ × そのメンバーの `stage_ids`）を `done` と同じ扱いで `open` から外す
  （`TaskPrediction` に `assigned: bool` を足し、画面では「待ち」と出す）。倍率の学習には使わない（時間が無いので元々入らない）
- `src/forecast.ts` / スケジュール画面：「待ち」のマスを今日のやることの案に出さない。残りの数の表示に「ほか N マスはメンバー待ち」
- `store/predict.rs` のテスト 1 本（担当のマスが残りに入らない）

**確かめ方**：`cargo test predict`、`npm test`（forecast）

## 5. 公開の要約と説明書

- `docs/snapshot-format.md`：版 2。`cells` の各マスに任意で `{ who: "a", color }` を足せる（頭文字と色だけ。名前は送らない）。
  `server/public/share.js` は `who` があれば丸を描く。無ければ版 1 と同じ
- `docs/guide/guide.html`：「10. アシスタントと分担しているとき」。共同作業データを準備するのは作家、Otosazu は読むだけ、
  メンバーの工程を 1 度決めること、形式が変わると読めなくなること
- `docs/booth.md`：2.7.0 の更新履歴。版を 2.7.0 に上げる

## 順番と区切り

1 → 2 → 3 → 4 → 5。1 は DB に触らないので先に単独で確かめられる。3 まででひととおり動く。4 と 5 は後から足せる。
コミットは工程ごと。2.6.0 の配備・リリースを済ませてから 1 に入る。

## やらないこと（2.7.0 では）

- アシスタント側からの申告（ブラウザの入力ページ、アシスタントの Otosazu）。共同作業機能を使っていない現場向けに別途
- メンバーごとの作業時間・ペース・予測
- 「上書きしない」のときの `Submit/` の中身の照合（提出の記録は履歴で足りる）
- チーム制作機能
