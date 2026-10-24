import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useApp } from "../app-context";
import { ChosenPlan, Forecast, loadChosenPlan, saveChosenPlan, useForecast } from "../forecast";
import { dayKey, dayLabel, estimate, hours, weekdayName } from "../format";
import { t, tn } from "../i18n/schedule";
import { addDays, HOUR, Plan, PlanStep } from "../schedule";

type Tab = "finish" | "deadline";
const TAB_KEY = "otosazu.scheduleTab";

export function ScheduleScreen({ workId }: { workId: number }) {
  const app = useApp();
  const [tab, setTabState] = useState<Tab>(() => {
    try {
      return localStorage.getItem(TAB_KEY) === "finish" ? "finish" : "deadline";
    } catch {
      return "deadline";
    }
  });
  const setTab = (t: Tab) => {
    setTabState(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      // 次に開いたときの初期タブが変わるだけ
    }
  };
  // スライダーを動かしている間の作業時間（保存前でも完成日をその場で計算し直す）
  const [draftHours, setDraftHours] = useState<number[] | null>(null);
  const forecast = useForecast(workId, draftHours);

  if (!forecast) return <p className="muted">{t("loading")}</p>;

  return (
    <>
      <div className="row" style={{ marginBottom: 16 }}>
        <span className="seg">
          <button className={tab === "finish" ? "on" : ""} onClick={() => setTab("finish")}>
            {t("tabFinish")}
          </button>
          <button className={tab === "deadline" ? "on" : ""} onClick={() => setTab("deadline")}>
            {t("tabDeadline")}
          </button>
        </span>
        <span className="muted small-text">
          {tab === "finish" ? t("tabFinishHint") : t("tabDeadlineHint")}
        </span>
      </div>
      {tab === "finish" ? (
        <FinishTab forecast={forecast} draftHours={draftHours} setDraftHours={setDraftHours} />
      ) : (
        <DeadlineTab forecast={forecast} onError={app.showError} />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// (A) 完成日を見る
// ---------------------------------------------------------------------------

function FinishTab({
  forecast,
  draftHours,
  setDraftHours,
}: {
  forecast: Forecast;
  draftHours: number[] | null;
  setDraftHours: (h: number[] | null) => void;
}) {
  const app = useApp();
  const { schedule, finish, prediction, board } = forecast;
  const hoursNow = draftHours ?? schedule.weekdayHours;
  const saveTimer = useRef<number | undefined>(undefined);
  const [newDayOff, setNewDayOff] = useState("");

  // スライダーを止めて少し経ったら保存する
  const changeHours = (i: number, v: number) => {
    const next = hoursNow.map((h, k) => (k === i ? v : h));
    setDraftHours(next);
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      try {
        await api.setWorkHours(board.work.id, next);
        app.refresh();
      } catch (e) {
        app.showError(e);
      }
    }, 400);
  };
  useEffect(() => () => window.clearTimeout(saveTimer.current), []);
  // 保存が反映されたら、手元の値を捨てて保存済みの値を表示する
  useEffect(() => {
    if (draftHours && draftHours.every((h, i) => h === schedule.weekdayHours[i])) setDraftHours(null);
  }, [schedule.weekdayHours, draftHours, setDraftHours]);

  const run = async (f: () => Promise<unknown>) => {
    try {
      await f();
      app.refresh();
    } catch (e) {
      app.showError(e);
    }
  };

  const weekTotal = hoursNow.reduce((n, h) => n + h, 0);

  return (
    <div className="sched">
      <div className="card">
        <div className="section-title">{t("hoursPerDay")}</div>
        {hoursNow.map((_, i) => (
          <div key={i} className={`wd${hoursNow[i] === 0 ? " off" : ""}`}>
            <b>{weekdayName((i + 1) % 7)}</b>
            <input
              type="range"
              min={0}
              max={12}
              step={0.5}
              value={hoursNow[i]}
              onChange={(e) => changeHours(i, Number(e.target.value))}
            />
            <span className="num">{hours(hoursNow[i] * HOUR)}</span>
          </div>
        ))}
        <div className="row small-text" style={{ margin: "10px 0 16px" }}>
          <span className="muted">{t("perWeek")}</span>
          <b className="num">{hours(weekTotal * HOUR)}</b>
          <span className="grow" />
          {schedule.customHours ? (
            <button className="btn small ghost" onClick={() => run(() => api.setWorkHours(board.work.id, null))}>
              {t("resetHours")}
            </button>
          ) : (
            <span className="muted">{t("defaultHours")}</span>
          )}
        </div>
        <div className="section-title">{t("daysOffTitle")}</div>
        <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
          {schedule.daysOff
            .filter((d) => d >= dayKey(forecast.today))
            .map((d) => (
              <span key={d} className="tag">
                {dayLabel(new Date(`${d}T00:00`))}
                <button className="tag-x" title={t("removeDayOff")} onClick={() => run(() => api.setDayOff(d, false))}>
                  ×
                </button>
              </span>
            ))}
        </div>
        <div className="row tight" style={{ marginTop: 8 }}>
          <input type="date" className="field" value={newDayOff} onChange={(e) => setNewDayOff(e.target.value)} />
          <button
            className="btn small"
            disabled={!newDayOff}
            onClick={() => {
              run(() => api.setDayOff(newDayOff, true));
              setNewDayOff("");
            }}
          >
            {t("addDayOff")}
          </button>
        </div>
      </div>

      <div className="card">
        <div className="section-title">{t("finishTitle")}</div>
        {prediction.remainingMs === 0 ? (
          <div className="big">{t("completed")}</div>
        ) : (
          <>
            <div className="result3">
              <div>
                <div className="lbl">{t("earliest")}</div>
                <div className="d num">{finish.low ? dayLabel(finish.low) : "—"}</div>
                <div className="lbl">{t("remaining", { time: estimate(prediction.lowMs) })}</div>
              </div>
              <div className="main-r">
                <div className="lbl">{t("likely")}</div>
                <div className="d num">{finish.mid ? dayLabel(finish.mid) : "—"}</div>
                <div className="lbl">{t("remaining", { time: estimate(prediction.remainingMs) })}</div>
              </div>
              <div>
                <div className="lbl">{t("latest")}</div>
                <div className="d num">{finish.high ? dayLabel(finish.high) : "—"}</div>
                <div className="lbl">{t("remaining", { time: estimate(prediction.highMs) })}</div>
              </div>
            </div>
            {!finish.mid && <p className="range">{t("noHours")}</p>}
            <ProgressChart forecast={forecast} />
            <div className="compare">
              <span className="grow">
                {tn("paceCompare", { pace: <b className="num">{t("perDay", { time: hours(forecast.paceMs) })}</b> })}
              </span>
              <b className="num">{finish.pace ? dayLabel(finish.pace) : "—"}</b>
              <span className="muted">{t("around")}</span>
            </div>
            <StageBases forecast={forecast} />
          </>
        )}
      </div>
    </div>
  );
}

/** 進み具合のグラフ。横軸は日付、縦軸は「これまでの作業時間 ÷（作業時間 + 残り）」 */
function ProgressChart({ forecast }: { forecast: Forecast }) {
  const { today, finish, prediction, board, deadline } = forecast;
  const W = 620, H = 230, L = 40, R = 610, T = 20, B = 200;
  const spent = board.pages.reduce((n, p) => n + p.cells.reduce((m, c) => m + c.totalMs, 0), 0);
  const total = spent + prediction.remainingMs;
  if (total <= 0) return null;

  const start = addDays(today, -27);
  const endCandidates = [finish.high, deadline?.date, addDays(today, 7)].filter((d): d is Date => !!d);
  const end = addDays(new Date(Math.max(...endCandidates.map((d) => d.getTime()))), 2);
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000));
  const x = (d: Date) => L + ((d.getTime() - start.getTime()) / 86_400_000 / days) * (R - L);
  const y = (ratio: number) => B - ratio * (B - T);

  // 実績：今日から過去へさかのぼって、その日の終わりまでに積み上がった時間
  const dailyMs = forecast.dailyMs;
  const points: string[] = [];
  let acc = spent;
  for (let i = 0; i <= 27; i++) {
    const d = addDays(today, -i);
    points.unshift(`${x(addDays(d, 1)).toFixed(1)},${y(acc / total).toFixed(1)}`);
    acc -= dailyMs(d);
  }
  points.unshift(`${x(start).toFixed(1)},${y(Math.max(0, acc) / total).toFixed(1)}`);
  const nowX = x(addDays(today, 1));
  const nowY = y(spent / total);
  const fx = (d: Date | null) => (d ? x(addDays(d, 1)) : R);

  // 目盛り（2 週間ごと）
  const ticks: Date[] = [];
  for (let d = start; d <= end; d = addDays(d, 14)) {
    // 「今日」の文字と重なる目盛りは出さない
    if (Math.abs(x(d) - x(addDays(today, 1))) > 36) ticks.push(d);
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart">
      <g fontSize="11" style={{ fill: "var(--muted)" }}>
        <line x1={L} y1={B} x2={R} y2={B} style={{ stroke: "var(--border)" }} />
        <line x1={L} y1={T} x2={R} y2={T} style={{ stroke: "var(--line-soft)" }} />
        <line x1={L} y1={(T + B) / 2} x2={R} y2={(T + B) / 2} style={{ stroke: "var(--line-soft)" }} />
        <text x={L - 6} y={T + 4} textAnchor="end">100%</text>
        <text x={L - 6} y={(T + B) / 2 + 4} textAnchor="end">50%</text>
        <text x={L - 6} y={B + 4} textAnchor="end">0%</text>
        {ticks.map((d) => (
          <text key={d.getTime()} x={x(d)} y={B + 18} textAnchor="middle">
            {d.getMonth() + 1}/{d.getDate()}
          </text>
        ))}
      </g>
      <path d={`M${nowX} ${nowY} L${fx(finish.low)} ${T} L${fx(finish.high)} ${T} Z`} style={{ fill: "var(--accent)" }} opacity=".12" />
      <polyline points={points.join(" ")} fill="none" style={{ stroke: "var(--text)" }} strokeWidth="2.5" />
      <line x1={nowX} y1={nowY} x2={fx(finish.mid)} y2={T} style={{ stroke: "var(--accent)" }} strokeWidth="2.5" strokeDasharray="6 5" />
      {finish.mid && (
        <>
          <circle cx={fx(finish.mid)} cy={T} r="5" style={{ fill: "var(--accent)" }} />
          <text x={fx(finish.mid)} y={T + 20} fontSize="12" style={{ fill: "var(--accent)" }} textAnchor="middle" fontWeight="700">
            {finish.mid.getMonth() + 1}/{finish.mid.getDate()}
          </text>
        </>
      )}
      {deadline && (
        <>
          <line x1={fx(deadline.date)} y1={T - 6} x2={fx(deadline.date)} y2={B} style={{ stroke: "var(--ok)" }} strokeWidth="1.5" />
          <text x={fx(deadline.date) - 4} y={B - 10} fontSize="11" style={{ fill: "var(--ok)" }} textAnchor="end">
            {t("deadlineMark", { date: `${deadline.date.getMonth() + 1}/${deadline.date.getDate()}` })}
          </text>
        </>
      )}
      <line x1={nowX} y1={T - 6} x2={nowX} y2={B} style={{ stroke: "var(--faint)" }} strokeDasharray="2 3" />
      <text x={nowX} y={B + 18} fontSize="11" style={{ fill: "var(--muted)" }} textAnchor="middle">
        {t("today")}
      </text>
    </svg>
  );
}

function StageBases({ forecast }: { forecast: Forecast }) {
  const { board, prediction } = forecast;
  const files = board.work.kind === "files";
  return (
    <details className="bases">
      <summary className="small-text muted">{t(files ? "basesSummaryFiles" : "basesSummaryComic")}</summary>
      <table>
        <tbody>
          {prediction.stages.map((b) => {
            const stage = board.stages.find((s) => s.id === b.stageId);
            return (
              <tr key={b.stageId}>
                <td>{stage?.name}</td>
                <td className="num">{estimate(b.baseMs)}</td>
                <td className="muted">{b.fromHint ? t("fromHint") : t(files ? "fromSamplesFiles" : "fromSamplesComic", { n: b.samples })}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted small-text">
        {t(files ? "formulaFiles" : "formulaComic")}
      </p>
    </details>
  );
}

// ---------------------------------------------------------------------------
// (B) 目標から逆算する
// ---------------------------------------------------------------------------

function DeadlineTab({ forecast, onError }: { forecast: Forecast; onError: (e: unknown) => void }) {
  const app = useApp();
  const { board, schedule, deadline, prediction, finish } = forecast;
  const workId = board.work.id;
  const [chosen, setChosen] = useState<ChosenPlan | null>(() => loadChosenPlan(workId));
  const [custom, setCustom] = useState<PlanStep[] | null>(null);

  const run = async (f: () => Promise<unknown>) => {
    try {
      await f();
      app.refresh();
    } catch (e) {
      onError(e);
    }
  };

  const choose = (plan: Plan | { key: string; name: string; steps: PlanStep[] }) => {
    const c: ChosenPlan = {
      date: dayKey(forecast.today),
      key: plan.key,
      name: plan.name,
      quotaMs: forecast.quotaMet ? forecast.workedTodayMs + forecast.planQuotaMs : forecast.quotaMs,
      steps: plan.steps,
    };
    saveChosenPlan(workId, c);
    setChosen(c);
    app.refresh();
  };

  if (prediction.remainingMs === 0) return <div className="card pad big">{t("completed")}</div>;

  const daysOffLeft = deadline
    ? schedule.daysOff.filter((d) => d >= dayKey(forecast.today) && d <= dayKey(deadline.date)).length
    : 0;
  const pct = forecast.quotaMs > 0 ? Math.min(100, (forecast.workedTodayMs / forecast.quotaMs) * 100) : 0;

  return (
    <>
      <div className="quota">
        <div className="card">
          <div className="section-title">{t("targetDate")}</div>
          <div className="row">
            <input
              type="date"
              className="field"
              value={schedule.deadline ?? ""}
              onChange={(e) => run(() => api.setDeadline(workId, e.target.value || null))}
            />
            {deadline && (
              <span className="muted small-text" style={{ lineHeight: 1.4 }}>
                {t("daysLeft", { n: deadline.plan.days })}
                <br />
                {t("daysOffLeft", { n: daysOffLeft })}
              </span>
            )}
          </div>
        </div>
        <div className="card">
          <div className="section-title">{t("perDayNeeded")}</div>
          {deadline ? (
            <div className="big num">
              {estimate(deadline.plan.perDayMs)}
              <span className="small-text muted" style={{ fontWeight: 400 }}>
                {" "}
                {t("safePerDay", { time: estimate(deadline.plan.safePerDayMs) })}
              </span>
            </div>
          ) : (
            <p className="range">{t("needDeadline")}</p>
          )}
        </div>
        <div className="card">
          <div className="section-title">{deadline ? t("quotaTitleDeadline") : t("quotaTitleNoDeadline")}</div>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="big num">
              {hours(forecast.workedTodayMs)} <span className="small-text">/ {estimate(forecast.quotaMs)}</span>
            </span>
            <span className="muted small-text">
              {forecast.quotaMet
                ? t("quotaMet")
                : forecast.workedTodayMs === 0
                  ? t("notStarted")
                  : t("quotaLeft", { time: estimate(forecast.quotaMs - forecast.workedTodayMs) })}
            </span>
          </div>
          <div className="bar">
            <span style={{ width: `${pct}%`, background: "var(--accent)" }} />
          </div>
        </div>
      </div>

      {deadline && !deadline.plan.feasible && (
        <div className="notice warn">
          {t("lateWarning", { date: finish.mid ? dayLabel(finish.mid) : "—" })} {t("lateWarning2")}
        </div>
      )}
      {forecast.notice && <div className="notice info">💡 {forecast.notice}</div>}

      <div className="row" style={{ marginBottom: 10 }}>
        <div className="section-title" style={{ margin: 0 }}>
          {forecast.quotaMet
            ? t("moreAfterQuota")
            : forecast.workedTodayMs > 0
              ? t("chooseRest", { time: estimate(forecast.planQuotaMs) })
              : t("chooseToday")}
        </div>
        <span className="muted small-text">{t("sameFinish")}</span>
        <span className="grow" />
        <label className="small-text muted row tight">
          {t("recommendedOrder")}
          <select
            className="field"
            value={schedule.workOrder}
            onChange={(e) => run(() => api.setWorkOrder(workId, e.target.value))}
          >
            <option value="stage">{t("orderStage")}</option>
            <option value="page">{t(board.work.kind === "files" ? "orderPageFiles" : "orderPageComic")}</option>
          </select>
        </label>
      </div>
      <div className="plans">
        {forecast.plans.map((plan) => (
          <PlanCard
            key={plan.key}
            plan={plan}
            forecast={forecast}
            selected={chosen?.key === plan.key}
            onChoose={() => choose(plan)}
          />
        ))}
        <button className={`card plan custom${chosen?.key === "custom" ? " on" : ""}`} onClick={() => setCustom(chosen?.key === "custom" ? chosen.steps : [])}>
          <b>{t("customTitle")}</b>
          <span className="muted small-text">
            {t("customHint1")}
            <br />
            {t("customHint2")}
          </span>
        </button>
      </div>

      {custom && (
        <CustomPicker
          forecast={forecast}
          initial={custom}
          onCancel={() => setCustom(null)}
          onDone={(steps) => {
            choose({ key: "custom", name: t("customName"), steps });
            setCustom(null);
          }}
        />
      )}
    </>
  );
}

function stepRows(forecast: Forecast, steps: PlanStep[]) {
  const { board } = forecast;
  return steps.map((s) => {
    const page = board.pages.find((p) => p.id === s.pageId);
    const stage = board.stages.find((st) => st.id === s.stageId);
    const task = forecast.task(s.pageId, s.stageId);
    const note = s.partial ? t("partial") : task && task.spentMs > 0 ? t("continued") : "";
    return { key: `${s.pageId}-${s.stageId}`, page, stage, note, ms: s.ms };
  });
}

function PlanCard({ plan, forecast, selected, onChoose }: { plan: Plan; forecast: Forecast; selected: boolean; onChoose: () => void }) {
  const rows = stepRows(forecast, plan.steps);
  const total = plan.steps.reduce((n, s) => n + s.ms, 0);
  const byStage = forecast.board.stages
    .map((st) => ({ st, ms: plan.steps.filter((s) => s.stageId === st.id).reduce((n, s) => n + s.ms, 0) }))
    .filter((x) => x.ms > 0);
  return (
    <button className={`card plan${selected ? " on" : ""}`} disabled={!!plan.disabled} onClick={onChoose}>
      <h4>
        <span>
          {plan.name}
          {plan.sub && <span className="muted plan-sub"> {plan.sub}</span>}
        </span>
        {selected && <span className="tag sys">{t("selected")}</span>}
      </h4>
      {plan.disabled ? (
        <div className="muted small-text">{plan.disabled}</div>
      ) : (
        <>
          <div className="steps">
            {rows.map((r) => (
              <div key={r.key} className="step">
                <i style={{ background: r.stage?.color }} />
                <b>{r.page?.label}</b>
                <span>
                  {r.stage?.name} <span className="muted">{r.note}</span>
                </span>
                <span className="num">{estimate(r.ms)}</span>
              </div>
            ))}
          </div>
          {total < forecast.planQuotaMs - 0.05 * HOUR && (
            <div className="muted small-text" style={{ marginTop: 6 }}>
              {t("fewTasks", { time: estimate(forecast.planQuotaMs - total) })}
            </div>
          )}
          <div className="mixbar">
            {byStage.map((x) => (
              <span key={x.st.id} style={{ width: `${(x.ms / total) * 100}%`, background: x.st.color }} />
            ))}
          </div>
        </>
      )}
    </button>
  );
}

function CustomPicker({
  forecast,
  initial,
  onCancel,
  onDone,
}: {
  forecast: Forecast;
  initial: PlanStep[];
  onCancel: () => void;
  onDone: (steps: PlanStep[]) => void;
}) {
  const [picked, setPicked] = useState<PlanStep[]>(initial);
  const { board } = forecast;
  const total = picked.reduce((n, s) => n + s.ms, 0);
  const pct = forecast.planQuotaMs > 0 ? Math.min(100, (total / forecast.planQuotaMs) * 100) : 0;
  const isPicked = (pageId: number, stageId: number) => picked.some((s) => s.pageId === pageId && s.stageId === stageId);

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="dialog wide">
        <h3>{t("pickTitle")}</h3>
        <div className="row small-text" style={{ justifyContent: "space-between" }}>
          <span className="num">
            <b>{estimate(total)}</b> / {forecast.quotaMet ? t("guide") : t("remainingQuota")} {estimate(forecast.planQuotaMs)}
          </span>
          <span className="muted">{Math.round(pct)}%</span>
        </div>
        <div className="bar" style={{ marginBottom: 12 }}>
          <span style={{ width: `${pct}%`, background: "var(--accent)" }} />
        </div>
        <div className="pick-list">
          {board.stages.map((stage) => {
            const cands = forecast.candidates.filter((c) => c.stageId === stage.id);
            if (cands.length === 0) return null;
            return (
              <div key={stage.id}>
                <div className="section-title" style={{ marginTop: 8 }}>
                  <span className="sdot" style={{ background: stage.color }} /> {stage.name}
                </div>
                {cands.map((c) => {
                  const page = board.pages.find((p) => p.id === c.pageId);
                  const on = isPicked(c.pageId, c.stageId);
                  return (
                    <label key={`${c.pageId}-${c.stageId}`} className={`pick${on ? " on" : ""}`}>
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() =>
                          setPicked((list) =>
                            on
                              ? list.filter((s) => !(s.pageId === c.pageId && s.stageId === c.stageId))
                              : [...list, { pageId: c.pageId, stageId: c.stageId, ms: c.remainingMs, partial: false }],
                          )
                        }
                      />
                      <b>{page?.label}</b>
                      <span className="muted">{c.inProgress ? t("continued") : ""}</span>
                      <span className="grow" />
                      <span className="num">{t("remaining", { time: estimate(c.remainingMs) })}</span>
                    </label>
                  );
                })}
              </div>
            );
          })}
        </div>
        <div className="actions">
          <button className="btn" onClick={onCancel}>
            {t("cancel")}
          </button>
          <button className="btn primary" disabled={picked.length === 0} onClick={() => onDone(picked)}>
            {t("confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
