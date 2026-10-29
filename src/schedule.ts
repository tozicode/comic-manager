// スケジュールの計算：残り時間から完成日を出す（A）／締切から今日のノルマと進め方の案を出す（B）
// 日付はすべてローカル時刻の「その日の 0 時」の Date で扱う。
import type { RowKind } from "./api";
import { kindKey, unitText } from "./i18n/common";
import { dayKey } from "./format";
import { t } from "./i18n/schedule";

export const HOUR = 3_600_000;
const DAY_LIMIT = 3 * 365; // これより先は「完成しない」とみなす

/** 月〜日の作業時間（時間） */
export type WeekHours = number[];

export type Calendar = { weekdayHours: WeekHours; daysOff: string[] };

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** その日に作業できる時間（ミリ秒）。休みの日は 0 */
export function capacity(d: Date, cal: Calendar): number {
  if (cal.daysOff.includes(dayKey(d))) return 0;
  return (cal.weekdayHours[(d.getDay() + 6) % 7] ?? 0) * HOUR;
}

/**
 * 残り時間を今日から割り当てて、完成する日を返す。
 * 今日はすでに作業したぶんを作業可能時間から引く。作業できる日が無ければ null
 */
export function finishDate(remainingMs: number, today: Date, workedTodayMs: number, cal: Calendar): Date | null {
  if (remainingMs <= 0) return today;
  let left = remainingMs;
  for (let i = 0; i < DAY_LIMIT; i++) {
    const d = addDays(today, i);
    const cap = i === 0 ? Math.max(0, capacity(d, cal) - workedTodayMs) : capacity(d, cal);
    left -= cap;
    if (left <= 0) return d;
  }
  return null;
}

/** 毎日同じ時間ずつ作業した場合の完成日（最近のペースでの見込み用） */
export function finishDateAtPace(remainingMs: number, today: Date, perDayMs: number): Date | null {
  if (remainingMs <= 0) return today;
  if (perDayMs <= 0) return null;
  return addDays(today, Math.ceil(remainingMs / perDayMs) - 1);
}

export type DeadlinePlan = {
  /** 今日から締切までの日数（今日と締切日を含む） */
  days: number;
  /** そのうち作業できる日の数 */
  workDays: number;
  /** 1 日あたりに必要な時間（標準 / 余裕を見た場合） */
  perDayMs: number;
  safePerDayMs: number;
  /** 今日のノルマ（今日すでに作業したぶんも含めた量） */
  todayQuotaMs: number;
  /** 締切までに作業できる時間の合計（今日の作業済みぶんを含む） */
  capacityMs: number;
  /** 作業できる時間に収まるか */
  feasible: boolean;
};

/**
 * 締切から逆算する。今日のノルマは、締切までの作業可能時間に比例して今日に割り当てる
 * （平日 3h・土日 6h なら、土日のノルマは平日の 2 倍）。前日までの遅れ・進みは、毎日の再計算で自然に割り直される
 */
export function deadlinePlan(
  remainingMs: number,
  highMs: number,
  today: Date,
  deadline: Date,
  workedTodayMs: number,
  cal: Calendar,
): DeadlinePlan {
  const days = Math.max(0, Math.round((deadline.getTime() - today.getTime()) / 86_400_000) + 1);
  let capacityMs = 0;
  let workDays = 0;
  for (let i = 0; i < days; i++) {
    const cap = capacity(addDays(today, i), cal);
    capacityMs += cap;
    if (cap > 0) workDays++;
  }
  // 今日のぶんは、作業済みの時間を足して「今日の最初の時点」に揃える
  const total = remainingMs + workedTodayMs;
  const todayCap = days > 0 ? capacity(today, cal) : 0;
  const todayQuotaMs = capacityMs > 0 ? (total * todayCap) / capacityMs : 0;
  return {
    days,
    workDays,
    perDayMs: workDays > 0 ? total / workDays : total,
    safePerDayMs: workDays > 0 ? (highMs + workedTodayMs) / workDays : highMs,
    todayQuotaMs,
    capacityMs,
    feasible: days > 0 && total <= capacityMs,
  };
}

/**
 * どの締切で計算するか（5.19）。選んでいる締切がまだ過ぎていなければそれ、
 * そうでなければ今日以降でいちばん早い締切。今日以降の締切が無ければ null。list は日付順
 */
export function pickDeadline<T extends { id: number; date: string }>(
  list: T[],
  selected: number | null,
  todayKey: string,
): T | null {
  const upcoming = list.filter((d) => d.date >= todayKey);
  return upcoming.find((d) => d.id === selected) ?? upcoming[0] ?? null;
}

/** 締切までに終わる確率。残り時間が対数正規分布に従うとみなす */
export function onTimeProbability(remainingMs: number, sigma: number, capacityMs: number): number {
  if (remainingMs <= 0) return 1;
  if (capacityMs <= 0) return 0;
  if (sigma <= 0) return remainingMs <= capacityMs ? 1 : 0;
  return normalCdf(Math.log(capacityMs / remainingMs) / sigma);
}

function normalCdf(x: number): number {
  // Abramowitz & Stegun 7.1.26 による erf の近似
  const t = 1 / (1 + 0.3275911 * (Math.abs(x) / Math.SQRT2));
  const y =
    1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

// ---------------------------------------------------------------------------
// 今日のやることの案
// ---------------------------------------------------------------------------

/** 着手できるタスク（ページ内で前の工程が完了しているもの） */
export type Candidate = {
  pageId: number;
  stageId: number;
  pageIndex: number;
  stageIndex: number;
  remainingMs: number;
  /** 途中まで進んでいる */
  inProgress: boolean;
};

export type PlanStep = { pageId: number; stageId: number; ms: number; partial: boolean };

export type Plan = {
  key: string;
  name: string;
  sub?: string;
  steps: PlanStep[];
  /** 選べない理由（選べるなら undefined） */
  disabled?: string;
};

export type StageInfo = { id: number; name: string; openMs: number };

/** これより短い残りは案に入れない */
export const MIN_STEP = 5 * 60_000;

/** 並べたタスクを、ノルマの時間ぶん先頭から切り出す。最後のタスクは「途中まで」になることがある */
export function fill(tasks: Candidate[], quotaMs: number): PlanStep[] {
  const steps: PlanStep[] = [];
  let left = quotaMs;
  for (const t of tasks) {
    if (left < MIN_STEP) break;
    const ms = Math.min(t.remainingMs, left);
    steps.push({ pageId: t.pageId, stageId: t.stageId, ms, partial: ms < t.remainingMs });
    left -= ms;
  }
  return steps;
}

const byPage = (a: Candidate, b: Candidate) => a.pageIndex - b.pageIndex || a.stageIndex - b.stageIndex;
const progressFirst = (a: Candidate, b: Candidate) => Number(b.inProgress) - Number(a.inProgress);

/** 作業順の方針どおりに並べる。途中のタスクは、工程ごとならその工程の先頭、ページごとなら全体の先頭に置く */
export function ordered(cands: Candidate[], workOrder: string): Candidate[] {
  const list = [...cands];
  if (workOrder === "page") return list.sort((a, b) => progressFirst(a, b) || byPage(a, b));
  return list.sort((a, b) => a.stageIndex - b.stageIndex || progressFirst(a, b) || a.pageIndex - b.pageIndex);
}

/**
 * 今日のノルマを満たす案を並べる：おすすめ / 工程ごとの日 / 混ぜる。
 * どの案もノルマの時間は同じで、選んだ案で完成日は変わらない
 */
export function buildPlans(
  cands: Candidate[],
  stages: StageInfo[],
  quotaMs: number,
  workOrder: string,
  row: RowKind = { kind: "comic", unit: "" },
): Plan[] {
  const unit = unitText(row);
  const plans: Plan[] = [];
  plans.push({
    key: "recommended",
    name: t("plan.recommended"),
    sub:
      workOrder === "page"
        ? t(kindKey(row.kind, "plan.recommendedSub"), { unit: unitText(row, 1) })
        : t("plan.recommendedSubStage"),
    steps: fill(ordered(cands, workOrder), quotaMs),
  });

  stages.forEach((stage, i) => {
    const mine = cands.filter((c) => c.stageId === stage.id).sort((a, b) => progressFirst(a, b) || a.pageIndex - b.pageIndex);
    const prev = stages[i - 1];
    plans.push({
      key: `stage-${stage.id}`,
      name: t("plan.stageDay", { stage: stage.name }),
      steps: fill(mine, quotaMs),
      disabled:
        mine.length > 0
          ? undefined
          : stage.openMs <= 0
            ? t("plan.stageDone", { stage: stage.name })
            : prev
              ? t(kindKey(row.kind, "plan.noReadyAfter"), { prev: prev.name, unit })
              : t(kindKey(row.kind, "plan.noReady"), { unit }),
    });
  });

  // 混ぜる：残りの多い工程ほど多めに割り当てる
  const ready = stages.filter((s) => s.openMs > 0 && cands.some((c) => c.stageId === s.id));
  if (ready.length >= 2) {
    const weight = ready.reduce((n, s) => n + s.openMs, 0);
    let steps: PlanStep[] = [];
    for (const s of ready) {
      const mine = cands.filter((c) => c.stageId === s.id).sort((a, b) => progressFirst(a, b) || a.pageIndex - b.pageIndex);
      steps = steps.concat(fill(mine, (quotaMs * s.openMs) / weight));
    }
    // 工程のタスクが足りずノルマに届かないときは、おすすめの順で埋める
    const used = steps.reduce((n, s) => n + s.ms, 0);
    const rest = ordered(cands, workOrder)
      .map((c) => {
        const taken = steps.find((s) => s.pageId === c.pageId && s.stageId === c.stageId)?.ms ?? 0;
        return { ...c, remainingMs: c.remainingMs - taken };
      })
      .filter((c) => c.remainingMs > 0);
    steps = merge(steps, fill(rest, quotaMs - used));
    plans.push({ key: "mix", name: t("plan.mix"), sub: t("plan.mixSub"), steps });
  }
  return plans;
}

/** 同じタスクの手順をまとめる */
function merge(a: PlanStep[], b: PlanStep[]): PlanStep[] {
  const out = a.map((s) => ({ ...s }));
  for (const s of b) {
    const same = out.find((o) => o.pageId === s.pageId && o.stageId === s.stageId);
    if (same) {
      same.ms += s.ms;
      same.partial = s.partial;
    } else out.push({ ...s });
  }
  return out;
}

/**
 * 工程の進み具合の差が大きいときの一言。
 * ある工程の「着手できるページ」が残り少なく、前の工程がまだ終わっていないとき
 */
export function catchUpNotice(
  cands: Candidate[],
  stages: StageInfo[],
  openCounts: number[],
  row: RowKind = { kind: "comic", unit: "" },
): string | null {
  for (let i = 1; i < stages.length; i++) {
    const ready = cands.filter((c) => c.stageId === stages[i].id).length;
    if (openCounts[i - 1] > 0 && openCounts[i] > ready && ready <= 2) {
      return t(kindKey(row.kind, "plan.catchUp"), {
        stage: stages[i].name,
        prev: stages[i - 1].name,
        n: ready,
        unit: unitText(row, ready),
      });
    }
  }
  return null;
}

/**
 * 選んだ案の名前を、今の言語で出し直す（保存した名前は選んだときの言語なので、案の種類から作り直す）。
 * 種類が分からなければ保存した名前を使う
 */
export function planName(plan: { key: string; name: string }, stages: { id: number; name: string }[]): string {
  if (plan.key === "recommended") return t("plan.recommended");
  if (plan.key === "mix") return t("plan.mix");
  if (plan.key === "custom") return t("customTitle");
  const stage = plan.key.startsWith("stage-") ? stages.find((s) => `stage-${s.id}` === plan.key) : undefined;
  return stage ? t("plan.stageDay", { stage: stage.name }) : plan.name;
}
