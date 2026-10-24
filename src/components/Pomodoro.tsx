// ポモドーロ（仕様書 5.3）の見張りと、画面から使うフック。
// 見張り（PomodoroDriver）はメインの窓とミニタイマーの窓の両方で動かす。状態は localStorage で共有し、
// 先に時間に気づいた窓が状態を進めて知らせる（片方の窓が最小化されて時計が遅れても知らせが遅れないように）
import { useEffect, useRef, useSyncExternalStore } from "react";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { api, TimerPrefs } from "../api";
import { useApp } from "../app-context";
import { dayKey, startOfDay } from "../format";
import { t } from "../i18n/timer";
import {
  haltPomo,
  initialPomo,
  keepGoing,
  loadPomo,
  Pomo,
  PomoSettings,
  runPomo,
  savePomo,
  takeBreak,
  tickPomo,
} from "../pomodoro";

type Snapshot = { prefs: TimerPrefs | null; pomo: Pomo | null; now: number };

let snapshot: Snapshot = { prefs: null, pomo: loadPomo(), now: Date.now() };
const listeners = new Set<() => void>();

function publish(next: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...next };
  listeners.forEach((f) => f());
}

const settingsOf = (p: TimerPrefs): PomoSettings => ({
  workMin: p.pomoWorkMin,
  shortMin: p.pomoShortMin,
  longMin: p.pomoLongMin,
  longEvery: p.pomoLongEvery,
});

const today = (now: number) => dayKey(startOfDay(now));

/** 保存してある状態を読み、変える。無ければ今日の初めの状態から */
function update(f: (p: Pomo, s: PomoSettings) => Pomo) {
  const prefs = snapshot.prefs;
  if (!prefs) return;
  const s = settingsOf(prefs);
  const now = Date.now();
  const next = f(loadPomo() ?? initialPomo(today(now), s), s);
  savePomo(next);
  publish({ pomo: next, now });
}

/** 時間になったことを知らせる（音と OS の通知） */
function announce(event: "workDone" | "breakDone", prefs: TimerPrefs) {
  if (prefs.pomoSound) chime(event === "workDone" ? [880, 660] : [660, 880]);
  const body = event === "workDone" ? t("pomoWorkDoneBody", { min: prefs.pomoWorkMin }) : t("pomoBreakDoneBody");
  isPermissionGranted()
    .then((ok) => ok && sendNotification({ title: "Otosazu", body }))
    .catch(() => {});
}

/** 短い 2 音のチャイム。音のファイルを持たないよう、その場で鳴らす */
function chime(freqs: number[]) {
  try {
    const ctx = new AudioContext();
    freqs.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const at = ctx.currentTime + i * 0.28;
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.25, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.5);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.55);
    });
    setTimeout(() => ctx.close().catch(() => {}), 1500);
  } catch {
    // 音が出せなくても通知と画面の表示で分かる
  }
}

/** 通知の許可を求める（設定でポモドーロをオンにしたとき）。
 * Mac は許可済みと答えたうえで、最初の通知を出すときに OS が許可を聞き、その通知は出ない。
 * 最初の「時間です」が消えないよう、ここで試しに 1 回知らせて、許可の確認を今出しておく */
export async function askNotificationPermission() {
  try {
    if (!(await isPermissionGranted())) await requestPermission();
    if (navigator.userAgent.includes("Mac")) sendNotification({ title: "Otosazu", body: t("pomoReadyBody") });
  } catch {
    // 許可されなくても、音と画面の表示で知らせる
  }
}

/** 見張り：計測の開始・停止をポモドーロに伝え、1 秒ごとに時間を見る。表示は持たない */
export function PomodoroDriver() {
  const app = useApp();
  const prefs = useSyncExternalStore(subscribe, () => snapshot).prefs;
  const on = !!prefs?.pomodoro;

  useEffect(() => {
    api
      .getTimerPrefs()
      .then((p) => publish({ prefs: p }))
      .catch(() => {});
  }, [app.version]);

  // 計測が始まった・止まったとき（どちらの窓・どの操作から止めても、ここで拾う）
  const running = !!app.active;
  const first = useRef(true);
  useEffect(() => {
    if (!on) return;
    // 起動直後は計測中の記録をまだ読み込んでいないので、止まったとはみなさない
    if (first.current && !running) {
      first.current = false;
      return;
    }
    first.current = false;
    const now = Date.now();
    update((p, s) => (running ? runPomo(p, now, today(now), s) : haltPomo(p, now)));
  }, [on, running]);

  useEffect(() => {
    if (!on) return;
    const timer = setInterval(() => {
      const prefs = snapshot.prefs;
      const p = loadPomo();
      const now = Date.now();
      if (!prefs || !p) return publish({ pomo: p, now });
      const { pomo, event } = tickPomo(p, now);
      if (event) {
        savePomo(pomo);
        announce(event, prefs);
      }
      publish({ pomo, now });
    }, 1000);
    return () => clearInterval(timer);
  }, [on]);

  return null;
}

function subscribe(f: () => void) {
  listeners.add(f);
  return () => listeners.delete(f);
}

/** 画面から使う：ポモドーロを使っているか、今の状態、［休憩する］［続ける］ */
export function usePomodoro() {
  const app = useApp();
  const snap = useSyncExternalStore(subscribe, () => snapshot);
  const enabled = !!snap.prefs?.pomodoro && !!snap.pomo;
  return {
    enabled,
    pomo: enabled ? snap.pomo : null,
    now: snap.now,
    takeBreak: async () => {
      update((p, s) => takeBreak(p, Date.now(), s));
      await app.pause();
    },
    keepGoing: () => update((p) => keepGoing(p, Date.now())),
  };
}
