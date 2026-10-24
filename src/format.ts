// 時間・日付の表示用の関数（言語ごとの書き方は SPANS などにまとめ、今の言語で選ぶ）
import { getLang, Lang } from "./i18n";

const HOUR = 3_600_000;

/** 時間と分の書き方（h 時間 m 分）。under は「step 分未満」 */
const SPANS: Record<Lang, { hm: (h: number, m: number) => string; h: (h: number) => string; m: (m: number) => string; under: (step: number) => string }> = {
  ja: { hm: (h, m) => `${h}時間${m}分`, h: (h) => `${h}時間`, m: (m) => `${m}分`, under: (s) => `${s}分未満` },
  en: { hm: (h, m) => `${h}h ${m}m`, h: (h) => `${h}h`, m: (m) => `${m}m`, under: (s) => `< ${s}m` },
  ko: { hm: (h, m) => `${h}시간 ${m}분`, h: (h) => `${h}시간`, m: (m) => `${m}분`, under: (s) => `${s}분 미만` },
  "zh-Hans": { hm: (h, m) => `${h}小时${m}分钟`, h: (h) => `${h}小时`, m: (m) => `${m}分钟`, under: (s) => `不到${s}分钟` },
  "zh-Hant": { hm: (h, m) => `${h}小時${m}分鐘`, h: (h) => `${h}小時`, m: (m) => `${m}分鐘`, under: (s) => `不到${s}分鐘` },
};

/** 曜日（日曜始まり）。単独で出すときの短い形 */
const WEEKDAYS: Record<Lang, string[]> = {
  ja: ["日", "月", "火", "水", "木", "金", "土"],
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  ko: ["일", "월", "화", "수", "목", "금", "토"],
  "zh-Hans": ["周日", "周一", "周二", "周三", "周四", "周五", "周六"],
  "zh-Hant": ["週日", "週一", "週二", "週三", "週四", "週五", "週六"],
};

const EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** 時間の表記（仕様書 5.9）。hm = 1時間30分、clock = 1:30、decimal = 1.5h */
export type TimeFormat = "hm" | "clock" | "decimal";

// 設定画面で選んだ表記。AppProvider が起動時と設定の変更時に setTimeFormat で入れ替える
let currentFormat: TimeFormat = "hm";

export function setTimeFormat(f: TimeFormat) {
  currentFormat = f;
}

/** 分単位の長さを表記にする（step 分未満の正の値は「step分未満」） */
function formatSpan(ms: number, step: number, fmt: TimeFormat): string {
  if (fmt === "decimal") return `${(ms / HOUR).toFixed(1)}h`;
  const min = Math.round(ms / 60_000 / step) * step;
  const w = SPANS[getLang()];
  if (ms > 0 && min === 0) return w.under(step);
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (fmt === "clock") return `${h}:${String(m).padStart(2, "0")}`;
  if (h === 0) return w.m(m);
  return m === 0 ? w.h(h) : w.hm(h, m);
}

/** 記録した時間の表記（1 分単位） */
export function hours(ms: number, fmt: TimeFormat = currentFormat): string {
  return formatSpan(ms, 1, fmt);
}

/** 予測した時間の表記（5 分単位。細かく出すと実際より正確に見えてしまうため） */
export function estimate(ms: number, fmt: TimeFormat = currentFormat): string {
  return formatSpan(ms, 5, fmt);
}

/** 倍率の表記（1 → 1.0、1.25 → 1.25） */
export function factor(f: number): string {
  return Number.isInteger(f * 10) ? f.toFixed(1) : String(f);
}

/** 00:42:13 のようなタイマー表記 */
export function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

/** 13:40 */
export function time(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** 曜日の短い名前（0 = 日曜） */
export function weekdayName(day: number): string {
  return WEEKDAYS[getLang()][day];
}

/** 10/23（木）。英語は Thu 10/23 */
export function dayLabel(d: Date): string {
  const md = `${d.getMonth() + 1}/${d.getDate()}`;
  const w = weekdayName(d.getDay());
  switch (getLang()) {
    case "en":
      return `${w} ${md}`;
    case "ko":
      return `${md} (${w})`;
    default:
      return `${md}（${w}）`;
  }
}

/** ヒートマップの月の見出し（4月 / Apr / 4월） */
export function monthLabel(month: number): string {
  const lang = getLang();
  if (lang === "en") return EN_MONTHS[month];
  return lang === "ko" ? `${month + 1}월` : `${month + 1}月`;
}

// 1 日の区切り（仕様書 5.11）。0 なら午前 0 時、5 なら朝 5 時〜翌 4:59 を 1 日とする。
// AppProvider が起動時と設定の変更時に setDayStartHour で入れ替える
let dayStartHour = 0;

export function setDayStartHour(h: number) {
  dayStartHour = h;
}

export function getDayStartHour(): number {
  return dayStartHour;
}

/**
 * その時刻が属する「日」（区切りに沿った日付）。日付だけを表す Date（その暦日の 0 時）で返す。
 * 区切りが朝 5 時なら、10/24 の 2:00 は 10/23 になる
 */
export function startOfDay(ms: number): Date {
  const d = new Date(ms - dayStartHour * HOUR);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** その日（区切りに沿った日付）が始まる時刻 */
export function dayStartMs(day: Date): number {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), dayStartHour).getTime();
}

/** 日付を比べるためのキー（2026-10-23） */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * <input type="date"> と <input type="time"> の値から時刻を作る。
 * 日付は区切りに沿った日付なので、区切りより前の時刻（深夜）は次の暦日の時刻として扱う
 */
export function fromInputs(date: string, hm: string): number | null {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = hm.split(":").map(Number);
  if ([y, mo, d, h, mi].some((n) => Number.isNaN(n))) return null;
  return new Date(y, mo - 1, d + (h < dayStartHour ? 1 : 0), h, mi).getTime();
}

/** 作業記録の時刻。その日（区切りに沿った日付）より後の暦日なら「翌」を付ける（例：翌01:40。英語は 01:40 (+1)） */
export function timeInDay(ms: number, day: Date): string {
  const next = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime();
  if (ms < next) return time(ms);
  switch (getLang()) {
    case "en":
      return `${time(ms)} (+1)`;
    case "ko":
      return `익일 ${time(ms)}`;
    case "ja":
      return `翌${time(ms)}`;
    default:
      return `次日${time(ms)}`;
  }
}

/** 作業記録を日ごとに分割して合計する（日をまたぐ記録は 1 日の区切りで分ける） */
export function dailyTotals<T extends { startedAt: number; endedAt: number | null }>(
  spans: T[],
  now: number,
  key: (span: T) => string = () => "",
): Map<string, { total: number; byKey: Map<string, number> }> {
  const result = new Map<string, { total: number; byKey: Map<string, number> }>();
  for (const span of spans) {
    let start = span.startedAt;
    const end = span.endedAt ?? now;
    while (start < end) {
      const day = startOfDay(start);
      const next = dayStartMs(new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1));
      const piece = Math.min(end, next) - start;
      const k = dayKey(day);
      const entry = result.get(k) ?? { total: 0, byKey: new Map() };
      entry.total += piece;
      entry.byKey.set(key(span), (entry.byKey.get(key(span)) ?? 0) + piece);
      result.set(k, entry);
      start = next;
    }
  }
  return result;
}
