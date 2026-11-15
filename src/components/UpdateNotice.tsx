import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, Update } from "@tauri-apps/plugin-updater";
import { useEffect, useState } from "react";
import { api } from "../api";
import { useApp } from "../app-context";
import { t } from "../i18n/update";
import { BOOTH_URL } from "../screens/SettingsScreen";
import { clearUpdateAttempt, recordUpdateAttempt, takeFailedUpdate } from "../update-attempt";
import { Dialog } from "./Dialog";

/**
 * 起動時に新しい版があれば知らせ、「更新する」でダウンロード → インストール → 再起動する（仕様書 5.13）。
 * つながらないときなどは何も出さない。
 * 前回「更新する」を押したのに古い版のまま起動したら、先にそのことと手で入れ直す方法を知らせる
 */
export function UpdateNotice() {
  const app = useApp();
  const [update, setUpdate] = useState<Update | null>(null);
  // ダウンロードの進み具合（0〜100）。null ならまだ始めていない
  const [progress, setProgress] = useState<number | null>(null);
  // 前回入れようとして入らなかった版と、今の版
  const [failed, setFailed] = useState<{ to: string; current: string } | null>(null);

  useEffect(() => {
    if (import.meta.env.DEV) return;
    let cancelled = false;
    (async () => {
      try {
        const current = await getVersion();
        const to = takeFailedUpdate(current);
        if (to && !cancelled) setFailed({ to, current });
      } catch (e) {
        console.warn("前回の更新の確認に失敗しました", e);
      }
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

  if (failed) {
    return (
      <Dialog
        label={t("label")}
        title={t("failedTitle", { version: failed.to })}
        onClose={() => setFailed(null)}
        actions={
          <>
            <button className="btn" onClick={() => setFailed(null)}>
              {t("close")}
            </button>
            <button className="btn primary" autoFocus onClick={() => openUrl(BOOTH_URL).catch(app.showError)}>
              {t("openBooth")}
            </button>
          </>
        }
      >
        <p>{t("failedBody", { version: failed.to, current: failed.current })}</p>
      </Dialog>
    );
  }

  if (!update) return null;

  const install = async () => {
    let total = 0;
    let got = 0;
    setProgress(0);
    // Windows はインストーラーを起こすとすぐアプリが終わり、入らなくても気づけないので、押したことを控えておく
    recordUpdateAttempt(update.currentVersion, update.version);
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
      clearUpdateAttempt();
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
