import { afterEach, describe, expect, it } from "vitest";
import { setDayStartHour } from "./format";
import { factorDiffers, weekdayAverages } from "./stats";

const H = 3_600_000;
/** 2026-10-26 は月曜日 */
const at = (d: number, h: number) => new Date(2026, 9, d, h).getTime();
const span = (d: number, h: number, len: number) => ({ startedAt: at(d, h), endedAt: at(d, h) + len * H });

describe("曜日ごとの平均作業時間", () => {
  afterEach(() => setDayStartHour(0));

  it("記録が無ければ平均は 0 で、期間も無い", () => {
    const r = weekdayAverages([], at(26, 12), []);
    expect(r.from).toBeNull();
    expect(r.averages.every((a) => a.avgMs === 0 && a.days === 0)).toBe(true);
  });

  it("最初の記録より前の日は入れない（使い始めの週が 0 で薄まらない）", () => {
    // 10/19（月）から使い始め、月曜に 2 時間・3 時間、火曜は作業なし
    const r = weekdayAverages([span(19, 20, 2), span(26, 20, 3)], at(28, 12), []);
    expect(r.from?.getDate()).toBe(19);
    expect(r.to.getDate()).toBe(27); // 今日（10/28）は入れない
    expect(r.averages[0]).toEqual({ avgMs: 2.5 * H, days: 2 });
    expect(r.averages[1]).toEqual({ avgMs: 0, days: 2 });
    expect(r.averages[2]).toEqual({ avgMs: 0, days: 1 }); // 水曜は 10/21 だけ
  });

  it("休みの日は入れない", () => {
    const r = weekdayAverages([span(19, 20, 2), span(26, 20, 4)], at(28, 12), ["2026-10-19"]);
    expect(r.averages[0]).toEqual({ avgMs: 4 * H, days: 1 });
  });

  it("8 週間より前の記録は入れない", () => {
    const r = weekdayAverages([span(1, 20, 1), span(26, 20, 3)], at(28 + 56, 12), []);
    // 12/23 から 8 週間前（10/28）以降だけ。10/26 の記録は範囲外
    expect(r.from?.getMonth()).toBe(9);
    expect(r.from?.getDate()).toBe(28);
    expect(r.averages.reduce((n, a) => n + a.avgMs, 0)).toBe(0);
    expect(r.averages.reduce((n, a) => n + a.days, 0)).toBe(56);
  });

  it("日付は 1 日の区切りに沿って数える", () => {
    setDayStartHour(5);
    // 火曜の深夜 2 時の作業は月曜の作業
    const r = weekdayAverages([span(26, 20, 1), span(27, 2, 2)], at(29, 12), []);
    expect(r.averages[0]).toEqual({ avgMs: 3 * H, days: 1 });
    expect(r.averages[1]).toEqual({ avgMs: 0, days: 1 });
  });
});

describe("倍率の見直しの印", () => {
  it.each([
    [1.3, 1.3, false],
    [1.3, 1.6, false],
    [1.3, 1.63, true],
    [2.0, 1.6, true],
    [2.0, 1.7, false],
  ])("初期 %d・実績 %d → %s", (initial, observed, expected) => {
    expect(factorDiffers(initial, observed, 3)).toBe(expected);
  });

  it("実績が 3 件未満なら印を出さない", () => {
    expect(factorDiffers(1.3, 2.6, 2)).toBe(false);
  });
});
