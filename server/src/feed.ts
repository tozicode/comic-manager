// みんなの作業（仕様書 5.25）の検証・上限・読み書き。
// Worker の本体モジュール（index.ts）は handler 以外を export できないので、テストから使うものはここに置く

/** 1 件のボディの大きさの上限。中身は数十バイトのはず */
export const FEED_MAX_BODY_BYTES = 1024;
/** 同じ送り手からの最短間隔 */
export const FEED_SENDER_INTERVAL_MS = 10_000;
/** 全体で 1 分あたりに受け付ける件数の上限（IP ごとの制限の代わりの歯止め） */
export const FEED_GLOBAL_PER_MIN = 120;
/** 返す知らせの範囲と件数。範囲は「作業中」に数える長さと揃える */
export const FEED_WINDOW_MS = 12 * 60 * 60 * 1000;
export const FEED_MAX_ITEMS = 200;
/** 「作業中」に数える長さ（最後の start から） */
export const FEED_ACTIVE_MS = 12 * 60 * 60 * 1000;
/** これより古い行は日次の掃除で消す */
export const FEED_RETENTION_MS = 3 * 24 * 60 * 60 * 1000;
/** 人数の答えを使い回す長さ（秒）。知らせは毎回 since の先だけを読むので使い回さない */
export const FEED_ACTIVE_CACHE_SECONDS = 300;
/** 絵文字の番号の上限（一覧は後ろに足していくので余裕を見る） */
export const FEED_MAX_EMOJI = 999;

const KINDS = ['start', 'stage', 'page', 'work'] as const;
const UNITS = ['page', 'sheet', 'item'] as const;
export type FeedKind = (typeof KINDS)[number];
export type FeedUnit = (typeof UNITS)[number];

/** アプリが送る 1 件 */
export interface FeedPost {
  sender: string;
  emoji: [number, number];
  kind: FeedKind;
  stage?: string;
  unit?: FeedUnit;
  count?: number;
}

/** 取得で返す 1 件 */
export interface FeedItem extends FeedPost {
  seq: number;
  at: number;
}

const SENDER_RE = /^[0-9a-f]{32}$/;
const STAGE_RE = /^[a-z_]{1,24}$/;

function isEmojiIndex(v: unknown): v is number {
  return Number.isInteger(v) && (v as number) >= 0 && (v as number) <= FEED_MAX_EMOJI;
}

/**
 * ボディを確かめて FeedPost にする。形が違えば null。
 * 自由な文字列が紛れ込まないよう、決まったキー以外があれば断る
 */
export function parseFeedPost(body: unknown): FeedPost | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  const allowed = new Set(['sender', 'emoji', 'kind', 'stage', 'unit', 'count']);
  if (Object.keys(b).some((k) => !allowed.has(k))) return null;

  if (typeof b.sender !== 'string' || !SENDER_RE.test(b.sender)) return null;
  if (!Array.isArray(b.emoji) || b.emoji.length !== 2 || !b.emoji.every(isEmojiIndex)) return null;
  if (!KINDS.includes(b.kind as FeedKind)) return null;
  const kind = b.kind as FeedKind;
  const post: FeedPost = { sender: b.sender, emoji: [b.emoji[0], b.emoji[1]], kind };

  // 種類ごとに、付けてよい項目が決まっている
  if (kind === 'stage') {
    if (b.stage !== undefined) {
      if (typeof b.stage !== 'string' || !STAGE_RE.test(b.stage)) return null;
      post.stage = b.stage;
    }
  } else if (b.stage !== undefined) {
    return null;
  }
  if (kind === 'page') {
    if (!UNITS.includes(b.unit as FeedUnit)) return null;
    if (!Number.isInteger(b.count) || (b.count as number) < 1 || (b.count as number) > 999) return null;
    post.unit = b.unit as FeedUnit;
    post.count = b.count as number;
  } else if (b.unit !== undefined || b.count !== undefined) {
    return null;
  }
  return post;
}

/** 受け付けを断る理由。null なら受け付けてよい */
export async function feedRejection(db: D1Database, sender: string, now: number): Promise<'sender' | 'global' | null> {
  const last = await db
    .prepare('SELECT MAX(at) AS at FROM feed WHERE sender = ?')
    .bind(sender)
    .first<{ at: number | null }>();
  if (last?.at != null && now - last.at < FEED_SENDER_INTERVAL_MS) return 'sender';
  const recent = await db
    .prepare('SELECT COUNT(*) AS n FROM feed WHERE at > ?')
    .bind(now - 60_000)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= FEED_GLOBAL_PER_MIN) return 'global';
  return null;
}

export async function insertFeed(db: D1Database, post: FeedPost, now: number): Promise<number> {
  const res = await db
    .prepare('INSERT INTO feed (sender, e1, e2, kind, stage, unit, count, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(post.sender, post.emoji[0], post.emoji[1], post.kind, post.stage ?? null, post.unit ?? null, post.count ?? null, now)
    .run();
  return res.meta.last_row_id ?? 0;
}

type FeedRow = {
  seq: number;
  sender: string;
  e1: number;
  e2: number;
  kind: FeedKind;
  stage: string | null;
  unit: FeedUnit | null;
  count: number | null;
  at: number;
};

// アプリは窓が表にある間 1 分おきに取りに来る。そのたびに表を端から読むと、D1 の無料枠（1 日 500 万行）を超える
// （2026-11-11 に実際に超えた）。どちらのクエリも、読む行が表の大きさに比例しない形にしてある（test/feed.spec.ts で固める）

/** since より新しい知らせ（新しい順）。主キーで since の先だけを読むので、新着が無ければ 1 行も読まない */
export const FEED_ITEMS_SQL =
  'SELECT seq, sender, e1, e2, kind, stage, unit, count, at FROM feed WHERE seq > ? AND at > ? ORDER BY seq DESC LIMIT ?';
/** 作業中の人数。索引 feed_kind_at（kind, at, sender）だけで、窓の中の start を数える */
export const FEED_ACTIVE_SQL = "SELECT COUNT(DISTINCT sender) AS n FROM feed WHERE kind = 'start' AND at > ?";

/** 直近の知らせのうち、since より新しいもの（新しい順） */
export async function readFeedItems(db: D1Database, since: number, now: number): Promise<FeedItem[]> {
  const rows = await db.prepare(FEED_ITEMS_SQL).bind(since, now - FEED_WINDOW_MS, FEED_MAX_ITEMS).all<FeedRow>();
  return rows.results.map((r): FeedItem => {
    const item: FeedItem = { seq: r.seq, at: r.at, sender: r.sender, emoji: [r.e1, r.e2], kind: r.kind };
    if (r.stage != null) item.stage = r.stage;
    if (r.unit != null) item.unit = r.unit;
    if (r.count != null) item.count = r.count;
    return item;
  });
}

/** 作業中の人数 */
export async function readFeedActive(db: D1Database, now: number): Promise<number> {
  const row = await db.prepare(FEED_ACTIVE_SQL).bind(now - FEED_ACTIVE_MS).first<{ n: number }>();
  return row?.n ?? 0;
}

/** 3 日より古い知らせを消す。戻り値は消した数（テスト用） */
export async function sweepFeed(db: D1Database, now = Date.now()): Promise<number> {
  const res = await db.prepare('DELETE FROM feed WHERE at < ?').bind(now - FEED_RETENTION_MS).run();
  return res.meta.changes ?? 0;
}
