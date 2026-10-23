import { useEffect, useState } from "react";
import { api, Board, BoardPage, StageRef } from "../api";
import { useApp } from "../app-context";
import { Dialog } from "../components/Dialog";
import { Thumb } from "../components/Thumb";
import { clock, hours, time } from "../format";

type Filter = "all" | "open";

/** セルの状態。locked = 前の工程が終わっていない */
type CellState = "done" | "running" | "doing" | "todo" | "locked";

export function BoardScreen({ workId }: { workId: number }) {
  const app = useApp();
  const [board, setBoard] = useState<Board | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ page: BoardPage; stage: StageRef } | null>(null);

  // 作品を開いたときに cmc を読み直す
  useEffect(() => {
    sync(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workId]);

  useEffect(() => {
    api.getBoard(workId).then(setBoard).catch(app.showError);
  }, [workId, app.version, app.showError]);

  const sync = async (manual: boolean) => {
    try {
      const r = await api.syncWork(workId);
      const parts = [];
      if (r.added > 0) parts.push(`${r.added} ページ増えました`);
      if (r.missing > 0) parts.push(`${r.missing} ページが CLIP STUDIO から消えています`);
      setSyncNote(parts.length ? parts.join("・") : manual ? "変更はありませんでした" : null);
      app.refresh();
    } catch (e) {
      setSyncNote(`cmc を読み直せませんでした（${e}）。前回読み込んだページ一覧を表示しています`);
    }
  };

  const setDone = async (page: BoardPage, stage: StageRef, done: boolean) => {
    try {
      await api.setTaskDone(page.id, stage.id, done);
      app.refresh();
    } catch (e) {
      app.showError(e);
    }
  };

  if (!board) return <p className="muted">読み込み中…</p>;

  const pages = board.pages.filter((p) => !p.missing);
  const missing = board.pages.filter((p) => p.missing);
  const pageCount = pages.reduce((n, p) => n + p.span, 0);
  const totalMs = board.pages.reduce((n, p) => n + p.cells.reduce((m, c) => m + c.totalMs, 0), 0);

  const cellState = (page: BoardPage, i: number): CellState => {
    const cell = page.cells[i];
    if (cell.done) return "done";
    if (app.active?.pageId === page.id && app.active.stageId === cell.stageId) return "running";
    if (i > 0 && !page.cells[i - 1].done) return "locked";
    return cell.totalMs > 0 ? "doing" : "todo";
  };

  const shown = filter === "open" ? pages.filter((p) => p.cells.some((c) => !c.done)) : pages;

  return (
    <>
      <div className="board-head">
        <div className="muted small-text">
          {board.work.lastSyncedAt && <>最終同期 {time(board.work.lastSyncedAt)} · </>}
          cmc から {pageCount} ページ
        </div>
        <button className="btn small ghost" onClick={() => sync(true)}>
          ⟳ cmc を読み直す
        </button>
      </div>
      {syncNote && (
        <div className="notice info">
          <span className="grow">{syncNote}</span>
          <button className="btn small ghost" onClick={() => setSyncNote(null)}>
            閉じる
          </button>
        </div>
      )}

      <div className="summary">
        <div className="card">
          <div className="section-title">工程ごとの進み具合</div>
          {board.stages.map((s, i) => {
            const done = pages.reduce((n, p) => n + (p.cells[i].done ? p.span : 0), 0);
            return (
              <div key={s.id} className="stage-prog">
                <span>{s.name}</span>
                <div className="bar">
                  <span style={{ width: `${pageCount ? (done / pageCount) * 100 : 0}%`, background: s.color }} />
                </div>
                <span className="num muted">
                  {done}/{pageCount}
                </span>
              </div>
            );
          })}
        </div>
        <div className="card">
          <div className="section-title">これまでの作業時間</div>
          <div className="big num">{hours(totalMs)}</div>
          <div className="range">完成見込みは、次のバージョンで表示します</div>
        </div>
      </div>

      <div className="toolbar">
        <span className="seg">
          <button className={filter === "all" ? "on" : ""} onClick={() => setFilter("all")}>
            すべて
          </button>
          <button className={filter === "open" ? "on" : ""} onClick={() => setFilter("open")}>
            未完了だけ
          </button>
        </span>
        <div className="legend">
          <span>
            <i style={{ border: "1px dashed var(--faint)" }} />
            未着手
          </span>
          <span>
            <i style={{ background: "#ece7e0" }} />
            作業中
          </span>
          <span>
            <i style={{ background: "var(--accent)" }} />
            完了
          </span>
          <span>
            <i style={{ border: "1px dashed #e4ddd5" }} />
            前の工程待ち
          </span>
        </div>
      </div>

      <table className="board">
        <thead>
          <tr>
            <th>ページ</th>
            {board.stages.map((s) => (
              <th key={s.id} style={{ width: 190 }}>
                <span className="sdot" style={{ background: s.color }} />
                {s.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((page) => (
            <tr key={page.id}>
              <td>
                <div className="pcell">
                  <Thumb cmcPath={board.work.cmcPath} fileName={page.fileName} spread={page.span === 2} />
                  <span className="pno">{page.label}</span>
                  {page.span === 2 && <span className="tag sys">見開き</span>}
                </div>
              </td>
              {board.stages.map((stage, i) => (
                <td key={stage.id}>
                  <BoardCell
                    state={cellState(page, i)}
                    stage={stage}
                    totalMs={page.cells[i].totalMs}
                    runningMs={app.active ? app.now - app.active.startedAt : 0}
                    onStart={() => app.start(page.id, stage.id)}
                    onPause={app.pause}
                    onDone={() => setDone(page, stage, true)}
                    onUndo={() => setUndo({ page, stage })}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {shown.length === 0 && <p className="muted center">表示するページがありません</p>}

      {missing.length > 0 && (
        <>
          <div className="section-title" style={{ marginTop: 24 }}>
            CLIP STUDIO から消えたページ（作業記録は残しています）
          </div>
          <table className="board missing">
            <tbody>
              {missing.map((page) => (
                <tr key={page.id}>
                  <td>
                    <div className="pcell">
                      <span className="pno">{page.fileName}</span>
                    </div>
                  </td>
                  {board.stages.map((stage, i) => (
                    <td key={stage.id} className="muted small-text">
                      {stage.name} {hours(page.cells[i].totalMs)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {undo && (
        <Dialog
          title={`${undo.page.label} の${undo.stage.name}を未完了に戻しますか？`}
          onClose={() => setUndo(null)}
          actions={
            <>
              <button className="btn" onClick={() => setUndo(null)}>
                やめる
              </button>
              <button
                className="btn primary"
                onClick={() => {
                  setDone(undo.page, undo.stage, false);
                  setUndo(null);
                }}
              >
                未完了に戻す
              </button>
            </>
          }
        />
      )}
    </>
  );
}

type CellProps = {
  state: CellState;
  stage: StageRef;
  totalMs: number;
  runningMs: number;
  onStart: () => void;
  onPause: () => void;
  onDone: () => void;
  onUndo: () => void;
};

function BoardCell({ state, stage, totalMs, runningMs, onStart, onPause, onDone, onUndo }: CellProps) {
  if (state === "locked") return <div className="cell locked">前の工程待ち</div>;
  if (state === "done") {
    return (
      <div className="cell done" style={{ background: stage.color }}>
        <div className="line">
          <span>✓ 完了</span>
          <span className="num">{hours(totalMs)}</span>
        </div>
        <div className="cell-actions">
          <button className="mini light" title="未完了に戻す" onClick={onUndo}>
            ↺
          </button>
        </div>
      </div>
    );
  }
  if (state === "running") {
    return (
      <div className="cell running">
        <div className="line">
          <span className="num">
            <b>{clock(runningMs)}</b>
          </span>
          <span>計測中</span>
        </div>
        <div className="line muted">
          <span className="num">合計 {hours(totalMs)}</span>
        </div>
        <div className="cell-actions show">
          <button className="mini dark" title="一時停止" onClick={onPause}>
            ❚❚
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className={`cell ${state}`} onClick={onStart} title="クリックで計測を始める">
      <div className="line">
        <span>{state === "doing" ? "途中" : "未着手"}</span>
        <span className="num">{state === "doing" ? hours(totalMs) : ""}</span>
      </div>
      <div className="cell-actions">
        <button
          className="mini"
          title="完了にする"
          onClick={(e) => {
            e.stopPropagation();
            onDone();
          }}
        >
          ✓
        </button>
        <button className="mini accent" title="計測を始める">
          ▶
        </button>
      </div>
    </div>
  );
}
