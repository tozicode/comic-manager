# ロゴ

Otosazu のロゴ（2026-10-29 決定）。頭文字の O を、3/4 まで埋まった**進捗の輪**のストップウォッチにしている。

| ファイル | 中身 | 使う場所 |
|---|---|---|
| `otosazu-logo.svg` | マーク＋文字（横長） | 明るい背景。BOOTH・記事・説明書 |
| `otosazu-logo-dark.svg` | 同じ・濃い背景用 | ダークモード、X の暗い背景 |
| `otosazu-mark.svg` | マークだけ（正方形・背景は透明） | アイコン、進捗共有の画像の隅 |
| `otosazu-mark-dark.svg` | 同じ・濃い背景用 | |

## 決まりごと

- **書体**：M PLUS Rounded 1c ExtraBold（SIL Open Font License）。文字はアウトライン化してあるので、書体が無い環境でも同じに見える
- **並べ方**：輪の下端を文字の並ぶ線に揃え、O を頭文字の大文字として読ませる
- **色**

  | | 明るい背景 | 濃い背景 |
  |---|---|---|
  | 輪（埋まった部分）・つまみ | `#c8553d` | `#e2735a` |
  | 輪（残りの部分） | `#e8b9ac` | `#6b3a2f` |
  | 針の中心・文字 | `#3a2a25` | `#f5ebe7` |

- 輪の残りの部分は、16px に縮めても消えない濃さにしてある。薄くしない
- アプリのアイコンは `src-tauri/icons/source.svg`（薄い朱色の角丸の地にこのマーク）から `npx tauri icon` で作る。サイドバーのロゴは `src/components/Logo.tsx`（色は App.css の `--logo-*`）

## 作り直すとき

`make_logo.py` で 4 つの SVG を書き出す。fontTools と、M PLUS Rounded 1c ExtraBold の .ttf が要る。

```bash
python docs/brand/make_logo.py <MPLUSRounded1c-ExtraBold.ttf の場所> docs/brand
```
