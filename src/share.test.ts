import { describe, expect, it } from "vitest";
import type { Board, BoardPage } from "./api";
import { gridLayout, shareData } from "./share";

const DAY = new Date(2026, 9, 29).getTime();
const stages = [
  { id: 1, name: "下書き", color: "#6fa8dc" },
  { id: 2, name: "ペン入れ", color: "#e06666" },
];
const page = (id: number, span: number, cells: [boolean, number | null][], missing = false): BoardPage => ({
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
  cells: cells.map(([done, doneAt], i) => ({ stageId: stages[i].id, done, doneAt, totalMs: 0 })),
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

describe("shareData", () => {
  it("マスをこれまで・今日・手を付けた・未着手に分ける", () => {
    const b = board([
      page(1, 1, [[true, DAY - 1000], [true, DAY + 1000]]),
      page(2, 2, [[true, DAY + 5000], [false, null]]),
      page(3, 1, [[false, null], [false, null]]),
      page(4, 1, [[true, DAY]], true),
    ]);
    const sessions = [
      { pageId: 2, stageId: 2, startedAt: DAY + 100, endedAt: DAY + 200 },
      // 昨日のうちに終わった記録は数えない
      { pageId: 3, stageId: 1, startedAt: DAY - 500, endedAt: DAY - 100 },
      // 計測中（終わっていない）は今日手を付けたもの
      { pageId: 3, stageId: 2, startedAt: DAY + 300, endedAt: null },
    ];
    const d = shareData(b, sessions, DAY);
    expect(d.rows).toEqual([
      ["before", "today"],
      ["today", "touched"],
      ["open", "touched"],
    ]);
    // 見開きは 2 ページ分。全体は (1+2+1) × 2 工程 = 8
    expect(d.doneToday.map((x) => [x.stage.id, x.count])).toEqual([
      [1, 2],
      [2, 1],
    ]);
    expect(d.progress).toBeCloseTo(4 / 8);
    expect(d.todayProgress).toBeCloseTo(3 / 8);
  });

  it("行が無ければ進み具合は 0", () => {
    const d = shareData(board([]), [], DAY);
    expect([d.progress, d.todayProgress, d.doneToday.length]).toEqual([0, 0, 0]);
  });
});

describe("gridLayout", () => {
  it("横長に収まるなら 1 段に並べる", () => {
    const g = gridLayout(16, 3, 640, 150);
    expect([g.bands, g.cols]).toEqual([1, 16]);
    expect(g.cell).toBe(40);
  });
  it("多ければ段に折り返してマスを大きくする", () => {
    const g = gridLayout(64, 3, 640, 400);
    expect(g.bands).toBeGreaterThan(1);
    expect(g.cols * g.bands).toBeGreaterThanOrEqual(64);
    expect(g.cell).toBeGreaterThan(640 / 64);
  });
});
