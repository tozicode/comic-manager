// cmc を移動・名前変更したあとに、作品の cmc の場所を指定し直す流れ
// ファイルを選ぶ → ページのファイル名で照らし合わせる → ほとんど一致しなければ確認する → 付け替えて読み直す
import { ReactNode, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api, RelinkCheck, SyncResult } from "../api";
import { useApp } from "../app-context";
import { Dialog } from "./Dialog";

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
      title: `「${title}」の漫画ファイルを選ぶ`,
      multiple: false,
      directory: false,
      filters: [{ name: "CLIP STUDIO 漫画ファイル", extensions: ["cmc"] }],
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
      label="漫画ファイルの場所を指定し直す"
      title="別の作品のようです"
      onClose={() => setPending(null)}
      actions={
        <>
          <button className="btn" onClick={() => setPending(null)}>
            やめる
          </button>
          <button
            className="btn primary"
            onClick={() => {
              const p = pending;
              setPending(null);
              apply(p.workId, p.path);
            }}
          >
            この漫画ファイルにする
          </button>
        </>
      }
    >
      <p>
        選んだ漫画ファイル（{pending.check.title}・{pending.check.newPages} ページ）は、「{pending.title}」のページと{" "}
        {pending.check.oldPages} ページ中 <b>{pending.check.matched} ページ</b>しか一致しませんでした。
      </p>
      <p className="muted small-text">
        このまま進めると、一致しないページの作業記録は「CLIP STUDIO から消えたページ」として残ります（別のページへ移すこともできます）。
      </p>
    </Dialog>
  );

  return { start, dialog };
}
