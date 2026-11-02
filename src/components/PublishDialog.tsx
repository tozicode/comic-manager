// 進捗の公開（仕様書 5.22）の設定ダイアログ。作品ごとに、公開のオン／オフ・隠す項目・閲覧 URL を扱う
import { useCallback, useEffect, useState } from "react";
import { api, HideKey, PublishPrefs } from "../api";
import { useApp } from "../app-context";
import { dayLabel, time } from "../format";
import { t } from "../i18n/publish";
import { publishWork, shareUrl, unpublishWork } from "../publish";
import { Dialog } from "./Dialog";
import { Qr } from "./Qr";

/** チェックの並び。チェックが付いている＝出す（hide に入っていない） */
const OPTIONS: { key: HideKey; label: "showTitle" | "showTime" | "showFinish" | "showCells" }[] = [
  { key: "title", label: "showTitle" },
  { key: "time", label: "showTime" },
  { key: "finish", label: "showFinish" },
  { key: "cells", label: "showCells" },
];

export function PublishDialog({ workId, onClose }: { workId: number; onClose: () => void }) {
  const app = useApp();
  const [prefs, setPrefs] = useState<PublishPrefs | null>(null);
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const reload = useCallback(() => api.getPublishPrefs(workId).then(setPrefs).catch(app.showError), [workId, app.showError]);
  useEffect(() => {
    reload();
  }, [reload]);

  /** 設定を保存したあと、その場で送る（または消す）。結果は Rust 側に記録されるので読み直して出す */
  const apply = async (enabled: boolean, hide: HideKey[]) => {
    setSending(true);
    setNote(null);
    try {
      const saved = await api.setPublishPrefs(workId, enabled, hide);
      setPrefs(saved);
      if (saved.enabled) await publishWork(saved);
      else if (saved.pendingDelete) await unpublishWork(saved);
      await reload();
    } catch (e) {
      app.showError(e);
    } finally {
      setSending(false);
    }
  };

  const sendNow = async () => {
    if (!prefs) return;
    setSending(true);
    setNote(null);
    try {
      await publishWork(prefs);
      await reload();
    } finally {
      setSending(false);
    }
  };

  const renew = async () => {
    setSending(true);
    setNote(null);
    try {
      const saved = await api.newPublishReadKey(workId);
      setPrefs(saved);
      if (saved.enabled) await publishWork(saved);
      await reload();
    } catch (e) {
      app.showError(e);
    } finally {
      setSending(false);
    }
  };

  const copy = async () => {
    if (!prefs) return;
    try {
      await navigator.clipboard.writeText(shareUrl(prefs));
      setNote(t("copied"));
    } catch (e) {
      app.showError(e);
    }
  };

  const url = prefs ? shareUrl(prefs) : "";
  const status = !prefs
    ? ""
    : sending
      ? t("sending")
      : prefs.lastError
        ? t("failed", { error: prefs.lastError })
        : prefs.lastSentAt
          ? t("sent", { time: `${dayLabel(new Date(prefs.lastSentAt))} ${time(prefs.lastSentAt)}` })
          : t("neverSent");

  return (
    <Dialog
      className="publish-dialog"
      title={t("title")}
      onClose={onClose}
      actions={
        <>
          <span className="grow muted small-text">{note}</span>
          <button className="btn" onClick={onClose}>
            {t("close")}
          </button>
        </>
      }
    >
      <p className="muted small-text">{t("intro")}</p>
      {prefs && (
        <>
          <label className="row tight">
            <input
              type="checkbox"
              checked={prefs.enabled}
              disabled={sending}
              onChange={(e) => apply(e.target.checked, prefs.hide)}
            />
            <b>{t("enable")}</b>
          </label>
          <div className="row" style={{ gap: 16, flexWrap: "wrap", margin: "6px 0 10px 24px" }}>
            {OPTIONS.map((o) => (
              <label key={o.key} className="row tight small-text">
                <input
                  type="checkbox"
                  checked={!prefs.hide.includes(o.key)}
                  disabled={sending}
                  onChange={(e) =>
                    apply(prefs.enabled, e.target.checked ? prefs.hide.filter((h) => h !== o.key) : [...prefs.hide, o.key])
                  }
                />
                {t(o.label)}
              </label>
            ))}
          </div>
          {prefs.enabled ? (
            <>
              <div className="row">
                <span className="grow">
                  {t("url")}
                  <br />
                  <span className="muted small-text path-text">{url}</span>
                </span>
                <button className="btn small" onClick={copy}>
                  {t("copy")}
                </button>
              </div>
              <div className="row remote-qr">
                <Qr text={url} label={t("qrLabel")} />
                <span className="muted small-text">{t("offHint")}</span>
              </div>
              <p className={prefs.lastError ? "error small-text" : "muted small-text"}>{status}</p>
              <div className="row" style={{ gap: 8 }}>
                <button className="btn small" disabled={sending} onClick={sendNow}>
                  {t("sendNow")}
                </button>
                <button className="btn small" disabled={sending} onClick={renew} title={t("newUrlHint")}>
                  {t("newUrl")}
                </button>
                <span className="muted small-text">{t("newUrlHint")}</span>
              </div>
            </>
          ) : (
            <p className="muted small-text">{t("offHint")}</p>
          )}
        </>
      )}
    </Dialog>
  );
}
