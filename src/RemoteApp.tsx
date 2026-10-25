// 遠隔の画面（別端末のブラウザ。仕様書 5.17）。
// 進捗を見て、タイマーを開始・一時停止・停止するだけの画面。作品の追加や設定はここには出さない。
// 作りはミニタイマーの窓（MiniApp.tsx）と同じで、指で押せる大きさにしてある。
import { useEffect, useState } from "react";
import { api, BoardPage, WorkSummary } from "./api";
import { useApp } from "./app-context";
import { Thumb } from "./components/Thumb";
import { Forecast, useForecast } from "./forecast";
import { clock, estimate, hours } from "./format";
import { t } from "./i18n/timer";
import { t as tr } from "./i18n/remote";

const WORK_KEY = "otosazu.workId";

function loadWorkId(): number | null {
  try {
    const v = Number(localStorage.getItem(WORK_KEY));
    return v > 0 ? v : null;
  } catch {
    return null;
  }
}

function saveWorkId(id: number) {
  try {
    localStorage.setItem(WORK_KEY, String(id));
  } catch {
    // 次に開いたときに最初の作品から始まるだけ
  }
}

export function RemoteApp() {
  const app = useApp();
  const [works, setWorks] = useState<WorkSummary[] | null>(null);
  const [workId, setWorkIdState] = useState<number | null>(loadWorkId);

  const setWorkId = (id: number) => {
    setWorkIdState(id);
    saveWorkId(id);
  };

  useEffect(() => {
    api.listWorks().then(setWorks).catch(app.showError);
  }, [app.version, app.showError]);

  // 計測中の作品があればそれを、無ければ覚えていた作品、それも無ければ最初の作品を見せる
  const chosen = app.active?.workId ?? workId;
  const work = works?.find((w) => w.id === chosen) ?? works?.[0] ?? null;
  const forecast = useForecast(work?.id ?? null);

  const { active, paused, now } = app;
  const f = forecast;
  const next = f?.candidates[0];
  const nextPage = next && f.board.pages.find((p) => p.id === next.pageId);
  const nextStage = next && f.board.stages.find((s) => s.id === next.stageId);

  return (
    <div className="remote">
      <header className="rhead">
        <span className="rbrand">Otosazu</span>
        {works && works.length > 0 && (
          <select
            className="field"
            aria-label={tr("work")}
            value={work?.id ?? ""}
            onChange={(e) => setWorkId(Number(e.target.value))}
          >
            {works.map((w) => (
              <option key={w.id} value={w.id}>
                {w.title}
              </option>
            ))}
          </select>
        )}
      </header>

      {app.error && (
        <div className="error" role="alert">
          <span className="grow">{app.error}</span>
          <button className="btn small ghost" onClick={app.clearError}>
            {t("close")}
          </button>
        </div>
      )}

      {/* 計測の札：止めた直後の確認 → 計測中 → 一時停止中 → 次にやること の順に見せる */}
      <section className="rcard">
        {app.stopped ? (
          <>
            <div className="rtask">{t("stoppedTitle", { page: app.stopped.pageLabel, stage: app.stopped.stageName })}</div>
            <div className="muted small-text">
              {t("stoppedBody", { now: hours(app.stopped.durationMs), total: hours(app.stopped.totalMs) })}
            </div>
            <div className="ractions">
              <button className="rbtn" onClick={() => app.answerStopped(false)}>
                {t("notYet")}
              </button>
              <button className="rbtn primary" onClick={() => app.answerStopped(true)}>
                {t("markDone")}
              </button>
            </div>
          </>
        ) : active ? (
          <>
            <div className="rtask">
              <b>{active.pageLabel}</b> <span style={{ color: active.stageColor }}>●</span> {active.stageName}
            </div>
            <div className="rclock num">{clock(now - active.startedAt)}</div>
            <div className="ractions">
              <button className="rbtn" onClick={app.pause}>
                {t("pause")}
              </button>
              <button className="rbtn primary" onClick={app.stop}>
                {t("stop")}
              </button>
            </div>
          </>
        ) : paused ? (
          <>
            <div className="muted small-text">{t("paused")}</div>
            <div className="rtask">
              {paused.pageLabel} {paused.stageName}
            </div>
            <div className="ractions">
              <button className="rbtn primary" onClick={app.resume}>
                {t("resume")}
              </button>
              <button className="rbtn" onClick={app.stop}>
                {t("stopTracking")}
              </button>
            </div>
          </>
        ) : next && nextPage && nextStage ? (
          <>
            <div className="muted small-text">{t("next")}</div>
            <div className="rtask">
              {nextPage.label} {nextStage.name}
            </div>
            <div className="muted small-text">{t("remaining", { time: estimate(next.remainingMs) })}</div>
            <div className="ractions">
              <button className="rbtn primary wide" onClick={() => app.start(nextPage.id, nextStage.id)}>
                {t("start")}
              </button>
            </div>
          </>
        ) : (
          <div className="muted small-text">{works === null ? tr("loading") : f ? t("noTasks") : tr("noWorks")}</div>
        )}
      </section>

      {/* 今日のノルマ */}
      {f && (
        <section className="rquota">
          <div className="row small-text" style={{ justifyContent: "space-between" }}>
            <span>{t("quota")}</span>
            <span className="num">
              <b>{hours(f.workedTodayMs)}</b> / {estimate(f.quotaMs)}
            </span>
          </div>
          <div className="bar">
            <span style={{ width: `${Math.min(100, (f.workedTodayMs / Math.max(1, f.quotaMs)) * 100)}%`, background: "var(--accent)" }} />
          </div>
        </section>
      )}

      {/* 進捗。マスを押すとそのタスクの計測を始める（完了にするのは止めたあとの確認で） */}
      {f && (
        <section className="rboard">
          <h2 className="small-text muted">{tr("progress")}</h2>
          <div className="rgrid" style={{ gridTemplateColumns: `auto repeat(${f.board.stages.length}, minmax(0, 1fr))` }}>
            <span />
            {f.board.stages.map((s) => (
              <span key={s.id} className="rstage tiny" title={s.name}>
                {s.name}
              </span>
            ))}
            {f.board.pages.map((page) => (
              <RemoteRow key={page.id} page={page} forecast={f} onStart={app.start} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

type RowProps = {
  page: BoardPage;
  forecast: Forecast;
  onStart: (pageId: number, stageId: number) => Promise<void>;
};

function RemoteRow({ page, forecast, onStart }: RowProps) {
  const f = forecast;
  const kind = f.board.work.kind;
  return (
    <>
      <span className="rpage">
        {kind !== "manual" && <Thumb path={page.path} spread={page.span === 2} free={kind === "files"} width={28} />}
        <span className="tiny">{page.label}</span>
      </span>
      {f.board.stages.map((stage, i) => {
        const cell = page.cells[i];
        const task = f.task(page.id, stage.id);
        // 前の工程が終わっていなくても計測はできる（2.2.0 から）。待ちは色を薄くして分かるようにする
        const waiting = i > 0 && !page.cells[i - 1].done;
        const label = cell.done ? "✓" : cell.totalMs > 0 ? hours(cell.totalMs) : task ? estimate(task.remainingMs) : "–";
        return (
          <button
            key={stage.id}
            className={`rcell${cell.done ? " done" : ""}${waiting ? " waiting" : ""}`}
            style={cell.done ? { background: stage.color } : undefined}
            title={cell.done ? tr("done") : waiting ? tr("waiting") : tr("startHere")}
            disabled={cell.done}
            onClick={() => onStart(page.id, stage.id)}
          >
            <span className="num tiny">{label}</span>
          </button>
        );
      })}
    </>
  );
}
