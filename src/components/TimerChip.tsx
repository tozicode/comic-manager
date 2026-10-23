import { useApp } from "../app-context";
import { clock } from "../format";

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

  if (active) {
    return (
      <div className="timer-chip">
        <span className="dot" />
        <button className="what" onClick={() => onOpenWork(active.workId)} title={active.workTitle}>
          {active.pageLabel} · {active.stageName}
        </button>
        <span className="time num">{clock(now - active.startedAt)}</span>
        <button className="icon-btn" title="一時停止" onClick={pause}>
          <PauseIcon />
        </button>
        <button className="icon-btn" title="止める" onClick={stop}>
          <StopIcon />
        </button>
      </div>
    );
  }
  if (paused) {
    return (
      <div className="timer-chip paused">
        <span className="what">
          一時停止中 · {paused.pageLabel} {paused.stageName}
        </span>
        <button className="icon-btn" title="再開" onClick={resume}>
          <PlayIcon />
        </button>
        <button className="icon-btn" title="計測をやめる" onClick={stop}>
          <StopIcon />
        </button>
      </div>
    );
  }
  return <div className="timer-idle">⏱ 計測していません</div>;
}
