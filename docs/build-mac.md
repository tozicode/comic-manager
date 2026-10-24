# Mac 版のビルド手順

Mac 版は Mac の上でしかビルドできない（Windows からのクロスビルドは不可）。
Apple の署名・公証は付けず、仮の署名（ad-hoc 署名）だけを付けて配布する。
設定は `src-tauri/tauri.macos.conf.json` にあり、Mac でビルドしたときだけ `tauri.conf.json` に重ねて使われる。

## 1. 準備（最初の 1 回だけ）

```sh
# Xcode のコマンドラインツール（コンパイラなど）
xcode-select --install

# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
# Intel と Apple Silicon の両方で動く版（universal）を作るため、両方のターゲットを入れる
rustup target add aarch64-apple-darwin x86_64-apple-darwin
```

Node.js は LTS 版を入れておく（公式のインストーラーか Homebrew）。

自動更新のファイルに付ける署名鍵を、Windows と同じ `~/.tauri/otosazu.key` に置く（[release.md](release.md) の 0. を参照）。

```sh
git clone git@github.com:tozicode/comic-manager.git
cd comic-manager
npm ci
```

## 2. テスト

```sh
npm test
(cd src-tauri && cargo test)
```

## 3. ビルド

```sh
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/otosazu.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
npm run tauri build -- --target universal-apple-darwin
```

できあがるもの:

- `src-tauri/target/universal-apple-darwin/release/bundle/dmg/Otosazu_<版>_universal.dmg` … 配布用
- `src-tauri/target/universal-apple-darwin/release/bundle/macos/Otosazu.app`
- `src-tauri/target/universal-apple-darwin/release/bundle/macos/Otosazu.app.tar.gz` と `.sig` … 自動更新用（[release.md](release.md) の 4.）

説明書の PDF は Windows で `npm run guide` で作ったもの（Windows・Mac 共通）を添える。

## 4. 動作確認

Mac 版で特に見ておくところ:

- 漫画（.cmc）・イラスト（.clip / .psd）の登録とサムネイル。Mac 版 CLIP STUDIO で作った .cmc も読めるか
- 止め忘れの確認：設定の「止め忘れの確認」を 1 分にして、計測中に 1 分以上操作しないと確認が出るか
- ショートカット：設定欄に ⌃⌥Space のように記号で出るか、他のアプリを使っている最中に効くか
- ミニタイマーの窓、ファイル選択・保存のダイアログ、バックアップ
- 自動更新：前の版を入れた状態で新しい版をリリースし、「更新する」で入れ替わって開き直すか。
  入れ替わった後に「このまま開く」の手順がもう一度要るかどうか（要るなら説明書に書く）
- 利用者側の初回の開き方：自分でビルドした .app はそのまま開けてしまうので、
  .dmg を一度クラウドストレージなどに上げてダウンロードし直し、説明書どおり
  「プライバシーとセキュリティ → このまま開く」で開けるかを確かめる

## 5. 配布

`.dmg` と説明書の PDF を zip にまとめる（Windows 版と同じく `Otosazu_<版>_mac.zip` など）。
