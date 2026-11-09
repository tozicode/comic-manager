// みんなの作業（仕様書 5.25）の左ペインの下の 2 行。
// 1 行目は常に「◯人が作業中」、2 行目は知らせを 1 件ずつ出して消す。
// 収まる文は止めたまま数秒出して薄く消し、はみ出す文だけ電光掲示板のように 1 回流す。
// OS の「動きを減らす」がオンなら流さず「…」で切る
import { CSSProperties, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Announcement } from "../feed";
import { useFeed } from "../feed-context";
import { t } from "../i18n/feed";

/** 止めて出す長さ。作品の完成は長めに出す */
const SHOW_MS = 4_000;
const SPECIAL_MS = 8_000;
/** 流す速さ（px/秒） */
const SCROLL_PX_PER_SEC = 45;

type Mode = "measure" | "static" | "scroll" | "clip";

function TickerLine({ item, onDone }: { item: Announcement; onDone: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLSpanElement>(null);
  const [mode, setMode] = useState<Mode>("measure");
  const [style, setStyle] = useState<CSSProperties>({});
  const done = useRef(onDone);
  done.current = onDone;

  useLayoutEffect(() => {
    const b = box.current;
    const s = text.current;
    if (!b || !s) return;
    const boxW = b.clientWidth;
    const textW = s.scrollWidth;
    const showMs = item.special ? SPECIAL_MS : SHOW_MS;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (textW <= boxW) {
      setMode("static");
      setStyle({ "--dur": `${showMs}ms` } as CSSProperties);
    } else if (reduce) {
      setMode("clip");
      setStyle({ "--dur": `${showMs}ms` } as CSSProperties);
    } else {
      const sec = (boxW + textW) / SCROLL_PX_PER_SEC;
      setMode("scroll");
      setStyle({ "--from": `${boxW}px`, "--to": `${-textW}px`, "--dur": `${sec}s` } as CSSProperties);
    }
  }, [item.id, item.special]);

  // 止めて出すときは時間で、流すときはアニメーションの終わりで次へ
  useEffect(() => {
    if (mode !== "static" && mode !== "clip") return;
    const timer = window.setTimeout(() => done.current(), item.special ? SPECIAL_MS : SHOW_MS);
    return () => window.clearTimeout(timer);
  }, [mode, item.special]);

  return (
    <div className="feed-line" ref={box}>
      <span
        ref={text}
        className={`feed-text ${mode}${item.special ? " special" : ""}`}
        style={style}
        onAnimationEnd={mode === "scroll" ? () => done.current() : undefined}
      >
        {item.text}
      </span>
    </div>
  );
}

/** 見た目だけ（はじめての案内の見本でも使う） */
export function FeedTickerView({
  active,
  current,
  onShown,
  onClick,
}: {
  active: number | null;
  current: Announcement | undefined;
  onShown: () => void;
  onClick?: () => void;
}) {
  return (
    <button type="button" className="feed-ticker" onClick={onClick} title={onClick ? t("tickerHint") : undefined}>
      <div className="feed-active">{active === null ? "—" : t("active", { n: active })}</div>
      {current ? <TickerLine key={current.id} item={current} onDone={onShown} /> : <div className="feed-line" />}
    </button>
  );
}

export function FeedTicker({ onOpen }: { onOpen: () => void }) {
  const feed = useFeed();
  if (!feed.prefs?.receive) return null;
  return (
    <FeedTickerView
      active={feed.base && !feed.offline ? feed.active : null}
      current={feed.queue[0]}
      onShown={feed.shift}
      onClick={onOpen}
    />
  );
}
