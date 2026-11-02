import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// forecast.ts は app-context（テーマや Tauri の窓を触る）を import するので、テストでは中身の無いものに差し替える。
// ここで使う computeForecast と buildSnapshot は純粋関数で、どちらも使わない
vi.mock("./app-context", () => ({ useApp: () => ({}) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: () => true }));

import type { Board, BoardPage, Prediction, WorkSchedule } from "./api";
import { computeForecast } from "./forecast";
import { setDayStartHour } from "./format";
import { buildSnapshot, shareUrl } from "./publish";

// 2026-10-29 10:00 を「今」にする。1 日の区切りは 0 時
const NOW = new Date(2026, 9, 29, 10).getTime();
const DAY = new Date(2026, 9, 29).getTime();
const stages = [
  { id: 1, name: "下書き", color: "#6fa8dc" },
  { id: 2, name: "ペン入れ", color: "#e06666" },
];
const page = (id: number, span: number, cells: [boolean, number | null, number][], missing = false): BoardPage => ({
  id,
  fileName: `p${id}.clip`,
  path: "",
  label: `p${id}`,
  number: id,
  span,
  half: 0,
  missing,
  found: true,
  tags: [],
  cells: cells.map(([done, doneAt, totalMs], i) => ({ stageId: stages[i].id, done, doneAt, totalMs })),
});
const board = (pages: BoardPage[]): Board => ({
  work: {
    id: 1,
    title: "冬の新刊",
    kind: "comic",
    setId: 1,
    unit: "",
    cmcPath: null,
    lastSyncedAt: null,
    splitSpreads: false,
    rightBound: true,
  },
  stages,
  pages,
});
/** 残り時間だけを持つ予測（完成見込みの計算に要るのはこれだけ） */
const prediction = (b: Board, remainingMs: number): Prediction => ({
  tasks: b.pages.flatMap((p) =>
    p.cells.map((c) => ({
      pageId: p.id,
      stageId: c.stageId,
      predictedMs: 3600_000,
      spentMs: c.totalMs,
      remainingMs: c.done ? 0 : 3600_000,
      done: c.done,
    })),
  ),
  remainingMs,
  lowMs: remainingMs / 2,
  highMs: remainingMs * 2,
  sigma: 0.5,
  stages: [],
});
const schedule = (deadlines: { id: number; name: string; date: string }[], selected: number | null): WorkSchedule => ({
  weekdayHours: [2, 2, 2, 2, 2, 2, 2],
  customHours: false,
  defaultWeekdayHours: [2, 2, 2, 2, 2, 2, 2],
  deadlines,
  selectedDeadline: selected,
  workOrder: "stage",
  daysOff: [],
});

const b = board([
  page(1, 1, [[true, DAY - 1000, 1800_000], [true, DAY + 1000, 600_000]]),
  page(2, 2, [[true, DAY + 5000, 0], [false, null, 300_000]]),
  page(3, 1, [[false, null, 0], [false, null, 0]]),
  page(4, 1, [[true, DAY, 0]], true),
]);
const sessions = [
  { pageId: 2, stageId: 2, startedAt: DAY + 100, endedAt: DAY + 200 },
  { pageId: 3, stageId: 2, startedAt: DAY + 300, endedAt: null },
];
const extra = { sessions, dayStart: DAY, lastWorkedAt: DAY - 3600_000, appVersion: "2.6.0", now: NOW };

describe("buildSnapshot", () => {
  beforeEach(() => setDayStartHour(0));
  afterEach(() => setDayStartHour(0));

  it("マス・進み具合・締切・見込み・作業時間を要約にする", () => {
    const f = computeForecast(
      b,
      prediction(b, 4 * 3600_000),
      schedule(
        [
          { id: 1, name: "", date: "2026-11-05" },
          { id: 2, name: "入稿", date: "2026-11-10" },
        ],
        2,
      ),
      [],
      NOW,
    );
    const s = buildSnapshot(f, extra, []);
    expect(s.v).toBe(1);
    expect(s.app).toBe("2.6.0");
    expect(s.work).toEqual({ title: "冬の新刊", kind: "comic", unit: "", rows: 3 });
    expect(s.stages).toEqual([
      { name: "下書き", color: "#6fa8dc" },
      { name: "ペン入れ", color: "#e06666" },
    ]);
    // 消えたページは除く。完了 2 / 今日手を付けた 1 / 未着手 0
    expect(s.cells).toEqual([
      [2, 2],
      [2, 1],
      [0, 1],
    ]);
    expect(s.spans).toEqual([1, 2, 1]);
    expect(s.labels).toEqual(["p1", "p2", "p3"]);
    // 8 マスぶん（見開きは 2）のうち完了 4、今日の完了 3
    expect(s.progress).toBeCloseTo(4 / 8);
    expect(s.todayProgress).toBeCloseTo(3 / 8);
    expect(s.completed).toBe(false);
    expect(s.deadlines).toEqual([
      { name: "", date: "2026-11-05", selected: false },
      { name: "入稿", date: "2026-11-10", selected: true },
    ]);
    // 残り 4 時間を 1 日 2 時間で。少なめ 2h → 今日、標準 4h → 明日、多め 8h → 4 日目
    expect(s.finish).toEqual({ low: "2026-10-29", mid: "2026-10-30", high: "2026-11-01" });
    expect(s.time).toEqual({ todayMs: 0, totalMs: 2700_000 });
    expect(s.lastWorkedOn).toBe("2026-10-28");
    expect(s.generatedAt).toBe(NOW);
  });

  it("隠す項目は null になる", () => {
    const f = computeForecast(b, prediction(b, 4 * 3600_000), schedule([], null), [], NOW);
    const s = buildSnapshot(f, extra, ["title", "time", "finish", "cells"]);
    expect(s.work.title).toBeNull();
    expect(s.time).toBeNull();
    expect(s.finish).toBeNull();
    expect(s.cells).toBeNull();
    expect(s.spans).toBeNull();
    expect(s.labels).toBeNull();
    // 隠しても進み具合と行の数は出る
    expect(s.progress).toBeCloseTo(0.5);
    expect(s.work.rows).toBe(3);
    expect(s.deadlines).toEqual([]);
  });

  it("全部完了した作品は completed になり、一度も作業していなければ lastWorkedOn は null", () => {
    const done = board([page(1, 1, [[true, DAY - 5000, 100], [true, DAY - 4000, 100]])]);
    const f = computeForecast(done, prediction(done, 0), schedule([], null), [], NOW);
    const s = buildSnapshot(f, { ...extra, lastWorkedAt: null }, []);
    expect(s.completed).toBe(true);
    expect(s.progress).toBe(1);
    expect(s.lastWorkedOn).toBeNull();
  });

  it("最後に作業した日は 1 日の区切りに沿う", () => {
    setDayStartHour(5);
    const f = computeForecast(b, prediction(b, 4 * 3600_000), schedule([], null), [], NOW);
    // 10/29 の 3 時は、区切りが 5 時なら 10/28 の作業
    const s = buildSnapshot(f, { ...extra, lastWorkedAt: new Date(2026, 9, 29, 3).getTime() }, []);
    expect(s.lastWorkedOn).toBe("2026-10-28");
  });
});

describe("shareUrl", () => {
  it("公開 ID を経路に、閲覧鍵をフラグメントに入れる", () => {
    const url = shareUrl({
      workId: 1,
      enabled: true,
      publishId: "a".repeat(32),
      writeKey: "w".repeat(32),
      readKey: "r".repeat(32),
      hide: [],
      lastSentAt: null,
      lastError: null,
      pendingDelete: false,
    });
    expect(url.endsWith(`/p/${"a".repeat(32)}#k=${"r".repeat(32)}`)).toBe(true);
    expect(url).not.toContain("w".repeat(32));
  });
});
