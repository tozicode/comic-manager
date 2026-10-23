// 時間・日付の表示用の関数

const HOUR = 3_600_000;
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

/** 1.2h のような時間表記（0.1h 単位） */
export function hours(ms: number): string {
  return `${(ms / HOUR).toFixed(1)}h`;
}

/** 00:42:13 のようなタイマー表記 */
export function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

/** 1時間12分 のような表記 */
export function duration(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 1) return "1分未満";
  if (min < 60) return `${min}分`;
  return `${Math.floor(min / 60)}時間${min % 60 ? `${min % 60}分` : ""}`;
}

/** 13:40 */
export function time(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** 10/23（木） */
export function dayLabel(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}（${WEEKDAYS[d.getDay()]}）`;
}

/** ローカル時刻での日付の 0 時 */
export function startOfDay(ms: number): Date {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** 日付を比べるためのキー（2026-10-23） */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** <input type="date"> と <input type="time"> の値から時刻を作る */
export function fromInputs(date: string, hm: string): number | null {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = hm.split(":").map(Number);
  if ([y, mo, d, h, mi].some((n) => Number.isNaN(n))) return null;
  return new Date(y, mo - 1, d, h, mi).getTime();
}

/** 作業記録を日ごとに分割して合計する（日をまたぐ記録は 0 時で分ける） */
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
      const next = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime();
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
