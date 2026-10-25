// ミニタイマー窓。CLIP STUDIO の上に常に表示しておく小さな窓
import { useEffect, useState } from "react";
import { api } from "./api";
import { useApp } from "./app-context";
import { usePomodoro } from "./components/Pomodoro";
import { SaveToast } from "./components/Watchers";
import { Thumb } from "./components/Thumb";
import { loadChosenPlan, useForecast } from "./forecast";
import { clock, estimate, hours } from "./format";
import { t } from "./i18n/timer";
import { pomoClock, remainingMs } from "./pomodoro";

const COMPACT_KEY = "otosazu.miniCompact";
const PIN_KEY = "otosazu.miniPinned";

function loadFlag(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}

function saveFlag(key: string, v: boolean) {
  try {
    localStorage.setItem(key, v ? "1" : "0");
  } catch {
    // 次に開いたときに既定の状態に戻るだけ
  }
}

function lastWorkId(): number | null {
  try {
    const v = Number(localStorage.getItem("otosazu.workId"));
    return v > 0 ? v : null;
  } catch {
    return null;
  }
}

const PauseIcon = () => (
  <svg viewBox="0 0 10 10">
    <rect x="1.5" y="1" width="2.5" height="8" fill="currentColor" />
    <rect x="6" y="1" width="2.5" height="8" fill="currentColor" />
  </svg>
);
const StopIcon = () => (
  <svg viewBox="0 0 10 10">
    <rect x="1.5" y="1.5" width="7" height="7" fill="currentColor" />
  </svg>
);
const PlayIcon = () => (
  <svg viewBox="0 0 10 10">
    <path d="M2 1 L9 5 L2 9 Z" fill="currentColor" />
  </svg>
);

export function MiniApp() {
  const app = useApp();
  const [compact, setCompact] = useState(() => loadFlag(COMPACT_KEY, false));
  const [pinned, setPinned] = useState(() => loadFlag(PIN_KEY, true));
  const workId = app.active?.workId ?? app.paused?.workId ?? lastWorkId();
  const forecast = useForecast(workId);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    api.setMiniCompact(compact).catch(app.showError);
  }, [compact, app.showError]);
  useEffect(() => {
    api.setMiniOnTop(pinned).catch(app.showError);
  }, [pinned, app.showError]);

  const toggleCompact = () => {
    saveFlag(COMPACT_KEY, !compact);
    setCompact(!compact);
  };
  const togglePin = () => {
    saveFlag(PIN_KEY, !pinned);
    setPinned(!pinned);
  };

  const { active, paused, now } = app;
  const f = forecast;
  const pomo = usePomodoro();
  const p = pomo.pomo;
  const due = !!active && p?.phase === "due";
  const onBreak = !active && !!paused && p?.phase === "break";
  const breakOver = !active && !!paused && p?.phase === "breakOver";
  const breakLabel = p && onBreak ? t(p.long ? "pomoLongBreak" : "pomoBreak", { time: pomoClock(remainingMs(p, pomo.now)) }) : "";
  const task = active && f ? f.task(active.pageId, active.stageId) : undefined;
  const page = active && f ? f.board.pages.find((p) => p.id === active.pageId) : undefined;

  // 次にやること：今日選んだ案の、まだ終わっていない最初のタスク。案が無ければ着手できる最初のタスク
  const plan = workId ? loadChosenPlan(workId) : null;
  const next = (() => {
    if (!f) return null;
    const fromPlan = plan?.steps.find((s) => {
      const t = f.task(s.pageId, s.stageId);
      return t && !t.done;
    });
    const c = fromPlan ?? f.candidates[0];
    if (!c) return null;
    const p = f.board.pages.find((x) => x.id === c.pageId);
    const st = f.board.stages.find((x) => x.id === c.stageId);
    const t = f.task(c.pageId, c.stageId);
    return p && st && t ? { page: p, stage: st, task: t } : null;
  })();

  if (compact) {
    return (
      <div className="miniwin compact" data-tauri-drag-region onDoubleClick={toggleCompact} title={t("expandHint")}>
        {active ? <span className="dot" /> : <span className="dot off" />}
        <div className="grow" data-tauri-drag-region>
          <div className="small-text" data-tauri-drag-region>
            {due && p
              ? t("pomoDue", { min: Math.round(p.alertAtMs / 60_000) })
              : onBreak
                ? breakLabel
                : breakOver
                  ? t("pomoBreakOver")
                  : active
                    ? `${active.pageLabel} ${active.stageName}`
                    : paused
                      ? t("pausedWith", { page: paused.pageLabel })
                      : t("notTracking")}
          </div>
          <div className="num mtime-s" data-tauri-drag-region>
            {active ? clock(now - active.startedAt) : "--:--:--"}
          </div>
        </div>
        {due ? (
          <button className="icon-btn accent" title={t("takeBreak")} onClick={pomo.takeBreak}>
            ☕
          </button>
        ) : active ? (
          <button className="icon-btn accent" title={t("pause")} onClick={app.pause}>
            <PauseIcon />
          </button>
        ) : paused ? (
          <button className="icon-btn accent" title={t("resume")} onClick={app.resume}>
            <PlayIcon />
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="miniwin">
      <div className="mtitle" data-tauri-drag-region onDoubleClick={() => api.focusMain()}>
        <span data-tauri-drag-region title={t("openMainHint")}>
          Otosazu{f ? ` · ${f.board.work.title}` : ""}
        </span>
        {active && p?.phase === "work" && (
          <span className="mpomo num" data-tauri-drag-region>
            {t("pomoLeft", { time: pomoClock(remainingMs(p, now)) })}
          </span>
        )}
        <span className="mtools">
          <button className={pinned ? "on" : ""} title={pinned ? t("pinnedOn") : t("pinnedOff")} onClick={togglePin}>
            📌
          </button>
          <button title={t("compact")} onClick={toggleCompact}>
            ⤡
          </button>
          <button title={t("close")} onClick={() => api.closeMini()}>
            ✕
          </button>
        </span>
      </div>

      {app.stopped ? (
        <div className="mbody column">
          <b>
            {t("stoppedTitle", { page: app.stopped.pageLabel, stage: app.stopped.stageName })}
          </b>
          <span className="muted small-text">
            {t("stoppedBody", { now: hours(app.stopped.durationMs), total: hours(app.stopped.totalMs) })}
          </span>
          <div className="row tight" style={{ justifyContent: "flex-end" }}>
            <button className="btn small" onClick={() => app.answerStopped(false)}>
              {t("notYet")}
            </button>
            <button className="btn small primary" onClick={() => app.answerStopped(true)}>
              {t("markDone")}
            </button>
          </div>
        </div>
      ) : due && p ? (
        <div className="mbody column">
          <b>{t("pomoDue", { min: Math.round(p.alertAtMs / 60_000) })}</b>
          <span className="muted small-text">
            {t("pomoDueBody")} · {active.pageLabel} {active.stageName} <span className="num">{clock(now - active.startedAt)}</span>
          </span>
          <div className="row tight" style={{ justifyContent: "flex-end" }}>
            <button className="btn small" onClick={pomo.keepGoing}>
              {t("keepGoing")}
            </button>
            <button className="btn small primary" onClick={pomo.takeBreak}>
              {t("takeBreak")}
            </button>
          </div>
        </div>
      ) : active ? (
        <div className="mbody">
          {f && page && f.board.work.kind !== "manual" && (
            <Thumb path={page.path} spread={page.span === 2} free={f.board.work.kind === "files"} width={40} />
          )}
          <div className="grow">
            <div className="small-text">
              <b>{active.pageLabel}</b> · <span style={{ color: active.stageColor }}>●</span> {active.stageName}
            </div>
            <div className="mtime num">{clock(now - active.startedAt)}</div>
            {task && (
              <div className="muted tiny">
                {task.predictedMs - task.spentMs > 0
                  ? t("predictedLeft", { time: estimate(task.predictedMs), left: estimate(task.predictedMs - task.spentMs) })
                  : t("predictedOver", { time: estimate(task.predictedMs) })}
              </div>
            )}
          </div>
          <div className="mctrl">
            <button className="icon-btn accent" title={t("pause")} onClick={app.pause}>
              <PauseIcon />
            </button>
            <button className="icon-btn sec" title={t("stop")} onClick={app.stop}>
              <StopIcon />
            </button>
          </div>
        </div>
      ) : (
        <div className="mbody">
          {paused ? (
            <>
              <div className="grow">
                <div className={`small-text${onBreak || breakOver ? " mbreak" : " muted"}`}>
                  {onBreak ? breakLabel : breakOver ? t("pomoBreakOver") : t("paused")}
                </div>
                <div className="mnext">
                  {paused.pageLabel} {paused.stageName}
                </div>
              </div>
              <div className="mctrl">
                <button className="icon-btn accent big" title={t("resume")} onClick={app.resume}>
                  <PlayIcon />
                </button>
                <button className="icon-btn sec" title={t("stopTracking")} onClick={app.stop}>
                  <StopIcon />
                </button>
              </div>
            </>
          ) : next ? (
            <>
              <div className="grow">
                <div className="small-text muted">{t("next")}</div>
                <div className="mnext">
                  {next.page.label} {next.stage.name}
                </div>
                <div className="muted tiny">
                  {next.task.spentMs > 0
                    ? t("continuedLeft", { time: estimate(next.task.remainingMs) })
                    : t("remaining", { time: estimate(next.task.remainingMs) })}
                </div>
              </div>
              <button className="icon-btn accent big" title={t("start")} onClick={() => app.start(next.page.id, next.stage.id)}>
                <PlayIcon />
              </button>
            </>
          ) : (
            <div className="muted small-text">{workId ? t("noTasks") : t("chooseWorkInMain")}</div>
          )}
        </div>
      )}

      {f && !app.stopped && (
        <div className="mfoot">
          {picking ? (
            <select
              className="field"
              autoFocus
              onBlur={() => setPicking(false)}
              onChange={(e) => {
                const [pid, sid] = e.target.value.split("-").map(Number);
                setPicking(false);
                if (pid) app.start(pid, sid);
              }}
              defaultValue=""
            >
              <option value="">{t("pickTask")}</option>
              {/* 着手できるタスクを先に、前の工程が終わっていないタスクも後ろに出す（工程順に進めないこともあるため） */}
              {[...f.candidates, ...f.openTasks.filter((c) => !f.candidates.includes(c))].map((c) => {
                const p = f.board.pages.find((x) => x.id === c.pageId);
                const st = f.board.stages.find((x) => x.id === c.stageId);
                const waiting = !f.candidates.includes(c);
                return (
                  <option key={`${c.pageId}-${c.stageId}`} value={`${c.pageId}-${c.stageId}`}>
                    {t(waiting ? "taskOptionWaiting" : "taskOption", {
                      page: p?.label ?? "",
                      stage: st?.name ?? "",
                      time: estimate(c.remainingMs),
                    })}
                  </option>
                );
              })}
            </select>
          ) : (
            <>
              <div className="row small-text" style={{ justifyContent: "space-between" }}>
                <span>{t("quota")}</span>
                <span className="num">
                  <b>{hours(f.workedTodayMs)}</b> / {estimate(plan?.quotaMs ?? f.quotaMs)}
                </span>
              </div>
              <div className="bar">
                <span
                  style={{
                    width: `${Math.min(100, (f.workedTodayMs / Math.max(1, plan?.quotaMs ?? f.quotaMs)) * 100)}%`,
                    background: "var(--accent)",
                  }}
                />
              </div>
              <button className="link small-text" onClick={() => setPicking(true)}>
                {t("pickOther")}
              </button>
            </>
          )}
        </div>
      )}
      <SaveToast />
    </div>
  );
}
