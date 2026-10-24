import { useApp } from "../app-context";
import { clock } from "../format";
import { t } from "../i18n/timer";
import { pomoClock, remainingMs } from "../pomodoro";
import { usePomodoro } from "./Pomodoro";

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

/** 右上に常に出す計測中のタイマー */
export function TimerChip({ onOpenWork }: { onOpenWork: (workId: number) => void }) {
  const { active, paused, now, pause, resume, stop } = useApp();
  const pomo = usePomodoro();
  const p = pomo.pomo;

  if (active && p?.phase === "due") {
    return (
      <div className="timer-chip due">
        <span className="what">{t("pomoDue", { min: Math.round(p.alertAtMs / 60_000) })}</span>
        <span className="time num">{clock(now - active.startedAt)}</span>
        <button className="chip-btn" onClick={pomo.keepGoing}>
          {t("keepGoing")}
        </button>
        <button className="chip-btn primary" onClick={pomo.takeBreak}>
          {t("takeBreak")}
        </button>
      </div>
    );
  }
  if (!active && paused && (p?.phase === "break" || p?.phase === "breakOver")) {
    return (
      <div className={`timer-chip break${p.phase === "breakOver" ? " over" : ""}`}>
        <span className="what">
          {p.phase === "break"
            ? t(p.long ? "pomoLongBreak" : "pomoBreak", { time: pomoClock(remainingMs(p, pomo.now)) })
            : t("pomoBreakOverWith", { page: paused.pageLabel, stage: paused.stageName })}
        </span>
        <button className="icon-btn" title={t("resume")} onClick={resume}>
          <PlayIcon />
        </button>
        <button className="icon-btn" title={t("stopTracking")} onClick={stop}>
          <StopIcon />
        </button>
      </div>
    );
  }
  if (active) {
    return (
      <div className="timer-chip">
        <span className="dot" />
        <button className="what" onClick={() => onOpenWork(active.workId)} title={active.workTitle}>
          {active.pageLabel} · {active.stageName}
        </button>
        <span className="time num">{clock(now - active.startedAt)}</span>
        {p?.phase === "work" && (
          <span className="pomo num">{t("pomoLeft", { time: pomoClock(remainingMs(p, now)) })}</span>
        )}
        <button className="icon-btn" title={t("pause")} onClick={pause}>
          <PauseIcon />
        </button>
        <button className="icon-btn" title={t("stop")} onClick={stop}>
          <StopIcon />
        </button>
      </div>
    );
  }
  if (paused) {
    return (
      <div className="timer-chip paused">
        <span className="what">
          {t("chipPaused", { page: paused.pageLabel, stage: paused.stageName })}
        </span>
        <button className="icon-btn" title={t("resume")} onClick={resume}>
          <PlayIcon />
        </button>
        <button className="icon-btn" title={t("stopTracking")} onClick={stop}>
          <StopIcon />
        </button>
      </div>
    );
  }
  return <div className="timer-idle">{t("chipIdle")}</div>;
}
