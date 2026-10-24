// cmc を移動・名前変更したあとに、作品の cmc の場所を指定し直す流れ
// ファイルを選ぶ → ページのファイル名で照らし合わせる → ほとんど一致しなければ確認する → 付け替えて読み直す
import { ReactNode, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api, RelinkCheck, SyncResult } from "../api";
import { useApp } from "../app-context";
import { Dialog } from "./Dialog";
import { t, tn } from "../i18n/relink";

/** これより一致が少なければ「別の作品のようです」と確認する */
const MATCH_RATIO = 0.5;

type Pending = { workId: number; title: string; path: string; check: RelinkCheck };

export function useRelink(onDone?: (result: SyncResult) => void): { start: (workId: number, title: string) => void; dialog: ReactNode } {
  const app = useApp();
  const [pending, setPending] = useState<Pending | null>(null);

  const apply = async (workId: number, path: string) => {
    try {
      const result = await api.relinkWork(workId, path);
      app.refresh();
      onDone?.(result);
    } catch (e) {
      app.showError(e);
    }
  };

  const start = async (workId: number, title: string) => {
    const selected = await open({
      title: t("chooseFile", { title }),
      multiple: false,
      directory: false,
      filters: [{ name: t("filterName"), extensions: ["cmc"] }],
    });
    if (typeof selected !== "string") return;
    try {
      const check = await api.checkRelink(workId, selected);
      const ratio = check.oldPages > 0 ? check.matched / check.oldPages : 1;
      if (ratio < MATCH_RATIO) setPending({ workId, title, path: selected, check });
      else await apply(workId, selected);
    } catch (e) {
      app.showError(e);
    }
  };

  const dialog = pending && (
    <Dialog
      label={t("label")}
      title={t("title")}
      onClose={() => setPending(null)}
      actions={
        <>
          <button className="btn" onClick={() => setPending(null)}>
            {t("cancel")}
          </button>
          <button
            className="btn primary"
            onClick={() => {
              const p = pending;
              setPending(null);
              apply(p.workId, p.path);
            }}
          >
            {t("confirm")}
          </button>
        </>
      }
    >
      <p>
        {tn("body", {
          file: pending.check.title,
          newPages: pending.check.newPages,
          work: pending.title,
          oldPages: pending.check.oldPages,
          matched: <b>{t("matchedPages", { n: pending.check.matched })}</b>,
        })}
      </p>
      <p className="muted small-text">
        {t("note")}
      </p>
    </Dialog>
  );

  return { start, dialog };
}
