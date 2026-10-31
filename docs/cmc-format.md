# CLIP STUDIO 漫画ファイル（cmc / clip）の構造メモ

`dummy-cmc/` のダミーファイルを解析して分かったこと。CLIP STUDIO PAINT のバージョン違いで変わる可能性があるため、
読み取り処理は「想定外の構造なら諦めて手動登録にフォールバックする」作りにする。

## フォルダ構成

```
コミック 20261023/
├── コミック 20261023.cmc   ← 作品ファイル（SQLite）
├── page0001.clip            ← 各ページ
├── page0002.clip
└── ...
```

- `.cmc` とページの `.clip` は**同じフォルダ**に並ぶ
- ファイル名の番号は**ページ順ではない**（ページを並べ替えてもファイル名は変わらない）。表示順は cmc から読む
- ただし「ページ管理 ＞ ページファイル名の整列」をすると、ファイル名が今のページ順の連番に付け替わる
  → ファイル名はページの ID に**使えない**。ID には `CanvasNode.MainId` を使う（下記）

## .cmc ファイル

中身は素の SQLite 3 データベース。

### Project テーブル（1行）
作品全体の設定。使えそうな列:
- `ComicStoryStoryName` 作品名 / `ComicStorySubTitle` サブタイトル / `ComicStoryAuthorName` 作者名
- `ComicBindPosition` 綴じ方向：1 = 右綴じ（日本語の CLIP STUDIO の既定。ダミーも 1）、0 = 左綴じ（推定。左綴じの cmc で未確認）。
  見開きを左右に分けて表示するときに使う。`ComicStartPage` 開始ページ（0 = 既定）は今のところ使わない

### CanvasNode テーブル（ページ一覧）
| 列 | 意味 |
|---|---|
| `MainId` | ノードID。ページの ID として使う（並べ替え・ファイル名の整列で変わらない） |
| `Type` | 0 = ルート、2 = ページ |
| `FirstChildIndex` | ルートの最初の子（= 1ページ目）の `MainId` |
| `NextIndex` | 次のページの `MainId`（0 で終端） |
| `LinkPath` | ページファイルへの相対パス。`.:page0001.clip` 形式（`.:` = cmc と同じフォルダ） |
| `Memo` | ページメモ（CLIP STUDIO 側で書ける） |
| `PageFlag` | 1 = 見開きページ、0 = 単ページ |
| `LinkWidth` / `LinkHeight` / `LinkResolution` | 見開きページではキャンバスサイズ（mm, dpi）が入る。単ページでは 0 / 72 |
| `LinkWrite*`, `LinkIsFolder`, `LinkUnit` | 見開き化した後の保存で列が追加された。**単ページの行では未初期化のゴミ値が入っている**ので使わない |

**ページ順は連結リスト**になっている。ルートの `FirstChildIndex` から `NextIndex` をたどる。

ダミーでの実例（並べ替え済み）:
```
root → page0001 → page0003 → page0005 → page0006 → page0007 → page0008 → page0004 → page0002
```

### 見開きページ

ダミーで表示上の 4・5 ページ目（`page0006` と `page0007`）を見開きにした結果:

```
変更前: … → page0005 → page0006 → page0007 → page0008 → …
変更後: … → page0005 → page0006(見開き) → page0008 → …
```

- 2ページが **1つの .clip に統合**される。左右どちらかのファイル（今回は `page0007.clip`）は
  ファイルごと削除され、`CanvasNode` の行も消える
- 残った行は `PageFlag = 1` になり、`LinkWidth × LinkHeight` = 420 × 297（A4 の倍幅）
- 見開き 1 ノードで **2ページ分**を占める。ノンブル（ページ番号）は 2 つ進めて数える
- 見開きの絵の左右：右綴じでは若い番号のページが**右側**（p4-5 なら p4 が右、p5 が左。右綴じの本は右のページから読むため）。
  左綴じではその逆。アプリでは「見開きを 1 ページずつ管理する」のサムネイルの切り出しに使う
### 見開きを単ページに戻したとき

```
見開き : … → page0005 → page0006(見開き) → page0008 → …
戻した後: … → page0005 → page0006 → page0009 → page0008 → …
```

- 見開きだったファイル（`page0006`）は単ページ（210 × 297）に戻り、`PageFlag = 0` になる
- もう片方は**新しい番号のファイル**（`page0009.clip`）として作られる。消えた `page0007` は復活しない
- 新しいファイルにも見開き時の絵（右半分）が引き継がれている
- 新しいファイルの番号は `Project.MaxCanvasFileIndex` で決まり、ふだんは使い回されない
  （ただし下記の整列では、消えたページの番号も詰めて付け直される）

### ページファイル名の整列

CLIP STUDIO の「ページ管理 ＞ ページファイル名の整列」は、ページの移動・削除で乱れたファイル名の番号を、
今のページ順に付け直す。`src-tauri/testdata/sort-before.cmc`（整列前）と `sort-after.cmc`（整列後）で比べた結果:

```
整列前: page0001 → page0003 → page0008 → page0010 → page0009 → page0011 → page0005 → page0006 → page0004 → page0002
整列後: page0001 → page0002 → page0003 → page0004 → page0005 → page0006 → page0007 → page0008 → page0009 → page0010
MainId:     2    →     4    →     9    →    11    →    10    →    12    →     6    →     7    →     5    →     3
```

- ページの並びと **`MainId` は変わらない**。変わるのは `LinkPath`（とファイル名）だけ
- .clip の中身もそのまま（レイヤーの `LayerUuid` も同じ）
- `MaxCanvasFileIndex` は 11 のまま戻らない
- 消えたページの番号も詰められるので、**同じファイル名が前とは別のページを指す**ことがある
- 新しいページの `MainId` は、作ったときのファイル番号 + 1 になっていた（`page0010` → 11）。
  見開きにしても残る側のページの `MainId` は変わらず、見開きを解除してできたページには新しい `MainId` が付く

### その他
- 列の追加（`LinkWrite*` など）は CLIP STUDIO が保存時にスキーマを更新したもの。
  古い cmc では列自体が無いことがあるので、列の有無を確認してから読む

## .clip ファイル

独自のチャンク形式。

```
"CSFCHUNK" (8B) + ファイルサイズ (8B, big endian) + オフセット (8B)
以降、チャンクの繰り返し:
  チャンク名 (8B, 例 "CHNKHead" "CHNKExta" "CHNKSQLi" "CHNKFoot") + サイズ (8B, big endian) + 本体
```

- `CHNKSQLi` の本体がそのまま SQLite データベース
- `CHNKExta` はレイヤーの画像データなど（今回は使わない）

### SQLite 内で使えるもの
- `CanvasPreview.ImageData`: **ページのサムネイル PNG**（ダミーでは 1240×1754）
- `Layer.LayerName`: レイヤー名（UTF-8）。将来「下書きレイヤーがあるか」等の自動判定に使える余地あり
- `Canvas.CanvasWidth / CanvasHeight / CanvasResolution`: キャンバスサイズ

## 読み取り時の注意

- **cmc / clip には絶対に書き込まない。** 読むときは一時フォルダへコピーしてから read-only で開く
  （CLIP STUDIO で開いている最中でもロックや破損を起こさないため）
- ページの保存はファイルの更新日時に表れるので、「どのページを作業中か」の推定や止め忘れ検知に使える

## 未確認事項
- 表紙の表現（`Project.ComicCoverExist` との関係）
- Mac 版で作ったファイルとの違い
- 古いバージョンの CLIP STUDIO で作ったファイルとの違い
