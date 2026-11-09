// みんなの作業（仕様書 5.25）：知らせの文を組み、送り待ちを送り、ほかの人の知らせを取ってくる。
// 何を・いつ送るかは Rust 側（store/feed.rs）が決めて送り待ちに入れる。ここは HTTP と表示の言葉だけ。
import { api, FeedKind, FeedUnit } from "./api";
import { feedWho } from "./feed-emoji";
import { t } from "./i18n/feed";

/**
 * 預かり場所。開発中のビルドは VITE_FEED_BASE を指定しない限り null（送りも取りもしない）。
 * 5.22 の公開と違い、本番の利用者に開発中に試した知らせが流れないよう、既定で本番に向けない
 */
export const FEED_BASE: string | null =
  import.meta.env.VITE_FEED_BASE ?? (import.meta.env.DEV ? null : "https://share.otosazu.com");

/** 説明書の「みんなの作業」の節 */
export const FEED_GUIDE_URL = "https://otosazu.com/guide/#feed";

/** サーバから届く知らせ 1 件 */
export type FeedItem = {
  seq: number;
  at: number;
  sender: string;
  emoji: [number, number];
  kind: FeedKind;
  stage?: string;
  unit?: FeedUnit;
  count?: number;
};

export type FeedResponse = { now: number; active: number; items: FeedItem[] };

/** 左ペインの 2 行目に出す 1 件 */
export type Announcement = { id: string; text: string; special: boolean };

const STAGE_KEYS = ["storyboard", "sketch", "inking", "screentone", "rough", "lineart", "coloring", "finishing"] as const;
type StageKey = (typeof STAGE_KEYS)[number];
const isStageKey = (s: string | undefined): s is StageKey => (STAGE_KEYS as readonly string[]).includes(s ?? "");

/** 知らせの文（今の言語で） */
export function feedText(item: Pick<FeedItem, "emoji" | "kind" | "stage" | "unit" | "count">): string {
  const who = feedWho(item.emoji);
  switch (item.kind) {
    case "start":
      return t("start", { who });
    case "stage":
      return isStageKey(item.stage) ? t("stage", { who, stage: t(`stage.${item.stage}`) }) : t("stageUnknown", { who });
    case "page":
      return t(item.unit ?? "item", { who, n: item.count ?? 1 });
    case "work":
      return t("work", { who });
  }
}

/**
 * 新しく届いた知らせを、2 行目に出す順に並べる（古い順）。自分の知らせは出さない。
 * 裏にあった間に来た分は「離れている間に ◯件」の 1 件、4 件以上なら「◯件の知らせ」の 1 件にまとめる
 */
export function announcements(fresh: FeedItem[], mine: ReadonlySet<string>, away: boolean): Announcement[] {
  const others = fresh.filter((i) => !mine.has(i.sender)).sort((a, b) => a.seq - b.seq);
  if (others.length === 0) return [];
  const last = others[others.length - 1].seq;
  if (away) return [{ id: `away-${last}`, text: t("away", { n: others.length }), special: false }];
  if (others.length >= 4) return [{ id: `many-${last}`, text: t("many", { n: others.length }), special: false }];
  return others.map((i) => ({ id: String(i.seq), text: feedText(i), special: i.kind === "work" }));
}

/** 何分前・何時間前 */
export function ago(at: number, now: number): string {
  const min = Math.floor((now - at) / 60_000);
  if (min < 1) return t("justNow");
  if (min < 60) return t("minAgo", { n: min });
  return t("hourAgo", { n: Math.floor(min / 60) });
}

/** ほかの人の知らせを取ってくる。since より新しいものだけ */
export async function fetchFeed(base: string, since: number): Promise<FeedResponse> {
  const res = await fetch(`${base}/feed?since=${since}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * 送る時刻になった知らせを送る。作品ごとに 1 件（サーバは同じ送り手を 10 秒に 1 件しか受けない）。
 * 送れたもの、形が違うと断られたもの（400 など。送り直しても通らない）は送り待ちから消す。
 * 429・5xx・つながらないときは残して次に回す
 */
export async function sendDue(base: string): Promise<void> {
  const due = await api.feedDue();
  for (const d of due) {
    const body: Record<string, unknown> = { sender: d.sender, emoji: d.emoji, kind: d.kind };
    if (d.stage) body.stage = d.stage;
    if (d.unit) body.unit = d.unit;
    if (d.count !== null && d.kind === "page") body.count = d.count;
    try {
      const res = await fetch(`${base}/feed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 429)) await api.feedSent(d.ids);
    } catch {
      // オフライン。次に回す
    }
  }
}
