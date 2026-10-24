// 作品の予測・スケジュールをまとめて読み込み、画面で使う形に計算するフック
import { useEffect, useState } from "react";
import { api, Board, Prediction, Span, TaskPrediction, WorkSchedule } from "./api";
import { useApp } from "./app-context";
import type { ExportedEvent, MonthInput, MonthOrder } from "./calendar";
import { dailyTotals, dayKey, dayStartMs, startOfDay } from "./format";
import {
  addDays,
  buildPlans,
  Calendar,
  Candidate,
  capacity,
  catchUpNotice,
  deadlinePlan,
  DeadlinePlan,
  finishDate,
  finishDateAtPace,
  MIN_STEP,
  onTimeProbability,
  Plan,
  PlanStep,
  StageInfo,
} from "./schedule";

const PACE_DAYS = 28;

export type DeadlineStatus = "ok" | "tight" | "late";

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
  deadline: { date: Date; plan: DeadlinePlan; probability: number; status: DeadlineStatus } | null;
  /** 今日のノルマ（締切があれば逆算した量、無ければ今日の作業可能時間） */
  quotaMs: number;
  /** 案を作るときの時間：今日の残りのノルマ。達成済みなら「もう少し進める」ぶんとしてノルマ 1 日ぶん */
  planQuotaMs: number;
  /** 今日のノルマを達成している */
  quotaMet: boolean;
  /** 着手できるタスク（ページ内で前の工程が完了しているもの） */
  candidates: Candidate[];
  /** 終わっていないタスクすべて（月の予定を割り振るときに使う） */
  openTasks: Candidate[];
  plans: Plan[];
  notice: string | null;
  task: (pageId: number, stageId: number) => TaskPrediction | undefined;
};

/**
 * 予測に必要なデータを読み込み、計算する。データが変わるたびに読み直す。
 * hoursOverride を渡すと、保存前の曜日ごとの作業時間で計算する（スライダー操作中など）
 */
export function useForecast(workId: number | null, hoursOverride?: number[] | null): Forecast | null {
  const app = useApp();
  const [data, setData] = useState<{ board: Board; prediction: Prediction; schedule: WorkSchedule; spans: Span[] } | null>(
    null,
  );

  useEffect(() => {
    if (!workId) {
      setData(null);
      return;
    }
    let cancelled = false;
    const from = dayStartMs(addDays(startOfDay(Date.now()), -PACE_DAYS));
    Promise.all([api.getBoard(workId), api.getPrediction(workId), api.getSchedule(workId), api.listSpans(from)])
      .then(([board, prediction, schedule, spans]) => !cancelled && setData({ board, prediction, schedule, spans }))
      .catch(app.showError);
    return () => {
      cancelled = true;
    };
  }, [workId, app.version, app.showError]);

  if (!data || !workId || data.board.work.id !== workId) return null;
  const cal = hoursOverride ? { weekdayHours: hoursOverride, daysOff: data.schedule.daysOff } : undefined;
  return computeForecast(data.board, data.prediction, data.schedule, data.spans, Date.now(), cal);
}

export function computeForecast(
  board: Board,
  prediction: Prediction,
  schedule: WorkSchedule,
  allSpans: Span[],
  now: number,
  calOverride?: Calendar,
): Forecast {
  const cal = calOverride ?? { weekdayHours: schedule.weekdayHours, daysOff: schedule.daysOff };
  const today = startOfDay(now);
  const spans = allSpans.filter((s) => s.workId === board.work.id);
  const totals = dailyTotals(spans, now);
  const workedTodayMs = totals.get(dayKey(today))?.total ?? 0;
  let pastMs = 0;
  for (let i = 1; i <= PACE_DAYS; i++) pastMs += totals.get(dayKey(addDays(today, -i)))?.total ?? 0;
  const paceMs = pastMs / PACE_DAYS;

  const finish = {
    low: finishDate(prediction.lowMs, today, workedTodayMs, cal),
    mid: finishDate(prediction.remainingMs, today, workedTodayMs, cal),
    high: finishDate(prediction.highMs, today, workedTodayMs, cal),
    pace: paceMs > 0 ? finishDateAtPace(prediction.remainingMs, today, paceMs) : null,
  };

  let deadline: Forecast["deadline"] = null;
  if (schedule.deadline) {
    const date = new Date(`${schedule.deadline}T00:00`);
    const plan = deadlinePlan(prediction.remainingMs, prediction.highMs, today, date, workedTodayMs, cal);
    // 今日の作業済みぶんは確率の計算から除く（残り時間と、今日の残りの作業可能時間で比べる）
    const capacityLeft = Math.max(0, plan.capacityMs - Math.max(workedTodayMs, 0));
    const probability = onTimeProbability(prediction.remainingMs, prediction.sigma, capacityLeft);
    const status: DeadlineStatus =
      finish.mid && finish.mid <= date ? (finish.high && finish.high <= date ? "ok" : "tight") : "late";
    deadline = { date, plan, probability, status };
  }
  const quotaMs = deadline ? deadline.plan.todayQuotaMs : capacity(today, cal);
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
      if (!t || t.done) return;
      const c = { pageId: page.id, stageId: stage.id, pageIndex, stageIndex, remainingMs: t.remainingMs, inProgress: t.spentMs > 0 };
      openTasks.push(c);
      if (stageIndex > 0 && !page.cells[stageIndex - 1].done) return;
      candidates.push(c);
    });
  });
  const stageInfos: StageInfo[] = board.stages.map((s) => ({
    id: s.id,
    name: s.name,
    openMs: prediction.tasks.filter((t) => t.stageId === s.id && !t.done).reduce((n, t) => n + t.remainingMs, 0),
  }));
  const openCounts = board.stages.map((_, i) => pages.filter((p) => !p.cells[i].done).length);

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
    deadline,
    quotaMs,
    planQuotaMs,
    quotaMet,
    candidates,
    openTasks,
    plans: buildPlans(candidates, stageInfos, planQuotaMs, schedule.workOrder, board.work.kind),
    notice: catchUpNotice(candidates, stageInfos, openCounts, board.work.kind),
    task,
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

/**
 * 月の予定を割り振る条件。1 日の時間は今日のノルマと同じ考え方：
 * 締切に間に合うなら締切までの作業可能時間に比例させ、そうでなければ作業可能時間をいっぱいに使う
 */
export function monthInput(f: Forecast, order: MonthOrder): MonthInput {
  const plan = f.deadline?.plan;
  const ratio =
    plan && plan.feasible && plan.capacityMs > 0 ? (f.prediction.remainingMs + f.workedTodayMs) / plan.capacityMs : 1;
  return { tasks: f.openTasks, today: f.today, cal: f.cal, todayMs: Math.max(0, f.quotaMs - f.workedTodayMs), ratio, order };
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
