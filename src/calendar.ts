// 月の予定（仕様書 5.15）：残りのタスクを完成まで日ごとに割り振り、.ics に書き出す
import { addDays, Calendar, capacity, Candidate, MIN_STEP, ordered } from "./schedule";

const DAY_LIMIT = 3 * 365;
/** 「日をまたがないように」で、その日の残りを超えてもよい量（その日に割り振る時間に対する割合） */
const FIT_SLACK = 0.2;
/** 「日をまたがないように」で、収まるタスクが無いときに次のタスクを途中まで進める残りの量（同じく割合） */
const FIT_SPLIT = 0.5;

/** 進め方：ページごと / 工程ごと / 日をまたがないように */
export type MonthOrder = "page" | "stage" | "fit";

export type DayStep = {
  pageId: number;
  stageId: number;
  pageIndex: number;
  stageIndex: number;
  ms: number;
  /** その日には終わらない */
  partial: boolean;
  /** 前の日（または今日より前）からの続き */
  continued: boolean;
};

export type DayPlan = { date: Date; steps: DayStep[] };

export type MonthPlan = {
  days: DayPlan[];
  /** 割り振りが終わる日（タスクが無ければ null） */
  finish: Date | null;
  /** 期限内に割り振りきれなかった（作業時間が 0 など） */
  incomplete: boolean;
};

export type MonthInput = {
  /** 終わっていないタスクすべて（着手できないものも含む） */
  tasks: Candidate[];
  today: Date;
  cal: Calendar;
  /** 今日に割り振る時間（今日のノルマの残り） */
  todayMs: number;
  /** 明日以降、作業可能時間のうち使う割合（締切に合わせて割り振るときは 1 未満） */
  ratio: number;
  order: MonthOrder;
};

/**
 * 残りのタスクを日ごとに割り振る。ページ内では前の工程が終わってから次の工程に入る。
 * 1 日の時間は「その日までに割り振るはずの合計」で管理し、使い残し・使いすぎを翌日以降で調整する
 */
export function planMonth(input: MonthInput): MonthPlan {
  const { today, cal, order } = input;
  const left = new Map(input.tasks.map((t) => [key(t), t.remainingMs]));
  const started = new Set(input.tasks.filter((t) => t.inProgress).map(key));
  const open = new Set(input.tasks.filter((t) => t.remainingMs > 0).map(key));
  const byKey = new Map(input.tasks.map((t) => [key(t), t]));
  // 前の工程が終わっているか：同じページの 1 つ前の工程が残っていなければ着手できる
  const ready = () =>
    [...open]
      .map((k) => byKey.get(k)!)
      .filter((t) => !input.tasks.some((o) => o.pageId === t.pageId && o.stageIndex === t.stageIndex - 1 && open.has(key(o))));
  // 「日をまたがないように」も、選ぶ順は工程ごとの順を基本にする
  const sortOrder = order === "page" ? "page" : "stage";

  const days: DayPlan[] = [];
  let target = 0; // その日までに割り振るはずの合計
  let done = 0; // 実際に割り振った合計
  for (let i = 0; i < DAY_LIMIT && open.size > 0; i++) {
    const date = addDays(today, i);
    const budget = i === 0 ? Math.max(0, input.todayMs) : capacity(date, cal) * input.ratio;
    if (budget <= 0) continue;
    target += budget;
    const steps: DayStep[] = [];
    const take = (t: Candidate, want: number) => {
      const k = key(t);
      // 残りがわずかになるなら、翌日に回さずその日に終える
      const ms = left.get(k)! - want < MIN_STEP ? left.get(k)! : want;
      const rest = left.get(k)! - ms;
      left.set(k, rest);
      steps.push({
        pageId: t.pageId,
        stageId: t.stageId,
        pageIndex: t.pageIndex,
        stageIndex: t.stageIndex,
        ms,
        partial: rest > 0,
        continued: started.has(k),
      });
      started.add(k);
      if (rest <= 0) open.delete(k);
      done += ms;
    };
    while (open.size > 0) {
      const room = target - done;
      const list = ordered(
        ready().map((t) => ({ ...t, remainingMs: left.get(key(t))!, inProgress: started.has(key(t)) })),
        sortOrder,
      );
      if (order === "fit") {
        const whole = list.find((t) => t.remainingMs <= room + budget * FIT_SLACK);
        if (whole) take(whole, whole.remainingMs);
        else if (room > Math.max(budget * FIT_SPLIT, MIN_STEP)) take(list[0], room);
        else break;
      } else {
        if (room < MIN_STEP) break;
        take(list[0], Math.min(list[0].remainingMs, room));
      }
    }
    if (steps.length > 0) days.push({ date, steps });
  }
  return { days, finish: open.size === 0 && days.length > 0 ? days[days.length - 1].date : null, incomplete: open.size > 0 };
}

const key = (t: { pageId: number; stageId: number }) => `${t.pageId}-${t.stageId}`;

// ---------------------------------------------------------------------------
// 表示用の文：「下書き p9〜p11・ペン入れ p5」
// ---------------------------------------------------------------------------

export type DayWords = {
  /** ページの区切り（「、」） */
  sep: string;
  /** 工程の区切り（「・」） */
  groupSep: string;
  range: (from: string, to: string) => string;
  partial: (page: string) => string;
  continued: (page: string) => string;
  group: (stage: string, pages: string) => string;
};

export type StageGroup = { stageId: number; pages: string };

/** 1 日のタスクを工程ごとにまとめ、ページを並べる。同じ工程で 3 つ以上続くページは範囲にまとめる */
export function groupDay(steps: DayStep[], label: (pageId: number) => string, w: DayWords): StageGroup[] {
  const stages = [...new Set([...steps].sort((a, b) => a.stageIndex - b.stageIndex).map((s) => s.stageId))];
  return stages.map((stageId) => {
    const mine = steps.filter((s) => s.stageId === stageId).sort((a, b) => a.pageIndex - b.pageIndex);
    const parts: string[] = [];
    let run: DayStep[] = [];
    const flush = () => {
      if (run.length >= 3) parts.push(w.range(label(run[0].pageId), label(run[run.length - 1].pageId)));
      else parts.push(...run.map((s) => label(s.pageId)));
      run = [];
    };
    for (const s of mine) {
      if (s.partial || s.continued) {
        flush();
        parts.push(s.partial ? w.partial(label(s.pageId)) : w.continued(label(s.pageId)));
      } else {
        if (run.length > 0 && s.pageIndex !== run[run.length - 1].pageIndex + 1) flush();
        run.push(s);
      }
    }
    flush();
    return { stageId, pages: parts.join(w.sep) };
  });
}

// ---------------------------------------------------------------------------
// .ics（RFC 5545）
// ---------------------------------------------------------------------------

export type IcsEvent = { uid: string; date: Date; summary: string; description?: string; cancelled?: boolean };

/** 前回書き出した予定（UID と日付）。書き出し直したときに、無くなった予定を取り消すのに使う */
export type ExportedEvent = { uid: string; date: string };

/**
 * 前回は書き出したが今回は無い予定を、取り消しの予定にする。
 * 今日より前の日は取り消さない（その日の予定として残しておく）
 */
export function staleEvents(prev: ExportedEvent[], current: IcsEvent[], today: Date, summary: string): IcsEvent[] {
  const now = new Set(current.map((e) => e.uid));
  const todayKey = ymd(today);
  return prev
    .filter((e) => !now.has(e.uid) && e.date.replace(/-/g, "") >= todayKey)
    .map((e) => ({ uid: e.uid, date: new Date(`${e.date}T00:00`), summary, cancelled: true }));
}

/**
 * 終日の予定だけの .ics を作る。改行は CRLF、75 バイトを超える行は折り返す。
 * SEQUENCE は書き出した時刻（分）から作り、書き出し直すたびに大きくなるようにする（取り消しを確実に反映させるため）
 */
export function buildIcs(calName: string, events: IcsEvent[], now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const seq = Math.max(0, Math.floor((now.getTime() - Date.UTC(2026, 0, 1)) / 60_000));
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//tozicode.com//Otosazu//JA",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escape(calName)}`,
  ];
  for (const e of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${ymd(e.date)}`,
      `DTEND;VALUE=DATE:${ymd(addDays(e.date, 1))}`,
      `SEQUENCE:${seq}`,
      `SUMMARY:${escape(e.summary)}`,
    );
    if (e.cancelled) lines.push("STATUS:CANCELLED");
    if (e.description) lines.push(`DESCRIPTION:${escape(e.description)}`);
    lines.push("TRANSP:TRANSPARENT", "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

const ymd = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;

function escape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** 75 バイトごとに折り返す（続きの行は空白で始める）。文字の途中では切らない */
function fold(line: string): string {
  const enc = new TextEncoder();
  const out: string[] = [];
  let cur = "";
  let bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    const limit = out.length === 0 ? 75 : 74; // 続きの行は先頭の空白 1 バイトぶん短い
    if (bytes + n > limit) {
      out.push(cur);
      cur = "";
      bytes = 0;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}
