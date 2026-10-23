import { DragEvent, useEffect, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { api, BoardPage, PageMerge, PageSplit, StageRef, TagGroup, UNIT } from "../api";
import { useApp } from "../app-context";
import type { Screen } from "../App";
import { Dialog } from "../components/Dialog";
import { useRelink } from "../components/Relink";
import { TagPopover } from "../components/TagPopover";
import { Thumb } from "../components/Thumb";
import { Forecast, loadChosenPlan, useForecast } from "../forecast";
import { clock, dayLabel, estimate, hours, time } from "../format";

/** 同期で見つかった見開きの変化（1 件ずつ確認する） */
type SpreadChange = { kind: "merge"; m: PageMerge } | { kind: "split"; s: PageSplit };

type Filter = "all" | "open";

/** イラストとして登録できるファイル */
const ILLUST_FILTER = [{ name: "イラスト（.clip / .psd）", extensions: ["clip", "psd", "psb"] }];

const HOUR = 3_600_000;

/** セルの状態。locked = 前の工程が終わっていない */
type CellState = "done" | "running" | "doing" | "todo" | "locked";

export function BoardScreen({ workId, onNavigate }: { workId: number; onNavigate: (s: Screen) => void }) {
  const app = useApp();
  const forecast = useForecast(workId);
  const [tags, setTags] = useState<TagGroup[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [syncNote, setSyncNote] = useState<string | null>(null);
  /** cmc を読み直せなかった（移動・名前の変更など） */
  const [syncFailed, setSyncFailed] = useState(false);
  const [undo, setUndo] = useState<{ page: BoardPage; stage: StageRef } | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  /** タグを編集しているページ（"bulk" ならチェックしたページをまとめて） */
  const [tagging, setTagging] = useState<number | "bulk" | null>(null);
  const [changes, setChanges] = useState<SpreadChange[]>([]);
  const [splitHalf, setSplitHalf] = useState(true);
  /** 消えたページの記録の移動先 */
  const [moveTo, setMoveTo] = useState<Record<number, number>>({});
  /** イラストの作品で外そうとしているファイル */
  const [removing, setRemoving] = useState<BoardPage | null>(null);
  /** イラストのファイルのドラッグ中の並び（離したら保存する） */
  const [dragOrder, setDragOrder] = useState<number[] | null>(null);
  const dragging = useRef<number | null>(null);

  // 作品を開いたときに cmc を読み直す
  useEffect(() => {
    sync(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workId]);

  useEffect(() => {
    api.listTags().then(setTags).catch(app.showError);
  }, [app.version, app.showError]);

  const forecastRef = useRef(forecast);
  forecastRef.current = forecast;

  // 同期は同時に 1 つだけ（開発時の StrictMode で effect が 2 回走っても、見開きの検知を取りこぼさない）
  const syncing = useRef(false);
  const sync = async (manual: boolean) => {
    if (syncing.current) return;
    syncing.current = true;
    try {
      const r = await api.syncWork(workId);
      // 作品を開いた直後はまだ予測を読み込んでいないので、種類は作品の情報から確かめる
      const files = (forecastRef.current?.board ?? (await api.getBoard(workId))).work.kind === "files";
      const parts = [];
      if (r.added > 0) parts.push(`${r.added} ページ増えました`);
      if (r.missing > 0)
        parts.push(
          files
            ? `${r.missing} 個のファイルが見つかりません。行の「場所を指定」から指定し直すと、記録をそのまま引き継げます`
            : `${r.missing} ページが CLIP STUDIO から消えています`,
        );
      setSyncNote(parts.length ? parts.join("・") : manual ? "変更はありませんでした" : null);
      const found = [
        ...r.merges.map((m): SpreadChange => ({ kind: "merge", m })),
        ...r.splits.map((s): SpreadChange => ({ kind: "split", s })),
      ];
      // 見開きの変化は同期の前後を比べて一度だけ見つかるので、確認待ちのものを空で上書きしない
      if (found.length > 0) {
        setChanges((prev) => [...prev, ...found]);
        setSplitHalf(true);
      }
      setSyncFailed(false);
      app.refresh();
    } catch (e) {
      setSyncNote(`${e}。前回読み込んだページ一覧を表示しています。`);
      setSyncFailed(true);
    } finally {
      syncing.current = false;
    }
  };

  // 場所を指定し直したら、読み直したときと同じように結果を知らせる
  const relink = useRelink((r) => {
    const found = [
      ...r.merges.map((m): SpreadChange => ({ kind: "merge", m })),
      ...r.splits.map((s): SpreadChange => ({ kind: "split", s })),
    ];
    if (found.length > 0) setChanges((prev) => [...prev, ...found]);
    setSyncFailed(false);
    setSyncNote(
      ["漫画ファイルの場所を指定し直しました", r.added > 0 && `${r.added} ページ増えました`, r.missing > 0 && `${r.missing} ページが見つかりません`]
        .filter(Boolean)
        .join("・"),
    );
  });

  const run = async (f: () => Promise<unknown>) => {
    try {
      await f();
      app.refresh();
    } catch (e) {
      app.showError(e);
    }
  };

  if (!forecast) return <p className="muted">読み込み中…</p>;
  const { board } = forecast;
  const startRelink = () => relink.start(workId, board.work.title);
  const isFiles = board.work.kind === "files";
  const unit = UNIT[board.work.kind];
  // 付け外しの画面には、この作品の種類で使うタググループだけを出す
  const usableTags = tags.filter((g) => g.applies === "both" || g.applies === board.work.kind);

  const addFiles = async () => {
    const picked = await openDialog({ title: "ファイルを追加", multiple: true, directory: false, filters: ILLUST_FILTER });
    const paths = Array.isArray(picked) ? picked : typeof picked === "string" ? [picked] : [];
    if (paths.length === 0) return;
    try {
      const n = await api.addFiles(workId, paths);
      setSyncNote(n > 0 ? `${n} 個のファイルを追加しました` : "選んだファイルはすでに登録されています");
      app.refresh();
    } catch (e) {
      app.showError(e);
    }
  };

  const relinkFile = async (page: BoardPage) => {
    const picked = await openDialog({ title: `「${page.label}」のファイルを選ぶ`, multiple: false, directory: false, filters: ILLUST_FILTER });
    if (typeof picked !== "string") return;
    await run(() => api.relinkFile(page.id, picked));
  };

  // ファイルのドラッグでの並べ替え（イラストのみ）
  const rowOrder = dragOrder ?? board.pages.map((p) => p.id);
  const onRowDragOver = (e: DragEvent, overId: number) => {
    const id = dragging.current;
    if (id === null || id === overId) return;
    e.preventDefault();
    const next = [...rowOrder];
    next.splice(next.indexOf(overId), 0, next.splice(next.indexOf(id), 1)[0]);
    setDragOrder(next);
  };
  const onRowDragEnd = () => {
    const order = dragOrder;
    dragging.current = null;
    setDragOrder(null);
    if (order && order.some((id, i) => id !== board.pages[i]?.id)) run(() => api.setFileOrder(workId, order));
  };

  const pages = board.pages.filter((p) => !p.missing);
  const missing = board.pages.filter((p) => p.missing);
  const pageCount = pages.reduce((n, p) => n + p.span, 0);
  const allTags = tags.flatMap((g) => g.tags);
  const tagName = (id: number) => allTags.find((t) => t.id === id);

  const cellState = (page: BoardPage, i: number): CellState => {
    const cell = page.cells[i];
    if (cell.done) return "done";
    if (app.active?.pageId === page.id && app.active.stageId === cell.stageId) return "running";
    if (i > 0 && !page.cells[i - 1].done) return "locked";
    return cell.totalMs > 0 ? "doing" : "todo";
  };

  const ordered = isFiles ? rowOrder.map((id) => pages.find((p) => p.id === id)!).filter(Boolean) : pages;
  const shown = filter === "open" ? ordered.filter((p) => p.cells.some((c) => !c.done)) : ordered;
  const allChecked = shown.length > 0 && shown.every((p) => selected.includes(p.id));

  // まとめて付けるときは、選んだ全ページに付いているタグを「付いている」とみなす
  const taggingPages = tagging === "bulk" ? selected : tagging ? [tagging] : [];
  const activeTags = allTags
    .map((t) => t.id)
    .filter((id) => taggingPages.length > 0 && taggingPages.every((pid) => board.pages.find((p) => p.id === pid)?.tags.includes(id)));
  const toggleTag = (tagId: number, on: boolean) => run(() => api.setPageTag(taggingPages, tagId, on));

  return (
    <>
      <div className="board-head">
        <div className="muted small-text">
          {board.work.lastSyncedAt && <>最終同期 {time(board.work.lastSyncedAt)} · </>}
          {isFiles ? `${pageCount} 枚のファイル` : `cmc から ${pageCount} ページ`}
        </div>
        <div className="row tight">
          {isFiles ? (
            <button className="btn small ghost" onClick={addFiles}>
              ＋ ファイルを追加
            </button>
          ) : (
            <button className="btn small ghost" onClick={startRelink} title="cmc を移動したり名前を変えたりしたとき">
              📁 場所を変更
            </button>
          )}
          <button className="btn small ghost" onClick={() => sync(true)}>
            {isFiles ? "⟳ 読み直す" : "⟳ cmc を読み直す"}
          </button>
        </div>
      </div>
      {syncNote && (
        <div className={`notice ${syncFailed ? "warn" : "info"}`}>
          <span className="grow">
            {syncNote}
            {syncFailed && " 漫画ファイルを移動したり名前を変えたりした場合は、場所を指定し直すと記録をそのまま引き継げます。"}
          </span>
          {syncFailed && (
            <button className="btn small primary" onClick={startRelink}>
              場所を指定し直す
            </button>
          )}
          <button className="btn small ghost" onClick={() => setSyncNote(null)}>
            閉じる
          </button>
        </div>
      )}

      <div className="summary three">
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
        <FinishCard forecast={forecast} />
        <DeadlineCard forecast={forecast} onSet={() => onNavigate("schedule")} />
      </div>

      <TodayStrip forecast={forecast} onChoose={() => onNavigate("schedule")} />

      <div className="toolbar">
        <span className="seg">
          <button className={filter === "all" ? "on" : ""} onClick={() => setFilter("all")}>
            すべて
          </button>
          <button className={filter === "open" ? "on" : ""} onClick={() => setFilter("open")}>
            未完了だけ
          </button>
        </span>
        <div style={{ position: "relative" }}>
          <button className="btn small" disabled={selected.length === 0} onClick={() => setTagging("bulk")}>
            {selected.length > 0
              ? `選んだ ${selected.length} ${unit.count}にタグを付ける`
              : `${unit.row}を選ぶとまとめてタグを付けられます`}
          </button>
          {tagging === "bulk" && (
            <TagPopover
              title={`${selected.length} ${unit.count}のタグ`}
              groups={usableTags}
              active={activeTags}
              onToggle={toggleTag}
              onClose={() => setTagging(null)}
            />
          )}
        </div>
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
            <th style={{ width: 28 }}>
              <input
                type="checkbox"
                title="すべて選ぶ"
                checked={allChecked}
                onChange={() => setSelected(allChecked ? [] : shown.map((p) => p.id))}
              />
            </th>
            <th>{unit.row}</th>
            {board.stages.map((s) => (
              <th key={s.id} style={{ width: board.stages.length >= 4 ? 140 : 180 }}>
                <span className="sdot" style={{ background: s.color }} />
                {s.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((page) => (
            <tr
              key={page.id}
              className={`${selected.includes(page.id) ? "selected" : ""}${dragOrder && dragging.current === page.id ? " dragging" : ""}`}
              onDragOver={isFiles ? (e) => onRowDragOver(e, page.id) : undefined}
              onDrop={(e) => e.preventDefault()}
            >
              <td>
                <input
                  type="checkbox"
                  checked={selected.includes(page.id)}
                  onChange={() =>
                    setSelected((s) => (s.includes(page.id) ? s.filter((x) => x !== page.id) : [...s, page.id]))
                  }
                />
              </td>
              <td style={{ position: "relative" }}>
                <div className="pcell">
                  {isFiles && (
                    <span
                      className="handle"
                      draggable
                      title="ドラッグで並べ替え"
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = "move";
                        dragging.current = page.id;
                      }}
                      onDragEnd={onRowDragEnd}
                    >
                      ⋮⋮
                    </span>
                  )}
                  <Thumb path={page.path} spread={page.span === 2} free={isFiles} />
                  <div className={isFiles ? "pinfo" : "pinfo inline"}>
                    <span className={`pno${isFiles ? " name" : ""}`} title={isFiles ? page.path : undefined}>
                      {page.label}
                    </span>
                    {!page.found &&
                      (isFiles ? (
                        <button className="lost" title="このファイルが見つかりません" onClick={() => relinkFile(page)}>
                          ⚠ 場所を指定
                        </button>
                      ) : (
                        <span className="lost">⚠ 見つかりません</span>
                      ))}
                    <div className="tags">
                      {page.tags.map((id) => {
                        const t = tagName(id);
                        return (
                          t && (
                            <span key={id} className={`tag${t.system ? " sys" : ""}`}>
                              {t.name}
                            </span>
                          )
                        );
                      })}
                      <button className="tag add" title="タグを付ける" onClick={() => setTagging(page.id)}>
                        ＋
                      </button>
                    </div>
                  </div>
                  {isFiles && (
                    <button className="mini remove" title="このファイルを作品から外す" onClick={() => setRemoving(page)}>
                      ×
                    </button>
                  )}
                </div>
                {tagging === page.id && (
                  <TagPopover
                    title={`${page.label} のタグ`}
                    groups={usableTags}
                    active={page.tags}
                    onToggle={toggleTag}
                    onClose={() => setTagging(null)}
                  />
                )}
              </td>
              {board.stages.map((stage, i) => (
                <td key={stage.id}>
                  <BoardCell
                    state={cellState(page, i)}
                    stage={stage}
                    totalMs={page.cells[i].totalMs}
                    predictedMs={forecast.task(page.id, stage.id)?.predictedMs ?? 0}
                    runningMs={app.active ? app.now - app.active.startedAt : 0}
                    onStart={() => app.start(page.id, stage.id)}
                    onPause={app.pause}
                    onDone={() => run(() => api.setTaskDone(page.id, stage.id, true))}
                    onUndo={() => setUndo({ page, stage })}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {shown.length === 0 && <p className="muted center">表示するページがありません</p>}
      <div style={{ height: 160 }} />

      {missing.length > 0 && (
        <>
          <div className="section-title">CLIP STUDIO から消えたページ（作業記録は残しています）</div>
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
                  <td>
                    <div className="row tight">
                      <select
                        className="field"
                        value={moveTo[page.id] ?? ""}
                        onChange={(e) => setMoveTo({ ...moveTo, [page.id]: Number(e.target.value) })}
                      >
                        <option value="">移す先のページ…</option>
                        {pages.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                      <button
                        className="btn small"
                        disabled={!moveTo[page.id]}
                        onClick={() => run(() => api.mergePages(page.id, moveTo[page.id]))}
                      >
                        記録を移す
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {changes[0]?.kind === "merge" && (
        <Dialog
          label="cmc を読み直したら見開きになっていました"
          title={`${changes[0].m.toLabel} が見開きになりました`}
          onClose={() => setChanges(changes.slice(1))}
          actions={
            <>
              <button className="btn" onClick={() => setChanges(changes.slice(1))}>
                あとで決める
              </button>
              <button
                className="btn primary"
                autoFocus
                onClick={() => {
                  const m = (changes[0] as { m: PageMerge }).m;
                  setChanges(changes.slice(1));
                  run(() => api.mergePages(m.fromPageId, m.toPageId));
                }}
              >
                まとめる
              </button>
            </>
          }
        >
          <p>
            消えたページ（{changes[0].m.fromFileName}）の作業記録 <b>{hours(changes[0].m.ms)}</b> とタグを、見開きページ（
            {changes[0].m.toLabel}）にまとめますか？
          </p>
          <p className="muted small-text">「あとで決める」を選ぶと、ボードの下の「CLIP STUDIO から消えたページ」に残ります。</p>
        </Dialog>
      )}
      {changes[0]?.kind === "split" && (
        <Dialog
          label="cmc を読み直したら見開きが解除されていました"
          title={`見開きが ${changes[0].s.label} と ${changes[0].s.newLabel} に分かれました`}
          onClose={() => setChanges(changes.slice(1))}
          actions={
            <button
              className="btn primary"
              autoFocus
              onClick={() => {
                const s = (changes[0] as { s: PageSplit }).s;
                setChanges(changes.slice(1));
                run(() => api.splitPage(s.pageId, s.newPageId, splitHalf));
              }}
            >
              決定
            </button>
          }
        >
          <p>
            見開きのときの作業記録 <b>{hours(changes[0].s.ms)}</b> をどう扱いますか？（完了とタグは両方のページに付けます）
          </p>
          <button className={`choice${splitHalf ? " on" : ""}`} onClick={() => setSplitHalf(true)}>
            <span className="radio" />
            <span>
              <b>半分ずつ分ける</b>（{changes[0].s.label} に {hours(changes[0].s.ms / 2)}、{changes[0].s.newLabel} に{" "}
              {hours(changes[0].s.ms / 2)}）
            </span>
          </button>
          <button className={`choice${splitHalf ? "" : " on"}`} onClick={() => setSplitHalf(false)}>
            <span className="radio" />
            <span>
              <b>元のページ（{changes[0].s.label}）に残す</b>
            </span>
          </button>
        </Dialog>
      )}

      {relink.dialog}
      {removing && (
        <Dialog
          title={`「${removing.label}」を作品から外しますか？`}
          onClose={() => setRemoving(null)}
          actions={
            <>
              <button className="btn" onClick={() => setRemoving(null)}>
                やめる
              </button>
              <button
                className="btn danger"
                onClick={() => {
                  const page = removing;
                  setRemoving(null);
                  run(() => api.removeFile(page.id));
                }}
              >
                外す
              </button>
            </>
          }
        >
          <p>
            このファイルの作業記録（{hours(removing.cells.reduce((n, c) => n + c.totalMs, 0))}）も Otosazu から消えます。
            <br />
            ファイルそのものは消えません。
          </p>
        </Dialog>
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
                  run(() => api.setTaskDone(undo.page.id, undo.stage.id, false));
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

function FinishCard({ forecast }: { forecast: Forecast }) {
  const { finish, prediction, schedule } = forecast;
  if (prediction.remainingMs === 0) {
    return (
      <div className="card">
        <div className="section-title">完成見込み</div>
        <div className="big">完成しました 🎉</div>
      </div>
    );
  }
  const week = schedule.weekdayHours;
  const weekday = week.slice(0, 5).every((h) => h === week[0]) ? `平日${hours(week[0] * HOUR)}` : "平日";
  const weekend = week[5] === week[6] ? `土日${hours(week[5] * HOUR)}` : "土日";
  return (
    <div className="card">
      <div className="section-title">完成見込み</div>
      {finish.mid ? (
        <>
          <div className="big">{dayLabel(finish.mid)}</div>
          <div className="range">
            早ければ {finish.low ? dayLabel(finish.low) : "—"} ・ 遅ければ {finish.high ? dayLabel(finish.high) : "—"}
          </div>
          <div className="range">
            残り約 {estimate(prediction.remainingMs)}（{weekday}・{weekend}で計算）
          </div>
        </>
      ) : (
        <>
          <div className="big">—</div>
          <div className="range">作業する時間が設定されていません（スケジュールで設定できます）</div>
        </>
      )}
    </div>
  );
}

const STATUS = {
  ok: { label: "余裕あり", cls: "ok" },
  tight: { label: "ギリギリ", cls: "warn" },
  late: { label: "遅れぎみ", cls: "late" },
};

function DeadlineCard({ forecast, onSet }: { forecast: Forecast; onSet: () => void }) {
  const d = forecast.deadline;
  if (!d) {
    return (
      <div className="card">
        <div className="section-title">締切</div>
        <p className="range" style={{ margin: "0 0 10px" }}>
          締切を決めると、今日やる量と進め方の案を出します
        </p>
        <button className="btn small" onClick={onSet}>
          締切を決める
        </button>
      </div>
    );
  }
  const s = STATUS[d.status];
  return (
    <div className="card">
      <div className="section-title">締切 {dayLabel(d.date)}</div>
      <div className="big">{d.plan.days > 0 ? `あと ${d.plan.days} 日` : "締切を過ぎています"}</div>
      <div className="range">
        <span className={`tag status ${s.cls}`}>{s.label}</span> 間に合う見込み {Math.round(d.probability * 100)}%
      </div>
    </div>
  );
}

function TodayStrip({ forecast, onChoose }: { forecast: Forecast; onChoose: () => void }) {
  const app = useApp();
  const plan = loadChosenPlan(forecast.board.work.id);
  if (!plan) {
    if (forecast.prediction.remainingMs === 0) return null;
    return (
      <div className="today-strip empty">
        <span className="grow muted">
          今日のノルマは <b className="num">{estimate(forecast.quotaMs)}</b>
          {forecast.deadline ? "（締切から逆算）" : "（今日の作業時間）"}。進め方の案から、今日やることを選べます
        </span>
        <button className="btn small primary" onClick={onChoose}>
          今日の進め方を選ぶ
        </button>
      </div>
    );
  }
  const worked = forecast.workedTodayMs;
  const pct = plan.quotaMs > 0 ? Math.min(100, (worked / plan.quotaMs) * 100) : 100;
  const { board } = forecast;
  return (
    <div className="today-strip">
      <div>
        <div className="small-text muted">今日のやること</div>
        <b>{plan.name}</b>
      </div>
      <div className="gauge">
        <div className="row small-text" style={{ justifyContent: "space-between" }}>
          <span className="num">
            <b>{hours(worked)}</b> / {estimate(plan.quotaMs)}
          </span>
          <span className="muted num">{Math.round(pct)}%</span>
        </div>
        <div className="bar">
          <span style={{ width: `${pct}%`, background: "var(--accent)" }} />
        </div>
      </div>
      <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
        {plan.steps.map((step) => {
          const page = board.pages.find((p) => p.id === step.pageId);
          const si = board.stages.findIndex((s) => s.id === step.stageId);
          const stage = board.stages[si];
          if (!page || !stage) return null;
          const done = page.cells[si]?.done;
          const running = app.active?.pageId === page.id && app.active.stageId === stage.id;
          return (
            <button
              key={`${step.pageId}-${step.stageId}`}
              className={`task-chip${done ? " done" : ""}${running ? " now" : ""}`}
              disabled={done || running}
              title={done ? "完了しています" : "クリックで計測を始める"}
              onClick={() => app.start(page.id, stage.id)}
            >
              <span className="sdot" style={{ background: stage.color }}>
                {stage.name.slice(0, 1)}
              </span>
              {page.label} {stage.name}
              {running ? " · 計測中" : done ? "" : ` ${estimate(step.ms)}${step.partial ? "（途中まで）" : ""}`}
            </button>
          );
        })}
      </div>
      <span className="grow" />
      <button className="btn small" onClick={onChoose}>
        案を選び直す
      </button>
    </div>
  );
}

type CellProps = {
  state: CellState;
  stage: StageRef;
  totalMs: number;
  predictedMs: number;
  runningMs: number;
  onStart: () => void;
  onPause: () => void;
  onDone: () => void;
  onUndo: () => void;
};

function BoardCell({ state, stage, totalMs, predictedMs, runningMs, onStart, onPause, onDone, onUndo }: CellProps) {
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
  const pct = predictedMs > 0 ? Math.min(100, (totalMs / predictedMs) * 100) : 0;
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
        <div className="line muted">
          <span className="num">予測 {estimate(predictedMs)}</span>
        </div>
        <div className="bar">
          <span style={{ width: `${pct}%`, background: stage.color }} />
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
      {state === "doing" ? (
        <>
          <div className="line">
            <span>途中</span>
            <span className="num">
              <b>{hours(totalMs)}</b>
            </span>
          </div>
          <div className="line muted">
            <span className="num">予測 {estimate(predictedMs)}</span>
          </div>
          <div className="bar">
            <span style={{ width: `${pct}%`, background: stage.color }} />
          </div>
        </>
      ) : (
        <>
          <div className="line">
            <span>未着手</span>
          </div>
          <div className="line">
            <span className="num">予測 {estimate(predictedMs)}</span>
          </div>
        </>
      )}
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
