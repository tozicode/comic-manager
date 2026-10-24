# リリース手順

新しい版を出すときの手順。自動更新（仕様書 5.13）のために、更新ファイルを GitHub Releases に置き、
BOOTH には今までどおり zip を置く。

## 0. 最初の 1 回だけ

- リポジトリを公開にする（非公開だと、アプリが更新ファイルをダウンロードできない）

  ```sh
  gh repo edit tozicode/comic-manager --visibility public --accept-visibility-change-consequences
  ```

- 署名鍵 `~/.tauri/otosazu.key`（パスワードなし）を、USB メモリなど別の場所にも控えておく。
  **この鍵をなくすと、配布済みのアプリに更新を届けられなくなる。** 公開鍵はアプリに入っている（`tauri.conf.json` の `plugins.updater.pubkey`）。
  鍵を作り直すと、それまでの版は新しい版を受け付けないので注意
- Mac にも同じ鍵を `~/.tauri/otosazu.key` に置く（クラウドの共有フォルダなど、他人に見られる場所は通さない）

## 1. 版を上げる

次の 5 か所の版を揃えて上げる（例 1.1.0）。

- `package.json`、`package-lock.json`（2 か所）
- `src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`（otosazu の項）
- `src-tauri/tauri.conf.json`

説明書（`docs/guide/guide.html`）の版とファイル名を直して `npm run guide` で PDF を作り直す。
仕様書の開発ステップの履歴と、`docs/booth.md` のアップデート履歴も書く。

## 2. テスト

```sh
npm test
(cd src-tauri && cargo test)
```

## 3. Windows 版のビルド（Git Bash で）

更新ファイルの署名に鍵が要る。PowerShell では空のパスワードを環境変数に入れられないので、Git Bash で行う。

```sh
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/otosazu.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
npm run tauri build
```

`src-tauri/target/release/bundle/nsis/` にできる次の 2 つを `release/<版>/` にコピーする。

- `Otosazu_<版>_x64-setup.exe`
- `Otosazu_<版>_x64-setup.exe.sig`

## 4. Mac 版のビルド

[build-mac.md](build-mac.md) の手順でビルドし、次のファイルを Windows の `release/<版>/` に持ってくる。

| Mac でできるファイル | `release/<版>/` での名前 |
|---|---|
| `bundle/macos/Otosazu.app.tar.gz` | `Otosazu_<版>_universal.app.tar.gz` |
| `bundle/macos/Otosazu.app.tar.gz.sig` | `Otosazu_<版>_universal.app.tar.gz.sig` |
| `bundle/dmg/Otosazu_<版>_universal.dmg` | そのまま（BOOTH 用） |

## 5. latest.json を作る

更新内容をテキストファイル（例 `release/<版>/notes.txt`）に書く。アプリの「新しい版が出ています」の画面にそのまま出る。

```sh
node scripts/make-latest-json.mjs <版> release/<版>/notes.txt
```

`release/<版>/latest.json` ができる。Mac のファイルが無いと Windows だけを載せる（Mac の利用者には知らせが出ない）。

## 6. GitHub Releases に上げる

```sh
V=<版>
gh release create v$V --title "Otosazu $V" --notes-file release/$V/notes.txt \
  release/$V/Otosazu_${V}_x64-setup.exe \
  release/$V/Otosazu_${V}_universal.app.tar.gz \
  release/$V/latest.json
```

上げたら、アプリが読む URL から latest.json が取れることを確かめる。

```sh
curl -sL https://github.com/tozicode/comic-manager/releases/latest/download/latest.json | head
```

古い版のアプリを起動して、「新しい版が出ています」が出て更新できるかも確かめる。

## 7. BOOTH

今までどおり、インストーラー（.exe／.dmg）と説明書の PDF を zip にまとめて置く。

- `Otosazu_<版>_windows.zip`：`Otosazu_<版>_x64-setup.exe` と説明書の PDF
- `Otosazu_<版>_mac.zip`：`Otosazu_<版>_universal.dmg` と説明書の PDF

## 動作確認のしかた（本物のリリースを出さずに試す）

`--config` で名前・識別子・置き場所を差し替えたテスト用のアプリを作れば、今使っている Otosazu と記録に触れずに試せる。

```json
{
  "productName": "OtosazuUpdTest",
  "version": "1.0.98",
  "identifier": "app.otosazu.updtest",
  "plugins": { "updater": { "endpoints": ["http://127.0.0.1:8765/latest.json"], "dangerousInsecureTransportProtocol": true } }
}
```

1. 上の設定で 1.0.98 をビルドしてインストールする（`npm run tauri build -- --config <設定ファイル>`）
2. 版を 1.0.99 にした設定でもう一度ビルドし、できたファイルを `release/1.0.99/` に `Otosazu_1.0.99_x64-setup.exe(.sig)` の名前で置く
3. `OTOSAZU_UPDATE_BASE=http://127.0.0.1:8765 node scripts/make-latest-json.mjs 1.0.99` で latest.json を作り、
   `release/1.0.99/` を `python -m http.server 8765 --bind 127.0.0.1` で配る
4. 1.0.98 を起動すると知らせが出て、「更新する」で 1.0.99 になって開き直す
5. 終わったら、テスト用のアプリをアンインストールし、`%APPDATA%` と `%LOCALAPPDATA%` の `app.otosazu.updtest` を消す
