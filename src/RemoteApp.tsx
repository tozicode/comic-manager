// 遠隔の画面（別端末のブラウザ。仕様書 5.17）。
// 進捗を見て、タイマーを開始・一時停止・停止するだけの画面。作品の追加や設定はここには出さない。
// 作りはミニタイマーの窓（MiniApp.tsx）と同じで、指で押せる大きさにしてある。
//
// 上の札はつねに「いま注目しているタスク」を出す。主語は 選んだマス ?? 次にやること。
// デスクトップのボードと違い、マスを押しただけでは計測を始めない（指は誤って触れやすいため）。
import { useEffect, useState } from "react";
import { api, BoardPage, Cell, StageRef, WorkSummary } from "./api";
import { useApp } from "./app-context";
import { Thumb } from "./components/Thumb";
import { Forecast, useForecast } from "./forecast";
import { clock, estimate, hours } from "./format";
import { t } from "./i18n/timer";
import { t as tr } from "./i18n/remote";

const WORK_KEY = "otosazu.workId";

/** 選んだマス */
type Picked = { pageId: number; stageId: number };

/** 札に出すタスク 1 つぶんの中身 */
type Subject = {
  page: BoardPage;
  stage: StageRef;
  cell: Cell;
  /** 前の工程がまだ終わっていない（計測はできる） */
  waiting: boolean;
  remainingMs: number;
  spentMs: number;
};

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

/** 選んだマス（無ければ次にやること）を、札に出す形にする */
function toSubject(f: Forecast, ref: Picked | null): Subject | null {
  if (!ref) return null;
  const page = f.board.pages.find((p) => p.id === ref.pageId);
  const index = f.board.stages.findIndex((s) => s.id === ref.stageId);
  const stage = f.board.stages[index];
  if (!page || !stage) return null;
  const task = f.task(page.id, stage.id);
  return {
    page,
    stage,
    cell: page.cells[index],
    waiting: index > 0 && !page.cells[index - 1].done,
    remainingMs: task?.remainingMs ?? 0,
    spentMs: task?.spentMs ?? 0,
  };
}

export function RemoteApp() {
  const app = useApp();
  const [works, setWorks] = useState<WorkSummary[] | null>(null);
  const [workId, setWorkIdState] = useState<number | null>(loadWorkId);
  const [picked, setPicked] = useState<Picked | null>(null);

  useEffect(() => {
    api.listWorks().then(setWorks).catch(app.showError);
  }, [app.version, app.showError]);

  // 計測中の作品があればそれを、無ければ覚えていた作品、それも無ければ最初の作品を見せる
  const chosen = app.active?.workId ?? workId;
  const work = works?.find((w) => w.id === chosen) ?? works?.[0] ?? null;
  const forecast = useForecast(work?.id ?? null);

  // 作品を変えたら選び直す
  useEffect(() => setPicked(null), [work?.id]);

  const setWorkId = (id: number) => {
    setWorkIdState(id);
    saveWorkId(id);
  };

  // 同じマスをもう一度押したら選ぶのをやめる
  const tapCell = (pageId: number, stageId: number) =>
    setPicked((now) => (now?.pageId === pageId && now.stageId === stageId ? null : { pageId, stageId }));

  const start = async (pageId: number, stageId: number) => {
    setPicked(null);
    await app.start(pageId, stageId);
  };

  const { active, paused, now } = app;
  const f = forecast;
  const next = f?.candidates[0];
  const subject = f ? toSubject(f, picked ?? (next ? { pageId: next.pageId, stageId: next.stageId } : null)) : null;
  // 計測中・一時停止中は、自分で選んだときだけタスクの札を出す（タイマーの札が主役なので）
  const showTask = !app.stopped && subject && (picked !== null || (!active && !paused));

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

      {/* 計測の札：止めた直後の確認 → 計測中 → 一時停止中 の順に見せる */}
      {app.stopped ? (
        <section className="rcard">
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
        </section>
      ) : active ? (
        <section className="rcard">
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
        </section>
      ) : paused ? (
        <section className="rcard">
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
        </section>
      ) : null}

      {/* タスクの札：選んだマス、選んでいなければ次にやること */}
      {showTask && subject ? (
        <TaskCard subject={subject} picked={picked !== null} tracking={!!active} onStart={start} />
      ) : (
        !app.stopped &&
        !active &&
        !paused && <section className="rcard muted small-text">{works === null ? tr("loading") : f ? t("noTasks") : tr("noWorks")}</section>
      )}

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

      {/* 進捗。マスを押すと上の札に出る。計測が始まるのは、その札の開始を押してから */}
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
              <RemoteRow key={page.id} page={page} forecast={f} picked={picked} onTap={tapCell} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

type TaskCardProps = {
  subject: Subject;
  /** 自分でマスを選んだ（false なら次にやることの提案） */
  picked: boolean;
  /** いま別のタスクを計測している */
  tracking: boolean;
  onStart: (pageId: number, stageId: number) => Promise<void>;
};

function TaskCard({ subject, picked, tracking, onStart }: TaskCardProps) {
  const { page, stage, cell } = subject;
  return (
    <section className={`rcard${picked ? " picked" : ""}`}>
      <div className="muted small-text">{picked ? tr("picked") : t("next")}</div>
      <div className="rtask">
        <b>{page.label}</b> <span style={{ color: stage.color }}>●</span> {stage.name}
      </div>
      <div className="muted small-text">
        {cell.done
          ? tr("doneTotal", { time: hours(cell.totalMs) })
          : subject.spentMs > 0
            ? t("continuedLeft", { time: estimate(subject.remainingMs) })
            : t("remaining", { time: estimate(subject.remainingMs) })}
        {!cell.done && subject.waiting && ` ・ ${tr("waiting")}`}
      </div>
      {!cell.done && (
        <div className="ractions">
          <button className="rbtn primary wide" onClick={() => onStart(page.id, stage.id)}>
            {tracking ? tr("switchTo") : t("start")}
          </button>
        </div>
      )}
    </section>
  );
}

type RowProps = {
  page: BoardPage;
  forecast: Forecast;
  picked: Picked | null;
  onTap: (pageId: number, stageId: number) => void;
};

function RemoteRow({ page, forecast, picked, onTap }: RowProps) {
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
        const on = picked?.pageId === page.id && picked.stageId === stage.id;
        const label = cell.done ? "✓" : cell.totalMs > 0 ? hours(cell.totalMs) : task ? estimate(task.remainingMs) : "–";
        return (
          <button
            key={stage.id}
            className={`rcell${cell.done ? " done" : ""}${waiting ? " waiting" : ""}${on ? " on" : ""}`}
            style={cell.done ? { background: stage.color } : undefined}
            title={tr("tapToPick")}
            aria-pressed={on}
            onClick={() => onTap(page.id, stage.id)}
          >
            <span className="num tiny">{label}</span>
          </button>
        );
      })}
    </>
  );
}
