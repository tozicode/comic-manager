import { describe, expect, it } from "vitest";
import { estimate, hours } from "./format";

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
