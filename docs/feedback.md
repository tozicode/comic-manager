# ご意見・不具合の窓口

利用者からの報告を受ける場所と、回答の読み方。

## 窓口

- **Google フォーム**（アカウント不要）：
  `https://docs.google.com/forms/d/e/1FAIpQLSfZiFdcGdq_BGvwtE6SqVEFJ7FbaFPN539hD57gBYYPvFcuAA/viewform`
  - アプリの「このソフトについて」は、版と OS を事前入力して開く（`src/screens/SettingsScreen.tsx` の `FORM_URL`。
    `entry.245049095` = お使いの OS、`entry.911636501` = Otosazu の版）
  - ファイル添付の設問は置かない（回答者に Google ログインを求めてしまうため）
- **メール**：`feedback@otosazu.com`（Cloudflare Email Routing で Gmail に転送）。スクショやバックアップファイルの受け皿
- 載せている場所：アプリの「このソフトについて」、公式サイトのフッター、説明書「困ったとき・ご意見」、BOOTH の原稿

## 回答を読む

フォームの回答は Google ドライブの `otosazu` フォルダにあるスプレッドシート
（`1QE1ZtbaFZw2X2pkXjNmqsqYSid8KuZi1DVxN1IWw9Ts`）に溜まる。

```sh
python scripts/feedback.py       # 全件、新しい順
python scripts/feedback.py 5     # 新しい 5 件
```

- fgf と同じサービスアカウント `spreadsheat@spreadsheat-tozicode.iam.gserviceaccount.com` で読む。
  鍵は `../fgf/spreadsheat-tozicode-65b8a6f80554.json`（リポジトリには入れない。別の場所に置くなら
  `OTOSAZU_GOOGLE_KEY` で指す）。Python の `gspread` が要る
- 回答のシートはこのアカウントに「閲覧者」で共有しておく（フォルダごとでもよい）。
  共有していないと `PermissionError` で止まる
