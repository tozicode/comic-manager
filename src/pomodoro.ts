// ポモドーロ（仕様書 5.3）：計測している間だけ作業の時間を数え、時間になったら休憩を勧める。
// 状態は localStorage に置き、メインの窓とミニタイマーの窓で同じものを見る（ここは計算と保存だけ）
const MIN = 60_000;
/** ［続ける］を押したあと、もう一度知らせるまでの作業時間 */
export const SNOOZE_MS = 5 * MIN;

/** 残り時間の表記：1 時間未満は「12:30」、それ以上は「1:05:00」 */
export function pomoClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const mm = String(Math.floor((total % 3600) / 60)).padStart(h > 0 ? 2 : 1, "0");
  const ss = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export type PomoSettings = { workMin: number; shortMin: number; longMin: number; longEvery: number };

/** work：作業中 / due：作業の時間になった（休憩するか聞いている） / break：休憩中 / breakOver：休憩が終わった */
export type PomoPhase = "work" | "due" | "break" | "breakOver";

export type Pomo = {
  /** 何回目かを数えている日（1 日の区切りに沿った日付） */
  day: string;
  /** その日に休憩まで進んだ回数 */
  count: number;
  phase: PomoPhase;
  /** 今のポモドーロで、runFrom より前に数えた作業時間 */
  accMs: number;
  /** 計測中なら、数え始めた時刻 */
  runFrom: number | null;
  /** 計測が止まった時刻（止めていた時間が休憩の長さを超えたかを見るため） */
  haltedAt: number | null;
  /** 作業時間がこれに達したら知らせる */
  alertAtMs: number;
  /** 休憩が終わる時刻 */
  breakEnd: number;
  /** 今の休憩が長い休憩か */
  long: boolean;
};

export function initialPomo(day: string, s: PomoSettings): Pomo {
  return {
    day,
    count: 0,
    phase: "work",
    accMs: 0,
    runFrom: null,
    haltedAt: null,
    alertAtMs: s.workMin * MIN,
    breakEnd: 0,
    long: false,
  };
}

/** 今のポモドーロで作業した時間 */
export function workedMs(p: Pomo, now: number): number {
  return p.accMs + (p.runFrom !== null ? Math.max(0, now - p.runFrom) : 0);
}

/** 表示する残り時間：作業中は知らせるまで、休憩中は休憩が終わるまで */
export function remainingMs(p: Pomo, now: number): number {
  if (p.phase === "break") return Math.max(0, p.breakEnd - now);
  if (p.phase === "work") return Math.max(0, p.alertAtMs - workedMs(p, now));
  return 0;
}

/** 計測が始まった（開始・再開・切り替え）。休憩のあとや、休憩の長さ以上止めていたあとは、新しいポモドーロにする */
export function runPomo(p: Pomo, now: number, day: string, s: PomoSettings): Pomo {
  const q = p.day === day ? p : { ...p, day, count: 0 };
  if (q.runFrom !== null) return q;
  const rested = q.haltedAt !== null && now - q.haltedAt >= s.shortMin * MIN;
  if (q.phase === "break" || q.phase === "breakOver" || rested) {
    return { ...q, phase: "work", accMs: 0, alertAtMs: s.workMin * MIN, runFrom: now, haltedAt: null };
  }
  return { ...q, runFrom: now, haltedAt: null };
}

/** 計測が止まった（一時停止・止め忘れ・計測をやめた）。残り時間も止める */
export function haltPomo(p: Pomo, now: number): Pomo {
  if (p.runFrom === null) return p;
  return { ...p, accMs: workedMs(p, now), runFrom: null, haltedAt: now };
}

export type PomoEvent = "workDone" | "breakDone" | null;

/** 時間が来たかを見る。来ていれば状態を進め、知らせる出来事を返す */
export function tickPomo(p: Pomo, now: number): { pomo: Pomo; event: PomoEvent } {
  if (p.phase === "work" && p.runFrom !== null && workedMs(p, now) >= p.alertAtMs) {
    return { pomo: { ...p, phase: "due" }, event: "workDone" };
  }
  if (p.phase === "break" && now >= p.breakEnd) return { pomo: { ...p, phase: "breakOver" }, event: "breakDone" };
  return { pomo: p, event: null };
}

/** ［休憩する］。計測を止めるのは呼ぶ側。長い休憩は longEvery 回ごと */
export function takeBreak(p: Pomo, now: number, s: PomoSettings): Pomo {
  const count = p.count + 1;
  const long = s.longEvery > 0 && count % s.longEvery === 0;
  return {
    ...p,
    count,
    phase: "break",
    long,
    breakEnd: now + (long ? s.longMin : s.shortMin) * MIN,
    accMs: 0,
    runFrom: null,
    haltedAt: null,
  };
}

/** ［続ける］。少ししてからもう一度知らせる */
export function keepGoing(p: Pomo, now: number): Pomo {
  return { ...p, phase: "work", alertAtMs: workedMs(p, now) + SNOOZE_MS };
}

// ---------------------------------------------------------------------------
// 保存（両方の窓で共有する）
// ---------------------------------------------------------------------------

const KEY = "otosazu.pomodoro";

export function loadPomo(): Pomo | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Pomo) : null;
  } catch {
    return null;
  }
}

export function savePomo(p: Pomo) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // 保存できなくても、この窓の中では動く
  }
}
