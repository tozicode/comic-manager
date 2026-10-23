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
- ファイル名の番号は**ページ順ではない**（ページを並べ替えてもファイル名は変わらない）
  → ファイル名はページの「ID」として使える。表示順は cmc から読む

## .cmc ファイル

中身は素の SQLite 3 データベース。

### Project テーブル（1行）
作品全体の設定。使えそうな列:
- `ComicStoryStoryName` 作品名 / `ComicStorySubTitle` サブタイトル / `ComicStoryAuthorName` 作者名
- `ComicBindPosition` 綴じ方向、`ComicStartPage` 開始ページ（見開きの判定に必要かも）

### CanvasNode テーブル（ページ一覧）
| 列 | 意味 |
|---|---|
| `MainId` | ノードID |
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
### 見開きを単ページに戻したとき

```
見開き : … → page0005 → page0006(見開き) → page0008 → …
戻した後: … → page0005 → page0006 → page0009 → page0008 → …
```

- 見開きだったファイル（`page0006`）は単ページ（210 × 297）に戻り、`PageFlag = 0` になる
- もう片方は**新しい番号のファイル**（`page0009.clip`）として作られる。消えた `page0007` は復活しない
- 新しいファイルにも見開き時の絵（右半分）が引き継がれている
- ファイル番号は `Project.MaxCanvasFileIndex` で管理され、**使い回されない**。
  → ファイル名をページ ID として扱って安全

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
