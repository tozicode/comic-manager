import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: () => true }));

import { ago, announcements, FEED_BASE, FeedItem, feedText } from "./feed";
import { FEED_EMOJI, feedEmoji, feedWho } from "./feed-emoji";
import { setLang } from "./i18n";

const item = (seq: number, extra: Partial<FeedItem> = {}): FeedItem => ({
  seq,
  at: 0,
  sender: "a".repeat(32),
  emoji: [16, 161],
  kind: "start",
  ...extra,
});

afterEach(() => setLang("ja"));

describe("絵文字の一覧", () => {
  it("Rust の EMOJI_COUNT と同じ 200 個で、重なりが無い", () => {
    expect(FEED_EMOJI).toHaveLength(200);
    expect(new Set(FEED_EMOJI).size).toBe(200);
  });

  it("国旗（地域指示子）と異体字セレクタを含まない", () => {
    for (const e of FEED_EMOJI) {
      expect([...e]).toHaveLength(1);
      expect(/[\u{1F1E6}-\u{1F1FF}️]/u.test(e)).toBe(false);
    }
  });

  it("知らない番号は ❔", () => {
    expect(feedEmoji(9999)).toBe("❔");
    expect(feedWho([16, 161])).toBe("🐧🍙");
  });
});

describe("知らせの文", () => {
  it("日本語", () => {
    setLang("ja");
    expect(feedText(item(1))).toBe("🐧🍙 が作業を始めました");
    expect(feedText(item(1, { kind: "stage", stage: "inking" }))).toBe("🐧🍙 がペン入れを終えました");
    expect(feedText(item(1, { kind: "stage" }))).toBe("🐧🍙 が工程を 1 つ終えました");
    expect(feedText(item(1, { kind: "stage", stage: "unknown_key" }))).toBe("🐧🍙 が工程を 1 つ終えました");
    expect(feedText(item(1, { kind: "page", unit: "page", count: 3 }))).toBe("🐧🍙 が 3 ページ仕上げました");
    expect(feedText(item(1, { kind: "page", unit: "sheet", count: 1 }))).toBe("🐧🍙 が 1 枚仕上げました");
    expect(feedText(item(1, { kind: "page", unit: "item", count: 2 }))).toBe("🐧🍙 が 2 つ仕上げました");
    expect(feedText(item(1, { kind: "work" }))).toBe("🎉 🐧🍙 が作品を完成させました！");
  });

  it("英語は数で形が変わる", () => {
    setLang("en");
    expect(feedText(item(1, { kind: "page", unit: "page", count: 1 }))).toBe("🐧🍙 finished a page");
    expect(feedText(item(1, { kind: "page", unit: "page", count: 4 }))).toBe("🐧🍙 finished 4 pages");
    expect(feedText(item(1, { kind: "stage", stage: "lineart" }))).toBe("🐧🍙 finished line art");
  });

  it("何分前・何時間前", () => {
    setLang("ja");
    expect(ago(0, 30_000)).toBe("たった今");
    expect(ago(0, 5 * 60_000)).toBe("5分前");
    expect(ago(0, 3 * 60 * 60_000)).toBe("3時間前");
  });
});

describe("2 行目に出す順番", () => {
  const mine = new Set(["m".repeat(32)]);

  it("古い順に 1 件ずつ。自分の知らせは出さず、完成は特別", () => {
    setLang("ja");
    const list = announcements(
      [item(3, { kind: "work" }), item(2, { sender: "m".repeat(32) }), item(1)],
      mine,
      false,
    );
    expect(list.map((a) => [a.id, a.special])).toEqual([
      ["1", false],
      ["3", true],
    ]);
  });

  it("4 件以上はまとめる", () => {
    setLang("ja");
    const list = announcements([1, 2, 3, 4].map((n) => item(n)), mine, false);
    expect(list).toEqual([{ id: "many-4", text: "4件の知らせがあります", special: false }]);
  });

  it("離れている間の分は 1 件にまとめる。自分のだけなら何も出さない", () => {
    setLang("ja");
    expect(announcements([item(5)], mine, true)).toEqual([{ id: "away-5", text: "離れている間に 1件", special: false }]);
    expect(announcements([item(6, { sender: "m".repeat(32) })], mine, true)).toEqual([]);
  });
});

describe("向け先", () => {
  it("テスト（開発）では VITE_FEED_BASE が無ければ送りも取りもしない", () => {
    expect(FEED_BASE).toBeNull();
  });
});
