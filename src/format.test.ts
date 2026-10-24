import { afterEach, describe, expect, it } from "vitest";
import { dailyTotals, dayKey, dayLabel, dayStartMs, estimate, fromInputs, hours, monthLabel, setDayStartHour, startOfDay, timeInDay } from "./format";
import { Lang, setLang } from "./i18n";

const MIN = 60_000;
const H = 60 * MIN;

describe("時間の表記", () => {
  const cases: [number, string, string, string][] = [
    // 長さ, 時間と分, 時計の形, 小数
    [0, "0分", "0:00", "0.0h"],
    [20_000, "1分未満", "1分未満", "0.0h"],
    [30 * MIN, "30分", "0:30", "0.5h"],
    [60 * MIN, "1時間", "1:00", "1.0h"],
    [90 * MIN, "1時間30分", "1:30", "1.5h"],
    [155 * H + 50 * MIN, "155時間50分", "155:50", "155.8h"],
  ];
  it.each(cases)("記録 %d ms", (ms, hm, clock, decimal) => {
    expect(hours(ms, "hm")).toBe(hm);
    expect(hours(ms, "clock")).toBe(clock);
    expect(hours(ms, "decimal")).toBe(decimal);
  });

  it("記録は 1 分単位に丸める", () => {
    expect(hours(67 * MIN + 29_000, "hm")).toBe("1時間7分");
    expect(hours(67 * MIN + 31_000, "hm")).toBe("1時間8分");
  });

  it("予測は 5 分単位に丸める", () => {
    expect(estimate(67 * MIN, "hm")).toBe("1時間5分");
    expect(estimate(68 * MIN, "hm")).toBe("1時間10分");
    expect(estimate(118 * MIN, "hm")).toBe("2時間");
    expect(estimate(68 * MIN, "clock")).toBe("1:10");
    expect(estimate(2 * MIN, "hm")).toBe("5分未満");
    expect(estimate(0, "hm")).toBe("0分");
    // 小数は今までどおり 0.1 時間単位
    expect(estimate(68 * MIN, "decimal")).toBe("1.1h");
  });

  it("既定は時間と分", () => {
    expect(hours(90 * MIN)).toBe("1時間30分");
  });
});

describe("1日の区切り", () => {
  // 2026/10/23（金）
  const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime();
  afterEach(() => setDayStartHour(0));

  it("0 時区切り（既定）では暦どおり", () => {
    expect(dayKey(startOfDay(at(24, 2)))).toBe("2026-10-24");
    expect(fromInputs("2026-10-23", "01:30")).toBe(at(23, 1, 30));
  });

  it("朝 5 時区切りでは、深夜 2 時は前の日", () => {
    setDayStartHour(5);
    expect(dayKey(startOfDay(at(24, 2)))).toBe("2026-10-23");
    expect(dayKey(startOfDay(at(24, 4, 59)))).toBe("2026-10-23");
    expect(dayKey(startOfDay(at(24, 5)))).toBe("2026-10-24");
    // 曜日も区切りに沿った日付で決まる（土曜の深夜 2 時は金曜）
    expect(startOfDay(at(24, 2)).getDay()).toBe(5);
    expect(dayStartMs(new Date(2026, 9, 23))).toBe(at(23, 5));
  });

  it("日をまたぐ記録は区切りで分ける", () => {
    setDayStartHour(5);
    const totals = dailyTotals([{ startedAt: at(23, 23), endedAt: at(24, 7) }], 0);
    expect(totals.get("2026-10-23")!.total).toBe(6 * H); // 23:00〜翌 5:00
    expect(totals.get("2026-10-24")!.total).toBe(2 * H); // 5:00〜7:00
  });

  it("入力した深夜の時刻は次の暦日として扱い、表示には「翌」を付ける", () => {
    setDayStartHour(5);
    expect(fromInputs("2026-10-23", "01:30")).toBe(at(24, 1, 30));
    expect(fromInputs("2026-10-23", "23:10")).toBe(at(23, 23, 10));
    const day = new Date(2026, 9, 23);
    expect(timeInDay(at(24, 1, 40), day)).toBe("翌01:40");
    expect(timeInDay(at(23, 23, 10), day)).toBe("23:10");
  });

  it("締切日はその日の区切りまで", () => {
    setDayStartHour(5);
    // 12/1 の 4 時はまだ 11/30（締切日）のうち
    expect(dayKey(startOfDay(new Date(2026, 11, 1, 4).getTime()))).toBe("2026-11-30");
  });
});

describe("言語ごとの表記", () => {
  afterEach(() => setLang("ja"));
  const day = new Date(2026, 9, 23); // 金曜日
  const cases: [Lang, string, string, string, string][] = [
    // 言語, 1時間30分, 3分（予測）, 日付, 月
    ["ja", "1時間30分", "5分未満", "10/23（金）", "10月"],
    ["en", "1h 30m", "< 5m", "Fri 10/23", "Oct"],
    ["ko", "1시간 30분", "5분 미만", "10/23 (금)", "10월"],
    ["zh-Hans", "1小时30分钟", "不到5分钟", "10/23（周五）", "10月"],
    ["zh-Hant", "1小時30分鐘", "不到5分鐘", "10/23（週五）", "10月"],
  ];
  it.each(cases)("%s", (lang, hm, under, date, month) => {
    setLang(lang);
    expect(hours(90 * MIN, "hm")).toBe(hm);
    expect(estimate(2 * MIN, "hm")).toBe(under);
    expect(dayLabel(day)).toBe(date);
    expect(monthLabel(9)).toBe(month);
  });

  it("翌日の時刻", () => {
    const late = new Date(2026, 9, 24, 1, 40).getTime();
    expect(timeInDay(late, day)).toBe("翌01:40");
    setLang("en");
    expect(timeInDay(late, day)).toBe("01:40 (+1)");
  });
});
