import { describe, expect, it } from "vitest";
import { dailyTotals, dayKey } from "./format";
import {
  buildPlans,
  Calendar,
  Candidate,
  capacity,
  catchUpNotice,
  deadlinePlan,
  fill,
  finishDate,
  finishDateAtPace,
  HOUR,
  onTimeProbability,
  ordered,
  pickDeadline,
} from "./schedule";

// 2026/10/19 は月曜日
const MON = new Date(2026, 9, 19);
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d);
const WEEK: Calendar = { weekdayHours: [3, 3, 3, 3, 3, 6, 6], daysOff: [] };

describe("capacity", () => {
  it("曜日ごとの時間と休みの日", () => {
    expect(capacity(MON, WEEK)).toBe(3 * HOUR);
    expect(capacity(day(2026, 10, 24), WEEK)).toBe(6 * HOUR); // 土曜
    expect(capacity(MON, { ...WEEK, daysOff: ["2026-10-19"] })).toBe(0);
  });
});

describe("finishDate", () => {
  it("今日から作業時間を割り当てる", () => {
    // 月〜金で 15h、土で 21h
    expect(dayKey(finishDate(15 * HOUR, MON, 0, WEEK)!)).toBe("2026-10-23");
    expect(dayKey(finishDate(15.5 * HOUR, MON, 0, WEEK)!)).toBe("2026-10-24");
  });

  it("今日すでに作業したぶんは今日の枠から引く", () => {
    expect(dayKey(finishDate(3 * HOUR, MON, 0, WEEK)!)).toBe("2026-10-19");
    expect(dayKey(finishDate(3 * HOUR, MON, 2 * HOUR, WEEK)!)).toBe("2026-10-20");
  });

  it("休みの日は飛ばす", () => {
    const cal = { ...WEEK, daysOff: ["2026-10-20"] };
    expect(dayKey(finishDate(6 * HOUR, MON, 0, cal)!)).toBe("2026-10-21");
  });

  it("残りが無ければ今日、作業できる日が無ければ null", () => {
    expect(finishDate(0, MON, 0, WEEK)).toEqual(MON);
    expect(finishDate(HOUR, MON, 0, { weekdayHours: [0, 0, 0, 0, 0, 0, 0], daysOff: [] })).toBeNull();
  });

  it("毎日同じペースの場合", () => {
    expect(dayKey(finishDateAtPace(10 * HOUR, MON, 2 * HOUR)!)).toBe("2026-10-23");
    expect(finishDateAtPace(HOUR, MON, 0)).toBeNull();
  });
});

describe("deadlinePlan", () => {
  it("作業可能時間に比例して今日のノルマを決める", () => {
    // 月〜日の 1 週間で 27h。残り 27h なら、ちょうど曜日の作業時間どおり
    const p = deadlinePlan(27 * HOUR, 30 * HOUR, MON, day(2026, 10, 25), 0, WEEK);
    expect(p.days).toBe(7);
    expect(p.workDays).toBe(7);
    expect(p.capacityMs).toBe(27 * HOUR);
    expect(p.todayQuotaMs).toBeCloseTo(3 * HOUR);
    expect(p.perDayMs).toBeCloseTo((27 / 7) * HOUR);
    expect(p.safePerDayMs).toBeCloseTo((30 / 7) * HOUR);
    expect(p.feasible).toBe(true);
  });

  it("今日の作業済みぶんを足して、日中でもノルマが変わらない", () => {
    const morning = deadlinePlan(27 * HOUR, 30 * HOUR, MON, day(2026, 10, 25), 0, WEEK);
    const evening = deadlinePlan(25 * HOUR, 28 * HOUR, MON, day(2026, 10, 25), 2 * HOUR, WEEK);
    expect(evening.todayQuotaMs).toBeCloseTo(morning.todayQuotaMs);
  });

  it("間に合わないとき・締切を過ぎたとき", () => {
    expect(deadlinePlan(30 * HOUR, 30 * HOUR, MON, day(2026, 10, 25), 0, WEEK).feasible).toBe(false);
    const past = deadlinePlan(HOUR, HOUR, MON, day(2026, 10, 18), 0, WEEK);
    expect(past.days).toBe(0);
    expect(past.feasible).toBe(false);
  });
});

describe("pickDeadline", () => {
  const list = [
    { id: 1, date: "2026-10-18" },
    { id: 2, date: "2026-10-20" },
    { id: 3, date: "2026-10-27" },
  ];
  it("選んでいる締切が過ぎていなければそれを使う", () => {
    expect(pickDeadline(list, 3, "2026-10-19")?.id).toBe(3);
  });
  it("選んでいない・消した・過ぎたときは今日以降でいちばん早い締切", () => {
    expect(pickDeadline(list, null, "2026-10-19")?.id).toBe(2);
    expect(pickDeadline(list, 99, "2026-10-19")?.id).toBe(2);
    expect(pickDeadline(list, 1, "2026-10-19")?.id).toBe(2);
  });
  it("締切日の当日はまだ過ぎていない。全部過ぎたら null", () => {
    expect(pickDeadline(list, 2, "2026-10-20")?.id).toBe(2);
    expect(pickDeadline(list, 3, "2026-10-28")).toBeNull();
    expect(pickDeadline([], null, "2026-10-19")).toBeNull();
  });
});

describe("onTimeProbability", () => {
  it("残りと作業可能時間が同じなら 50%", () => {
    expect(onTimeProbability(10 * HOUR, 0.2, 10 * HOUR)).toBeCloseTo(0.5, 3);
    expect(onTimeProbability(10 * HOUR, 0.2, 20 * HOUR)).toBeGreaterThan(0.99);
    expect(onTimeProbability(10 * HOUR, 0.2, 5 * HOUR)).toBeLessThan(0.01);
    expect(onTimeProbability(0, 0.2, 0)).toBe(1);
  });
});

// p1〜p4 × 下書き(0)・ペン入れ(1)・トーン(2)
const stages = [
  { id: 10, name: "下書き", openMs: 2 * HOUR },
  { id: 11, name: "ペン入れ", openMs: 6 * HOUR },
  { id: 12, name: "トーン", openMs: 4 * HOUR },
];
const c = (page: number, stage: number, hours: number, inProgress = false): Candidate => ({
  pageId: page,
  stageId: 10 + stage,
  pageIndex: page,
  stageIndex: stage,
  remainingMs: hours * HOUR,
  inProgress,
});
const cands = [c(3, 0, 1), c(4, 0, 1), c(1, 1, 1.5), c(2, 1, 1.5, true), c(0, 2, 1)];
const summary = (steps: { pageId: number; stageId: number; ms: number; partial: boolean }[]) =>
  steps.map((s) => `p${s.pageId}-${s.stageId - 10}:${s.ms / HOUR}${s.partial ? "途中" : ""}`);

describe("今日の案", () => {
  it("fill はノルマぶん切り出し、最後は途中までになる", () => {
    expect(summary(fill([c(1, 0, 1), c(2, 0, 1), c(3, 0, 1)], 2.5 * HOUR))).toEqual(["p1-0:1", "p2-0:1", "p3-0:0.5途中"]);
    // 5 分未満の端数は入れない
    expect(fill([c(1, 0, 1), c(2, 0, 1)], HOUR + 60_000)).toHaveLength(1);
  });

  it("工程ごとの並びでは、途中のタスクがその工程の先頭に来る", () => {
    expect(summary(fill(ordered(cands, "stage"), 100 * HOUR))).toEqual([
      "p3-0:1",
      "p4-0:1",
      "p2-1:1.5",
      "p1-1:1.5",
      "p0-2:1",
    ]);
    expect(summary(fill(ordered(cands, "page"), 100 * HOUR))).toEqual([
      "p2-1:1.5",
      "p0-2:1",
      "p1-1:1.5",
      "p3-0:1",
      "p4-0:1",
    ]);
  });

  it("おすすめ・工程ごとの日・混ぜるの案を出す", () => {
    const plans = buildPlans(cands, stages, 3 * HOUR, "stage");
    expect(plans.map((p) => p.name)).toEqual(["おすすめ", "下書きの日", "ペン入れの日", "トーンの日", "混ぜる"]);
    const by = (key: string) => plans.find((p) => p.key === key)!;
    expect(summary(by("recommended").steps)).toEqual(["p3-0:1", "p4-0:1", "p2-1:1途中"]);
    expect(summary(by("stage-11").steps)).toEqual(["p2-1:1.5", "p1-1:1.5"]);
    // トーンは着手できるのが 1h ぶんだけなので、ノルマに届かない
    expect(summary(by("stage-12").steps)).toEqual(["p0-2:1"]);
    // 混ぜる：残り 2h:6h:4h の比で 0.5h / 1.5h / 1h
    expect(summary(by("mix").steps)).toEqual(["p3-0:0.5途中", "p2-1:1.5", "p0-2:1"]);
    // どの案もノルマを超えない
    for (const p of plans) expect(p.steps.reduce((n, s) => n + s.ms, 0)).toBeLessThanOrEqual(3 * HOUR);
  });

  it("着手できない工程の日は選べない", () => {
    const plans = buildPlans([c(1, 0, 1)], stages, 2 * HOUR, "stage");
    expect(plans.find((p) => p.key === "stage-11")!.disabled).toContain("下書きが済んだ");
    const done = buildPlans([c(1, 1, 1)], [{ ...stages[0], openMs: 0 }, stages[1]], 2 * HOUR, "stage");
    expect(done.find((p) => p.key === "stage-10")!.disabled).toContain("すべて終わって");
    // 工程が 1 つしか着手できないときは「混ぜる」を出さない
    expect(plans.some((p) => p.key === "mix")).toBe(false);
  });

  it("混ぜるでノルマに届かないぶんは、おすすめの順で埋める", () => {
    const plans = buildPlans([c(1, 0, 0.5), c(1, 1, 3)], [stages[0], { ...stages[1], openMs: 0.5 * HOUR }], 2 * HOUR, "stage");
    expect(summary(plans.find((p) => p.key === "mix")!.steps)).toEqual(["p1-0:0.5", "p1-1:1.5途中"]);
  });

  it("後の工程が追いついてきたら一言添える", () => {
    expect(catchUpNotice(cands, stages, [2, 4, 4])).toContain("ペン入れが下書きに追いついてきました");
    expect(catchUpNotice(cands, stages, [0, 2, 1])).toBeNull();
  });
});

describe("dailyTotals", () => {
  it("日をまたぐ記録は 0 時で分ける", () => {
    const start = new Date(2026, 9, 19, 23, 0).getTime();
    const totals = dailyTotals([{ startedAt: start, endedAt: start + 2 * HOUR, name: "ペン入れ" }], 0, (s) => s.name);
    expect(totals.get("2026-10-19")!.total).toBe(HOUR);
    expect(totals.get("2026-10-20")!.byKey.get("ペン入れ")).toBe(HOUR);
  });
});
