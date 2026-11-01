// AI に相談する文のダイアログ（仕様書 5.21）。目的と項目を選び、できた文を確認してコピーする
import { useEffect, useMemo, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { api, Span, TagFit, TagGroup } from "../api";
import { useApp } from "../app-context";
import { AI_PURPOSES, AiOptions, aiText, RECENT_DAYS } from "../ai";
import { useForecast } from "../forecast";
import { dailyTotals, dayKey, dayStartMs, getDayStartHour } from "../format";
import { kindKey, unitText } from "../i18n/common";
import { t } from "../i18n/ai";
import { addDays } from "../schedule";
import { Dialog } from "./Dialog";

const OPTIONS_KEY = "otosazu.aiOptions";

function loadOptions(): AiOptions {
  const all: AiOptions = { purpose: "deadline", hideTitle: false, pages: true };
  try {
    const saved = { ...all, ...JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? "{}") };
    return AI_PURPOSES.includes(saved.purpose) ? saved : { ...saved, purpose: all.purpose };
  } catch {
    return all;
  }
}

export function AiDialog({ workId, onClose }: { workId: number; onClose: () => void }) {
  const app = useApp();
  const forecast = useForecast(workId);
  const [extra, setExtra] = useState<{ tags: TagGroup[]; fits: TagFit[]; spans: Span[] } | null>(null);
  const [opts, setOpts] = useState<AiOptions>(loadOptions);
  const [note, setNote] = useState<string | null>(null);
  const today = forecast?.today;
  const from = today ? dayStartMs(addDays(today, 1 - RECENT_DAYS)) : null;

  useEffect(() => {
    if (from === null) return;
    Promise.all([api.listTags(), api.getModelStats(), api.listSpans(from)])
      .then(([tags, stats, spans]) => setExtra({ tags, fits: stats.tags, spans }))
      .catch(app.showError);
  }, [from, app.version, app.showError]);

  const text = useMemo(() => {
    if (!forecast || !extra) return null;
    const totals = dailyTotals(extra.spans, Date.now());
    return aiText(
      {
        forecast,
        tags: extra.tags,
        fits: extra.fits,
        allDailyMs: (d) => totals.get(dayKey(d))?.total ?? 0,
        dayStartHour: getDayStartHour(),
      },
      opts,
    );
  }, [forecast, extra, opts]);

  const update = (next: AiOptions) => {
    setOpts(next);
    setNote(null);
    try {
      localStorage.setItem(OPTIONS_KEY, JSON.stringify(next));
    } catch {
      // 覚えられなくても、その場では切り替わる
    }
  };

  const copy = async () => {
    if (!text) return;
    try {
      await writeText(text);
      setNote(t("copied"));
    } catch {
      setNote(t("copyFailed"));
    }
  };

  const row = forecast?.board.work;
  return (
    <Dialog
      className="ai-dialog"
      title={t("title")}
      onClose={onClose}
      actions={
        <>
          <span className="grow muted small-text">{note ?? (text ? t("length", { n: text.length }) : "")}</span>
          <button className="btn" onClick={onClose}>
            {t("close")}
          </button>
          <button className="btn primary" disabled={!text} onClick={copy}>
            {t("copy")}
          </button>
        </>
      }
    >
      <p className="muted small-text">{t("hint")}</p>
      <div className="row" style={{ gap: 12, flexWrap: "wrap", margin: "8px 0" }}>
        <span className="small-text">{t("purpose")}</span>
        {AI_PURPOSES.map((p) => (
          <label key={p} className="row tight small-text">
            <input type="radio" name="ai-purpose" checked={opts.purpose === p} onChange={() => update({ ...opts, purpose: p })} />
            {t(`p.${p}`)}
          </label>
        ))}
      </div>
      <div className="row" style={{ gap: 16, margin: "4px 0 8px" }}>
        <label className="row tight small-text">
          <input type="checkbox" checked={opts.hideTitle} onChange={() => update({ ...opts, hideTitle: !opts.hideTitle })} />
          {t("hideTitle")}
        </label>
        {row && (
          <label className="row tight small-text">
            <input type="checkbox" checked={opts.pages} onChange={() => update({ ...opts, pages: !opts.pages })} />
            {t(kindKey(row.kind, "withPages"), { unit: unitText(row, 1) })}
          </label>
        )}
      </div>
      {text ? <textarea className="ai-text" readOnly value={text} /> : <p className="muted">{t("loading")}</p>}
    </Dialog>
  );
}
