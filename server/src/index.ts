import { Hono } from 'hono';
import { cors } from 'hono/cors';

import {
  FEED_ACTIVE_CACHE_SECONDS,
  FEED_MAX_BODY_BYTES,
  feedRejection,
  insertFeed,
  parseFeedPost,
  readFeedActive,
  readFeedItems,
  sweepFeed,
} from './feed';
import { MAX_BODY_BYTES, MIN_INTERVAL_MS, sweep } from './limits';

export interface Env {
  DB: D1Database;
  /** 閲覧ページ（public/）。テストでは無いこともある */
  ASSETS?: { fetch(req: Request): Promise<Response> };
}


/** 閲覧鍵を送るヘッダ（閲覧ページの JS と合わせる。URL のクエリに鍵を出さないため） */
const READ_HEADER = 'X-Otosazu-Read';

/** PUT /p/:id のボディ */
interface PutBody {
  /** 閲覧鍵（平文。サーバはハッシュだけ持つ）。送るたびに上書きされるので、作り直しはこれを変えるだけ */
  readKey: string;
  /** 要約の JSON。中身はサーバは見ない */
  snapshot: unknown;
}

/**
 * 進捗の公開 Worker（仕様書 5.22）。
 *
 *   - PUT    /p/:id           … Bearer <書き込み鍵>。要約を上書き（初回は登録）
 *   - DELETE /p/:id           … Bearer <書き込み鍵>。消す（無くても 204）
 *   - GET    /p/:id/snapshot  … X-Otosazu-Read: <閲覧鍵>。要約の JSON
 *   - GET    /p/:id           … 閲覧ページ（public/p.html）
 *   - POST   /feed            … みんなの作業（5.25）の知らせを 1 件置く。鍵は無い
 *   - GET    /feed?since=<n>  … 直近 12 時間の知らせ（n より新しいもの）と作業中の人数
 *
 * サーバは要約の中身を理解しない。やることは「鍵を確かめて預かり、配る」だけ。
 */
const app = new Hono<{ Bindings: Env }>();

// アプリ（Tauri の WebView。オリジンは tauri://localhost や http://localhost:1420）からの PUT / DELETE と、
// 別の場所に置かれた閲覧ページからの GET を通すため、/p/ 以下は CORS を開ける。守りは鍵で足りる
app.use(
  '/p/*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type', READ_HEADER],
    maxAge: 86400,
  }),
);

// みんなの作業も、アプリの WebView から POST し、GET する
app.use(
  '/feed',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type'],
    maxAge: 86400,
  }),
);

/** 鍵は高エントロピー（アプリが乱数で作る）なので SHA-256 で足りる。低速 KDF は要らない */
async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 公開 ID の形。アプリは 16 バイトの 16 進（32 文字）で作る。短すぎるものは総当たりされうるので断る */
const ID_RE = /^[0-9a-f]{16,64}$/;
function validKey(s: unknown): s is string {
  return typeof s === 'string' && s.length >= 16 && s.length <= 128;
}

function bearer(c: { req: { header(name: string): string | undefined } }): string | null {
  const m = (c.req.header('Authorization') ?? '').match(/^Bearer\s+(.+)$/);
  return m ? m[1] : null;
}

type Row = { write_hash: string; read_hash: string; body: string; updated_at: number };

async function findRow(db: D1Database, id: string): Promise<Row | null> {
  return db.prepare('SELECT write_hash, read_hash, body, updated_at FROM snapshots WHERE id = ?').bind(id).first<Row>();
}

app.put('/p/:id', async (c) => {
  const id = c.req.param('id');
  if (!ID_RE.test(id)) return c.json({ error: 'bad id' }, 400);
  const writeKey = bearer(c);
  if (!validKey(writeKey)) return c.json({ error: 'missing bearer' }, 401);

  const raw = await c.req.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return c.json({ error: 'too large' }, 413);
  let body: PutBody;
  try {
    body = JSON.parse(raw) as PutBody;
  } catch {
    return c.json({ error: 'bad request' }, 400);
  }
  if (!validKey(body?.readKey) || body.snapshot === undefined || body.snapshot === null) {
    return c.json({ error: 'bad request' }, 400);
  }

  const writeHash = await sha256Hex(writeKey);
  const readHash = await sha256Hex(body.readKey);
  const snapshot = JSON.stringify(body.snapshot);
  const now = Date.now();

  const row = await findRow(c.env.DB, id);
  if (row) {
    if (row.write_hash !== writeHash) return c.json({ error: 'forbidden' }, 403);
    if (now - row.updated_at < MIN_INTERVAL_MS) {
      c.header('Retry-After', String(Math.ceil((MIN_INTERVAL_MS - (now - row.updated_at)) / 1000)));
      return c.json({ error: 'too many requests' }, 429);
    }
    await c.env.DB.prepare('UPDATE snapshots SET read_hash = ?, body = ?, updated_at = ? WHERE id = ? AND write_hash = ?')
      .bind(readHash, snapshot, now, id, writeHash)
      .run();
    return c.json({ ok: true, updatedAt: now });
  }

  // 初回：この書き込み鍵を公開 ID に束ねる（TOFU）。同時に他者が先に作った場合に備えて読み直す
  await c.env.DB.prepare(
    'INSERT OR IGNORE INTO snapshots (id, write_hash, read_hash, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(id, writeHash, readHash, snapshot, now, now)
    .run();
  const again = await findRow(c.env.DB, id);
  if (!again || again.write_hash !== writeHash) return c.json({ error: 'forbidden' }, 403);
  return c.json({ ok: true, updatedAt: now }, 201);
});

// 公開をやめたとき。アプリは失敗したら次の起動でやり直すので、無い行でも 204 にして冪等にする
app.delete('/p/:id', async (c) => {
  const id = c.req.param('id');
  if (!ID_RE.test(id)) return c.json({ error: 'bad id' }, 400);
  const writeKey = bearer(c);
  if (!validKey(writeKey)) return c.json({ error: 'missing bearer' }, 401);
  const row = await findRow(c.env.DB, id);
  if (!row) return c.body(null, 204);
  if (row.write_hash !== (await sha256Hex(writeKey))) return c.json({ error: 'forbidden' }, 403);
  await c.env.DB.prepare('DELETE FROM snapshots WHERE id = ?').bind(id).run();
  return c.body(null, 204);
});

app.get('/p/:id/snapshot', async (c) => {
  const id = c.req.param('id');
  if (!ID_RE.test(id)) return c.json({ error: 'bad id' }, 400);
  const readKey = c.req.header(READ_HEADER);
  if (!validKey(readKey)) return c.json({ error: 'missing key' }, 401);
  const row = await findRow(c.env.DB, id);
  // 行が無い＝公開が終わっている。閲覧ページはこれを「公開が終わっています」と出す
  if (!row) return c.json({ error: 'not found' }, 404);
  if (row.read_hash !== (await sha256Hex(readKey))) return c.json({ error: 'forbidden' }, 403);
  return c.body(JSON.stringify({ updatedAt: row.updated_at, snapshot: JSON.parse(row.body) }), 200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex',
  });
});

// 閲覧ページ。/p/<id> はどれも同じ HTML（鍵は URL のフラグメントにあり、サーバには届かない）
app.get('/p/:id', async (c) => {
  if (!ID_RE.test(c.req.param('id'))) return c.text('not found', 404);
  if (!c.env.ASSETS) return c.text('viewer not available', 404);
  const url = new URL(c.req.url);
  url.pathname = '/p';
  url.search = '';
  return c.env.ASSETS.fetch(new Request(url.toString(), { headers: c.req.raw.headers }));
});

/** 人数の答えを使い回すときの鍵 */
function feedActiveCacheKey(url: string): Request {
  const u = new URL(url);
  u.pathname = '/feed/__active';
  u.search = '';
  return new Request(u.toString());
}

/** 作業中の人数。数えるには窓の中の start をぜんぶ読むので、数分は使い回す（Cache API は拠点ごと） */
async function feedActive(db: D1Database, url: string, now: number): Promise<number> {
  const key = feedActiveCacheKey(url);
  const cached = await caches.default.match(key);
  if (cached) return (await cached.json<{ active: number }>()).active;
  const active = await readFeedActive(db, now);
  await caches.default.put(
    key,
    new Response(JSON.stringify({ active }), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${FEED_ACTIVE_CACHE_SECONDS}` },
    }),
  );
  return active;
}

app.post('/feed', async (c) => {
  const raw = await c.req.text();
  if (new TextEncoder().encode(raw).length > FEED_MAX_BODY_BYTES) return c.json({ error: 'too large' }, 413);
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return c.json({ error: 'bad request' }, 400);
  }
  const post = parseFeedPost(json);
  if (!post) return c.json({ error: 'bad request' }, 400);

  const now = Date.now();
  const rejected = await feedRejection(c.env.DB, post.sender, now);
  if (rejected) {
    c.header('Retry-After', rejected === 'sender' ? '10' : '60');
    return c.json({ error: 'too many requests' }, 429);
  }
  const seq = await insertFeed(c.env.DB, post, now);
  // 人数が変わるのは start だけ。すぐ数に入るよう、使い回している人数を捨てる
  if (post.kind === 'start') await caches.default.delete(feedActiveCacheKey(c.req.url));
  return c.json({ ok: true, seq }, 201);
});

app.get('/feed', async (c) => {
  const since = Number(c.req.query('since') ?? 0);
  if (!Number.isInteger(since) || since < 0) return c.json({ error: 'bad since' }, 400);

  const now = Date.now();
  const [items, active] = await Promise.all([
    readFeedItems(c.env.DB, since, now),
    feedActive(c.env.DB, c.req.url, now),
  ]);
  return c.body(JSON.stringify({ now, active, items }), 200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
});

// 本体モジュールが export してよいのは handler だけ（定数を export すると workerd が起動時に断る）
export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(Promise.all([sweep(env.DB), sweepFeed(env.DB)]));
  },
};
