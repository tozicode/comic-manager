// 進捗の公開（仕様書 5.22）：要約（snapshot）を組んで、預かり場所（server/）に送る。
// 要約の形は docs/snapshot-format.md。中身の計算は share.ts（マスと進み具合）と forecast.ts（完成見込み・締切）を使い回す。
// 鍵と設定は Rust 側（store/publish.rs）が持ち、送るのはここ（画面側の fetch）。
import { api, Board, HideKey, PublishPrefs } from "./api";
import { computeForecast, Forecast } from "./forecast";
import { dayKey, dayStartMs, startOfDay } from "./format";
import { addDays } from "./schedule";
import { SessionLike, shareData } from "./share";

/** 預かり場所。開発中は `VITE_PUBLISH_BASE=http://127.0.0.1:8787` で wrangler dev に向けられる */
export const PUBLISH_BASE: string = import.meta.env.VITE_PUBLISH_BASE ?? "https://share.otosazu.com";

/** 要約の版。形を変えたら上げる（閲覧ページは知らない版でも進み具合と最終更新だけは出す） */
export const SNAPSHOT_VERSION = 3;

export type Snapshot = {
  v: number;
  generatedAt: number;
  app: string;
  work: { title: string | null; kind: Board["work"]["kind"]; unit: string; rows: number };
  stages: { name: string; color: string }[];
  /** 行 × 工程。0 未着手 / 1 作業中 / 2 完了 / 3 対象外（版 3。分母に入れない）。隠すときは null */
  cells: number[][] | null;
  spans: number[] | null;
  labels: string[] | null;
  /** 共同作業のメンバー（頭文字と色だけ。名前は送らない。5.23）。居なければ [] */
  members: { i: string; c: string }[];
  /** 行 × 工程。担当しているメンバーの members での番号。居なければ -1。cells が null のとき・メンバーが居ないときは null */
  who: number[][] | null;
  progress: number;
  todayProgress: number;
  completed: boolean;
  deadlines: { name: string; date: string; selected: boolean }[];
  finish: { low: string | null; mid: string | null; high: string | null } | null;
  time: { todayMs: number; totalMs: number } | null;
  lastWorkedOn: string | null;
};

/** 要約を組む材料のうち、Forecast に入っていないもの */
export type SnapshotExtra = {
  /** 今日の作業記録（share.ts の「手を付けた」の判定に使う） */
  sessions: SessionLike[];
  /** 今日の始まり（1 日の区切りに沿ったもの） */
  dayStart: number;
  /** この作品で最後に作業した時刻（作品一覧の lastWorkedAt）。一度も無ければ null */
  lastWorkedAt: number | null;
  appVersion: string;
  now: number;
};

const CELL_CODE = { open: 0, touched: 1, before: 2, today: 2, excluded: 3 } as const;

/** メンバーの印に使う頭文字（1 文字。CollabDialog と同じ） */
const initial = (name: string) => (Array.from(name.trim())[0] ?? "?").toUpperCase();

/** 純粋関数。隠す項目は null にする */
export function buildSnapshot(forecast: Forecast, extra: SnapshotExtra, hide: HideKey[]): Snapshot {
  const { board, prediction } = forecast;
  const data = shareData(board, extra.sessions, extra.dayStart);
  const hidden = new Set(hide);
  const showCells = !hidden.has("cells");
  const dateOrNull = (d: Date | null) => (d ? dayKey(d) : null);
  const finish = forecast.finish;
  const totalMs = board.pages.reduce((n, p) => n + p.cells.reduce((m, c) => m + c.totalMs, 0), 0);
  const selected = forecast.deadline?.id ?? null;
  // 共同作業のメンバー（出てきた順）と、マスごとの担当
  const pages = board.pages.filter((p) => !p.missing);
  const members: { name: string; color: string }[] = [];
  for (const p of pages) for (const a of p.assignees) if (!members.some((m) => m.name === a.name)) members.push(a);
  const who = pages.map((p) =>
    board.stages.map((s) => {
      const a = p.assignees.find((x) => x.stageIds.includes(s.id));
      return a ? members.findIndex((m) => m.name === a.name) : -1;
    }),
  );
  return {
    v: SNAPSHOT_VERSION,
    generatedAt: extra.now,
    app: extra.appVersion,
    work: {
      title: hidden.has("title") ? null : board.work.title,
      kind: board.work.kind,
      unit: board.work.unit,
      rows: data.rows.length,
    },
    stages: data.stages.map((s) => ({ name: s.name, color: s.color })),
    cells: showCells ? data.rows.map((row) => row.map((c) => CELL_CODE[c])) : null,
    spans: showCells ? data.spans : null,
    labels: showCells ? data.labels : null,
    members: members.map((m) => ({ i: initial(m.name), c: m.color })),
    who: showCells && members.length > 0 ? who : null,
    progress: data.progress,
    todayProgress: data.todayProgress,
    // 作家の残りが 0 でも、メンバー担当のマスが残っていれば完成ではない（5.23）。対象外のマスは終わったものとみなす
    completed: prediction.tasks.every((t) => t.done || t.excluded),
    deadlines: forecast.deadlines.map((d) => ({ name: d.name, date: dayKey(d.date), selected: d.id === selected })),
    finish:
      hidden.has("finish") || (!finish.low && !finish.mid && !finish.high)
        ? null
        : { low: dateOrNull(finish.low), mid: dateOrNull(finish.mid), high: dateOrNull(finish.high) },
    time: hidden.has("time") ? null : { todayMs: forecast.workedTodayMs, totalMs },
    lastWorkedOn: extra.lastWorkedAt === null ? null : dayKey(startOfDay(extra.lastWorkedAt)),
  };
}

/** 閲覧 URL。鍵はフラグメントに入れ、サーバのログに残さない */
export function shareUrl(prefs: PublishPrefs): string {
  return `${PUBLISH_BASE}/p/${prefs.publishId}#k=${prefs.readKey}`;
}

/** 直近の作業の目安に使う日数（forecast.ts の PACE_DAYS と同じ 28 日） */
const PACE_DAYS = 28;

/** 作品の今の状態を読み込んで要約を組む（Publisher とダイアログの両方から使う） */
export async function collectSnapshot(workId: number, hide: HideKey[]): Promise<Snapshot> {
  const now = Date.now();
  const today = startOfDay(now);
  const dayStart = dayStartMs(today);
  const from = dayStartMs(addDays(today, -PACE_DAYS));
  const [board, prediction, schedule, spans, sessions, works, info] = await Promise.all([
    api.getBoard(workId),
    api.getPrediction(workId),
    api.getSchedule(workId),
    api.listSpans(from),
    api.listSessions(workId, dayStart),
    api.listWorks(),
    api.dataInfo(),
  ]);
  const forecast = computeForecast(board, prediction, schedule, spans, now);
  const lastWorkedAt = works.find((w) => w.id === workId)?.lastWorkedAt ?? null;
  return buildSnapshot(forecast, { sessions, dayStart, lastWorkedAt, appVersion: info.version, now }, hide);
}

/** 送る。失敗は Error で投げる（文面は設定画面に出す）。10 秒以内の再送（429）は「送れた」と同じ扱いにする */
export async function sendSnapshot(prefs: PublishPrefs, snapshot: Snapshot): Promise<void> {
  const res = await fetch(`${PUBLISH_BASE}/p/${prefs.publishId}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${prefs.writeKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ readKey: prefs.readKey, snapshot }),
  });
  if (res.ok || res.status === 429) return;
  throw new Error(`HTTP ${res.status}`);
}

/** サーバの行を消す。無くても成功（Worker 側が 204 を返す） */
export async function removeSnapshot(prefs: PublishPrefs): Promise<void> {
  const res = await fetch(`${PUBLISH_BASE}/p/${prefs.publishId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${prefs.writeKey}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

/** 1 作品ぶんを送って結果を記録する。送れなかった理由は記録するだけで投げない */
export async function publishWork(prefs: PublishPrefs): Promise<void> {
  try {
    const snapshot = await collectSnapshot(prefs.workId, prefs.hide);
    await sendSnapshot(prefs, snapshot);
    await api.markPublished(prefs.workId, null);
  } catch (e) {
    await api.markPublished(prefs.workId, e instanceof Error ? e.message : String(e)).catch(() => {});
  }
}

/** 公開をやめた作品のサーバの行を消して、消し残しの印を下ろす。消せなければ次の機会に回す */
export async function unpublishWork(prefs: PublishPrefs): Promise<void> {
  try {
    await removeSnapshot(prefs);
    await api.markUnpublished(prefs.workId);
  } catch {
    // オフラインなど。pending_delete が立ったままなので、次の起動でやり直す
  }
}

/** 送る必要のあるものをすべて片付ける（起動時・記録が変わったあと） */
export async function publishAll(): Promise<void> {
  const list = await api.listPublishing();
  for (const prefs of list) {
    if (prefs.pendingDelete) await unpublishWork(prefs);
    else if (prefs.enabled) await publishWork(prefs);
  }
}
