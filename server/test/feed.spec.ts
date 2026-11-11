import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import {
  FEED_ACTIVE_MS,
  FEED_ACTIVE_SQL,
  FEED_GLOBAL_PER_MIN,
  FEED_ITEMS_SQL,
  FEED_MAX_ITEMS,
  FEED_RETENTION_MS,
  FEED_SENDER_INTERVAL_MS,
  FEED_WINDOW_MS,
  type FeedItem,
  sweepFeed,
} from '../src/feed';

// みんなの作業（仕様書 5.25）の口を、実 Worker + D1 で固める。ストレージはテストごとに分離される

const base = 'https://share.test';
const A = 'a'.repeat(32);
const B = 'b'.repeat(32);

type Feed = { now: number; active: number; items: FeedItem[] };

function post(body: unknown, raw?: string) {
  return SELF.fetch(`${base}/feed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: raw ?? JSON.stringify(body),
  });
}
async function feed(since?: number): Promise<Feed> {
  const res = await SELF.fetch(`${base}/feed${since === undefined ? '' : `?since=${since}`}`);
  expect(res.status).toBe(200);
  return res.json<Feed>();
}
/** 送り手の間隔や時間の窓を試すため、行を昔にする */
async function age(ms: number, sender?: string) {
  if (sender) await env.DB.prepare('UPDATE feed SET at = at - ? WHERE sender = ?').bind(ms, sender).run();
  else await env.DB.prepare('UPDATE feed SET at = at - ?').bind(ms).run();
  // 使い回している人数も捨てる（本番では 5 分で切れる）
  await caches.default.delete(new Request(`${base}/feed/__active`));
}

const start = (sender = A) => ({ sender, emoji: [3, 41], kind: 'start' });

describe('みんなの作業', () => {
  it('置いた知らせが取れる。時刻はサーバが付ける', async () => {
    const res = await post({ sender: A, emoji: [3, 41], kind: 'stage', stage: 'inking' });
    expect(res.status).toBe(201);
    const got = await feed();
    expect(got.items).toHaveLength(1);
    expect(got.items[0]).toMatchObject({ sender: A, emoji: [3, 41], kind: 'stage', stage: 'inking' });
    expect(got.items[0].at).toBeGreaterThan(0);
  });

  it('種類ごとの形', async () => {
    expect((await post({ sender: A, emoji: [0, 999], kind: 'work' })).status).toBe(201);
    await age(FEED_SENDER_INTERVAL_MS, A);
    expect((await post({ sender: A, emoji: [0, 1], kind: 'page', unit: 'sheet', count: 3 })).status).toBe(201);
    await age(FEED_SENDER_INTERVAL_MS, A);
    // 知らない工程は鍵なしで送る
    expect((await post({ sender: A, emoji: [0, 1], kind: 'stage' })).status).toBe(201);
    const items = (await feed()).items;
    expect(items.map((i) => i.kind)).toEqual(['stage', 'page', 'work']);
    expect(items[0].stage).toBeUndefined();
    expect(items[1]).toMatchObject({ unit: 'sheet', count: 3 });
  });

  it.each([
    ['送り手の形', { sender: 'xyz', emoji: [1, 2], kind: 'start' }],
    ['絵文字の範囲', { sender: A, emoji: [1, 1000], kind: 'start' }],
    ['絵文字の数', { sender: A, emoji: [1], kind: 'start' }],
    ['知らない種類', { sender: A, emoji: [1, 2], kind: 'hello' }],
    ['工程の鍵に自由な文字', { sender: A, emoji: [1, 2], kind: 'stage', stage: 'ペン入れ' }],
    ['開始に工程', { sender: A, emoji: [1, 2], kind: 'start', stage: 'inking' }],
    ['ページに単位が無い', { sender: A, emoji: [1, 2], kind: 'page', count: 1 }],
    ['ページの数が 0', { sender: A, emoji: [1, 2], kind: 'page', unit: 'page', count: 0 }],
    ['工程に件数', { sender: A, emoji: [1, 2], kind: 'stage', count: 2 }],
    ['余計なキー', { sender: A, emoji: [1, 2], kind: 'start', name: 'たろう' }],
  ])('形が違えば 400：%s', async (_label, body) => {
    expect((await post(body)).status).toBe(400);
  });

  it('JSON でなければ 400、大きすぎれば 413', async () => {
    expect((await post(null, '{')).status).toBe(400);
    expect((await post(null, 'x'.repeat(2000))).status).toBe(413);
  });

  it('同じ送り手から 10 秒以内は 429。別の送り手は通る', async () => {
    expect((await post(start(A))).status).toBe(201);
    expect((await post(start(A))).status).toBe(429);
    expect((await post(start(B))).status).toBe(201);
    await age(FEED_SENDER_INTERVAL_MS, A);
    expect((await post(start(A))).status).toBe(201);
  });

  it('全体で 1 分あたりの上限を超えたら 429', async () => {
    const stmt = env.DB.prepare("INSERT INTO feed (sender, e1, e2, kind, at) VALUES (?, 0, 0, 'start', ?)");
    const now = Date.now();
    await env.DB.batch(
      Array.from({ length: FEED_GLOBAL_PER_MIN }, (_, i) => stmt.bind(i.toString(16).padStart(32, '0'), now)),
    );
    expect((await post(start(A))).status).toBe(429);
  });

  it('since より新しいものだけ返る。新しい順', async () => {
    await post(start(A));
    await post(start(B));
    const all = await feed();
    expect(all.items.map((i) => i.sender)).toEqual([B, A]);
    const newer = await feed(all.items[1].seq);
    expect(newer.items.map((i) => i.sender)).toEqual([B]);
    expect((await SELF.fetch(`${base}/feed?since=-1`)).status).toBe(400);
  });

  it('24 時間より古いものは返らない', async () => {
    await post(start(A));
    await age(FEED_WINDOW_MS + 1000);
    expect((await feed()).items).toHaveLength(0);
  });

  it('人数は 12 時間以内に start を送った送り手の数（同じ送り手は 1 人）', async () => {
    await post(start(A));
    await age(FEED_SENDER_INTERVAL_MS, A);
    await post(start(A));
    await post({ sender: B, emoji: [1, 2], kind: 'work' });
    expect((await feed()).active).toBe(1);
    await age(FEED_ACTIVE_MS + 1000);
    expect((await feed()).active).toBe(0);
  });

  it('人数は使い回す。start が置かれたら数え直す', async () => {
    await post(start(A));
    expect((await feed()).active).toBe(1);
    // POST を通さずに足した分は、使い回している間は数に入らない
    await env.DB.prepare("INSERT INTO feed (sender, e1, e2, kind, at) VALUES (?, 0, 0, 'start', ?)")
      .bind(B, Date.now())
      .run();
    expect((await feed()).active).toBe(1);
    await post(start('c'.repeat(32)));
    expect((await feed()).active).toBe(3);
  });

  // 取りに来るたびに表全体を読むと、D1 の無料枠（1 日 500 万行）を超える（2026-11-11 に実際に超えた）
  it('取りに来るたびに表全体を読まない', async () => {
    const now = Date.now();
    const stmt = env.DB.prepare('INSERT INTO feed (sender, e1, e2, kind, at) VALUES (?, 0, 0, ?, ?)');
    const row = (i: number, kind: string, at: number) => stmt.bind(i.toString(16).padStart(32, '0'), kind, at);
    await env.DB.batch([
      // 2 日前の知らせが溜まっている
      ...Array.from({ length: 300 }, (_, i) => row(i, 'start', now - 2 * FEED_WINDOW_MS)),
      // 今しがたの知らせ。start は 5 件だけ
      ...Array.from({ length: 20 }, (_, i) => row(1000 + i, 'work', now - 1000)),
      ...Array.from({ length: 5 }, (_, i) => row(2000 + i, 'start', now - 1000)),
    ]);
    const last = (await env.DB.prepare('SELECT MAX(seq) AS seq FROM feed').first<{ seq: number }>())!.seq;

    // 新着が無ければ、知らせは 1 行も読まない
    const items = await env.DB.prepare(FEED_ITEMS_SQL).bind(last, now - FEED_WINDOW_MS, FEED_MAX_ITEMS).all();
    expect(items.results).toHaveLength(0);
    expect(items.meta.rows_read).toBeLessThanOrEqual(1);

    // 人数は、窓の中の start の行だけを読む
    const active = await env.DB.prepare(FEED_ACTIVE_SQL).bind(now - FEED_ACTIVE_MS).all<{ n: number }>();
    expect(active.results[0].n).toBe(5);
    expect(active.meta.rows_read).toBeLessThanOrEqual(10);
  });

  it('掃除で 3 日より古い行が消える', async () => {
    await post(start(A));
    await post(start(B));
    await age(FEED_RETENTION_MS + 1000, A);
    expect(await sweepFeed(env.DB)).toBe(1);
    const left = await env.DB.prepare('SELECT sender FROM feed').all<{ sender: string }>();
    expect(left.results.map((r) => r.sender)).toEqual([B]);
  });

  it('アプリの WebView から POST できるよう CORS が開いている', async () => {
    const res = await SELF.fetch(`${base}/feed`, {
      method: 'OPTIONS',
      headers: { Origin: 'tauri://localhost', 'Access-Control-Request-Method': 'POST' },
    });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});
