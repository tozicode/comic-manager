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

## 回答を読む・対応を記録する

フォームの回答は Google ドライブの `otosazu` フォルダにあるスプレッドシート
（`1QE1ZtbaFZw2X2pkXjNmqsqYSid8KuZi1DVxN1IWw9Ts`）に溜まる。このシートが台帳で、右端の「対応」列だけ手で足した
（フォームが作る列は触らない）。

```sh
python scripts/feedback.py                 # 未対応の回答を新しい順に
python scripts/feedback.py --all           # 全部
python scripts/feedback.py done 5 "済 3.2.1 記録の平均（5.12）"   # 5 行目の「対応」列に書く
```

- 「対応」が **「済」か「見送り」で始まる行は対応済み**。空欄や「一部 …」は未対応として出る。
  書く中身は、版と何をしたか（仕様書の節）、見送りならその理由を一言
- 回す手順：来たら未対応を見て、対応するなら PLAN.md に落とす（この時点では空欄のまま）。
  リリースしたら `done` で「済 <版> …」を書く。見送るなら「見送り …」。
  複数の要望が 1 つの回答にあって一部だけ応えたら「一部 …」と書いて未対応のまま残す
- メールや BOOTH で来たものは、同じシートに「ほかの窓口」のタブを作って手で足す（回答タブに手で行を足さない）
- リポジトリには利用者の文面を置かない（公開リポジトリのため）。仕様書の該当する節と開発ステップの履歴に
  「利用者の要望」と一言書くだけにする
- fgf と同じサービスアカウント `spreadsheat@spreadsheat-tozicode.iam.gserviceaccount.com` で読み書きする。
  鍵は `../fgf/spreadsheat-tozicode-65b8a6f80554.json`（リポジトリには入れない。別の場所に置くなら
  `OTOSAZU_GOOGLE_KEY` で指す）。Python の `gspread` が要る。シートはこのアカウントに「編集者」で共有してある
