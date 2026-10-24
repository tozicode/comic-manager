// 複数の画面で使う言葉の訳文と、作品の種類に応じた文言の組み立て（仕様書 5.16）
import { defineMessages, getLang } from ".";
import type { RowKind, StageSet, WorkKind } from "../api";

const { t } = defineMessages({
  ja: { "set.comic": "漫画", "set.files": "イラスト" },
  en: { "set.comic": "Comic", "set.files": "Illustration" },
  ko: { "set.comic": "만화", "set.files": "일러스트" },
  "zh-Hans": { "set.comic": "漫画", "set.files": "插画" },
  "zh-Hant": { "set.comic": "漫畫", "set.files": "插畫" },
});

/**
 * 工程のセットの名前。組み込みの漫画・イラストは、データベースの名前（初回起動時の言語で作ったもの）ではなく
 * 今の言語で出す。利用者が作ったセットは付けた名前をそのまま出す
 */
export function setName(set: StageSet): string {
  return set.kind === "manual" ? set.name : t(set.kind === "files" ? "set.files" : "set.comic");
}

/**
 * 「ページ」「枚」「{unit}」で文言が変わるキーを、作品の種類から選ぶ。
 * 漫画・イラストは訳し分けたキー（xxxComic / xxxFiles）、利用者が作ったセットの作品は単位の言葉を差し込むキー（xxxUnit）。
 * 数え方の助数詞が言語ごとに違うので、組み込みの 2 種類は訳文をそのまま残している
 */
export function kindKey<K extends string>(kind: WorkKind, base: K): `${K}Comic` | `${K}Files` | `${K}Unit` {
  const suffix = kind === "comic" ? "Comic" : kind === "files" ? "Files" : "Unit";
  return `${base}${suffix}` as `${K}Comic` | `${K}Files` | `${K}Unit`;
}

/**
 * {unit} に差し込む単位の言葉。英語だけ、1 つでなければ末尾に s を付ける（part → parts、chapter → chapters）。
 * n を省くと複数（「○○を選ぶと」のように数の無い文）
 */
export function unitText(row: RowKind, n = 2): string {
  const unit = row.unit.trim();
  if (getLang() !== "en" || n === 1 || unit === "" || unit.endsWith("s")) return unit;
  return `${unit}s`;
}
