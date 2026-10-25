// アプリ全体で共有する状態：計測中のタイマー、データの再読み込み、エラー表示。
// メインの窓とミニタイマー窓はそれぞれこの状態を持ち、変更があればイベントで知らせ合って読み直す。
// 別端末のブラウザ（遠隔の画面。5.17）にはイベントが届かないので、代わりに読み直しで追いつく。
import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ActiveSession, api, isRemote, StopResult } from "./api";
import { setDayStartHour, setTimeFormat } from "./format";
import { setLang } from "./i18n";
import { setThemePref } from "./theme";

/** 一時停止中のタスク（再開ボタン用）。アプリを閉じても残るよう localStorage に置く */
export type PausedTask = { workId: number; pageId: number; pageLabel: string; stageId: number; stageName: string };

/** 計測中に別のページが保存されたときの通知 */
export type SaveNotice = { workId: number; pageId: number; pageLabel: string; stageId: number; stageName: string };

/** データが変わったことを他の窓に知らせるイベント */
const CHANGED_EVENT = "otosazu://changed";
const SAVE_EVENT = "otosazu://page-saved";
/** グローバルショートカット（Rust 側の desktop::TOGGLE_EVENT と同じ） */
const TOGGLE_EVENT = "otosazu://toggle-timer";
/** 遠隔の画面が計測中の記録を読み直す間隔。これが PC 側の止め忘れの検知への合図も兼ねる（5.17） */
const REMOTE_POLL_MS = 3_000;

export const windowLabel = (() => {
  if (isRemote) return "remote";
  try {
    return getCurrentWindow().label;
  } catch {
    return "main";
  }
})();
export const isMini = windowLabel === "mini";

type AppContextValue = {
  active: ActiveSession | null;
  paused: PausedTask | null;
  /** 1 秒ごとに更新される現在時刻（計測中のみ） */
  now: number;
  /** データが変わるたびに増える。画面はこれを見て読み直す */
  version: number;
  /** データを変えたら呼ぶ。この窓と他の窓の両方が読み直す */
  refresh: () => void;
  start: (pageId: number, stageId: number) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  /** 止めて「完了しましたか？」を聞く */
  stop: () => Promise<void>;
  /** 止め忘れの確認などで、止めたタスクを一時停止中として覚えておく */
  setPaused: (task: PausedTask | null) => void;
  /** 計測中の記録が外から止められたとき（止め忘れの確認）に呼ぶ */
  reloadActive: () => Promise<void>;
  /** 止めた直後の完了確認（表示中のみ） */
  stopped: StopResult | null;
  answerStopped: (done: boolean) => Promise<void>;
  saveNotice: SaveNotice | null;
  notifySave: (notice: SaveNotice) => void;
  clearSaveNotice: () => void;
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
  const [saveNotice, setSaveNotice] = useState<SaveNotice | null>(null);
  const [error, setError] = useState<string | null>(null);

  const showError = useCallback((e: unknown) => setError(String(e)), []);
  const refresh = useCallback(() => {
    setVersion((v) => v + 1);
    // 遠隔の画面の分は、記録を変えたときに Rust 側（server.rs）が知らせる
    if (!isRemote) emit(CHANGED_EVENT, { from: windowLabel }).catch(() => {});
  }, []);
  const setPaused = useCallback((task: PausedTask | null) => {
    setPausedState(task);
    savePaused(task);
  }, []);
  const reloadActive = useCallback(async () => {
    try {
      setActive(await api.getActiveSession());
      setPausedState(loadPaused());
    } catch (e) {
      showError(e);
    }
  }, [showError]);

  // 起動時に、前回から計測中のままの記録があれば引き継ぐ
  useEffect(() => {
    reloadActive();
  }, [reloadActive]);

  // 時間の表記と 1 日の区切り。変わったら、画面全体を描き直すために version を進める
  const [timeFormat, setTimeFormatState] = useState<string | null>(null);
  useEffect(() => {
    Promise.all([api.getDisplayPrefs(), api.getDayStartHour(), api.getSystemLanguage()])
      .then(([p, dayStart, systemLang]) => {
        setTimeFormat(p.timeFormat);
        setThemePref(p.theme);
        setLang(p.language === "system" ? systemLang : p.language);
        setDayStartHour(dayStart);
        const key = `${p.timeFormat}|${dayStart}`;
        setTimeFormatState((old) => {
          if (old !== null && old !== key) setVersion((v) => v + 1);
          return key;
        });
      })
      .catch(() => {});
  }, [version]);

  // 他の窓でデータが変わったら読み直す
  useEffect(() => {
    if (isRemote) return;
    const unlisten = listen<{ from: string }>(CHANGED_EVENT, (e) => {
      if (e.payload.from === windowLabel) return;
      setVersion((v) => v + 1);
      reloadActive();
    });
    const unlistenSave = listen<SaveNotice | null>(SAVE_EVENT, (e) => setSaveNotice(e.payload));
    return () => {
      unlisten.then((f) => f()).catch(() => {});
      unlistenSave.then((f) => f()).catch(() => {});
    };
  }, [reloadActive]);

  // 遠隔の画面（別端末のブラウザ）は、イベントの代わりに計測中の記録を読み直して PC 側に追いつく（5.17）。
  // 画面が見えている間だけ動かす：この問い合わせが PC 側の止め忘れの検知への合図も兼ねるので、
  // 裏に回ったタブが「操作中」を送り続けないようにする
  const activeRef = useRef<ActiveSession | null>(null);
  activeRef.current = active;
  useEffect(() => {
    if (!isRemote) return;
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const next = await api.getActiveSession();
        const before = activeRef.current;
        if (next?.id !== before?.id || next?.startedAt !== before?.startedAt) {
          setActive(next);
          setVersion((v) => v + 1);
        }
      } catch {
        // つながらないときは次の確認に任せる
      }
    };
    // 戻ってきたときは、見ていない間の変わりように追いつくため全部読み直す
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      setVersion((v) => v + 1);
      check();
    };
    const timer = setInterval(check, REMOTE_POLL_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

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
      setSaveNotice(null);
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

  // ショートカットで一時停止・再開する（受け取るのはメインの窓だけ）
  const latest = useRef({ active, paused, pause, resume });
  latest.current = { active, paused, pause, resume };
  useEffect(() => {
    if (isMini) return;
    const unlisten = listen(TOGGLE_EVENT, () => {
      const { active, paused, pause, resume } = latest.current;
      if (active) pause();
      else if (paused) resume();
    });
    return () => {
      unlisten.then((f) => f()).catch(() => {});
    };
  }, []);

  // 表記を読み込むまでは描かない（一瞬だけ違う表記が出るのを避ける）
  if (timeFormat === null) return null;

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
        setPaused,
        reloadActive,
        stopped,
        answerStopped,
        saveNotice,
        notifySave: (notice) => {
          setSaveNotice(notice);
          emit(SAVE_EVENT, notice).catch(() => {});
        },
        clearSaveNotice: () => {
          setSaveNotice(null);
          emit(SAVE_EVENT, null).catch(() => {});
        },
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
