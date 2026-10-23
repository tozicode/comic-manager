import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api, WorkSummary } from "../api";
import { useApp } from "../app-context";
import { Dialog } from "../components/Dialog";
import { useRelink } from "../components/Relink";
import { useForecast } from "../forecast";
import { dayLabel, hours } from "../format";

type Props = { works: WorkSummary[]; onOpen: (workId: number) => void };

export function WorksScreen({ works, onOpen }: Props) {
  const app = useApp();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<WorkSummary | null>(null);
  const relink = useRelink();

  const addWork = async () => {
    const selected = await open({
      title: "漫画ファイルを選ぶ",
      multiple: false,
      directory: false,
      filters: [{ name: "CLIP STUDIO 漫画ファイル", extensions: ["cmc"] }],
    });
    if (typeof selected !== "string") return;
    setAdding(true);
    try {
      const id = await api.addWork(selected);
      app.refresh();
      onOpen(id);
    } catch (e) {
      app.showError(e);
    } finally {
      setAdding(false);
    }
  };

  const removeWork = async (work: WorkSummary) => {
    setRemoving(null);
    try {
      await api.removeWork(work.id);
      app.refresh();
    } catch (e) {
      app.showError(e);
    }
  };

  return (
    <>
      {works.length === 0 && (
        <p className="lead">
          はじめに、CLIP STUDIO PAINT で作った漫画ファイル（.cmc）を登録しましょう。
          <br />
          ページの一覧を読み込んで、ページ × 工程ごとに作業時間を記録できるようになります。
        </p>
      )}
      <div className="works">
        {works.map((w) => (
          <div key={w.id} className="card work-card" role="button" tabIndex={0} onClick={() => onOpen(w.id)}>
            <div className="grow">
              <div className="row">
                <h3 className="grow">{w.title}</h3>
                <button
                  className="btn small ghost"
                  title="この作品を Otosazu から外す"
                  onClick={(e) => {
                    e.stopPropagation();
                    setRemoving(w);
                  }}
                >
                  外す
                </button>
              </div>
              <div className="muted small-text">
                {w.pageCount}ページ · {w.stageCount}工程
              </div>
              <div className="bar" style={{ marginTop: 10 }}>
                <span style={{ width: `${w.progress * 100}%`, background: "var(--accent)" }} />
              </div>
              <dl className="kv">
                <dt>進捗</dt>
                <dd className="num">{Math.round(w.progress * 100)}%</dd>
                <dt>作業時間</dt>
                <dd className="num">{hours(w.totalMs)}</dd>
                <WorkOutlook workId={w.id} />
                <dt>最後の作業</dt>
                <dd>{w.lastWorkedAt ? dayLabel(new Date(w.lastWorkedAt)) : "まだありません"}</dd>
              </dl>
              <div className="path" title={w.cmcPath}>
                {w.cmcPath}
              </div>
              {w.fileMissing && (
                <div className="file-missing" onClick={(e) => e.stopPropagation()}>
                  <span className="grow">⚠ この場所に漫画ファイルが見つかりません</span>
                  <button className="btn small primary" onClick={() => relink.start(w.id, w.title)}>
                    場所を指定し直す
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
        <button className="work-add" onClick={addWork} disabled={adding}>
          <span className="plus">＋</span>
          <b>{adding ? "読み込み中…" : "作品を追加"}</b>
          <span className="small-text">CLIP STUDIO の漫画ファイル（.cmc）を選ぶ</span>
        </button>
      </div>

      {relink.dialog}
      {removing && (
        <Dialog
          title={`「${removing.title}」を外しますか？`}
          onClose={() => setRemoving(null)}
          actions={
            <>
              <button className="btn" onClick={() => setRemoving(null)}>
                やめる
              </button>
              <button className="btn danger" onClick={() => removeWork(removing)}>
                外す
              </button>
            </>
          }
        >
          <p>
            この作品の作業記録（{hours(removing.totalMs)}）も Otosazu から消えます。
            <br />
            CLIP STUDIO の漫画ファイルそのものは消えません。
          </p>
        </Dialog>
      )}
    </>
  );
}

const STATUS = {
  ok: { label: "余裕あり", cls: "ok" },
  tight: { label: "ギリギリ", cls: "warn" },
  late: { label: "遅れぎみ", cls: "late" },
};

/** 完成見込みと締切の状況（作品カードの中に出す） */
function WorkOutlook({ workId }: { workId: number }) {
  const f = useForecast(workId);
  if (!f) return null;
  if (f.prediction.remainingMs === 0) {
    return (
      <>
        <dt>状態</dt>
        <dd>完成済み（実績は次の作品の予測に使われます）</dd>
      </>
    );
  }
  return (
    <>
      <dt>完成見込み</dt>
      <dd>
        {f.finish.mid ? <b>{dayLabel(f.finish.mid)}</b> : "—"}
        {f.finish.low && f.finish.high && (
          <span className="muted">
            {" "}
            （{dayLabel(f.finish.low)}〜{dayLabel(f.finish.high)}）
          </span>
        )}
      </dd>
      {f.deadline && (
        <>
          <dt>締切</dt>
          <dd>
            {dayLabel(f.deadline.date)} <span className={`tag status ${STATUS[f.deadline.status].cls}`}>{STATUS[f.deadline.status].label}</span>
          </dd>
        </>
      )}
    </>
  );
}
