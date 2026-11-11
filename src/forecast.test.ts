import { describe, expect, it, vi } from "vitest";

// forecast.ts は app-context（テーマや Tauri の窓を触る）を import するので、テストでは中身の無いものに差し替える
vi.mock("./app-context", () => ({ useApp: () => ({}) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: () => true }));

import type { Board, Prediction, TimetableWorkInput, WorkSchedule } from "./api";
import { computeForecast, upcomingDeadlines } from "./forecast";
import { dayKey } from "./format";
import { Calendar, HOUR, pickDeadline } from "./schedule";
import { buildTimetable, TimetableWork } from "./timetable";

// 2026/10/19 は月曜日。毎日 4 時間
const MON = new Date(2026, 9, 19);
const CAL: Calendar = { weekdayHours: [4, 4, 4, 4, 4, 4, 4], daysOff: [] };

const input = (workId: number, remainingMs: number, deadlines: [number, string, string][], selected: number | null = null): TimetableWorkInput => ({
  workId,
  title: `作品${workId}`,
  remainingMs,
  lowMs: remainingMs * 0.8,
  highMs: remainingMs * 1.2,
  sigma: 0.3,
  deadlines: deadlines.map(([id, name, date]) => ({ id, name, date })),
  selectedDeadline: selected,
});

/** forecast.ts の toTimetableWork と同じく、計算に使う締切を付けた形にする（今日の作業は無し） */
function run(list: TimetableWorkInput[]) {
  const works: TimetableWork[] = list.map((w) => {
    const picked = pickDeadline(w.deadlines, w.selectedDeadline, dayKey(MON));
    return { ...w, deadline: picked ? new Date(`${picked.date}T00:00`) : null, workedTodayMs: 0 };
  });
  return upcomingDeadlines(list, works, buildTimetable(works, MON, CAL), MON, CAL);
}

describe("これからの締切（5.26）", () => {
  it("未完成の作品の今日以降の締切を日付の順に並べ、完成した作品と過ぎた締切は出さない", () => {
    const rows = run([
      input(1, 8 * HOUR, [[11, "", "2026-11-30"]]),
      input(2, 4 * HOUR, [
        [21, "初稿", "2026-10-25"],
        [22, "", "2026-10-10"],
      ]),
      input(3, 0, [[31, "", "2026-10-22"]]),
    ]);
    expect(rows.map((r) => [r.workId, r.id])).toEqual([
      [2, 21],
      [1, 11],
    ]);
    expect(rows[0].name).toBe("初稿");
  });

  it("選んでいない締切は薄く出す印が付き、状況はその日に差し替えて組んだ結果になる", () => {
    // 残り 24 時間。毎日 4 時間なので 10/24（土）に終わり、10/23 には間に合わず、11/30 には間に合う
    const rows = run(
      [
        input(1, 24 * HOUR, [
          [11, "希望", "2026-10-23"],
          [12, "最終", "2026-11-30"],
        ], 12),
      ],
    );
    expect(rows.map((r) => [r.id, r.picked, r.status])).toEqual([
      [11, false, "late"],
      [12, true, "ok"],
    ]);
  });

  it("ほかの作品に器を取られると間に合わない", () => {
    // 作品 2 の締切が早いので先に器を使い、作品 1 は 10/24 に収まらない（1 作品だけなら 20h ≦ 6 日 × 4h で収まる）
    const rows = run([input(1, 20 * HOUR, [[11, "", "2026-10-24"]]), input(2, 16 * HOUR, [[21, "", "2026-10-23"]])]);
    const one = rows.find((r) => r.workId === 1)!;
    expect(one.status).toBe("late");
  });
});

describe("次にやるタスクの並び", () => {
  // 2 ページ × 下書き・ペン入れ。1 ページ目の下書きだけ終わっている
  const cell = (done: boolean) => ({ done, excluded: false });
  const board = {
    work: { id: 1, title: "作品", kind: "comic", unit: "" },
    stages: [
      { id: 10, name: "下書き" },
      { id: 20, name: "ペン入れ" },
    ],
    pages: [
      { id: 1, label: "1", missing: false, assignees: [], cells: [cell(true), cell(false)] },
      { id: 2, label: "2", missing: false, assignees: [], cells: [cell(false), cell(false)] },
    ],
  } as unknown as Board;
  const task = (pageId: number, stageId: number, done = false) => ({
    pageId,
    stageId,
    predictedMs: HOUR,
    spentMs: done ? HOUR : 0,
    remainingMs: done ? 0 : HOUR,
    done,
    assigned: false,
    excluded: false,
  });
  const prediction: Prediction = {
    tasks: [task(1, 10, true), task(1, 20), task(2, 10), task(2, 20)],
    remainingMs: 3 * HOUR,
    lowMs: 3 * HOUR,
    highMs: 3 * HOUR,
    sigma: 0.3,
    stages: [],
  };
  const next = (workOrder: "stage" | "page") => {
    const schedule = { weekdayHours: CAL.weekdayHours, deadlines: [], selectedDeadline: null, workOrder, daysOff: [] } as unknown as WorkSchedule;
    const f = computeForecast(board, prediction, schedule, [], MON.getTime() + 9 * HOUR, CAL);
    return f.candidates.map((c) => [c.pageId, c.stageId]);
  };

  it("進め方が工程ごとなら、同じ工程のほかのページを先に出す", () => {
    expect(next("stage")).toEqual([
      [2, 10],
      [1, 20],
    ]);
  });

  it("進め方がページごとなら、同じページの次の工程を先に出す", () => {
    expect(next("page")).toEqual([
      [1, 20],
      [2, 10],
    ]);
  });
});
