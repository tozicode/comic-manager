// ミニタイマー窓。CLIP STUDIO の上に常に表示しておく小さな窓
import { useEffect, useState } from "react";
import { api } from "./api";
import { useApp } from "./app-context";
import { usePomodoro } from "./components/Pomodoro";
import { SaveToast } from "./components/Watchers";
import { Thumb, spreadSide } from "./components/Thumb";
import { Forecast, loadChosenPlan, useForecast } from "./forecast";
import { clock, estimate, hours } from "./format";
import { t } from "./i18n/timer";
import { pomoClock, remainingMs } from "./pomodoro";

const COMPACT_KEY = "otosazu.miniCompact";
const PIN_KEY = "otosazu.miniPinned";
/** ミニ窓を開いたままアプリを終えたか。1 なら次の起動でメインの窓が開き直す（App.tsx） */
export const MINI_OPEN_KEY = "otosazu.miniOpen";

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
const CheckIcon = () => (
  <svg viewBox="0 0 10 10">
    <path d="M1.5 5.5 L4 8 L8.5 2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const UndoIcon = () => (
  <svg viewBox="0 0 10 10">
    <path d="M3.5 2 L1.5 4 L3.5 6 M1.5 4 H6 a2 2 0 0 1 0 4 H4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const PlayIcon = () => (
  <svg viewBox="0 0 10 10">
    <path d="M2 1 L9 5 L2 9 Z" fill="currentColor" />
  </svg>
);

/** 切り替え先のタスクを選ぶ select。着手できるタスクを先に、前の工程が終わっていないタスクも後ろに出す（工程順に進めないこともあるため） */
function TaskPicker({ f, onPick, onClose }: { f: Forecast; onPick: (pageId: number, stageId: number) => void; onClose: () => void }) {
  return (
    <select
      className="field"
      autoFocus
      onBlur={onClose}
      onChange={(e) => {
        const [pid, sid] = e.target.value.split("-").map(Number);
        onClose();
        if (pid) onPick(pid, sid);
      }}
      defaultValue=""
    >
      <option value="">{t("pickTask")}</option>
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
  );
}

/** 工程の色の ●（ページ名と工程名の間に置く） */
function StageDot({ color }: { color: string }) {
  return <span style={{ color }}>●</span>;
}

/** ミニ窓用のページのサムネ。ファイルを持たない作品やページが見つからないときは出さない */
function PageThumb({ f, pageId }: { f: Forecast; pageId: number }) {
  const page = f.board.pages.find((x) => x.id === pageId);
  if (!page || f.board.work.kind === "manual") return null;
  return <Thumb path={page.path} spread={page.span === 2} half={spreadSide(page, f.board.work)} free={f.board.work.kind === "files"} width={40} />;
}

export function MiniApp() {
  const app = useApp();
  const [compact, setCompact] = useState(() => loadFlag(COMPACT_KEY, false));
  const [pinned, setPinned] = useState(() => loadFlag(PIN_KEY, true));
  const workId = app.active?.workId ?? app.paused?.workId ?? lastWorkId();
  const forecast = useForecast(workId);
  const [picking, setPicking] = useState(false);
  /** 計測していないときに選んだタスク。「次にやること」の枠に入れるだけで、▶ を押すまで計測は始めない */
  const [picked, setPicked] = useState<{ pageId: number; stageId: number } | null>(null);

  // 開いている間は「開いていた」と覚えておき、✕ で閉じたときだけ消す（次の起動で開き直すかの目印）
  useEffect(() => {
    saveFlag(MINI_OPEN_KEY, true);
  }, []);
  const close = () => {
    saveFlag(MINI_OPEN_KEY, false);
    api.closeMini().catch(app.showError);
  };

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
  const pausedColor = paused && f ? (f.board.stages.find((x) => x.id === paused.stageId)?.color ?? "") : "";

  // 次にやること：今日選んだ案の、まだ終わっていない最初のタスク。案が無ければ着手できる最初のタスク
  const plan = workId ? loadChosenPlan(workId) : null;
  // 自分で選んだタスクがあれば（まだ終わっていなければ）それを優先する
  const next = (() => {
    if (!f) return null;
    const pickedTask = picked ? f.task(picked.pageId, picked.stageId) : undefined;
    const fromPlan = plan?.steps.find((s) => {
      const t = f.task(s.pageId, s.stageId);
      return t && !t.done;
    });
    const c = pickedTask && !pickedTask.done ? picked : (fromPlan ?? f.candidates[0]);
    if (!c) return null;
    const p = f.board.pages.find((x) => x.id === c.pageId);
    const st = f.board.stages.find((x) => x.id === c.stageId);
    const t = f.task(c.pageId, c.stageId);
    return p && st && t ? { page: p, stage: st, task: t, picked: c === picked } : null;
  })();

  // 選んだタスク：計測中なら作業の続きなのでそのまま切り替える。計測していなければ枠に入れるだけ
  const pick = (pageId: number, stageId: number) => {
    if (active) {
      app.start(pageId, stageId);
      return;
    }
    app.setPaused(null);
    setPicked({ pageId, stageId });
  };
  // 計測を始めたら（どの窓からでも）選びは役目を終える
  useEffect(() => {
    if (active) setPicked(null);
  }, [active]);

  if (compact) {
    return (
      <div className="miniwin compact" data-tauri-drag-region onDoubleClick={toggleCompact} title={t("expandHint")}>
        {active ? <span className="dot" /> : <span className="dot off" />}
        <div className="grow" data-tauri-drag-region>
          {picking && f ? (
            <TaskPicker f={f} onPick={pick} onClose={() => setPicking(false)} />
          ) : (
            <>
              {/* 1 行目は押すと切り替え先を選べる。窓をつかむのは 2 行目（時刻）と余白 */}
              <button className="mpick small-text" title={f ? t("pickOther") : undefined} disabled={!f} onClick={() => setPicking(true)}>
                {due && p
                  ? t("pomoDue", { min: Math.round(p.alertAtMs / 60_000) })
                  : onBreak
                    ? breakLabel
                    : breakOver
                      ? t("pomoBreakOver")
                      : active
                        ? <>{active.pageLabel} <StageDot color={active.stageColor} /> {active.stageName}</>
                        : paused
                          ? <>{t("pausedWith", { page: paused.pageLabel })} {pausedColor && <StageDot color={pausedColor} />} {paused.stageName}</>
                          : next
                            ? <>{t(next.picked ? "pickedTask" : "next")} {next.page.label} <StageDot color={next.stage.color} /> {next.stage.name}</>
                            : t("notTracking")}
                {f && <span className="caret">▾</span>}
              </button>
              <div className="num mtime-s" data-tauri-drag-region>
                {active ? clock(now - active.startedAt) : "--:--:--"}
              </div>
            </>
          )}
        </div>
        {due ? (
          <button className="icon-btn accent" title={t("takeBreak")} onClick={pomo.takeBreak}>
            ☕
          </button>
        ) : active ? (
          <>
            <button className="icon-btn accent" title={t("pause")} onClick={app.pause}>
              <PauseIcon />
            </button>
            <button className="icon-btn sec" title={t("markDone")} onClick={app.finish}>
              <CheckIcon />
            </button>
          </>
        ) : app.finished && !app.finished.wasDone ? (
          <button className="icon-btn sec" title={t("undoFinish")} onClick={app.undoFinish}>
            <UndoIcon />
          </button>
        ) : paused ? (
          <button className="icon-btn accent" title={t("resume")} onClick={app.resume}>
            <PlayIcon />
          </button>
        ) : next ? (
          <button className="icon-btn accent" title={t("start")} onClick={() => app.start(next.page.id, next.stage.id)}>
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
          <button title={t("close")} onClick={close}>
            ✕
          </button>
        </span>
      </div>

      {due && p ? (
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
          {f && <PageThumb f={f} pageId={active.pageId} />}
          <div className="grow">
            <button className="mpick small-text" title={t("pickOther")} onClick={() => setPicking(true)}>
              <b>{active.pageLabel}</b> · <StageDot color={active.stageColor} /> {active.stageName} <span className="caret">▾</span>
            </button>
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
            <button className="icon-btn sec" title={t("markDone")} onClick={app.finish}>
              <CheckIcon />
            </button>
          </div>
        </div>
      ) : (
        <div className="mbody">
          {paused ? (
            <>
              {f && <PageThumb f={f} pageId={paused.pageId} />}
              <div className="grow">
                <div className={`small-text${onBreak || breakOver ? " mbreak" : " muted"}`}>
                  {onBreak ? breakLabel : breakOver ? t("pomoBreakOver") : t("paused")}
                </div>
                <div className="mnext">
                  {paused.pageLabel} {pausedColor && <StageDot color={pausedColor} />} {paused.stageName}
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
              {f && <PageThumb f={f} pageId={next.page.id} />}
              <div className="grow">
                <div className="small-text muted">{t(next.picked ? "pickedTask" : "next")}</div>
                <button className="mpick mnext" title={t("pickOther")} onClick={() => setPicking(true)}>
                  {next.page.label} <StageDot color={next.stage.color} /> {next.stage.name} <span className="caret">▾</span>
                </button>
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

      {f && (
        <div className="mfoot">
          {picking ? (
            <TaskPicker f={f} onPick={pick} onClose={() => setPicking(false)} />
          ) : (
            <>
              {/* 完了にした直後は、ノルマの 2 行を通知に差し替える（窓に重ねると「別のタスクを選ぶ」を塞ぐため） */}
              {app.finished ? (
                <div className="mfinished row small-text">
                  <span className="grow">{t("finishedTitle", { page: app.finished.pageLabel, stage: app.finished.stageName })}</span>
                  {!app.finished.wasDone && (
                    <button className="btn small" onClick={app.undoFinish}>
                      {t("undo")}
                    </button>
                  )}
                </div>
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
                </>
              )}
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
