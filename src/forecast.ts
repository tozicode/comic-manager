// 作品の予測・スケジュールをまとめて読み込み、画面で使う形に計算するフック。
// 完成見込み・確率・ノルマ・月の予定は、全作品を 1 つの時間割に敷いた結果（timetable.ts、仕様書 5.24）から出す
import { useEffect, useState } from "react";
import { api, Board, cellPassed, Prediction, Span, TaskPrediction, TimetableWorkInput, WorkSchedule } from "./api";
import { useApp } from "./app-context";
import type { ExportedEvent, MonthInput, MonthOrder } from "./calendar";
import { dailyTotals, dayKey, dayStartMs, startOfDay } from "./format";
import {
  addDays,
  buildPlans,
  Calendar,
  Candidate,
  catchUpNotice,
  deadlinePlan,
  DeadlinePlan,
  finishDateAtPace,
  MIN_STEP,
  onTimeProbability,
  pickDeadline,
  Plan,
  PlanStep,
  StageInfo,
} from "./schedule";
import { buildTimetable, TimetableWork, WorkShare } from "./timetable";

const PACE_DAYS = 28;

export type DeadlineStatus = "ok" | "tight" | "late";

/** 締切ごとの見込み（5.19）。name が空なら画面では「締切」と出す */
export type DeadlineView = {
  id: number;
  name: string;
  date: Date;
  plan: DeadlinePlan;
  probability: number;
  status: DeadlineStatus;
  /** この締切を選んだときに、締切までに配りきれない時間（0 なら収まる。5.24） */
  shortMs: number;
};

export type Forecast = {
  board: Board;
  prediction: Prediction;
  schedule: WorkSchedule;
  cal: Calendar;
  today: Date;
  /** この作品で今日作業した時間 */
  workedTodayMs: number;
  /** この作品の最近 4 週間の 1 日あたりの作業時間 */
  paceMs: number;
  /** その日にこの作品で作業した時間（直近 4 週間ぶん） */
  dailyMs: (d: Date) => number;
  finish: { low: Date | null; mid: Date | null; high: Date | null; pace: Date | null };
  /** 今日以降の締切すべて（日付順） */
  deadlines: DeadlineView[];
  /** 計算に使っている締切（選んでいるもの。過ぎていれば次の締切） */
  deadline: DeadlineView | null;
  /** 今日のノルマ（時間割のこの作品の今日の取り分。締切があれば逆算、無ければほかの作品のあとに残る時間） */
  quotaMs: number;
  /** 案を作るときの時間：今日の残りのノルマ。達成済みなら「もう少し進める」ぶんとしてノルマ 1 日ぶん */
  planQuotaMs: number;
  /** 今日のノルマを達成している */
  quotaMet: boolean;
  /** 着手できるタスク（ページ内で前の工程が完了しているもの） */
  candidates: Candidate[];
  /** 終わっていないタスクすべて（月の予定を割り振るときに使う） */
  openTasks: Candidate[];
  /** 共同作業のメンバーが担当していて、まだ完了していないマスの数（予測に含めない。5.23） */
  assignedCount: number;
  plans: Plan[];
  notice: string | null;
  task: (pageId: number, stageId: number) => TaskPrediction | undefined;
  /** 時間割でのこの作品の取り分（5.24） */
  share: WorkShare;
  /** 時間割に入っている作品（この作品を含む。締切順ではなく入力の順） */
  timetable: TimetableWork[];
};

// ---------------------------------------------------------------------------
// 時間割の入力（全作品ぶん）。作品一覧はカードごとに useForecast を呼ぶので、同じ版（app.version）なら
// 1 回しか読まないよう、最後の読み込みを窓ごとに覚えておく
// ---------------------------------------------------------------------------

let inputCache: { version: number; promise: Promise<TimetableWorkInput[]> } | null = null;

function loadTimetableInput(version: number): Promise<TimetableWorkInput[]> {
  if (!inputCache || inputCache.version !== version) {
    const promise = api.getTimetableInput();
    inputCache = { version, promise };
    // 読めなかったら次に呼ばれたときに読み直す
    promise.catch(() => {
      if (inputCache?.promise === promise) inputCache = null;
    });
  }
  return inputCache.promise;
}

/** 時間割の入力を、計算に使う締切と今日の作業時間を添えた形にする */
function toTimetableWork(w: TimetableWorkInput, allSpans: Span[], today: Date, now: number): TimetableWork {
  const picked = pickDeadline(w.deadlines, w.selectedDeadline, dayKey(today));
  const totals = dailyTotals(
    allSpans.filter((s) => s.workId === w.workId),
    now,
  );
  return {
    workId: w.workId,
    title: w.title,
    remainingMs: w.remainingMs,
    lowMs: w.lowMs,
    highMs: w.highMs,
    sigma: w.sigma,
    deadline: picked ? new Date(`${picked.date}T00:00`) : null,
    workedTodayMs: totals.get(dayKey(today))?.total ?? 0,
  };
}

/** 全作品の時間割（作品一覧の警告の 1 行とこれからの締切に使う）。読み込み中は null */
export function useTimetable(): {
  works: TimetableWork[];
  shares: Map<number, WorkShare>;
  today: Date;
  /** これからの締切（未完成の作品の今日以降の締切すべて。5.26） */
  upcoming: UpcomingDeadline[];
} | null {
  const app = useApp();
  const [data, setData] = useState<{ input: TimetableWorkInput[]; spans: Span[]; cal: Calendar } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const today = startOfDay(Date.now());
    Promise.all([loadTimetableInput(app.version), api.listSpans(dayStartMs(today)), api.getCalendar()])
      .then(([input, spans, [weekdayHours, daysOff]]) => !cancelled && setData({ input, spans, cal: { weekdayHours, daysOff } }))
      .catch(app.showError);
    return () => {
      cancelled = true;
    };
  }, [app.version, app.showError]);

  if (!data) return null;
  const now = Date.now();
  const today = startOfDay(now);
  const works = data.input.map((w) => toTimetableWork(w, data.spans, today, now));
  const shares = buildTimetable(works, today, data.cal);
  return { works, shares, today, upcoming: upcomingDeadlines(data.input, works, shares, today, data.cal) };
}

/** 締切の状況：いっぱいの組み方の完成見込みが締切までに収まるか（多めの見込みまで収まれば ok） */
function deadlineStatus(s: WorkShare, date: Date): DeadlineStatus {
  return s.finish.mid && s.finish.mid <= date ? (s.finish.high && s.finish.high <= date ? "ok" : "tight") : "late";
}

/** これからの締切の 1 行（5.26） */
export type UpcomingDeadline = {
  workId: number;
  title: string;
  id: number;
  /** 空なら画面では「締切」と出す */
  name: string;
  date: Date;
  status: DeadlineStatus;
  /** 計算に使っている締切（5.19） */
  picked: boolean;
};

/**
 * 純粋関数。残りのある作品の今日以降の締切を日付の順に並べる。input と works は同じ並び。
 * 状況は、計算に使っている締切なら時間割そのもの、ほかの締切はその作品の締切をその日に差し替えて組み直した結果（computeForecast と同じ）
 */
export function upcomingDeadlines(
  input: TimetableWorkInput[],
  works: TimetableWork[],
  shares: Map<number, WorkShare>,
  today: Date,
  cal: Calendar,
): UpcomingDeadline[] {
  const todayKey = dayKey(today);
  const rows: UpcomingDeadline[] = [];
  input.forEach((w, i) => {
    if (w.remainingMs <= 0) return;
    const picked = pickDeadline(w.deadlines, w.selectedDeadline, todayKey);
    for (const d of w.deadlines) {
      if (d.date < todayKey) continue;
      const date = new Date(`${d.date}T00:00`);
      const s =
        d.id === picked?.id
          ? shares.get(w.workId)!
          : buildTimetable(works.map((x, j) => (j === i ? { ...x, deadline: date } : x)), today, cal).get(w.workId)!;
      rows.push({ workId: w.workId, title: w.title, id: d.id, name: d.name, date, status: deadlineStatus(s, date), picked: d.id === picked?.id });
    }
  });
  return rows.sort((a, b) => a.date.getTime() - b.date.getTime() || a.title.localeCompare(b.title));
}

/**
 * 予測に必要なデータを読み込み、計算する。データが変わるたびに読み直す。
 * hoursOverride を渡すと、保存前の曜日ごとの作業時間で計算する（スライダー操作中など）
 */
export function useForecast(workId: number | null, hoursOverride?: number[] | null): Forecast | null {
  const app = useApp();
  const [data, setData] = useState<{
    board: Board;
    prediction: Prediction;
    schedule: WorkSchedule;
    spans: Span[];
    timetable: TimetableWorkInput[];
  } | null>(null);

  useEffect(() => {
    if (!workId) {
      setData(null);
      return;
    }
    let cancelled = false;
    const from = dayStartMs(addDays(startOfDay(Date.now()), -PACE_DAYS));
    Promise.all([
      api.getBoard(workId),
      api.getPrediction(workId),
      api.getSchedule(workId),
      api.listSpans(from),
      loadTimetableInput(app.version),
    ])
      .then(
        ([board, prediction, schedule, spans, timetable]) =>
          !cancelled && setData({ board, prediction, schedule, spans, timetable }),
      )
      .catch(app.showError);
    return () => {
      cancelled = true;
    };
  }, [workId, app.version, app.showError]);

  if (!data || !workId || data.board.work.id !== workId) return null;
  const cal = hoursOverride ? { weekdayHours: hoursOverride, daysOff: data.schedule.daysOff } : undefined;
  return computeForecast(data.board, data.prediction, data.schedule, data.spans, Date.now(), cal, data.timetable);
}

/**
 * 純粋関数。timetable は全作品の時間割の入力（無ければこの作品だけで組む = 3.1.0 までと同じ結果）。
 * この作品のぶんは、いま読んだ盤面と予測から作り直す（時間割の入力と読んだ時刻がずれても、この作品の数字は食い違わない）
 */
export function computeForecast(
  board: Board,
  prediction: Prediction,
  schedule: WorkSchedule,
  allSpans: Span[],
  now: number,
  calOverride?: Calendar,
  timetable: TimetableWorkInput[] = [],
): Forecast {
  const cal = calOverride ?? { weekdayHours: schedule.weekdayHours, daysOff: schedule.daysOff };
  const today = startOfDay(now);
  const spans = allSpans.filter((s) => s.workId === board.work.id);
  const totals = dailyTotals(spans, now);
  const workedTodayMs = totals.get(dayKey(today))?.total ?? 0;
  let pastMs = 0;
  for (let i = 1; i <= PACE_DAYS; i++) pastMs += totals.get(dayKey(addDays(today, -i)))?.total ?? 0;
  const paceMs = pastMs / PACE_DAYS;

  // 時間割（5.24）
  const self: TimetableWorkInput = {
    workId: board.work.id,
    title: board.work.title,
    remainingMs: prediction.remainingMs,
    lowMs: prediction.lowMs,
    highMs: prediction.highMs,
    sigma: prediction.sigma,
    deadlines: schedule.deadlines,
    selectedDeadline: schedule.selectedDeadline,
  };
  const works = [self, ...timetable.filter((w) => w.workId !== board.work.id)].map((w) => toTimetableWork(w, allSpans, today, now));
  const share = buildTimetable(works, today, cal).get(board.work.id)!;
  const picked = pickDeadline(schedule.deadlines, schedule.selectedDeadline, dayKey(today));

  const finish = {
    ...share.finish,
    pace: paceMs > 0 ? finishDateAtPace(prediction.remainingMs, today, paceMs) : null,
  };

  const deadlines = schedule.deadlines
    .filter((d) => d.date >= dayKey(today))
    .map((d): DeadlineView => {
      const date = new Date(`${d.date}T00:00`);
      // 1 日あたりの必要時間は、この作品だけで割った数字のまま（5.24）
      const plan = deadlinePlan(prediction.remainingMs, prediction.highMs, today, date, workedTodayMs, cal);
      // 選んでいない締切は、この作品の締切をその日に差し替えて時間割を組み直した結果で見る（別の締切なら収まるか）
      const s = d.id === picked?.id ? share : buildTimetable(works.map((w, i) => (i === 0 ? { ...w, deadline: date } : w)), today, cal).get(board.work.id)!;
      // 確率の分母は、締切までにこの作品が使えた器（ほかの作品が先に取るぶんを除く）。今日の作業済みぶんは除く
      const capacityLeft = Math.max(0, s.availableUntil(date) - Math.max(workedTodayMs, 0));
      const probability = onTimeProbability(prediction.remainingMs, prediction.sigma, capacityLeft);
      const status = deadlineStatus(s, date);
      return { id: d.id, name: d.name, date, plan, probability, status, shortMs: s.shortMs };
    });
  const deadline = deadlines.find((d) => d.id === picked?.id) ?? null;
  const quotaMs = share.todayMs;
  const leftMs = quotaMs - workedTodayMs;
  const quotaMet = leftMs < MIN_STEP;
  const planQuotaMs = quotaMet ? quotaMs : leftMs;

  // 着手できるタスク
  const task = (pageId: number, stageId: number) =>
    prediction.tasks.find((t) => t.pageId === pageId && t.stageId === stageId);
  const pages = board.pages.filter((p) => !p.missing);
  const candidates: Candidate[] = [];
  const openTasks: Candidate[] = [];
  pages.forEach((page, pageIndex) => {
    board.stages.forEach((stage, stageIndex) => {
      const t = task(page.id, stage.id);
      // メンバー担当のマスは、その人が描くので作家のやることには入れない（5.23）。対象外のマスも入れない
      if (!t || t.done || t.assigned || t.excluded) return;
      const c = { pageId: page.id, stageId: stage.id, pageIndex, stageIndex, remainingMs: t.remainingMs, inProgress: t.spentMs > 0 };
      openTasks.push(c);
      // 前の工程が対象外なら、終わったものとして飛ばす
      if (stageIndex > 0 && !cellPassed(page.cells[stageIndex - 1])) return;
      candidates.push(c);
    });
  });
  const stageInfos: StageInfo[] = board.stages.map((s) => ({
    id: s.id,
    name: s.name,
    openMs: prediction.tasks.filter((t) => t.stageId === s.id && !t.done && !t.assigned && !t.excluded).reduce((n, t) => n + t.remainingMs, 0),
  }));
  const assigned = (page: Board["pages"][number], stageId: number) => page.assignees.some((a) => a.stageIds.includes(stageId));
  const openCounts = board.stages.map((s, i) => pages.filter((p) => !cellPassed(p.cells[i]) && !assigned(p, s.id)).length);
  const assignedCount = prediction.tasks.filter((t) => t.assigned && !t.done && !t.excluded).length;

  return {
    board,
    prediction,
    schedule,
    cal,
    today,
    workedTodayMs,
    paceMs,
    dailyMs: (d: Date) => totals.get(dayKey(d))?.total ?? 0,
    finish,
    deadlines,
    deadline,
    quotaMs,
    planQuotaMs,
    quotaMet,
    candidates,
    openTasks,
    assignedCount,
    plans: buildPlans(candidates, stageInfos, planQuotaMs, schedule.workOrder, board.work),
    notice: catchUpNotice(candidates, stageInfos, openCounts, board.work),
    task,
    share,
    timetable: works,
  };
}

// ---------------------------------------------------------------------------
// 今日選んだ案（日付が変わったら無効）
// ---------------------------------------------------------------------------

export type ChosenPlan = { date: string; key: string; name: string; quotaMs: number; steps: PlanStep[] };

const planKey = (workId: number) => `otosazu.plan.${workId}`;

export function loadChosenPlan(workId: number): ChosenPlan | null {
  try {
    const raw = localStorage.getItem(planKey(workId));
    const plan = raw ? (JSON.parse(raw) as ChosenPlan) : null;
    return plan && plan.date === dayKey(startOfDay(Date.now())) ? plan : null;
  } catch {
    return null;
  }
}

export function saveChosenPlan(workId: number, plan: ChosenPlan | null) {
  try {
    if (plan) localStorage.setItem(planKey(workId), JSON.stringify(plan));
    else localStorage.removeItem(planKey(workId));
  } catch {
    // 保存できなくても、その場では選んだ案が表示される
  }
}

// ---------------------------------------------------------------------------
// 月の予定（仕様書 5.15）
// ---------------------------------------------------------------------------

/** 月の予定を割り振る条件。1 日の時間は時間割のその日のこの作品の取り分（今日は、取り分から作業済みぶんを引いた残り） */
export function monthInput(f: Forecast, order: MonthOrder): MonthInput {
  const todayKey = dayKey(f.today);
  return {
    tasks: f.openTasks,
    today: f.today,
    budgetOf: (d) => (dayKey(d) === todayKey ? Math.max(0, f.quotaMs - f.workedTodayMs) : f.share.dayMs(d)),
    order,
  };
}

const orderKey = (workId: number) => `otosazu.monthOrder.${workId}`;

export function loadMonthOrder(workId: number): MonthOrder | null {
  try {
    const v = localStorage.getItem(orderKey(workId));
    return v === "page" || v === "stage" || v === "fit" ? v : null;
  } catch {
    return null;
  }
}

export function saveMonthOrder(workId: number, order: MonthOrder) {
  try {
    localStorage.setItem(orderKey(workId), order);
  } catch {
    // 保存できなくても、その場では選んだ進め方で表示される
  }
}

const exportedKey = (workId: number) => `otosazu.icsExported.${workId}`;

/** 前回 .ics に書き出した予定 */
export function loadExported(workId: number): ExportedEvent[] {
  try {
    const raw = localStorage.getItem(exportedKey(workId));
    return raw ? (JSON.parse(raw) as ExportedEvent[]) : [];
  } catch {
    return [];
  }
}

export function saveExported(workId: number, events: ExportedEvent[]) {
  try {
    localStorage.setItem(exportedKey(workId), JSON.stringify(events));
  } catch {
    // 覚えられなければ、次の書き出しで古い予定を取り消せないだけ
  }
}
