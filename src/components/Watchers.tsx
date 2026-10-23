// 止め忘れ対策（メインの窓だけで動かす）
// - PC の操作がしばらく無ければ、操作が無くなった時刻で計測を止めて「休憩していましたか？」と聞く
// - 計測中に別のページの .clip が保存されたら「そのページを作業していますか？」と知らせる
import { useEffect, useRef, useState } from "react";
import { api, StopResult, TimerPrefs } from "../api";
import { useApp } from "../app-context";
import { duration, time } from "../format";
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
      label={`${prefs?.idleMinutes ?? ""} 分間 PC の操作がありませんでした`}
      title="休憩していましたか？"
      onClose={() => answer(false)}
      actions={
        <>
          <button className="btn" onClick={() => answer(false)}>
            止めたままにする
          </button>
          <button className="btn primary" autoFocus onClick={() => answer(true)}>
            再開する
          </button>
        </>
      }
    >
      <p>
        {s.pageLabel} の{s.stageName}を計測していましたが、{time(prompt.idleSince)} から操作がなかったので一時停止しました。
      </p>
      <button className={`choice${working ? "" : " on"}`} onClick={() => setWorking(false)}>
        <span className="radio" />
        <span>
          <b>休憩していた</b>
          <br />
          <span className="muted">{time(prompt.idleSince)} 以降は記録しない</span>
        </span>
      </button>
      <button className={`choice${working ? " on" : ""}`} onClick={() => setWorking(true)}>
        <span className="radio" />
        <span>
          <b>作業していた</b>（資料を読んでいた など）
          <br />
          <span className="muted">止まっていた {duration(prompt.detectedAt - prompt.idleSince)} も記録する</span>
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
      <b>{n.pageLabel} が保存されました</b>
      <div>
        計測中は「{app.active.pageLabel} {app.active.stageName}」です。{n.pageLabel} を作業していますか？
      </div>
      <div className="actions">
        <button className="btn small" onClick={app.clearSaveNotice}>
          いいえ
        </button>
        <button
          className="btn small primary"
          onClick={() => {
            app.clearSaveNotice();
            app.start(n.pageId, n.stageId);
          }}
        >
          {n.pageLabel} {n.stageName}に切り替える
        </button>
      </div>
    </div>
  );
}
