// 上限と掃除。Worker の本体モジュール（index.ts）は handler 以外を export できないので、テストから使うものはここに置く

/** 要約 1 件の大きさの上限（仕様書 5.22。数 KB のはずなので余裕を見て 64 KB） */
export const MAX_BODY_BYTES = 64 * 1024;
/** 同じ公開 ID への書き込みの最短間隔。アプリは 30 秒のデバウンスで送るので、これに当たるのは異常な使い方だけ */
export const MIN_INTERVAL_MS = 10_000;
/** 送信がこれだけ止まった行は掃除で消す */
export const RETENTION_MS = 180 * 24 * 60 * 60 * 1000;

/** 送信が RETENTION_MS 止まった行を消す。戻り値は消した数（テスト用） */
export async function sweep(db: D1Database, now = Date.now()): Promise<number> {
  const res = await db.prepare('DELETE FROM snapshots WHERE updated_at < ?').bind(now - RETENTION_MS).run();
  return res.meta.changes ?? 0;
}
