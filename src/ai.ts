// AI に相談する文（仕様書 5.21）。いまの進み具合を、チャット AI が読みやすい Markdown の文にまとめる
import type { Board, TagFit, TagGroup } from "./api";
import { dayKey, dayLabel, estimate, factor, hours, weekdayName } from "./format";
import type { Forecast } from "./forecast";
import { kindKey, unitText } from "./i18n/common";
import { t } from "./i18n/ai";
import { addDays, HOUR, planName } from "./schedule";

export type AiPurpose = "deadline" | "today" | "review" | "free";
export const AI_PURPOSES: AiPurpose[] = ["deadline", "today", "review", "free"];

export type AiOptions = { purpose: AiPurpose; hideTitle: boolean; pages: boolean };

export type AiInput = {
  forecast: Forecast;
  tags: TagGroup[];
  /** 学習した倍率（実績のあるタグだけ。無いタグは初期倍率を使う） */
  fits: TagFit[];
  /** その日の全作品の作業時間 */
  allDailyMs: (d: Date) => number;
  /** 1 日の区切り（時） */
  dayStartHour: number;
};

/** 最近の作業に出す日数 */
export const RECENT_DAYS = 14;
/** 休みの日を出す範囲（日） */
const DAYS_OFF_AHEAD = 56;

// 時間は表記の設定（5.9）によらず「3時間25分」の形で書く（「0.5h」を AI が読み違えないように）
const spent = (ms: number) => hours(ms, "hm");
const est = (ms: number) => estimate(ms, "hm");

/** 表の 1 行。セルの中の | は表を壊すので置き換える */
const tableRow = (cells: string[]) => `| ${cells.map((c) => c.replace(/\|/g, "/")).join(" | ")} |`;
const table = (head: string[], rows: string[][]) =>
  [tableRow(head), tableRow(head.map(() => "---")), ...rows.map(tableRow)].join("\n");

export function aiText(input: AiInput, opts: AiOptions): string {
  const { forecast: f } = input;
  const { board, prediction, schedule } = f;
  const row = board.work;
  const k = <K extends string>(base: K) => kindKey(row.kind, base);
  const unit = unitText(row, 1);
  const rowWord = t(k("row"), { unit });
  const pages = board.pages.filter((p) => !p.missing);
  const totalCount = pages.reduce((n, p) => n + p.span, 0);
  // 作家の残りが 0 でも、メンバー担当のマスが残っていれば完成ではない（5.23）
  const completed = prediction.tasks.every((t) => t.done);
  const out: string[] = [];

  // 前置き
  out.push(`# ${t(k("head"))}`);
  const gloss = [
    t("glossStage", { row: rowWord, stages: board.stages.map((s) => s.name).join(t("listSep")) }),
    t("glossTask", { row: rowWord }),
    t("glossTime"),
    t("glossRange"),
    t("glossTag", { row: rowWord }),
  ];
  if (row.kind === "comic" && pages.some((p) => p.span === 2)) gloss.push(t("glossSpread"));
  if (input.dayStartHour > 0) gloss.push(t("glossDayStart", { h: input.dayStartHour }));
  out.push(t("intro"), `${t("glossTitle")}\n${bullets(gloss)}`, t("todayLine", { date: dayLabel(f.today) }));

  // 作品
  const weekdays = schedule.weekdayHours.map((h, i) => t("dayHours", { day: weekdayName((i + 1) % 7), time: spent(h * HOUR) }));
  const todayKey = dayKey(f.today);
  const lastKey = dayKey(addDays(f.today, DAYS_OFF_AHEAD));
  const daysOff = schedule.daysOff
    .filter((d) => d >= todayKey && d <= lastKey)
    .sort()
    .map((d) => dayLabel(new Date(`${d}T00:00`)));
  out.push(
    `## ${t("secWork")}`,
    bullets([
      t("titleLine", { title: opts.hideTitle ? t("hiddenTitle") : row.title }),
      t(k("kindLine"), { n: totalCount, unit: unitText(row, totalCount) }),
      t(schedule.workOrder === "page" ? "orderPage" : "orderStage", { row: rowWord }),
      t("hoursLine", { list: weekdays.join(t("listSep")) }),
      daysOff.length > 0 ? t("daysOffLine", { list: daysOff.join(t("listSep")) }) : t("daysOffNone"),
    ]),
  );

  // 締切
  out.push(`## ${t("secDeadline")}`);
  if (f.deadlines.length === 0) out.push(t("noDeadline"));
  else
    out.push(
      bullets(
        f.deadlines.map((d) => {
          const head = t("deadlineLine", {
            name: d.name.trim() || t("deadlineDefault"),
            date: dayLabel(d.date),
            n: d.plan.days,
          });
          const used = d.id === f.deadline?.id ? t("deadlineUsed") : "";
          const detail = completed
            ? ""
            : `\n  - ${t("deadlineDetail", {
                p: Math.round(d.probability * 100),
                time: est(d.plan.perDayMs),
                safe: est(d.plan.safePerDayMs),
              })}`;
          return `${head}${used}${detail}`;
        }),
      ),
    );

  // 予測
  out.push(`## ${t("secForecast")}`);
  if (completed) out.push(t("completedLine"));
  else {
    const { low, mid, high, pace } = f.finish;
    out.push(
      bullets([
        t("remainLine", { low: est(prediction.lowMs), mid: est(prediction.remainingMs), high: est(prediction.highMs) }),
        mid && low && high
          ? t("finishLine", { low: dayLabel(low), mid: dayLabel(mid), high: dayLabel(high) })
          : t("finishNever"),
        pace ? t("paceLine", { time: est(f.paceMs), date: dayLabel(pace) }) : t("paceNone"),
      ]),
    );
  }

  // 工程ごと
  out.push(
    `## ${t("secStages")}`,
    table(
      [t("colStage"), t("colDone"), t("colSpent"), t("colBase", { row: rowWord }), t("colLeft")],
      board.stages.map((stage, i) => {
        const done = pages.reduce((n, p) => n + (p.cells[i].done ? p.span : 0), 0);
        const spentMs = pages.reduce((n, p) => n + p.cells[i].totalMs, 0);
        const base = prediction.stages.find((s) => s.stageId === stage.id);
        const leftMs = prediction.tasks.filter((x) => x.stageId === stage.id && !x.done).reduce((n, x) => n + x.remainingMs, 0);
        return [
          stage.name,
          `${done} / ${totalCount}`,
          spent(spentMs),
          !base ? "-" : base.fromHint ? t("baseHint", { time: est(base.baseMs) }) : t("baseSamples", { time: est(base.baseMs), n: base.samples }),
          est(leftMs),
        ];
      }),
    ),
  );

  // タグ
  const tagName = new Map<number, string>();
  const used: { id: number; name: string; factor: number; count: number }[] = [];
  for (const group of input.tags)
    for (const tag of group.tags) {
      tagName.set(tag.id, tag.name);
      const count = pages.reduce((n, p) => n + (p.tags.includes(tag.id) ? p.span : 0), 0);
      if (count === 0 || tag.hidden) continue;
      const fit = input.fits.find((x) => x.tagId === tag.id);
      used.push({ id: tag.id, name: tag.name, factor: fit?.factor ?? tag.initialFactor, count });
    }
  out.push(`## ${t("secTags")}`);
  out.push(
    used.length === 0
      ? t("noTags", { row: rowWord })
      : table(
          [t("colTag"), t("colFactor"), t("colTagged", { row: rowWord })],
          used.map((u) => [u.name, `×${factor(Math.round(u.factor * 100) / 100)}`, String(u.count)]),
        ),
  );

  // 最近の作業
  const days = Array.from({ length: RECENT_DAYS }, (_, i) => addDays(f.today, i - RECENT_DAYS + 1));
  out.push(`## ${t("secRecent", { n: RECENT_DAYS })}`);
  if (!completed) out.push(t("quotaLine", { quota: est(f.quotaMs), done: spent(f.workedTodayMs) }));
  out.push(
    table(
      [t("colDate"), t("colThis"), t("colAll")],
      days.map((d) => [dayLabel(d), spent(f.dailyMs(d)), spent(input.allDailyMs(d))]),
    ),
  );

  // ページごと
  if (opts.pages && pages.length > 0)
    out.push(
      `## ${t("secPages", { row: rowWord })}`,
      table(
        [rowWord, t("colTags"), ...board.stages.map((s) => s.name)],
        pages.map((p) => [
          pageLabel(board, p.id),
          p.tags.map((id) => tagName.get(id)).filter(Boolean).join(t("listSep")) || "-",
          ...p.cells.map((c) =>
            c.done ? t("cellDone") : c.totalMs > 0 ? t("cellWorking", { time: spent(c.totalMs) }) : t("cellOpen"),
          ),
        ]),
      ),
    );

  // 今日のやることの案
  if (opts.purpose === "today" && !completed) {
    const plans = f.plans.filter((p) => !p.disabled && p.steps.length > 0);
    if (plans.length > 0) {
      const stageName = new Map(board.stages.map((s) => [s.id, s.name]));
      out.push(
        `## ${t("secPlans")}`,
        bullets(
          plans.map((p) => {
            const steps = p.steps.map(
              (s) =>
                `${t("planStep", { page: pageLabel(board, s.pageId), stage: stageName.get(s.stageId) ?? "", time: est(s.ms) })}${
                  s.partial ? t("partial") : ""
                }`,
            );
            return t("planLine", { name: planName(p, board.stages), steps: steps.join(" → ") });
          }),
        ),
      );
    }
  }

  // 相談したいこと
  out.push(`## ${t("secAsk")}`, t(`ask.${opts.purpose}`, { row: rowWord }), t("askRule"));
  return `${out.join("\n\n")}\n`;
}

const bullets = (lines: string[]) => lines.map((l) => `- ${l}`).join("\n");

/** 行の名前。見開き（2 ページ分の行）は「p4-5（見開き）」 */
function pageLabel(board: Board, pageId: number): string {
  const page = board.pages.find((p) => p.id === pageId);
  if (!page) return "";
  return page.span === 2 ? t("spreadLabel", { label: page.label }) : page.label;
}
