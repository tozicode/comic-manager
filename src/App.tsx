import { useEffect, useState } from "react";
import { api, isRemote, WorkSummary } from "./api";
import { AppProvider, isMini, useApp } from "./app-context";
import { Sidebar } from "./components/Sidebar";
import { TimerChip } from "./components/TimerChip";
import { UpdateNotice } from "./components/UpdateNotice";
import { PomodoroDriver } from "./components/Pomodoro";
import { FinishToast, SaveToast, Watchers } from "./components/Watchers";
import { Publisher } from "./components/Publisher";
import { CollabWatcher } from "./components/CollabWatcher";
import { FeedGuide } from "./components/FeedGuide";
import { FeedProvider, useFeed } from "./feed-context";
import { FeedScreen } from "./screens/FeedScreen";
import { MINI_OPEN_KEY, MiniApp } from "./MiniApp";
import { RemoteApp } from "./RemoteApp";
import { BoardScreen } from "./screens/BoardScreen";
import { RecordsScreen } from "./screens/RecordsScreen";
import { ScheduleScreen } from "./screens/ScheduleScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { StatsScreen } from "./screens/StatsScreen";
import { WorksScreen } from "./screens/WorksScreen";
import { useLang } from "./i18n";
import { t } from "./i18n/shell";
import "./App.css";

export type Screen = "works" | "board" | "schedule" | "records" | "stats" | "settings" | "feed";

const WORK_KEY = "otosazu.workId";
/** 起動時のミニ窓の開き直しを済ませたか。StrictMode は effect を 2 回動かすので、1 回で止める */
let miniRestored = false;

function loadWorkId(): number | null {
  try {
    const v = Number(localStorage.getItem(WORK_KEY));
    return v > 0 ? v : null;
  } catch {
    return null;
  }
}

function Shell() {
  const app = useApp();
  const [works, setWorks] = useState<WorkSummary[]>([]);
  const [workId, setWorkIdState] = useState<number | null>(loadWorkId);
  const [screen, setScreen] = useState<Screen>(workId ? "board" : "works");
  /** 作品の追加から「新しいセットを作る」で設定に飛んだとき、セットの追加を開いた状態で出す */
  const [addSet, setAddSet] = useState(false);

  const setWorkId = (id: number | null) => {
    setWorkIdState(id);
    try {
      if (id) localStorage.setItem(WORK_KEY, String(id));
      else localStorage.removeItem(WORK_KEY);
    } catch {
      // 次回起動時に作品一覧から始まるだけなので無視する
    }
  };

  useEffect(() => {
    api.listWorks().then(setWorks).catch(app.showError);
  }, [app.version, app.showError]);

  // 選んでいた作品が消えていたら作品一覧に戻す
  const work = works.find((w) => w.id === workId) ?? null;
  useEffect(() => {
    if (works.length > 0 && workId && !work) {
      setWorkId(null);
      setScreen("works");
    }
  }, [works, workId, work]);

  const openWork = (id: number, to: Screen = "board") => {
    setWorkId(id);
    setScreen(to);
  };

  // 前回ミニタイマーを開いたまま終えていたら、起動時に開き直す（✕ で閉じていれば開かない）
  useEffect(() => {
    if (miniRestored) return;
    miniRestored = true;
    try {
      if (localStorage.getItem(MINI_OPEN_KEY) !== "1") return;
    } catch {
      return;
    }
    api.openMini(false).catch(() => {});
  }, []);

  const needsWork = (screen === "board" || screen === "schedule" || screen === "records") && !work;

  return (
    <div className="shell">
      <Sidebar
        works={works}
        work={work}
        screen={screen}
        onScreen={setScreen}
        onWork={(id) => openWork(id, screen === "records" || screen === "schedule" ? screen : "board")}
      />
      <div className="main">
        <header className="topbar">
          <h1>{t(`screen.${screen}`)}</h1>
          <div className="row">
            <button className="btn small ghost" title={t("miniTimerHint")} onClick={() => api.openMini().catch(app.showError)}>
              {t("miniTimer")}
            </button>
            <TimerChip onOpenWork={(id) => openWork(id)} />
          </div>
        </header>
        <div className="content">
          {app.error && (
            <div className="error" role="alert">
              <span className="grow">{app.error}</span>
              <button className="btn small ghost" onClick={app.clearError}>
                {t("close")}
              </button>
            </div>
          )}
          {screen === "works" || needsWork ? (
            <WorksScreen
              works={works}
              onOpen={openWork}
              onAddSet={() => {
                setAddSet(true);
                setScreen("settings");
              }}
            />
          ) : screen === "board" && work ? (
            <BoardScreen key={work.id} workId={work.id} onNavigate={setScreen} />
          ) : screen === "schedule" && work ? (
            <ScheduleScreen key={work.id} workId={work.id} />
          ) : screen === "records" && work ? (
            <RecordsScreen key={work.id} workId={work.id} />
          ) : screen === "stats" ? (
            <StatsScreen />
          ) : screen === "feed" ? (
            <FeedScreen workId={work?.id ?? null} />
          ) : (
            <SettingsScreen addSet={addSet} onAddSetShown={() => setAddSet(false)} />
          )}
        </div>
      </div>

      <FeedGuideGate hasWorks={works.length > 0} />
      <Watchers />
      <Publisher />
      <CollabWatcher />
      <SaveToast />
      <UpdateNotice />
      <FinishToast />
    </div>
  );
}

export default function App() {
  // 言語を切り替えたら、画面を作り直してすべての文言を入れ替える
  const lang = useLang();
  // 別端末のブラウザ（5.17）。ポモドーロの知らせ・保存の検知・自動更新の確認は PC の窓だけの役目なので出さない
  if (isRemote) {
    return (
      <AppProvider>
        <RemoteApp key={lang} />
      </AppProvider>
    );
  }
  return (
    <AppProvider>
      <PomodoroDriver />
      {isMini ? (
        <MiniApp key={lang} />
      ) : (
        <FeedProvider>
          <Shell key={lang} />
        </FeedProvider>
      )}
    </AppProvider>
  );
}

/**
 * はじめての案内（5.25）を出すとき：まだ出していなくて、作品が 1 つ以上あるとき。
 * 今の利用者は更新して最初の起動で、新しい利用者は最初の作品を登録したあとに出る
 */
function FeedGuideGate({ hasWorks }: { hasWorks: boolean }) {
  const feed = useFeed();
  if (!feed.prefs || feed.prefs.guided || !hasWorks) return null;
  return <FeedGuide />;
}
