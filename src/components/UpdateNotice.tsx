import { relaunch } from "@tauri-apps/plugin-process";
import { check, Update } from "@tauri-apps/plugin-updater";
import { useEffect, useState } from "react";
import { api } from "../api";
import { useApp } from "../app-context";
import { t } from "../i18n/update";
import { Dialog } from "./Dialog";

/**
 * 起動時に新しい版があれば知らせ、「更新する」でダウンロード → インストール → 再起動する（仕様書 5.13）。
 * つながらないときなどは何も出さない
 */
export function UpdateNotice() {
  const app = useApp();
  const [update, setUpdate] = useState<Update | null>(null);
  // ダウンロードの進み具合（0〜100）。null ならまだ始めていない
  const [progress, setProgress] = useState<number | null>(null);

  useEffect(() => {
    if (import.meta.env.DEV) return;
    let cancelled = false;
    (async () => {
      try {
        if (!(await api.getCheckUpdates())) return;
        const found = await check({ timeout: 15_000 });
        if (!cancelled) setUpdate(found);
      } catch (e) {
        console.warn("更新の確認に失敗しました", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!update) return null;

  const install = async () => {
    let total = 0;
    let got = 0;
    setProgress(0);
    try {
      await update.downloadAndInstall((ev) => {
        if (ev.event === "Started") total = ev.data.contentLength ?? 0;
        if (ev.event === "Progress") {
          got += ev.data.chunkLength;
          if (total > 0) setProgress(Math.min(99, Math.floor((got / total) * 100)));
        }
        if (ev.event === "Finished") setProgress(100);
      });
      // Windows はインストーラーがアプリを閉じるので、ここに来るのは主に Mac
      await relaunch();
    } catch (e) {
      setProgress(null);
      app.showError(t("failed", { error: String(e) }));
    }
  };

  const busy = progress !== null;
  return (
    <Dialog
      label={t("label")}
      title={t("title", { version: update.version, current: update.currentVersion })}
      onClose={() => !busy && setUpdate(null)}
      actions={
        <>
          <button className="btn" disabled={busy} onClick={() => setUpdate(null)}>
            {t("later")}
          </button>
          <button className="btn primary" disabled={busy} autoFocus onClick={install}>
            {busy ? t("downloading", { pct: progress }) : t("install")}
          </button>
        </>
      }
    >
      {update.body && <div className="update-notes">{update.body}</div>}
      <p className="muted small-text">
        {t("note")}
      </p>
    </Dialog>
  );
}
