import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Board, BoardPage } from "./api";
import { setTimeFormat } from "./format";
import { setLang } from "./i18n";
import { gridLayout, postText, shareData } from "./share";
import type { ShareInfo } from "./share-draw";

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

describe("postText", () => {
  beforeEach(() => {
    setLang("ja");
    setTimeFormat("hm");
  });
  afterEach(() => setLang("ja"));

  const b = board([page(1, 1, [[true, DAY + 1], [true, DAY + 1]]), page(2, 1, [[true, DAY + 1], [false, null]])]);
  const data = shareData(b, [], DAY);
  const info = (over: Partial<ShareInfo> = {}): ShareInfo => ({
    title: "冬の新刊",
    today: new Date(DAY),
    workedMs: (3 * 60 + 25) * 60_000,
    quotaMs: 0,
    quotaMet: false,
    finish: new Date(2026, 10, 10),
    completed: false,
    row: b.work,
    ...over,
  });

  it("作業時間と、工程ごとに進めた数を文にする", () => {
    expect(postText(data, info())).toBe(
      "「冬の新刊」今日は3時間25分作業して、下書きを2ページ、ペン入れを1ページ進めました。全体の進み具合は75%です。完成見込みは11/10（火）です。 #Otosazu",
    );
  });

  it("隠した項目は文面にも入れない", () => {
    expect(postText(data, info({ title: null, workedMs: null, finish: null }))).toBe(
      "今日は下書きを2ページ、ペン入れを1ページ進めました。全体の進み具合は75%です。 #Otosazu",
    );
  });

  it("今日まだ何も終えていなくても、進み具合は伝える", () => {
    const none = shareData(b, [], DAY + 10);
    expect(postText(none, info({ title: null, workedMs: 0, finish: null }))).toBe("全体の進み具合は75%です。 #Otosazu");
  });

  it("英語では文の間に空白を入れる", () => {
    setLang("en");
    expect(postText(data, info({ title: null, finish: null }))).toBe(
      "Worked 3h 25m today and finished 下書き (2 p), ペン入れ (1 p). Overall progress: 75%. #Otosazu",
    );
  });
});
