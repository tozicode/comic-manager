import { describe, expect, it } from "vitest";
import { buildIcs, DayWords, groupDay, planMonth, MonthOrder, staleEvents } from "./calendar";
import { dayKey } from "./format";
import { Calendar, Candidate, HOUR } from "./schedule";

// 2026/10/19 は月曜日
const MON = new Date(2026, 9, 19);
const EVERY3: Calendar = { weekdayHours: [3, 3, 3, 3, 3, 3, 3], daysOff: [] };

/** pages 枚 × stages 工程のタスク（ページ id = 1.., 工程 id = 101..） */
function tasks(pages: number, stageHours: number[]): Candidate[] {
  const out: Candidate[] = [];
  for (let p = 0; p < pages; p++)
    stageHours.forEach((h, s) =>
      out.push({ pageId: p + 1, stageId: 101 + s, pageIndex: p, stageIndex: s, remainingMs: h * HOUR, inProgress: false }),
    );
  return out;
}

const plan = (ts: Candidate[], order: MonthOrder, cal = EVERY3, todayMs = 3 * HOUR, ratio = 1) =>
  planMonth({ tasks: ts, today: MON, cal, todayMs, ratio, order });

/** 日ごとの「ページ:工程」の並び */
const names = (p: ReturnType<typeof plan>) =>
  p.days.map((d) => d.steps.map((s) => `${s.pageId}:${s.stageId - 100}${s.partial ? "~" : ""}`).join(" "));

describe("planMonth", () => {
  it("工程ごと：全ページの 1 つめの工程を先に進める", () => {
    const p = plan(tasks(3, [1, 1]), "stage");
    expect(names(p)).toEqual(["1:1 2:1 3:1", "1:2 2:2 3:2"]);
    expect(dayKey(p.finish!)).toBe("2026-10-20");
  });

  it("ページごと：1 ページを全工程終えてから次のページ", () => {
    expect(names(plan(tasks(3, [1, 1]), "page"))).toEqual(["1:1 1:2 2:1", "2:2 3:1 3:2"]);
  });

  it("日をまたぐタスクは途中までと続きに分かれる", () => {
    const p = plan(tasks(2, [2]), "stage");
    expect(names(p)).toEqual(["1:1 2:1~", "2:1"]);
    expect(p.days[1].steps[0].continued).toBe(true);
  });

  it("日をまたがないように：収まるタスクを選び、少しの残りは翌日へ回す", () => {
    // 2h のタスクが 3 つ。3h の日に 2h を入れると残り 1h で、2h のタスクは収まらないので翌日へ回す。
    // 翌日は回した 1h を足した 4h になり、2 つ収まる（完成日は工程ごとと同じ）
    const p = plan(tasks(3, [2]), "fit");
    expect(names(p)).toEqual(["1:1", "2:1 3:1"]);
    expect(p.days.every((d) => d.steps.every((s) => !s.partial))).toBe(true);
  });

  it("日をまたがないように：残りが多ければ大きいタスクを途中まで進める", () => {
    const p = plan(tasks(1, [7]), "fit");
    expect(names(p)).toEqual(["1:1~", "1:1~", "1:1"]);
  });

  it("日をまたがないように：前の工程の順を守ったうえで、収まるものを先に入れる", () => {
    // p1 下書き 2h → p1 ペン入れ 1h、p2 下書き 2h。3h の日に p1 の下書きとペン入れが収まる
    const ts = tasks(2, [2, 1]);
    expect(names(plan(ts, "fit"))[0]).toBe("1:1 1:2");
  });

  it("わずかな残りは翌日に回さず、その日に終える", () => {
    const p = plan(tasks(1, [3 + 2 / 60]), "stage");
    expect(names(p)).toEqual(["1:1"]);
  });

  it("休みの日と作業時間 0 の日には割り振らない", () => {
    const cal: Calendar = { weekdayHours: [3, 0, 3, 3, 3, 3, 3], daysOff: ["2026-10-21"] };
    const p = plan(tasks(3, [3]), "stage", cal);
    expect(p.days.map((d) => dayKey(d.date))).toEqual(["2026-10-19", "2026-10-22", "2026-10-23"]);
  });

  it("今日はノルマの残りだけ、明日以降は割合ぶんだけ使う", () => {
    const p = plan(tasks(4, [1]), "stage", EVERY3, 1 * HOUR, 0.5);
    expect(names(p)).toEqual(["1:1", "2:1 3:1~", "3:1 4:1"]);
  });

  it("作業時間が無ければ割り振りきれない", () => {
    const p = plan(tasks(1, [1]), "stage", { weekdayHours: [0, 0, 0, 0, 0, 0, 0], daysOff: [] }, 0);
    expect(p.incomplete).toBe(true);
    expect(p.finish).toBeNull();
  });

  it("途中まで進めたタスクは最初から続き扱い", () => {
    const ts = tasks(1, [1]);
    ts[0].inProgress = true;
    expect(plan(ts, "stage").days[0].steps[0].continued).toBe(true);
  });
});

const W: DayWords = {
  sep: "、",
  groupSep: "・",
  range: (a, b) => `${a}〜${b}`,
  partial: (p) => `${p}（途中まで）`,
  continued: (p) => `${p}（続き）`,
  group: (s, p) => `${s} ${p}`,
};

describe("groupDay", () => {
  const step = (pageIndex: number, stageIndex: number, extra: { partial?: boolean; continued?: boolean } = {}) => ({
    pageId: pageIndex + 1,
    stageId: 101 + stageIndex,
    pageIndex,
    stageIndex,
    ms: HOUR,
    partial: false,
    continued: false,
    ...extra,
  });
  const label = (id: number) => `p${id}`;

  it("3 つ以上続くページは範囲にまとめ、工程の順に並べる", () => {
    const g = groupDay([step(4, 1), step(0, 0), step(1, 0), step(2, 0), step(5, 1)], label, W);
    expect(g).toEqual([
      { stageId: 101, pages: "p1〜p3" },
      { stageId: 102, pages: "p5、p6" },
    ]);
  });

  it("名前の行は範囲にまとめず並べる", () => {
    const names = ["頭", "胴", "右腕", "左腕"];
    const g = groupDay([step(0, 0), step(1, 0), step(2, 0), step(3, 0)], (id) => names[id - 1], W);
    expect(g[0].pages).toBe("頭、胴、右腕、左腕");
    // 番号だけの行は数字でまとめる
    const h = groupDay([step(0, 0), step(1, 0), step(2, 0)], (id) => String(id), W);
    expect(h[0].pages).toBe("1〜3");
  });

  it("途中まで・続きはまとめずに印を付ける", () => {
    const g = groupDay([step(6, 0, { continued: true }), step(7, 0), step(8, 0), step(9, 0), step(10, 0, { partial: true })], label, W);
    expect(g[0].pages).toBe("p7（続き）、p8〜p10、p11（途中まで）");
  });
});

describe("buildIcs", () => {
  it("終日の予定を CRLF で書き、記号を逃がし、長い行は折り返す", () => {
    const ics = buildIcs(
      "Otosazu",
      [{ uid: "a@otosazu", date: new Date(2026, 9, 31), summary: "下書き p1、p2; 続き", description: "1行目\n" + "あ".repeat(40) }],
      new Date(Date.UTC(2026, 9, 24, 3, 4, 5)),
    );
    expect(ics).toContain("\r\nDTSTART;VALUE=DATE:20261031\r\n");
    expect(ics).toContain("\r\nDTEND;VALUE=DATE:20261101\r\n");
    expect(ics).toContain("\r\nDTSTAMP:20261024T030405Z\r\n");
    expect(ics).toContain("SUMMARY:下書き p1、p2\\; 続き");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    const enc = new TextEncoder();
    for (const line of ics.split("\r\n")) expect(enc.encode(line).length).toBeLessThanOrEqual(75);
    // 折り返しを戻すと元の文になる
    expect(ics.replace(/\r\n /g, "")).toContain(`DESCRIPTION:1行目\\n${"あ".repeat(40)}`);
  });
});

describe("取り消し", () => {
  it("前回あって今回無い、今日以降の予定だけを取り消す", () => {
    const prev = [
      { uid: "2026-10-18-w1@otosazu", date: "2026-10-18" },
      { uid: "2026-10-20-w1@otosazu", date: "2026-10-20" },
      { uid: "2026-10-21-w1@otosazu", date: "2026-10-21" },
      { uid: "finish-w1@otosazu", date: "2026-10-21" },
    ];
    const current = [
      { uid: "2026-10-20-w1@otosazu", date: new Date(2026, 9, 20), summary: "a" },
      { uid: "finish-w1@otosazu", date: new Date(2026, 9, 20), summary: "b" },
    ];
    const stale = staleEvents(prev, current, MON, "（取り消し）");
    expect(stale.map((e) => e.uid)).toEqual(["2026-10-21-w1@otosazu"]);
    expect(stale[0].cancelled).toBe(true);
  });

  it("取り消しの予定には STATUS:CANCELLED を付け、SEQUENCE は書き出すたびに大きくなる", () => {
    const ev = [{ uid: "x@otosazu", date: MON, summary: "s", cancelled: true }];
    const a = buildIcs("c", ev, new Date(Date.UTC(2026, 9, 24, 0, 0)));
    const b = buildIcs("c", ev, new Date(Date.UTC(2026, 9, 24, 0, 5)));
    expect(a).toContain("\r\nSTATUS:CANCELLED\r\n");
    const seq = (s: string) => Number(/SEQUENCE:(\d+)/.exec(s)![1]);
    expect(seq(b)).toBeGreaterThan(seq(a));
  });
});
