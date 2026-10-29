// 進捗を共有する画像のダイアログ（仕様書 5.20）。画像を確認して、コピー・保存・X への投稿をする
import { useEffect, useMemo, useRef, useState } from "react";
import { Image } from "@tauri-apps/api/image";
import { writeImage } from "@tauri-apps/plugin-clipboard-manager";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api, SessionRow } from "../api";
import { useApp } from "../app-context";
import { useForecast } from "../forecast";
import { dayKey, dayStartMs } from "../format";
import { t } from "../i18n/share";
import { postText, shareData } from "../share";
import { drawShare, ShareInfo } from "../share-draw";
import { Dialog } from "./Dialog";

type Options = { title: boolean; time: boolean; finish: boolean };
const OPTIONS_KEY = "otosazu.shareOptions";

function loadOptions(): Options {
  const all = { title: true, time: true, finish: true };
  try {
    return { ...all, ...JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? "{}") };
  } catch {
    return all;
  }
}

export function ShareDialog({ workId, onClose }: { workId: number; onClose: () => void }) {
  const app = useApp();
  const forecast = useForecast(workId);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [opts, setOpts] = useState<Options>(loadOptions);
  const [note, setNote] = useState<string | null>(null);
  const today = forecast?.today;
  const dayStart = today ? dayStartMs(today) : null;

  useEffect(() => {
    if (dayStart === null) return;
    api.listSessions(workId, dayStart).then(setSessions).catch(app.showError);
  }, [workId, dayStart, app.version, app.showError]);

  // 画像と投稿の文面に載せる中身（隠した項目は null）
  const content = useMemo(() => {
    if (!forecast || !sessions || dayStart === null) return null;
    const { board, prediction } = forecast;
    const info: ShareInfo = {
      title: opts.title ? board.work.title : null,
      today: forecast.today,
      workedMs: opts.time ? forecast.workedTodayMs : null,
      quotaMs: forecast.quotaMs,
      quotaMet: forecast.quotaMet,
      finish: opts.finish ? forecast.finish.mid : null,
      completed: prediction.remainingMs === 0,
      row: board.work,
    };
    return { data: shareData(board, sessions, dayStart), info };
  }, [forecast, sessions, opts, dayStart]);

  useEffect(() => {
    if (content && canvas.current) drawShare(canvas.current, content.data, content.info);
  }, [content]);

  const toggle = (key: keyof Options) => {
    const next = { ...opts, [key]: !opts[key] };
    setOpts(next);
    try {
      localStorage.setItem(OPTIONS_KEY, JSON.stringify(next));
    } catch {
      // 覚えられなくても、その場では切り替わる
    }
  };

  const png = () =>
    new Promise<Blob>((resolve, reject) =>
      canvas.current?.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob"))), "image/png"),
    );

  // WebView のクリップボード（navigator.clipboard）は画像の書き込みを断られることがあるので、Tauri のプラグインで入れる
  const copy = async () => {
    const c = canvas.current;
    if (!c) return;
    try {
      const pixels = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
      await writeImage(await Image.new(new Uint8Array(pixels.buffer), c.width, c.height));
      setNote(t("copied"));
    } catch {
      setNote(t("copyFailed"));
    }
  };

  const save = async () => {
    if (!today) return;
    const dest = await saveDialog({
      title: t("saveDialog"),
      defaultPath: `otosazu-${dayKey(today)}.png`,
      filters: [{ name: t("filterName"), extensions: ["png"] }],
    });
    if (!dest) return;
    try {
      const bytes = new Uint8Array(await (await png()).arrayBuffer());
      await api.saveImage(dest, Array.from(bytes));
      setNote(t("saved", { path: dest }));
    } catch (e) {
      app.showError(e);
    }
  };

  const post = () => {
    if (!content) return;
    const text = postText(content.data, content.info);
    openUrl(`https://x.com/intent/post?text=${encodeURIComponent(text)}`).catch(app.showError);
  };

  const ready = !!content;
  return (
    <Dialog
      className="share-dialog"
      title={t("title")}
      onClose={onClose}
      actions={
        <>
          <span className="grow muted small-text">{note}</span>
          <button className="btn" onClick={onClose}>
            {t("close")}
          </button>
          <button className="btn" disabled={!ready} onClick={save}>
            {t("save")}
          </button>
          <button className="btn" disabled={!ready} onClick={post}>
            {t("post")}
          </button>
          <button className="btn primary" disabled={!ready} onClick={copy}>
            {t("copy")}
          </button>
        </>
      }
    >
      <div className="share-preview">
        {!ready && <p className="muted">{t("loading")}</p>}
        <canvas ref={canvas} style={{ display: ready ? "block" : "none" }} />
      </div>
      <div className="row" style={{ gap: 16, margin: "10px 0 4px" }}>
        {(["title", "time", "finish"] as const).map((key) => (
          <label key={key} className="row tight small-text">
            <input type="checkbox" checked={opts[key]} onChange={() => toggle(key)} />
            {t(key === "title" ? "showTitle" : key === "time" ? "showTime" : "showFinish")}
          </label>
        ))}
      </div>
    </Dialog>
  );
}
