import { describe, expect, it } from "vitest";
import { dayKey } from "./format";
import { addDays, Calendar, capacity, deadlinePlan, finishDate, HOUR } from "./schedule";
import { buildTimetable, TimetableWork } from "./timetable";

// 2026/10/19 は月曜日
const MON = new Date(2026, 9, 19);
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d);
const WEEK: Calendar = { weekdayHours: [3, 3, 3, 3, 3, 6, 6], daysOff: [] };
const key = (d: Date | null) => (d ? dayKey(d) : null);

const mk = (o: Partial<TimetableWork> & { workId: number }): TimetableWork => ({
  title: `作品${o.workId}`,
  remainingMs: 0,
  lowMs: 0,
  highMs: 0,
  sigma: 0.3,
  deadline: null,
  minMs: 0,
  workedTodayMs: 0,
  ...o,
});
/** 残り 1 つで 3 通りが同じ作品 */
const simple = (workId: number, remainingMs: number, o: Partial<TimetableWork> = {}) =>
  mk({ workId, remainingMs, lowMs: remainingMs * 0.8, highMs: remainingMs * 1.3, ...o });

/** 全日の取り分の合計 */
const total = (share: ReturnType<typeof buildTimetable> extends Map<number, infer S> ? S : never, days = 400) => {
  let s = 0;
  for (let i = 0; i < days; i++) s += share.dayMs(addDays(MON, i));
  return s;
};

describe("作品が 1 つなら今の結果と同じ", () => {
  const conditions: { name: string; cal: Calendar; deadline: Date | null; worked: number }[] = [
    { name: "締切あり", cal: WEEK, deadline: day(2026, 11, 8), worked: 0 },
    { name: "締切なし", cal: WEEK, deadline: null, worked: 0 },
    { name: "休みの日を含む", cal: { ...WEEK, daysOff: ["2026-10-20", "2026-10-24", "2026-11-03"] }, deadline: day(2026, 11, 8), worked: 0 },
    { name: "今日の作業済みあり", cal: WEEK, deadline: day(2026, 11, 8), worked: 2 * HOUR },
  ];
  for (const c of conditions) {
    it(`${c.name}：完成日と今日のノルマが一致する`, () => {
      for (let h = 0.5; h <= 10; h += 0.5) {
        const rem = h * 6 * HOUR; // 3h 〜 60h
        const w = simple(1, rem, { deadline: c.deadline, workedTodayMs: c.worked });
        const s = buildTimetable([w], MON, c.cal).get(1)!;
        expect(key(s.finish.mid), `残り ${rem / HOUR}h`).toBe(key(finishDate(rem, MON, c.worked, c.cal)));
        expect(key(s.finish.low)).toBe(key(finishDate(w.lowMs, MON, c.worked, c.cal)));
        expect(key(s.finish.high)).toBe(key(finishDate(w.highMs, MON, c.worked, c.cal)));
        if (!c.deadline) {
          expect(s.todayMs).toBeCloseTo(capacity(MON, c.cal));
          continue;
        }
        const plan = deadlinePlan(rem, w.highMs, MON, c.deadline, c.worked, c.cal);
        expect(s.aloneFeasible).toBe(plan.feasible);
        // 間に合うなら今日のノルマは同じ式。間に合わないなら器いっぱい（今は作業可能時間を超える値を出していた）
        if (plan.feasible) expect(s.todayMs, `残り ${rem / HOUR}h`).toBeCloseTo(plan.todayQuotaMs);
        else expect(s.todayMs).toBeCloseTo(capacity(MON, c.cal));
        expect(s.allottedMs).toBeCloseTo(Math.min(plan.capacityMs, rem + c.worked));
        expect(s.shortMs).toBeCloseTo(Math.max(0, rem + c.worked - plan.capacityMs));
        expect(s.breakdown).toEqual([]);
        expect(s.othersPerDayMs).toBe(0);
      }
    });
  }

  it("残りが無ければ今日に完成、作業できる日が無ければ null", () => {
    const none = buildTimetable([simple(1, 0)], MON, WEEK).get(1)!;
    expect(key(none.finish.mid)).toBe("2026-10-19");
    const zero: Calendar = { weekdayHours: [0, 0, 0, 0, 0, 0, 0], daysOff: [] };
    const s = buildTimetable([simple(1, 5 * HOUR, { deadline: day(2026, 10, 25) })], MON, zero).get(1)!;
    expect(s.finish).toEqual({ low: null, mid: null, high: null });
    expect(s.todayMs).toBe(0);
    expect(s.shortMs).toBe(5 * HOUR);
    expect(s.aloneFeasible).toBe(false);
  });
});

describe("取り合い", () => {
  it("締切の早い作品が先に埋まり、遅い作品の完成が後ろにずれる", () => {
    const a = simple(1, 6 * HOUR, { deadline: day(2026, 10, 20) }); // 火曜まで。月火で 6h
    const b = simple(2, 6 * HOUR, { deadline: day(2026, 10, 30) });
    const t = buildTimetable([a, b], MON, WEEK);
    expect(key(t.get(1)!.finish.mid)).toBe("2026-10-20");
    expect(key(t.get(2)!.finish.mid)).toBe("2026-10-22"); // 1 つなら火曜に終わるところ
    expect(key(buildTimetable([b], MON, WEEK).get(2)!.finish.mid)).toBe("2026-10-20");
    // ならし：A は締切までの器 6h に対して残り 6h なので毎日 3h。B は今日ぶんが入らない
    expect(t.get(1)!.todayMs).toBeCloseTo(3 * HOUR);
    expect(t.get(2)!.todayMs).toBeCloseTo(0);
    expect(t.get(2)!.breakdown).toEqual([{ workId: 1, ms: 6 * HOUR }]);
    expect(t.get(2)!.othersPerDayMs).toBeGreaterThan(0);
    expect(t.get(1)!.breakdown).toEqual([]); // A の締切までに B には配っていない
  });

  it("同じ締切なら作品 id の小さい順", () => {
    const t = buildTimetable([simple(5, 3 * HOUR, { deadline: MON }), simple(2, 3 * HOUR, { deadline: MON })], MON, WEEK);
    expect(t.get(2)!.todayMs).toBeCloseTo(3 * HOUR);
    expect(t.get(5)!.todayMs).toBeCloseTo(0);
  });

  it("締切の無い作品どうしは残りに比例して分け、同じ日に終わる", () => {
    const t = buildTimetable([simple(1, 6 * HOUR), simple(2, 12 * HOUR)], MON, WEEK);
    expect(t.get(1)!.todayMs).toBeCloseTo(1 * HOUR);
    expect(t.get(2)!.todayMs).toBeCloseTo(2 * HOUR);
    // 合計 18h = 月〜金 15h + 土 3h
    expect(key(t.get(1)!.finish.mid)).toBe("2026-10-24");
    expect(key(t.get(2)!.finish.mid)).toBe("2026-10-24");
    expect(t.get(1)!.othersDayMs(MON)).toBeCloseTo(2 * HOUR);
  });

  it("締切のある作品が締切の無い作品より先", () => {
    const t = buildTimetable([simple(1, 30 * HOUR), simple(2, 3 * HOUR, { deadline: day(2026, 10, 20) })], MON, WEEK);
    // いっぱい：2 が今日 3h を取って今日のうちに終わる
    expect(key(t.get(2)!.finish.mid)).toBe("2026-10-19");
    // ならしでは 2 は締切まで 6h の器に残り 3h なので今日 1.5h。残りの 1.5h を 1 が使う
    expect(t.get(2)!.todayMs).toBeCloseTo(1.5 * HOUR);
    expect(t.get(1)!.todayMs + t.get(2)!.todayMs).toBeCloseTo(3 * HOUR);
  });
});

describe("下限", () => {
  it("早い作品が間に合わなくても、下限の時間は毎日取れる", () => {
    const a = simple(1, 20 * HOUR, { deadline: day(2026, 10, 20) }); // 間に合わないので器いっぱい
    const b = simple(2, 10 * HOUR, { deadline: day(2026, 11, 20), minMs: 1 * HOUR });
    const t = buildTimetable([a, b], MON, WEEK);
    expect(t.get(2)!.todayMs).toBeCloseTo(1 * HOUR);
    expect(t.get(2)!.dayMs(day(2026, 10, 20))).toBeCloseTo(1 * HOUR);
    expect(t.get(1)!.todayMs).toBeCloseTo(2 * HOUR);
    // 下限が無ければ B は今日ぶんが入らない
    expect(buildTimetable([a, { ...b, minMs: 0 }], MON, WEEK).get(2)!.todayMs).toBeCloseTo(0);
  });

  it("下限の合計が器を超える日は締切順。休みの日には確保しない", () => {
    const a = simple(1, 20 * HOUR, { deadline: day(2026, 10, 25), minMs: 2 * HOUR });
    const b = simple(2, 20 * HOUR, { deadline: day(2026, 11, 25), minMs: 2 * HOUR });
    const t = buildTimetable([a, b], MON, { ...WEEK, daysOff: ["2026-10-20"] });
    expect(t.get(1)!.todayMs).toBeCloseTo(2 * HOUR);
    expect(t.get(2)!.todayMs).toBeCloseTo(1 * HOUR);
    expect(t.get(2)!.dayMs(day(2026, 10, 20))).toBe(0);
  });

  it("下限は必要量より多くても確保する", () => {
    const s = buildTimetable([simple(1, 7 * HOUR, { deadline: day(2026, 10, 25), minMs: 2 * HOUR })], MON, WEEK).get(1)!;
    // 比例配分なら今日 7 × 3 / 27 ≒ 0.78h だが、下限の 2h
    expect(s.todayMs).toBeCloseTo(2 * HOUR);
  });
});

describe("持ち越しと合計", () => {
  it("配れなかったぶんは翌日に持ち越され、取り分の合計は残り + 今日の作業済みになる", () => {
    const works = [
      simple(1, 9 * HOUR, { deadline: day(2026, 10, 21), workedTodayMs: HOUR }),
      simple(2, 14 * HOUR, { deadline: day(2026, 10, 28) }),
      simple(3, 40 * HOUR, { deadline: day(2026, 12, 1), minMs: 0.5 * HOUR }),
      simple(4, 5 * HOUR),
    ];
    const t = buildTimetable(works, MON, WEEK);
    for (const w of works) expect(total(t.get(w.workId)!), w.title).toBeCloseTo(w.remainingMs + w.workedTodayMs);
    // 1 は締切までの器 9h から 3 の下限 1.5h を除いた 7.5h に 10h なので足りない。今日は器いっぱい（3 の下限 0.5h を除いた 2.5h）
    expect(t.get(1)!.todayMs).toBeCloseTo(2.5 * HOUR);
    expect(t.get(1)!.shortMs).toBeCloseTo(2.5 * HOUR);
  });

  it("今日の作業済みぶんを足し戻すので、日中にノルマが変わらない", () => {
    const morning = buildTimetable([simple(1, 27 * HOUR, { deadline: day(2026, 10, 25) })], MON, WEEK).get(1)!;
    const evening = buildTimetable([simple(1, 25 * HOUR, { deadline: day(2026, 10, 25), workedTodayMs: 2 * HOUR })], MON, WEEK).get(1)!;
    expect(evening.todayMs).toBeCloseTo(morning.todayMs);
  });

  it("いっぱいで間に合う作品は、ならしでも締切までに残りを配りきれる（乱数 200 通り）", () => {
    // 再現できるよう、線形合同法の乱数
    let seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let c = 0; c < 200; c++) {
      const n = 2 + Math.floor(rnd() * 4);
      const works: TimetableWork[] = [];
      for (let k = 0; k < n; k++) {
        const hasDeadline = rnd() < 0.8;
        works.push(
          simple(k + 1, (1 + Math.floor(rnd() * 60)) * HOUR, {
            deadline: hasDeadline ? addDays(MON, Math.floor(rnd() * 30)) : null,
            minMs: rnd() < 0.3 ? 0.5 * HOUR : 0,
            workedTodayMs: rnd() < 0.3 ? HOUR : 0,
          }),
        );
      }
      const t = buildTimetable(works, MON, WEEK);
      for (const w of works) {
        const s = t.get(w.workId)!;
        if (!w.deadline || s.shortMs > 0) continue;
        let got = 0;
        for (let d = MON; d <= w.deadline; d = addDays(d, 1)) got += s.dayMs(d);
        expect(got, `${c} 回目 ${w.title}`).toBeGreaterThanOrEqual(w.remainingMs + w.workedTodayMs - 1);
      }
    }
  });
});

describe("警告の出し分け", () => {
  it("この作品だけでも足りない／この作品だけなら間に合う", () => {
    const a = simple(1, 20 * HOUR, { deadline: day(2026, 10, 20) }); // 器 6h に 20h
    const b = simple(2, 6 * HOUR, { deadline: day(2026, 10, 22) }); // 1 つなら 12h の器に 6h で間に合う
    const t = buildTimetable([a, b], MON, WEEK);
    expect(t.get(1)!.aloneFeasible).toBe(false);
    expect(t.get(1)!.shortMs).toBeCloseTo(14 * HOUR);
    // A が木曜まで器を独り占めするので B には配られない
    expect(t.get(2)!.aloneFeasible).toBe(true);
    expect(t.get(2)!.shortMs).toBeCloseTo(6 * HOUR);
    expect(t.get(2)!.breakdown).toEqual([{ workId: 1, ms: 12 * HOUR }]);
    expect(t.get(2)!.othersPerDayMs).toBeCloseTo(3 * HOUR);
  });

  it("締切を過ぎた締切は配れないので全部足りない", () => {
    const s = buildTimetable([simple(1, 3 * HOUR, { deadline: day(2026, 10, 18) })], MON, WEEK).get(1)!;
    expect(s.shortMs).toBe(3 * HOUR);
    expect(s.aloneFeasible).toBe(false);
    expect(key(s.finish.mid)).toBe("2026-10-19"); // 完成はするので今日
  });
});
