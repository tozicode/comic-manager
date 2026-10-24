// 統計画面（仕様書 5.12）の集計
import { dailyTotals, dayKey, startOfDay } from "./format";

export const STATS_WEEKS = 8;

export type WeekdayAverage = {
  /** 1 日あたりの平均作業時間 */
  avgMs: number;
  /** 平均に入れた日の数 */
  days: number;
};

/**
 * 直近 weeks 週間（今日は含めない）の、曜日ごと（月〜日）の 1 日あたりの平均作業時間。
 * 休みの日と、最初の作業記録より前の日は入れない
 */
export function weekdayAverages(
  spans: { startedAt: number; endedAt: number | null }[],
  now: number,
  daysOff: string[],
  weeks = STATS_WEEKS,
): { averages: WeekdayAverage[]; from: Date | null; to: Date } {
  const today = startOfDay(now);
  const to = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const averages = Array.from({ length: 7 }, () => ({ avgMs: 0, days: 0 }));
  if (spans.length === 0) return { averages, from: null, to };

  const first = startOfDay(Math.min(...spans.map((s) => s.startedAt)));
  const windowStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() - weeks * 7);
  const from = first > windowStart ? first : windowStart;
  if (from > to) return { averages, from: null, to };

  const totals = dailyTotals(spans, now);
  const off = new Set(daysOff);
  const sums = Array(7).fill(0);
  for (let d = new Date(from); d <= to; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    const key = dayKey(d);
    if (off.has(key)) continue;
    const i = (d.getDay() + 6) % 7;
    sums[i] += totals.get(key)?.total ?? 0;
    averages[i].days++;
  }
  averages.forEach((a, i) => (a.avgMs = a.days ? sums[i] / a.days : 0));
  return { averages, from, to };
}

/** 見直しの印を出すのに必要な実績の数（少ないと偶然のずれで印が出てしまうため） */
export const MIN_SAMPLES_TO_FLAG = 3;

/** 実績から見た倍率が初期倍率と大きく違うか（1.25 倍以上、または 0.8 倍以下。実績が少ないうちは出さない） */
export function factorDiffers(initial: number, observed: number, samples: number): boolean {
  if (samples < MIN_SAMPLES_TO_FLAG) return false;
  const r = observed / initial;
  return r >= 1.25 || r <= 0.8;
}
