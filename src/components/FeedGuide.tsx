// みんなの作業（仕様書 5.25）のはじめての案内。
// 既定で送る機能なので、どう見えて何が送られるかを最初に見せ、その場で止められるようにする。
// 閉じるまでは何も送らない（Rust 側は guided が立つまで送り待ちに入れない）
import { useMemo, useState } from "react";
import { useApp } from "../app-context";
import { Announcement, feedText } from "../feed";
import { useFeed } from "../feed-context";
import { t } from "../i18n/feed";
import { FeedDisclosure } from "../screens/FeedScreen";
import { Dialog } from "./Dialog";
import { FeedTickerView } from "./FeedTicker";

/** 見本に流す知らせ（作り物） */
function samples(): Announcement[] {
  const list = [
    { emoji: [16, 161] as [number, number], kind: "start" as const },
    { emoji: [1, 104] as [number, number], kind: "stage" as const, stage: "inking" },
    { emoji: [26, 122] as [number, number], kind: "page" as const, unit: "page" as const, count: 3 },
    { emoji: [16, 161] as [number, number], kind: "work" as const },
  ];
  return list.map((i, n) => ({ id: `sample-${n}`, text: feedText(i), special: i.kind === "work" }));
}

export function FeedGuide() {
  const app = useApp();
  const feed = useFeed();
  const [send, setSend] = useState(true);
  const list = useMemo(samples, []);
  const [shown, setShown] = useState(0);

  const close = () => {
    if (!feed.prefs) return;
    feed.setPrefs({ ...feed.prefs, send, guided: true }).catch(app.showError);
  };

  return (
    <Dialog
      className="feed-guide"
      title={t("guideTitle")}
      onClose={close}
      actions={
        <>
          <span className="grow muted small-text">{t("guideLater")}</span>
          <button className="btn primary" onClick={close}>
            {t("guideStart")}
          </button>
        </>
      }
    >
      <p>{t("guideIntro")}</p>
      <div className="dlabel feed-guide-label">{t("guideSample")}</div>
      <div className="feed-guide-sample">
        <FeedTickerView
          active={5}
          current={{ ...list[shown % list.length], id: `sample-${shown}` }}
          onShown={() => setShown((n) => n + 1)}
        />
      </div>
      <FeedDisclosure />
      <label className="row tight feed-guide-send">
        <input type="checkbox" checked={send} onChange={(e) => setSend(e.target.checked)} />
        <b>{t("send")}</b>
      </label>
    </Dialog>
  );
}
