// アプリ全体で共有する状態：計測中のタイマー、データの再読み込み、エラー表示
import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { ActiveSession, api, StopResult } from "./api";

/** 一時停止中のタスク（再開ボタン用）。アプリを閉じても残るよう localStorage に置く */
export type PausedTask = { workId: number; pageId: number; pageLabel: string; stageId: number; stageName: string };

type AppContextValue = {
  active: ActiveSession | null;
  paused: PausedTask | null;
  /** 1 秒ごとに更新される現在時刻（計測中のみ） */
  now: number;
  /** データが変わるたびに増える。画面はこれを見て読み直す */
  version: number;
  refresh: () => void;
  start: (pageId: number, stageId: number) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  /** 止めて「完了しましたか？」を聞く */
  stop: () => Promise<void>;
  /** 止めた直後の完了確認（表示中のみ） */
  stopped: StopResult | null;
  answerStopped: (done: boolean) => Promise<void>;
  error: string | null;
  showError: (e: unknown) => void;
  clearError: () => void;
};

const AppContext = createContext<AppContextValue | null>(null);

const PAUSED_KEY = "otosazu.paused";

function loadPaused(): PausedTask | null {
  try {
    const raw = localStorage.getItem(PAUSED_KEY);
    return raw ? (JSON.parse(raw) as PausedTask) : null;
  } catch {
    return null;
  }
}

function savePaused(task: PausedTask | null) {
  try {
    if (task) localStorage.setItem(PAUSED_KEY, JSON.stringify(task));
    else localStorage.removeItem(PAUSED_KEY);
  } catch {
    // 保存できなくても再開ボタンが出ないだけなので無視する
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<ActiveSession | null>(null);
  const [paused, setPausedState] = useState<PausedTask | null>(loadPaused);
  const [now, setNow] = useState(Date.now());
  const [version, setVersion] = useState(0);
  const [stopped, setStopped] = useState<StopResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const showError = useCallback((e: unknown) => setError(String(e)), []);
  const setPaused = (task: PausedTask | null) => {
    setPausedState(task);
    savePaused(task);
  };

  // 起動時に、前回から計測中のままの記録があれば引き継ぐ
  useEffect(() => {
    api.getActiveSession().then(setActive).catch(showError);
  }, [showError]);

  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);

  const start = async (pageId: number, stageId: number) => {
    try {
      setActive(await api.startTimer(pageId, stageId));
      setPaused(null);
      refresh();
    } catch (e) {
      showError(e);
    }
  };

  const pause = async () => {
    if (!active) return;
    try {
      await api.stopTimer();
      setPaused({
        workId: active.workId,
        pageId: active.pageId,
        pageLabel: active.pageLabel,
        stageId: active.stageId,
        stageName: active.stageName,
      });
      setActive(null);
      refresh();
    } catch (e) {
      showError(e);
    }
  };

  const resume = async () => {
    if (paused) await start(paused.pageId, paused.stageId);
  };

  const stop = async () => {
    try {
      const result = await api.stopTimer();
      setActive(null);
      setPaused(null);
      refresh();
      if (result && !result.alreadyDone) setStopped(result);
    } catch (e) {
      showError(e);
    }
  };

  const answerStopped = async (done: boolean) => {
    const result = stopped;
    setStopped(null);
    if (!result || !done) return;
    try {
      await api.setTaskDone(result.pageId, result.stageId, true);
      refresh();
    } catch (e) {
      showError(e);
    }
  };

  return (
    <AppContext.Provider
      value={{
        active,
        paused,
        now,
        version,
        refresh,
        start,
        pause,
        resume,
        stop,
        stopped,
        answerStopped,
        error,
        showError,
        clearError: () => setError(null),
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("AppProvider の中で使ってください");
  return ctx;
}
