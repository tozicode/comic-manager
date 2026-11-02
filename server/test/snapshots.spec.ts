import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { MIN_INTERVAL_MS, RETENTION_MS, sweep } from '../src/limits';

// 実 Worker + D1 で仕様書 5.22 の振る舞いを固める。ストレージはテストごとに分離される

const ID = '0123456789abcdef0123456789abcdef';
const WRITE = 'w'.repeat(32);
const READ = 'r'.repeat(32);
const base = 'https://share.test';

function put(id: string, snapshot: unknown, opts: { write?: string; read?: string; raw?: string } = {}) {
  return SELF.fetch(`${base}/p/${id}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${opts.write ?? WRITE}`, 'Content-Type': 'application/json' },
    body: opts.raw ?? JSON.stringify({ readKey: opts.read ?? READ, snapshot }),
  });
}
function get(id: string, read = READ) {
  return SELF.fetch(`${base}/p/${id}/snapshot`, { headers: { 'X-Otosazu-Read': read } });
}
function del(id: string, write = WRITE) {
  return SELF.fetch(`${base}/p/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${write}` } });
}
/** 書き込み間隔の判定をすり抜けるため、前回の送信を昔にする */
async function age(id: string, ms: number) {
  await env.DB.prepare('UPDATE snapshots SET updated_at = updated_at - ? WHERE id = ?').bind(ms, id).run();
}

describe('進捗の公開', () => {
  it('PUT で登録し、閲覧鍵で GET できる', async () => {
    const res = await put(ID, { progress: 0.5 });
    expect(res.status).toBe(201);
    const got = await get(ID);
    expect(got.status).toBe(200);
    expect(got.headers.get('Cache-Control')).toBe('no-store');
    const body = await got.json<{ updatedAt: number; snapshot: { progress: number } }>();
    expect(body.snapshot.progress).toBe(0.5);
    expect(body.updatedAt).toBeGreaterThan(0);
  });

  it('2 回目の PUT は上書き。間隔が短すぎると 429', async () => {
    await put(ID, { v: 1 });
    expect((await put(ID, { v: 2 })).status).toBe(429);
    await age(ID, MIN_INTERVAL_MS);
    expect((await put(ID, { v: 2 })).status).toBe(200);
    const body = await (await get(ID)).json<{ snapshot: { v: number } }>();
    expect(body.snapshot.v).toBe(2);
  });

  it('書き込み鍵が違えば 403。閲覧鍵が違えば 403', async () => {
    await put(ID, {});
    await age(ID, MIN_INTERVAL_MS);
    expect((await put(ID, {}, { write: 'x'.repeat(32) })).status).toBe(403);
    expect((await get(ID, 'x'.repeat(32))).status).toBe(403);
  });

  it('閲覧鍵は PUT のたびに置き換わる（作り直し）', async () => {
    await put(ID, {});
    await age(ID, MIN_INTERVAL_MS);
    await put(ID, {}, { read: 'n'.repeat(32) });
    expect((await get(ID, READ)).status).toBe(403);
    expect((await get(ID, 'n'.repeat(32))).status).toBe(200);
  });

  it('鍵が無い・短い・ID の形が違うものは断る', async () => {
    expect((await SELF.fetch(`${base}/p/${ID}`, { method: 'PUT', body: '{}' })).status).toBe(401);
    expect((await put(ID, {}, { write: 'short' })).status).toBe(401);
    expect((await put(ID, {}, { read: 'short' })).status).toBe(400);
    expect((await put('ZZZ', {})).status).toBe(400);
    expect((await put(ID, {}, { raw: 'not json' })).status).toBe(400);
    expect((await SELF.fetch(`${base}/p/${ID}/snapshot`)).status).toBe(401);
  });

  it('大きすぎる要約は 413', async () => {
    const res = await put(ID, { pad: 'x'.repeat(64 * 1024) });
    expect(res.status).toBe(413);
  });

  it('DELETE で消え、閲覧は 404 になる。無い行の DELETE も 204', async () => {
    await put(ID, {});
    expect((await del(ID, 'x'.repeat(32))).status).toBe(403);
    expect((await del(ID)).status).toBe(204);
    expect((await get(ID)).status).toBe(404);
    expect((await del(ID)).status).toBe(204);
  });

  it('消えた後は別の書き込み鍵で同じ ID を登録できる', async () => {
    await put(ID, {});
    await del(ID);
    expect((await put(ID, {}, { write: 'y'.repeat(32) })).status).toBe(201);
  });

  it('アプリの WebView から送れるよう CORS を返す', async () => {
    const pre = await SELF.fetch(`${base}/p/${ID}`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://tauri.localhost',
        'Access-Control-Request-Method': 'PUT',
        'Access-Control-Request-Headers': 'authorization,content-type',
      },
    });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(pre.headers.get('Access-Control-Allow-Methods')).toContain('PUT');
    expect(pre.headers.get('Access-Control-Allow-Headers')?.toLowerCase()).toContain('authorization');
    const res = await put(ID, {});
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('掃除は送信が止まった行だけ消す', async () => {
    const old = 'a'.repeat(32);
    await put(old, {});
    await put(ID, {});
    await age(old, RETENTION_MS + 1000);
    expect(await sweep(env.DB)).toBe(1);
    expect((await get(old)).status).toBe(404);
    expect((await get(ID)).status).toBe(200);
  });
});
