import { useEffect, useState } from "react";
import { api, WorkSummary } from "./api";
import { AppProvider, isMini, useApp } from "./app-context";
import { Dialog } from "./components/Dialog";
import { Sidebar } from "./components/Sidebar";
import { TimerChip } from "./components/TimerChip";
import { UpdateNotice } from "./components/UpdateNotice";
import { PomodoroDriver } from "./components/Pomodoro";
import { SaveToast, Watchers } from "./components/Watchers";
import { MiniApp } from "./MiniApp";
import { hours } from "./format";
import { BoardScreen } from "./screens/BoardScreen";
import { RecordsScreen } from "./screens/RecordsScreen";
import { ScheduleScreen } from "./screens/ScheduleScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { StatsScreen } from "./screens/StatsScreen";
import { WorksScreen } from "./screens/WorksScreen";
import { useLang } from "./i18n";
import { t, tn } from "./i18n/shell";
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
          ) : (
            <SettingsScreen addSet={addSet} onAddSetShown={() => setAddSet(false)} />
          )}
        </div>
      </div>

      <Watchers />
      <SaveToast />
      <UpdateNotice />
      {app.stopped && (
        <Dialog
          label={t("stoppedLabel")}
          title={t("stoppedTitle", { page: app.stopped.pageLabel, stage: app.stopped.stageName })}
          onClose={() => app.answerStopped(false)}
          actions={
            <>
              <button className="btn" onClick={() => app.answerStopped(false)}>
                {t("notYet")}
              </button>
              <button className="btn primary" autoFocus onClick={() => app.answerStopped(true)}>
                {t("markDone")}
              </button>
            </>
          }
        >
          <p>
            {tn("stoppedBody", {
              now: <b className="num">{hours(app.stopped.durationMs)}</b>,
              total: <b className="num">{hours(app.stopped.totalMs)}</b>,
            })}
          </p>
        </Dialog>
      )}
    </div>
  );
}

export default function App() {
  // 言語を切り替えたら、画面を作り直してすべての文言を入れ替える
  const lang = useLang();
  return (
    <AppProvider>
      <PomodoroDriver />
      {isMini ? <MiniApp key={lang} /> : <Shell key={lang} />}
    </AppProvider>
  );
}
