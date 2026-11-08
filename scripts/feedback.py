# フィードバックのフォーム（ご意見・不具合の報告）の回答を読み、対応の記録を書く
# 使い方:
#   python scripts/feedback.py              未対応の回答を新しい順に出す
#   python scripts/feedback.py --all        全部出す
#   python scripts/feedback.py done <行> <メモ>   その行の「対応」列にメモを書く（例: done 5 "済 3.2.1 記録の平均（5.12）"）
#
#   - 回答は Google フォームが書き足すスプレッドシート（ドライブの otosazu フォルダ）にある。
#     右端の「対応」列だけ手で足した列で、フォームは触らない
#   - 「対応」が「済」か「見送り」で始まる行は対応済み。空欄やそれ以外（「一部 …」など）は未対応として出す
#   - fgf と同じサービスアカウント（spreadsheat@spreadsheat-tozicode.iam.gserviceaccount.com）で読み書きする。
#     鍵は ../fgf/spreadsheat-tozicode-65b8a6f80554.json（別の場所なら OTOSAZU_GOOGLE_KEY で指す）。
#     シートはこのアカウントに「編集者」で共有しておく
#   - 行は表の行番号（見出しが 1 行目なので、最初の回答は 2）
import os
import sys

import gspread

HOME = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KEY_PATH = os.environ.get(
    "OTOSAZU_GOOGLE_KEY",
    os.path.join(HOME, "..", "fgf", "spreadsheat-tozicode-65b8a6f80554.json"),
)
SHEET_KEY = "1QE1ZtbaFZw2X2pkXjNmqsqYSid8KuZi1DVxN1IWw9Ts"
STATUS = "対応"
DONE_PREFIXES = ("済", "見送り")


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    sheet = gspread.service_account(filename=KEY_PATH).open_by_key(SHEET_KEY).sheet1
    rows = sheet.get_all_values()
    if not rows:
        print("回答はまだありません")
        return
    header = rows[0]
    if STATUS not in header:
        sys.exit(f"見出しに「{STATUS}」の列がありません: {header}")
    status_col = header.index(STATUS)

    if len(sys.argv) >= 4 and sys.argv[1] == "done":
        row = int(sys.argv[2])
        note = " ".join(sys.argv[3:])
        if not 2 <= row <= len(rows):
            sys.exit(f"行 {row} はありません（2〜{len(rows)}）")
        sheet.update_cell(row, status_col + 1, note)
        print(f"行 {row} の「{STATUS}」に書きました: {note}")
        return

    show_all = "--all" in sys.argv[1:]
    answers = [(i, r) for i, r in enumerate(rows[1:], start=2)]
    if not show_all:
        answers = [(i, r) for i, r in answers if not status_of(r, status_col).startswith(DONE_PREFIXES)]
    print(f"{len(answers)} 件（{'全部' if show_all else '未対応'} / シート: {sheet.spreadsheet.title}）")
    for i, row in reversed(answers):
        print("-" * 60)
        print(f"行 {i}")
        for name, value in zip(header, row):
            if value.strip():
                print(f"{name}: {value}")


def status_of(row: list[str], col: int) -> str:
    return row[col].strip() if col < len(row) else ""


if __name__ == "__main__":
    main()
