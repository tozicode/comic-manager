# フィードバックのフォーム（ご意見・不具合の報告）の回答を読んで出す
# 使い方: python scripts/feedback.py [件数]
#   - 回答は Google フォームが書き足すスプレッドシート（ドライブの otosazu フォルダ）にある
#   - fgf と同じサービスアカウント（spreadsheat@spreadsheat-tozicode.iam.gserviceaccount.com）で読む。
#     鍵は ../fgf/spreadsheat-tozicode-65b8a6f80554.json（別の場所なら OTOSAZU_GOOGLE_KEY で指す）。
#     シートはこのアカウントに「閲覧者」で共有しておく
#   - 新しい回答から順に、1 件ずつ「設問: 回答」の形で出す。件数を省くと全件
import os
import sys

import gspread

HOME = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KEY_PATH = os.environ.get(
    "OTOSAZU_GOOGLE_KEY",
    os.path.join(HOME, "..", "fgf", "spreadsheat-tozicode-65b8a6f80554.json"),
)
SHEET_KEY = "1QE1ZtbaFZw2X2pkXjNmqsqYSid8KuZi1DVxN1IWw9Ts"


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else None
    sheet = gspread.service_account(filename=KEY_PATH).open_by_key(SHEET_KEY).sheet1
    rows = sheet.get_all_values()
    if not rows:
        print("回答はまだありません")
        return
    header, answers = rows[0], rows[1:]
    print(f"{len(answers)} 件（シート: {sheet.spreadsheet.title} / {sheet.title}）")
    for row in reversed(answers[-limit:] if limit else answers):
        print("-" * 60)
        for name, value in zip(header, row):
            if value.strip():
                print(f"{name}: {value}")


if __name__ == "__main__":
    main()
