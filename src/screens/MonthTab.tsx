// スケジュール画面の「月の予定」タブ（仕様書 5.15）：完成まで日ごとの割り振りを月のカレンダーで見せ、.ics に書き出す
import { useState } from "react";
import { createPortal } from "react-dom";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { api } from "../api";
import { useApp } from "../app-context";
import { buildIcs, DayPlan, DayWords, groupDay, IcsEvent, MonthOrder, planMonth, staleEvents } from "../calendar";
import { Forecast, loadExported, loadMonthOrder, monthInput, saveExported, saveMonthOrder } from "../forecast";
import { dayKey, dayLabel, estimate, monthLabel, weekdayName } from "../format";
import { kindKey, unitText } from "../i18n/common";
import { t } from "../i18n/month";
import { addDays } from "../schedule";

/** Mac の印刷は中身が 1 割ほど大きく出るので、印刷用の CSS で高さを変える（App.css の .print-root.mac） */
const IS_MAC = navigator.userAgent.includes("Mac");

const words = (): DayWords => ({
  sep: t("sep"),
  groupSep: t("groupSep"),
  range: (a, b) => t("range", { a, b }),
  partial: (page) => t("partialPage", { page }),
  continued: (page) => t("continuedPage", { page }),
  group: (stage, pages) => t("group", { stage, pages }),
});

export function MonthTab({ forecast }: { forecast: Forecast }) {
  const app = useApp();
  const { board, schedule, prediction, today, deadline } = forecast;
  const workId = board.work.id;
  const kind = board.work.kind;
  const unit = unitText(board.work);
  const orderPageName = t(kindKey(kind, "orderPage"), { unit: unitText(board.work, 1) });
  const [order, setOrderState] = useState<MonthOrder>(
    () => loadMonthOrder(workId) ?? (schedule.workOrder === "page" ? "page" : "stage"),
  );
  const [note, setNote] = useState<string | null>(null);
  const setOrder = (o: MonthOrder) => {
    setOrderState(o);
    saveMonthOrder(workId, o);
  };

  if (prediction.remainingMs === 0) return <div className="card pad big">{t("completed")}</div>;

  const plan = planMonth(monthInput(forecast, order));
  const w = words();
  const label = (pageId: number) => board.pages.find((p) => p.id === pageId)?.label ?? "";
  const stage = (id: number) => board.stages.find((s) => s.id === id);
  const byDay = new Map(plan.days.map((d) => [dayKey(d.date), d]));
  const [a, b] = board.stages.map((s) => s.name);
  const hint =
    order === "page"
      ? t(kindKey(kind, "orderHintPage"), { unit: unitText(board.work, 1) })
      : order === "stage"
        ? t(kindKey(kind, "orderHintStage"), { a: a ?? "", b: b ?? "", unit })
        : t("orderHintFit");

  // 今月から、完成予定と締切の遅いほうの月まで
  const last = [plan.finish, deadline?.date].filter((d): d is Date => !!d).reduce((m, d) => (d > m ? d : m), today);
  const months: Date[] = [];
  for (let m = new Date(today.getFullYear(), today.getMonth(), 1); m <= last; m = new Date(m.getFullYear(), m.getMonth() + 1, 1))
    months.push(m);

  const exportIcs = async () => {
    const title = board.work.title;
    const events: IcsEvent[] = plan.days.map((d) => ({
      uid: `${dayKey(d.date)}-w${workId}@otosazu`,
      date: d.date,
      summary: summaryOf(d, label, stage, w),
      description: [
        title,
        ...d.steps.map((s) => {
          const page = s.partial ? w.partial(label(s.pageId)) : s.continued ? w.continued(label(s.pageId)) : label(s.pageId);
          return `${page} ${stage(s.stageId)?.name ?? ""} ${estimate(s.ms)}`;
        }),
        t("dayTotal", { time: estimate(d.steps.reduce((n, s) => n + s.ms, 0)) }),
      ].join("\n"),
    }));
    if (plan.finish) events.push({ uid: `finish-w${workId}@otosazu`, date: plan.finish, summary: t("finishEvent", { title }) });
    if (deadline) events.push({ uid: `deadline-w${workId}@otosazu`, date: deadline.date, summary: t("deadlineEvent", { title }) });
    const dest = await saveDialog({
      title: t("exportDialog"),
      defaultPath: `otosazu-${title.replace(/[\\/:*?"<>|]/g, "_")}.ics`,
      filters: [{ name: t("filterName"), extensions: ["ics"] }],
    });
    if (!dest) return;
    // 前回書き出して今回は無い予定（完成が早まった日など）は、取り消しとして入れてカレンダーから消してもらう
    const all = [...events, ...staleEvents(loadExported(workId), events, today, t("cancelled"))];
    try {
      await api.saveCalendar(dest, buildIcs(t("calName", { title }), all, new Date()));
      saveExported(workId, events.map((e) => ({ uid: e.uid, date: dayKey(e.date) })));
      setNote(t("exportDone", { path: dest }));
    } catch (e) {
      app.showError(e);
    }
  };

  return (
    <>
      <div className="row" style={{ marginBottom: 6 }}>
        <label className="small-text muted row tight">
          {t("order")}
          <select className="field" value={order} onChange={(e) => setOrder(e.target.value as MonthOrder)}>
            <option value="page">{orderPageName}</option>
            <option value="stage">{t("orderStage")}</option>
            <option value="fit">{t("orderFit")}</option>
          </select>
        </label>
        <span className="muted small-text">{hint}</span>
        <span className="grow" />
        <button className="btn small" disabled={plan.days.length === 0} onClick={() => api.printPage().catch(app.showError)}>
          {t("print")}
        </button>
        <button className="btn small" disabled={plan.days.length === 0} onClick={exportIcs}>
          {t("export")}
        </button>
      </div>
      <p className="muted small-text" style={{ margin: "0 0 12px" }}>
        {note ?? t("exportNote")}
      </p>
      {plan.incomplete && <div className="notice warn">{t("noHours")}</div>}
      {months.map((m) => (
        <MonthGrid
          key={m.getTime()}
          month={m}
          forecast={forecast}
          byDay={byDay}
          finish={plan.finish}
          label={label}
          words={w}
        />
      ))}
      <p className="muted small-text">{t("basis")}</p>
      {/* 印刷するときだけ出す（画面のほかの部分は印刷しない）。月ごとに 1 枚、A4 横 */}
      {createPortal(
        <div className={`print-root${IS_MAC ? " mac" : ""}`}>
          {months.map((m) => (
            <div key={m.getTime()} className="print-page">
              <div className="print-head">
                <b>{t("printTitle", { title: board.work.title })}</b>
                <span>
                  {t("printMeta", {
                    date: dayLabel(today),
                    order: order === "page" ? orderPageName : t(order === "stage" ? "orderStage" : "orderFit"),
                  })}
                </span>
              </div>
              <MonthGrid month={m} forecast={forecast} byDay={byDay} finish={plan.finish} label={label} words={w} full />
            </div>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}

function summaryOf(d: DayPlan, label: (id: number) => string, stage: (id: number) => { name: string } | undefined, w: DayWords) {
  return groupDay(d.steps, label, w)
    .map((g) => w.group(stage(g.stageId)?.name ?? "", g.pages))
    .join(w.groupSep);
}

function MonthGrid({
  month,
  forecast,
  byDay,
  finish,
  label,
  words: w,
  full = false,
}: {
  month: Date;
  forecast: Forecast;
  byDay: Map<string, DayPlan>;
  finish: Date | null;
  label: (id: number) => string;
  words: DayWords;
  /** 今日より前の週も出す（印刷用） */
  full?: boolean;
}) {
  const { board, today, deadline, cal } = forecast;
  // 月曜はじまりで、月の初めの週の月曜から月の終わりの週の日曜まで
  const end = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  const cells: Date[] = [];
  for (let d = addDays(month, -((month.getDay() + 6) % 7)); d <= end || cells.length % 7 !== 0; d = addDays(d, 1)) {
    // 画面では今日より前の週は出さない
    if (full || d >= addDays(today, -((today.getDay() + 6) % 7))) cells.push(d);
  }
  const stage = (id: number) => board.stages.find((s) => s.id === id);

  return (
    <div className="card month">
      <div className="section-title">{t("monthTitle", { y: month.getFullYear(), m: monthLabel(month.getMonth()) })}</div>
      <div className="month-grid" style={{ "--weeks": cells.length / 7 } as React.CSSProperties}>
        {[1, 2, 3, 4, 5, 6, 0].map((wd) => (
          <div key={wd} className="month-wd">
            {weekdayName(wd)}
          </div>
        ))}
        {cells.map((d) => {
          const key = dayKey(d);
          if (d.getMonth() !== month.getMonth()) return <div key={key} className="month-day out" />;
          const plan = byDay.get(key);
          const off = cal.daysOff.includes(key) || (cal.weekdayHours[(d.getDay() + 6) % 7] ?? 0) === 0;
          const groups = plan ? groupDay(plan.steps, label, w) : [];
          const total = plan ? plan.steps.reduce((n, s) => n + s.ms, 0) : 0;
          const cls = ["month-day", d < today ? "past" : "", key === dayKey(today) ? "today" : "", off ? "off" : ""];
          return (
            <div
              key={key}
              className={cls.filter(Boolean).join(" ")}
              title={plan ? `${summaryOf(plan, label, stage, w)}\n${t("dayTotal", { time: estimate(total) })}` : undefined}
            >
              <div className="month-num">
                <span>{d.getDate()}</span>
                {plan && <span className="muted num">{estimate(total)}</span>}
              </div>
              {groups.map((g) => (
                <div key={g.stageId} className="month-item">
                  <i style={{ background: stage(g.stageId)?.color }} />
                  <span>
                    {stage(g.stageId)?.name} {g.pages}
                  </span>
                </div>
              ))}
              {deadline && key === dayKey(deadline.date) && <div className="month-mark deadline">{t("deadline")}</div>}
              {finish && key === dayKey(finish) && <div className="month-mark finish">{t("finish")}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
