// みんなの作業（仕様書 5.25）の状態：設定、ほかの人の知らせ、作業中の人数、2 行目に出す順番待ち。
// PC の窓（Shell）だけで動かす。ミニ窓と遠隔の画面には出さない。
// - 取る：窓が表に出ている間だけ 1 分おき。裏に回ったら止め、表に戻ったらすぐ取る
// - 送る：送るのがオンで案内を閉じていれば、1 分おきと記録が変わった少しあとに、送り待ちを送る
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, FeedPrefs } from "./api";
import { useApp } from "./app-context";
import { Announcement, announcements, FEED_BASE, FeedItem, fetchFeed, sendDue } from "./feed";

const POLL_MS = 60_000;
const SEND_MS = 60_000;
/** 記録が変わってから送り待ちを見に行くまで（送る時刻は Rust 側が 30 秒以上先にしている） */
const SEND_AFTER_CHANGE_MS = 35_000;
/** 知らせの一覧に出す範囲。「作業中」の人数を数える長さ（サーバの FEED_ACTIVE_MS）と揃える */
const WINDOW_MS = 12 * 60 * 60 * 1000;
const MAX_ITEMS = 200;

type FeedState = {
  /** 向け先。開発中のビルドでは null（送りも取りもしない） */
  base: string | null;
  prefs: FeedPrefs | null;
  setPrefs: (p: FeedPrefs) => Promise<void>;
  /** 作業中の人数。まだ取れていない・届かないときは null */
  active: number | null;
  offline: boolean;
  /** 直近 12 時間の知らせ（新しい順） */
  items: FeedItem[];
  /** 自分の送り手（作品ごと） */
  mine: ReadonlySet<string>;
  /** 2 行目に出す順番待ち。先頭を出し終えたら shift を呼ぶ */
  queue: Announcement[];
  shift: () => void;
};

const Ctx = createContext<FeedState | null>(null);

export function useFeed(): FeedState {
  const v = useContext(Ctx);
  if (!v) throw new Error("FeedProvider がありません");
  return v;
}

export function FeedProvider({ children }: { children: ReactNode }) {
  const app = useApp();
  const base = FEED_BASE;
  const [prefs, setPrefsState] = useState<FeedPrefs | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [offline, setOffline] = useState(false);
  const [items, setItems] = useState<FeedItem[]>([]);
  const [mine, setMine] = useState<ReadonlySet<string>>(new Set());
  const [queue, setQueue] = useState<Announcement[]>([]);

  const lastSeq = useRef<number | null>(null);
  const mineRef = useRef(mine);
  mineRef.current = mine;
  /** 窓から離れている（フォーカスが無い）間に届いた知らせ。戻ったときに「離れている間に ◯件」にまとめる */
  const awayItems = useRef<FeedItem[] | null>(document.hasFocus() ? null : []);

  useEffect(() => {
    api.getFeedPrefs().then(setPrefsState).catch(app.showError);
  }, [app.showError]);

  // 自分の送り手は、作品が増えたり送り始めたりすると増えるので、記録が変わるたびに読み直す
  useEffect(() => {
    api
      .listFeedSenders()
      .then((list) => setMine(new Set(list.map((s) => s.sender))))
      .catch(() => {});
  }, [app.version]);

  const setPrefs = useCallback(async (p: FeedPrefs) => {
    await api.setFeedPrefs(p);
    setPrefsState(p);
  }, []);

  const receiving = base !== null && prefs?.receive === true;

  // ----- 取る -----
  const poll = useCallback(async () => {
    if (!base) return;
    try {
      const res = await fetchFeed(base, lastSeq.current ?? 0);
      setOffline(false);
      setActive(res.active);
      const fresh = res.items;
      const first = lastSeq.current === null;
      if (fresh.length > 0) lastSeq.current = Math.max(...fresh.map((i) => i.seq));
      else if (first) lastSeq.current = 0;
      setItems((old) =>
        [...fresh, ...old].filter((i) => i.at > res.now - WINDOW_MS).slice(0, MAX_ITEMS),
      );
      // 起動して最初に取った分は、もう過ぎたことなので流さない（画面の一覧には出す）
      if (first) return;
      if (awayItems.current) awayItems.current.push(...fresh);
      else setQueue((q) => [...q, ...announcements(fresh, mineRef.current, false)]);
    } catch {
      setOffline(true);
    }
  }, [base]);

  useEffect(() => {
    if (!receiving) return;
    let timer: number | undefined;
    const start = () => {
      window.clearInterval(timer);
      poll();
      timer = window.setInterval(poll, POLL_MS);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") start();
      else window.clearInterval(timer);
    };
    const onBlur = () => {
      awayItems.current ??= [];
    };
    const onFocus = () => {
      const held = awayItems.current;
      awayItems.current = null;
      if (held && held.length > 0) setQueue((q) => [...q, ...announcements(held, mineRef.current, true)]);
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
    };
  }, [receiving, poll]);

  // 受け取りをやめたら、流しかけのものも消す
  useEffect(() => {
    if (!receiving) setQueue([]);
  }, [receiving]);

  // ----- 送る -----
  const sending = base !== null && prefs?.send === true && prefs.guided;
  const busy = useRef(false);
  const send = useCallback(async () => {
    if (!base || busy.current) return;
    busy.current = true;
    try {
      await sendDue(base);
    } catch {
      // 次に回す
    } finally {
      busy.current = false;
    }
  }, [base]);

  useEffect(() => {
    if (!sending) return;
    send();
    const timer = window.setInterval(send, SEND_MS);
    return () => window.clearInterval(timer);
  }, [sending, send]);

  useEffect(() => {
    if (!sending || app.version === 0) return;
    const timer = window.setTimeout(send, SEND_AFTER_CHANGE_MS);
    return () => window.clearTimeout(timer);
  }, [sending, send, app.version]);

  const shift = useCallback(() => setQueue((q) => q.slice(1)), []);

  const value = useMemo<FeedState>(
    () => ({ base, prefs, setPrefs, active, offline, items, mine, queue, shift }),
    [base, prefs, setPrefs, active, offline, items, mine, queue, shift],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
