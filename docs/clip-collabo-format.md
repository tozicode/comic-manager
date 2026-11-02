# CLIP STUDIO PAINT EX「共同作業」データの形式（調べた範囲）

2026-11-02 に CLIP STUDIO PAINT 1.5 系で使い捨ての作品を使って確かめた、非公開形式の観察記録。
Otosazu が「誰がどのページを担当し、いつ反映したか」を作家側の PC から読めるかの判断材料にする。
公式の仕様ではないので、クリスタの更新で変わりうる。

## 置き場所

| 場所 | 中身 |
|---|---|
| 共同作業データ（共有フォルダ）`<場所>/<フォルダー名>/` | 作品の cmc と .clip の正本、`Collabo/`、`Submit/`（「上書きしない」がオンのとき） |
| `Collabo/CollaborateLog.tclg` | 反映履歴（SQLite） |
| `Collabo/Common.tccs` | 準備時の設定（SQLite） |
| `Collabo/<ページファイル名の . を _ にしたもの>/<担当者名を UTF-16BE の 16 進にしたもの>.tced` | ページごとの担当。1 担当者 1 ファイル |
| `Submit/<YYYYMMDDhhmmss>^<担当者名の UTF-16BE 16 進>/` | 利用者が提出したページの複製 |
| 各自の作業フォルダ `CollaborateLocal.tclo` | 自分の役割と、各ファイルを最後に取り込んだ時刻（SQLite） |

ページファイル名と cmc の対応は cmc の `CanvasNode.LinkPath`（`.:page0001.clip`）で取れる。
`Collabo` 側はすべて**ファイル名**で参照していて、cmc の `MainId` は出てこない。

## CollaborateLog.tclg（反映履歴）

```sql
CREATE TABLE Common(_PW_ID, Version, CurrentRevision);
CREATE TABLE CommitInfo(_PW_ID, Revision, UserName TEXT, Comment TEXT, Year, Month, Day, Hour, Minute, Second);
CREATE TABLE File(_PW_ID, Path TEXT, Revision, Status);
```

- 反映 1 回が `CommitInfo` 1 行。`Revision` は 1 から順に増える。日時は現地時刻の分解表記。
- `Comment` は UTF-8。反映ダイアログのコメントがそのまま入る。準備時のコメントも Revision 1 に入る。
- `File` は「その反映で触ったファイル」。`Path` は `.:page0001.clip` 形式。
- `Status` は見えた範囲で 1 = 追加（初回登録）、4 = 提出（「上書きしない」のときの利用者の反映）。
  ログ画面の種類が「追加／更新／削除／提出／却下」なので、2 = 更新、3 = 削除、5 = 却下と思われるが未確認。

## 担当（.tced）

28 バイトの例（担当者 `assistant`、コメント「アシスタントへの指示」）:

```
00 00 00 01            版？（1）
00 00 00 0a            コメントの文字数（UTF-16 単位）
30 a2 30 b7 ... 79 3a  コメント本文（UTF-16BE）
```

- 担当者名はファイル名、ページはフォルダ名、指示コメントは中身。**設定日時は中に無く、ファイルの更新時刻**がそれにあたる。
- 担当を解除するとこのファイルが消えるはず（未確認。「作業担当者に設定されたファイルしか開けない」か「上書きしない」がオンだと利用者側の［作業担当を解除］は選べない）。

## Common.tccs / CollaborateLocal.tclo の設定列

| 列 | 意味（準備ダイアログの項目） |
|---|---|
| `DirectionOnly` | 作業担当者に設定されたファイルしか開けない |
| `WarnIfNoFlag` | 担当外のファイルを開くと警告する |
| `AddFileAtCommit` | 共同作業データに上書きしない（提出は Submit に複製） |
| `Administrator`（tclo のみ） | 1 = 管理者、0 = 利用者 |
| `CommonFolder`（tclo のみ） | 共同作業データの絶対パス |
| `UserName`（tclo のみ） | 自分のユーザー名 |

`CollaborateLocal.tclo` の `File` には各ファイルの取り込み時刻と、提出した `SubmitFolder` 名、競合ファイル名、削除フラグが入る。

## Otosazu にとっての要点

- すべて SQLite か小さな固定形式で、cmc と同じ読み方で読める。作家の PC には Dropbox 等で共同作業データが同期されるので、
  作家側の Otosazu は `Collabo/` を見るだけで「ページごとの担当者と指示」「誰がいつどのページを反映したか、コメント」が取れる。
- 「工程」の情報は無い。反映 1 回を何の完了とみなすかは Otosazu 側で決める必要がある。
- 対応づけはページファイル名。Otosazu の既存のページ行（`LinkPath`）とそのまま突き合わせられる。
