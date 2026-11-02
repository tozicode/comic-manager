import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Board, BoardPage, Prediction, TagGroup, WorkSchedule } from "./api";
import { aiText, AiInput, AiOptions } from "./ai";
import { computeForecast } from "./forecast";
import { setDayStartHour, setTimeFormat } from "./format";
import { setLang } from "./i18n";
import { HOUR } from "./schedule";

// forecast.ts が読み込む画面の仕組み（テーマなど）は window が要るので、使わない useApp だけの代わりを置く
vi.mock("./app-context", () => ({ useApp: () => null }));

// 2026/11/2 は月曜日。正午を「今」とする
const NOW = new Date(2026, 10, 2, 12).getTime();
const stages = [
  { id: 1, name: "下書き", color: "#6fa8dc" },
  { id: 2, name: "ペン入れ", color: "#e06666" },
];
const page = (id: number, label: string, span: number, cells: [boolean, number][], tags: number[] = []): BoardPage => ({
  id,
  fileName: `p${id}.clip`,
  path: "",
  label,
  number: id,
  span,
  half: 0,
  missing: false,
  found: true,
  tags,
  cells: cells.map(([done, totalMs], i) => ({ stageId: stages[i].id, done, doneAt: done ? NOW - HOUR : null, totalMs })),
  assignees: [],
});
const board: Board = {
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
  pages: [
    page(1, "p1", 1, [[true, 2 * HOUR], [true, 3 * HOUR]], [10]),
    page(2, "p2-3", 2, [[true, 4 * HOUR], [false, 70 * 60_000]], [10, 99]),
    page(4, "p4", 1, [[false, 0], [false, 0]]),
  ],
  collab: false,
};
const task = (pageId: number, stageId: number, done: boolean, remainingMs: number, spentMs = 0) => ({
  pageId,
  stageId,
  predictedMs: remainingMs + spentMs,
  spentMs,
  remainingMs,
  done,
});
const prediction: Prediction = {
  tasks: [
    task(1, 1, true, 0),
    task(1, 2, true, 0),
    task(2, 1, true, 0),
    task(2, 2, false, 2 * HOUR, 70 * 60_000),
    task(4, 1, false, 2 * HOUR),
    task(4, 2, false, 3 * HOUR),
  ],
  remainingMs: 7 * HOUR,
  lowMs: 5 * HOUR,
  highMs: 10 * HOUR,
  sigma: 0.3,
  stages: [
    { stageId: 1, baseMs: 2 * HOUR, samples: 2, fromHint: false },
    { stageId: 2, baseMs: 3 * HOUR, samples: 0, fromHint: true },
  ],
};
const schedule: WorkSchedule = {
  weekdayHours: [3, 3, 3, 3, 3, 6, 0],
  customHours: false,
  defaultWeekdayHours: [3, 3, 3, 3, 3, 6, 0],
  deadlines: [
    { id: 1, name: "早割", date: "2026-11-01" },
    { id: 2, name: "", date: "2026-11-06" },
  ],
  selectedDeadline: null,
  workOrder: "stage",
  daysOff: ["2026-11-03", "2027-03-01"],
};
const tags: TagGroup[] = [
  {
    id: 1,
    name: "コマ数",
    exclusive: true,
    setIds: [],
    system: false,
    tags: [
      { id: 10, groupId: 1, name: "コマ多", initialFactor: 1.3, system: false, hidden: false },
      { id: 11, groupId: 1, name: "コマ少", initialFactor: 0.8, system: false, hidden: false },
    ],
  },
  {
    id: 2,
    name: "見開き",
    exclusive: false,
    setIds: [],
    system: true,
    tags: [{ id: 99, groupId: 2, name: "見開き", initialFactor: 2, system: true, hidden: false }],
  },
];

const input = (): AiInput => {
  // 今日 1 時間、昨日 2 時間作業した
  const spans = [
    { workId: 1, startedAt: NOW - HOUR, endedAt: NOW, stageName: "" },
    { workId: 1, startedAt: NOW - 24 * HOUR, endedAt: NOW - 22 * HOUR, stageName: "" },
  ];
  return {
    forecast: computeForecast(board, prediction, schedule, spans, NOW),
    tags,
    fits: [{ tagId: 10, factor: 1.456, observed: 1.5, samples: 3 }],
    allDailyMs: () => 5 * HOUR,
    dayStartHour: 0,
  };
};
const opts = (over: Partial<AiOptions> = {}): AiOptions => ({ purpose: "deadline", hideTitle: false, pages: true, ...over });

describe("aiText", () => {
  beforeEach(() => {
    setLang("ja");
    // 表記の設定によらず「時間・分」で書くことを確かめる
    setTimeFormat("decimal");
    setDayStartHour(0);
  });
  afterEach(() => {
    setLang("ja");
    setTimeFormat("hm");
  });

  it("作品・締切・予測・工程を書く", () => {
    const text = aiText(input(), opts());
    expect(text).toContain("# 漫画制作の進み具合");
    expect(text).toContain("今日：11/2（月）");
    expect(text).toContain("- 作品名：冬の新刊");
    expect(text).toContain("- 種類：漫画（全 4 ページ）");
    expect(text).toContain("曜日ごとの作業時間：月 3時間、火 3時間、水 3時間、木 3時間、金 3時間、土 6時間、日 0分");
    // 8 週間より先の休みは出さない
    expect(text).toContain("これから 8 週間の休みの日：11/3（火）\n");
    // 過ぎた締切は出さず、名前の無い締切は「締切」
    expect(text).not.toContain("早割");
    expect(text).toContain("- 締切：11/6（金）（今日を含めてあと 5 日） ← 今の計算に使っている締切");
    expect(text).toContain("残りの作業時間：少なめ 5時間 ／ 標準 7時間 ／ 多め 10時間");
    expect(text).toContain("| ペン入れ | 1 / 4 | 4時間10分 | 3時間（実績が無いので設定の目安） | 5時間 |");
    expect(text).toContain("| 下書き | 3 / 4 | 6時間 | 2時間（2 件の実績から） | 2時間 |");
    expect(text).not.toContain("1 日の区切り");
  });

  it("タグは付いている行の数（見開きは 2）と、学習した倍率（無ければ初期倍率）", () => {
    const text = aiText(input(), opts());
    expect(text).toContain("| コマ多 | ×1.46 | 3 |");
    expect(text).toContain("| 見開き | ×2.0 | 2 |");
    expect(text).not.toContain("コマ少");
  });

  it("最近の作業はこの作品と全作品を日ごとに並べる", () => {
    const text = aiText(input(), opts());
    expect(text).toContain("## 最近の作業（直近 14 日）");
    expect(text).toContain("| 11/2（月） | 1時間 | 5時間 |");
    expect(text).toContain("| 11/1（日） | 2時間 | 5時間 |");
    expect(text).toContain("| 10/20（火） | 0分 | 5時間 |");
    expect(text).not.toContain("10/19（月）");
  });

  it("ページごとの状態は言葉で書き、外せる", () => {
    const text = aiText(input(), opts());
    expect(text).toContain("| ページ | タグ | 下書き | ペン入れ |");
    expect(text).toContain("| p2-3（見開き） | コマ多、見開き | 完了 | 作業中（ここまで 1時間10分） |");
    expect(text).toContain("| p4 | - | 未着手 | 未着手 |");
    expect(aiText(input(), opts({ pages: false }))).not.toContain("## ページごとの状態");
  });

  it("作品名を伏せる", () => {
    const text = aiText(input(), opts({ hideTitle: true }));
    expect(text).toContain("- 作品名：作品A");
    expect(text).not.toContain("冬の新刊");
  });

  it("目的によって末尾の問いかけを変え、今日の作業を決めるときは案も載せる", () => {
    const deadline = aiText(input(), opts());
    expect(deadline).toMatch(/## 相談したいこと\n\n締切に間に合うかどうか.+\n\n数字はこの文にあるもの.+\n$/);
    expect(deadline).not.toContain("今日のやることの案");

    const today = aiText(input(), opts({ purpose: "today" }));
    expect(today).toContain("## 今日のやることの案（アプリが出したもの）");
    expect(today).toMatch(/- おすすめ：p4 下書き .+/);

    expect(aiText(input(), opts({ purpose: "free" }))).toContain("（ここに相談したいことを書いてください）");
  });

  it("1 日の区切りが 0 時でなければ前置きに書く", () => {
    expect(aiText({ ...input(), dayStartHour: 5 }, opts())).toContain("1 日の区切りは 5 時です");
  });

  it("英語でも書ける", () => {
    setLang("en");
    const text = aiText(input(), opts());
    expect(text).toContain("# Comic production progress");
    expect(text).toContain("- Type: comic (4 pages in total)");
    expect(text).toContain("- Deadline: Fri 11/6 (5 days left, including today)");
    expect(text).toContain("Please use the numbers in this text.");
  });
});
