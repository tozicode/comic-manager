// みんなの作業（仕様書 5.25）の画面：直近 12 時間の知らせ、送る・受け取るの設定、送るもの・送らないもの。
// 左ペインの下の 2 行を押して開く
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
import { api, FeedSender } from "../api";
import { useApp } from "../app-context";
import { ago, FEED_GUIDE_URL, feedText } from "../feed";
import { useFeed } from "../feed-context";
import { feedWho } from "../feed-emoji";
import { t } from "../i18n/feed";

/** 送るもの・送らないもの（画面と、はじめての案内の両方で出す） */
export function FeedDisclosure() {
  const app = useApp();
  return (
    <div className="feed-disclosure small-text">
      <div>
        <b>{t("sendsTitle")}</b>：{t("sends")}
      </div>
      <div>
        <b>{t("notSendsTitle")}</b>：{t("notSends")}
      </div>
      <div className="muted">{t("keep")}</div>
      <button className="link small-text" onClick={() => openUrl(FEED_GUIDE_URL).catch(app.showError)}>
        {t("privacy")}
      </button>
    </div>
  );
}

export function FeedScreen({ workId }: { workId: number | null }) {
  const app = useApp();
  const feed = useFeed();
  const [sender, setSender] = useState<FeedSender | null>(null);

  useEffect(() => {
    if (workId === null) {
      setSender(null);
      return;
    }
    api.getFeedSender(workId).then(setSender).catch(app.showError);
  }, [workId, app.showError]);

  const prefs = feed.prefs;
  const now = Date.now();
  const save = (patch: Partial<NonNullable<typeof prefs>>) => {
    if (prefs) feed.setPrefs({ ...prefs, ...patch }).catch(app.showError);
  };

  return (
    <div className="feed-screen">
      <section className="card feed-about">
        <h2>{t("aboutTitle")}</h2>
        <p>{t("about1")}</p>
        <p>{t("about2")}</p>
      </section>

      <section className="card feed-settings">
        {prefs && (
          <>
            <label className="row tight">
              <input type="checkbox" checked={prefs.receive} onChange={(e) => save({ receive: e.target.checked })} />
              {t("receive")}
            </label>
            <label className="row tight">
              <input type="checkbox" checked={prefs.send} onChange={(e) => save({ send: e.target.checked, guided: true })} />
              {t("send")}
            </label>
          </>
        )}
        {sender && prefs?.send && <p className="muted small-text">{t("yourEmoji", { who: feedWho(sender.emoji) })}</p>}
        {feed.base === null && <p className="muted small-text">{t("dev")}</p>}
        {feed.base !== null && feed.offline && <p className="muted small-text">{t("offline")}</p>}
        <FeedDisclosure />
      </section>

      {prefs?.receive && (
        <section>
          <h2 className="section-title">{t("recent")}</h2>
          {feed.items.length === 0 ? (
            <p className="muted small-text">{t("empty")}</p>
          ) : (
            <ul className="feed-list card">
              {feed.items.map((i) => (
                <li key={i.seq} className={i.kind === "work" ? "special" : undefined}>
                  <span className="grow">
                    {feedText(i)}
                    {feed.mine.has(i.sender) && <span className="muted"> {t("you")}</span>}
                  </span>
                  <span className="muted small-text">{ago(i.at, now)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
