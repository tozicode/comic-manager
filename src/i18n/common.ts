// 複数の画面で使う言葉の訳文
import { defineMessages } from ".";
import type { WorkKind } from "../api";

const { t } = defineMessages({
  ja: { "set.comic": "漫画", "set.files": "イラスト" },
  en: { "set.comic": "Comic", "set.files": "Illustration" },
  ko: { "set.comic": "만화", "set.files": "일러스트" },
  "zh-Hans": { "set.comic": "漫画", "set.files": "插画" },
  "zh-Hant": { "set.comic": "漫畫", "set.files": "插畫" },
});

/**
 * 工程のセットの名前。データベースの名前（初回起動時の言語で作ったもの）ではなく、
 * 作品の種類から今の言語で出す（セットの名前は利用者が変えられないため）
 */
export function setName(kind: WorkKind): string {
  return t(kind === "files" ? "set.files" : "set.comic");
}
