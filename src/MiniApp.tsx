// ミニタイマー窓。CLIP STUDIO の上に常に表示しておく小さな窓
import { useEffect, useState } from "react";
import { api } from "./api";
import { useApp } from "./app-context";
import { SaveToast } from "./components/Watchers";
import { Thumb } from "./components/Thumb";
import { loadChosenPlan, useForecast } from "./forecast";
import { clock, estimate, hours } from "./format";

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
      <div className="miniwin compact" data-tauri-drag-region onDoubleClick={toggleCompact} title="ダブルクリックで大きく表示">
        {active ? <span className="dot" /> : <span className="dot off" />}
        <div className="grow" data-tauri-drag-region>
          <div className="small-text" data-tauri-drag-region>
            {active ? `${active.pageLabel} ${active.stageName}` : paused ? `一時停止中 ${paused.pageLabel}` : "計測していません"}
          </div>
          <div className="num mtime-s" data-tauri-drag-region>
            {active ? clock(now - active.startedAt) : "--:--:--"}
          </div>
        </div>
        {active ? (
          <button className="icon-btn accent" title="一時停止" onClick={app.pause}>
            <PauseIcon />
          </button>
        ) : paused ? (
          <button className="icon-btn accent" title="再開" onClick={app.resume}>
            <PlayIcon />
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="miniwin">
      <div className="mtitle" data-tauri-drag-region onDoubleClick={() => api.focusMain()}>
        <span data-tauri-drag-region title="ダブルクリックでメインの窓を開く">
          Otosazu{f ? ` · ${f.board.work.title}` : ""}
        </span>
        <span className="mtools">
          <button className={pinned ? "on" : ""} title={pinned ? "常に手前に表示中" : "常に手前に表示する"} onClick={togglePin}>
            📌
          </button>
          <button title="小さく表示" onClick={toggleCompact}>
            ⤡
          </button>
          <button title="閉じる" onClick={() => api.closeMini()}>
            ✕
          </button>
        </span>
      </div>

      {app.stopped ? (
        <div className="mbody column">
          <b>
            {app.stopped.pageLabel} の{app.stopped.stageName}は完了しましたか？
          </b>
          <span className="muted small-text">
            今回 {hours(app.stopped.durationMs)} ・ 合計 {hours(app.stopped.totalMs)}
          </span>
          <div className="row tight" style={{ justifyContent: "flex-end" }}>
            <button className="btn small" onClick={() => app.answerStopped(false)}>
              まだ途中
            </button>
            <button className="btn small primary" onClick={() => app.answerStopped(true)}>
              完了にする
            </button>
          </div>
        </div>
      ) : active ? (
        <div className="mbody">
          {f && page && <Thumb path={page.path} spread={page.span === 2} free={f.board.work.kind === "files"} width={40} />}
          <div className="grow">
            <div className="small-text">
              <b>{active.pageLabel}</b> · <span style={{ color: active.stageColor }}>●</span> {active.stageName}
            </div>
            <div className="mtime num">{clock(now - active.startedAt)}</div>
            {task && (
              <div className="muted tiny">
                予測 {estimate(task.predictedMs)} ・{" "}
                {task.predictedMs - task.spentMs > 0
                  ? `残り約 ${estimate(task.predictedMs - task.spentMs)}`
                  : "超過"}
              </div>
            )}
          </div>
          <div className="mctrl">
            <button className="icon-btn accent" title="一時停止" onClick={app.pause}>
              <PauseIcon />
            </button>
            <button className="icon-btn sec" title="止める" onClick={app.stop}>
              <StopIcon />
            </button>
          </div>
        </div>
      ) : (
        <div className="mbody">
          {paused ? (
            <>
              <div className="grow">
                <div className="small-text muted">一時停止中</div>
                <div className="mnext">
                  {paused.pageLabel} {paused.stageName}
                </div>
              </div>
              <div className="mctrl">
                <button className="icon-btn accent big" title="再開" onClick={app.resume}>
                  <PlayIcon />
                </button>
                <button className="icon-btn sec" title="計測をやめる" onClick={app.stop}>
                  <StopIcon />
                </button>
              </div>
            </>
          ) : next ? (
            <>
              <div className="grow">
                <div className="small-text muted">次にやること</div>
                <div className="mnext">
                  {next.page.label} {next.stage.name}
                </div>
                <div className="muted tiny">
                  {next.task.spentMs > 0 ? "続きから ・ " : ""}残り約 {estimate(next.task.remainingMs)}
                </div>
              </div>
              <button className="icon-btn accent big" title="開始" onClick={() => app.start(next.page.id, next.stage.id)}>
                <PlayIcon />
              </button>
            </>
          ) : (
            <div className="muted small-text">{workId ? "着手できるタスクはありません" : "メインの窓で作品を選んでください"}</div>
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
              <option value="">タスクを選ぶ…</option>
              {f.candidates.map((c) => {
                const p = f.board.pages.find((x) => x.id === c.pageId);
                const st = f.board.stages.find((x) => x.id === c.stageId);
                return (
                  <option key={`${c.pageId}-${c.stageId}`} value={`${c.pageId}-${c.stageId}`}>
                    {p?.label} {st?.name}（残り {estimate(c.remainingMs)}）
                  </option>
                );
              })}
            </select>
          ) : (
            <>
              <div className="row small-text" style={{ justifyContent: "space-between" }}>
                <span>今日のノルマ</span>
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
                別のタスクを選ぶ ▾
              </button>
            </>
          )}
        </div>
      )}
      <SaveToast />
    </div>
  );
}
