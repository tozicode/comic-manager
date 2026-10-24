import { useEffect, useState } from "react";
import { api, WorkSummary } from "./api";
import { AppProvider, isMini, useApp } from "./app-context";
import { Dialog } from "./components/Dialog";
import { Sidebar } from "./components/Sidebar";
import { TimerChip } from "./components/TimerChip";
import { SaveToast, Watchers } from "./components/Watchers";
import { MiniApp } from "./MiniApp";
import { hours } from "./format";
import { BoardScreen } from "./screens/BoardScreen";
import { RecordsScreen } from "./screens/RecordsScreen";
import { ScheduleScreen } from "./screens/ScheduleScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { StatsScreen } from "./screens/StatsScreen";
import { WorksScreen } from "./screens/WorksScreen";
import "./App.css";

export type Screen = "works" | "board" | "schedule" | "records" | "stats" | "settings";

const WORK_KEY = "otosazu.workId";

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
          <h1>{TITLES[screen]}</h1>
          <div className="row">
            <button className="btn small ghost" title="CLIP STUDIO の上に小さなタイマーを出す" onClick={() => api.openMini().catch(app.showError)}>
              ⧉ ミニタイマー
            </button>
            <TimerChip onOpenWork={(id) => openWork(id)} />
          </div>
        </header>
        <div className="content">
          {app.error && (
            <div className="error" role="alert">
              <span className="grow">{app.error}</span>
              <button className="btn small ghost" onClick={app.clearError}>
                閉じる
              </button>
            </div>
          )}
          {screen === "works" || needsWork ? (
            <WorksScreen works={works} onOpen={openWork} />
          ) : screen === "board" && work ? (
            <BoardScreen key={work.id} workId={work.id} onNavigate={setScreen} />
          ) : screen === "schedule" && work ? (
            <ScheduleScreen key={work.id} workId={work.id} />
          ) : screen === "records" && work ? (
            <RecordsScreen key={work.id} workId={work.id} />
          ) : screen === "stats" ? (
            <StatsScreen />
          ) : (
            <SettingsScreen />
          )}
        </div>
      </div>

      <Watchers />
      <SaveToast />
      {app.stopped && (
        <Dialog
          label="タイマーを止めました"
          title={`${app.stopped.pageLabel} の${app.stopped.stageName}は完了しましたか？`}
          onClose={() => app.answerStopped(false)}
          actions={
            <>
              <button className="btn" onClick={() => app.answerStopped(false)}>
                まだ途中
              </button>
              <button className="btn primary" autoFocus onClick={() => app.answerStopped(true)}>
                完了にする
              </button>
            </>
          }
        >
          <p>
            今回 <b className="num">{hours(app.stopped.durationMs)}</b> ・ このタスクの合計{" "}
            <b className="num">{hours(app.stopped.totalMs)}</b>
          </p>
        </Dialog>
      )}
    </div>
  );
}

const TITLES: Record<Screen, string> = {
  works: "作品一覧",
  board: "進捗ボード",
  schedule: "スケジュール",
  records: "作業記録",
  stats: "統計",
  settings: "設定",
};

export default function App() {
  return <AppProvider>{isMini ? <MiniApp /> : <Shell />}</AppProvider>;
}
