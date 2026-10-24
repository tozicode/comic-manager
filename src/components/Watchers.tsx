// 止め忘れ対策（メインの窓だけで動かす）
// - PC の操作がしばらく無ければ、操作が無くなった時刻で計測を止めて「休憩していましたか？」と聞く
// - 計測中に別のページの .clip が保存されたら「そのページを作業していますか？」と知らせる
import { useEffect, useRef, useState } from "react";
import { api, StopResult, TimerPrefs } from "../api";
import { useApp } from "../app-context";
import { hours, time } from "../format";
import { t } from "../i18n/timer";
import { Dialog } from "./Dialog";

const IDLE_CHECK_MS = 20_000;
const SAVE_CHECK_MS = 15_000;

type IdlePrompt = { stopped: StopResult; idleSince: number; detectedAt: number };

export function Watchers() {
  const app = useApp();
  const [prefs, setPrefs] = useState<TimerPrefs | null>(null);
  const [prompt, setPrompt] = useState<IdlePrompt | null>(null);
  const [working, setWorking] = useState(false);
  // 計測中は毎秒描き直されるので、見張りの中からは最新の app を参照越しに使う
  // （effect の依存に app を入れると、毎秒 setInterval が作り直されて検知が動かない）
  const appRef = useRef(app);
  appRef.current = app;
  const activeId = app.active?.id;

  useEffect(() => {
    api.getTimerPrefs().then(setPrefs).catch(app.showError);
  }, [app.version, app.showError]);

  // ----- 無操作の検知 -----
  const busy = useRef(false);
  useEffect(() => {
    const active = appRef.current.active;
    if (!active || !prefs || prefs.idleMinutes <= 0 || prompt) return;
    const limit = prefs.idleMinutes * 60_000;
    const timer = setInterval(async () => {
      const app = appRef.current;
      if (busy.current) return;
      busy.current = true;
      try {
        const idle = await api.idleMs();
        if (idle < limit) return;
        const now = Date.now();
        const stopped = await api.stopTimerAt(now - idle);
        if (!stopped) return;
        app.setPaused({
          workId: active.workId,
          pageId: active.pageId,
          pageLabel: active.pageLabel,
          stageId: active.stageId,
          stageName: active.stageName,
        });
        setWorking(false);
        setPrompt({ stopped, idleSince: now - idle, detectedAt: now });
        await app.reloadActive();
        app.refresh();
        api.focusMain().catch(() => {});
      } catch (e) {
        app.showError(e);
      } finally {
        busy.current = false;
      }
    }, IDLE_CHECK_MS);
    return () => clearInterval(timer);
  }, [activeId, prefs, prompt]);

  const answer = async (resume: boolean) => {
    const p = prompt;
    setPrompt(null);
    if (!p) return;
    try {
      // 資料を読んでいたなど、操作は無くても作業していたなら、気づいた時刻まで記録に含める
      if (working) await api.setSessionEnd(p.stopped.sessionId, p.detectedAt);
      app.refresh();
      if (resume) await app.start(p.stopped.pageId, p.stopped.stageId);
    } catch (e) {
      app.showError(e);
    }
  };

  // ----- 別のページの保存の検知 -----
  const mtimes = useRef<{ workId: number; map: Map<number, number> } | null>(null);
  useEffect(() => {
    const active = appRef.current.active;
    if (!active || !prefs?.watchSaves) {
      mtimes.current = null;
      return;
    }
    const check = async () => {
      try {
        const list = await api.pageMtimes(active.workId);
        const map = new Map(list);
        const before = mtimes.current?.workId === active.workId ? mtimes.current.map : null;
        mtimes.current = { workId: active.workId, map };
        if (!before) return;
        const saved = list.find(([id, t]) => id !== active.pageId && t > (before.get(id) ?? Infinity));
        if (!saved) return;
        const board = await api.getBoard(active.workId);
        const page = board.pages.find((p) => p.id === saved[0]);
        if (!page) return;
        // 切り替え先の工程：計測中と同じ工程がそのページで着手できればそれ、だめなら最初の着手できる工程
        const ready = board.stages.filter((_, i) => !page.cells[i].done && (i === 0 || page.cells[i - 1].done));
        const stage = ready.find((s) => s.id === active.stageId) ?? ready[0];
        if (!stage) return;
        appRef.current.notifySave({
          workId: active.workId,
          pageId: page.id,
          pageLabel: page.label,
          stageId: stage.id,
          stageName: stage.name,
        });
      } catch {
        // ファイルが一時的に読めないことはあるので、次の確認に任せる
      }
    };
    check();
    const timer = setInterval(check, SAVE_CHECK_MS);
    return () => clearInterval(timer);
  }, [activeId, prefs?.watchSaves]);

  if (!prompt) return null;
  const s = prompt.stopped;
  return (
    <Dialog
      label={t("idleLabel", { min: prefs?.idleMinutes ?? "" })}
      title={t("idleTitle")}
      onClose={() => answer(false)}
      actions={
        <>
          <button className="btn" onClick={() => answer(false)}>
            {t("keepStopped")}
          </button>
          <button className="btn primary" autoFocus onClick={() => answer(true)}>
            {t("resumeAction")}
          </button>
        </>
      }
    >
      <p>
        {t("idleBody", { page: s.pageLabel, stage: s.stageName, time: time(prompt.idleSince) })}
      </p>
      <button className={`choice${working ? "" : " on"}`} onClick={() => setWorking(false)}>
        <span className="radio" />
        <span>
          <b>{t("wasResting")}</b>
          <br />
          <span className="muted">{t("restingNote", { time: time(prompt.idleSince) })}</span>
        </span>
      </button>
      <button className={`choice${working ? " on" : ""}`} onClick={() => setWorking(true)}>
        <span className="radio" />
        <span>
          <b>{t("wasWorking")}</b>
          {t("wasWorkingExample")}
          <br />
          <span className="muted">{t("workingNote", { time: hours(prompt.detectedAt - prompt.idleSince) })}</span>
        </span>
      </button>
    </Dialog>
  );
}

/** 別のページが保存されたときの通知（メインとミニの両方に出す） */
export function SaveToast() {
  const app = useApp();
  const n = app.saveNotice;
  if (!n || !app.active || app.active.pageId === n.pageId) return null;
  return (
    <div className="toast" role="status">
      <b>{t("savedTitle", { page: n.pageLabel })}</b>
      <div>
        {t("savedBody", { current: `${app.active.pageLabel} ${app.active.stageName}`, page: n.pageLabel })}
      </div>
      <div className="actions">
        <button className="btn small" onClick={app.clearSaveNotice}>
          {t("no")}
        </button>
        <button
          className="btn small primary"
          onClick={() => {
            app.clearSaveNotice();
            app.start(n.pageId, n.stageId);
          }}
        >
          {t("switchTo", { page: n.pageLabel, stage: n.stageName })}
        </button>
      </div>
    </div>
  );
}
