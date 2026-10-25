import { DragEvent, useEffect, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { api, BoardPage, PageMerge, PageSplit, StageRef, TagGroup } from "../api";
import { useApp } from "../app-context";
import type { Screen } from "../App";
import { Dialog } from "../components/Dialog";
import { useRelink } from "../components/Relink";
import { TagPopover } from "../components/TagPopover";
import { Thumb } from "../components/Thumb";
import { Forecast, loadChosenPlan, useForecast } from "../forecast";
import { planName } from "../schedule";
import { clock, dayLabel, estimate, hours, time } from "../format";
import { t, tn } from "../i18n/board";
import { kindKey, unitText } from "../i18n/common";

/** 同期で見つかった見開きの変化（1 件ずつ確認する） */
type SpreadChange = { kind: "merge"; m: PageMerge } | { kind: "split"; s: PageSplit };

type Filter = "all" | "open";

/** イラストとして登録できるファイル */
const illustFilter = () => [{ name: t("illustFilter"), extensions: ["clip", "psd", "psb"] }];

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
  /** イラストの作品で外そうとしているファイル（ファイルを持たない作品では行） */
  const [removing, setRemoving] = useState<BoardPage | null>(null);
  /** ファイルを持たない作品：行を足す入力（null なら閉じている）、名前を変えている行 */
  const [addingRows, setAddingRows] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ page: BoardPage; title: string } | null>(null);
  /** イラストのファイル（または行）のドラッグ中の並び（離したら保存する） */
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
      if (r.added > 0) parts.push(t("syncAdded", { n: r.added }));
      if (r.missing > 0)
        parts.push(
          files
            ? t("syncMissingFiles", { n: r.missing })
            : t("syncMissingPages", { n: r.missing }),
        );
      setSyncNote(parts.length ? parts.join(t("sep")) : manual ? t("noChanges") : null);
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
      setSyncNote(t("syncError", { error: String(e) }));
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
      [t("relinked"), r.added > 0 && t("syncAdded", { n: r.added }), r.missing > 0 && t("relinkMissing", { n: r.missing })]
        .filter(Boolean)
        .join(t("sep")),
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

  if (!forecast) return <p className="muted">{t("loading")}</p>;
  const { board } = forecast;
  const startRelink = () => relink.start(workId, board.work.title);
  const kind = board.work.kind;
  const isFiles = kind === "files";
  const isManual = kind === "manual";
  /** 行を利用者が並べ替え・外せる作品（イラスト、ファイルを持たない作品） */
  const hasRows = isFiles || isManual;
  const unit = unitText(board.work);
  // 付け外しの画面には、この作品の工程セットで使うタググループだけを出す
  const usableTags = tags.filter((g) => g.setIds.length === 0 || g.setIds.includes(board.work.setId));

  const addRows = async () => {
    const names = (addingRows ?? "").split(/\r?\n/);
    setAddingRows(null);
    try {
      const n = await api.addRows(workId, names);
      setSyncNote(t("rowsAdded", { n, unit: unitText(board.work, n) }));
      app.refresh();
    } catch (e) {
      app.showError(e);
    }
  };

  const addFiles = async () => {
    const picked = await openDialog({ title: t("addFilesTitle"), multiple: true, directory: false, filters: illustFilter() });
    const paths = Array.isArray(picked) ? picked : typeof picked === "string" ? [picked] : [];
    if (paths.length === 0) return;
    try {
      const n = await api.addFiles(workId, paths);
      setSyncNote(n > 0 ? t("filesAdded", { n }) : t("alreadyAdded"));
      app.refresh();
    } catch (e) {
      app.showError(e);
    }
  };

  const relinkFile = async (page: BoardPage) => {
    const picked = await openDialog({ title: t("chooseFileFor", { label: page.label }), multiple: false, directory: false, filters: illustFilter() });
    if (typeof picked !== "string") return;
    await run(() => api.relinkFile(page.id, picked));
  };

  // ファイル（行）のドラッグでの並べ替え（イラストとファイルを持たない作品）
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

  const ordered = hasRows ? rowOrder.map((id) => pages.find((p) => p.id === id)!).filter(Boolean) : pages;
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
          {board.work.lastSyncedAt && t("lastSynced", { time: time(board.work.lastSyncedAt) })}
          {isFiles
            ? t("fileCount", { n: pageCount })
            : isManual
              ? t("unitCount", { n: pageCount, unit: unitText(board.work, pageCount) })
              : t("cmcPageCount", { n: pageCount })}
        </div>
        <div className="row tight">
          {isFiles ? (
            <button className="btn small ghost" onClick={addFiles}>
              {t("addFiles")}
            </button>
          ) : isManual ? (
            <button className="btn small ghost" onClick={() => setAddingRows("")}>
              {t("addRows", { unit })}
            </button>
          ) : (
            <button className="btn small ghost" onClick={startRelink} title={t("changeLocationHint")}>
              {t("changeLocation")}
            </button>
          )}
          {!isManual && (
            <button className="btn small ghost" onClick={() => sync(true)}>
              {isFiles ? t("reload") : t("reloadCmc")}
            </button>
          )}
        </div>
      </div>
      {syncNote && (
        <div className={`notice ${syncFailed ? "warn" : "info"}`}>
          <span className="grow">
            {syncNote}
            {syncFailed && t("syncFailedHint")}
          </span>
          {syncFailed && (
            <button className="btn small primary" onClick={startRelink}>
              {t("relinkButton")}
            </button>
          )}
          <button className="btn small ghost" onClick={() => setSyncNote(null)}>
            {t("close")}
          </button>
        </div>
      )}

      <div className="summary three">
        <div className="card">
          <div className="section-title">{t("stageProgress")}</div>
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
            {t("filterAll")}
          </button>
          <button className={filter === "open" ? "on" : ""} onClick={() => setFilter("open")}>
            {t("filterOpen")}
          </button>
        </span>
        <div style={{ position: "relative" }}>
          <button className="btn small" disabled={selected.length === 0} onClick={() => setTagging("bulk")}>
            {selected.length > 0
              ? t(kindKey(kind, "bulkTag"), { n: selected.length, unit: unitText(board.work, selected.length) })
              : t(kindKey(kind, "bulkHint"), { unit })}
          </button>
          {tagging === "bulk" && (
            <TagPopover
              title={t(kindKey(kind, "bulkTitle"), { n: selected.length, unit: unitText(board.work, selected.length) })}
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
            {t("notStarted")}
          </span>
          <span>
            <i style={{ background: "var(--track)" }} />
            {t("inProgress")}
          </span>
          <span>
            <i style={{ background: "var(--accent)" }} />
            {t("done")}
          </span>
          <span>
            <i style={{ border: "1px dashed var(--locked-border)" }} />
            {t("waiting")}
          </span>
        </div>
      </div>

      <table className="board">
        <thead>
          <tr>
            <th style={{ width: 28 }}>
              <input
                type="checkbox"
                title={t("selectAll")}
                checked={allChecked}
                onChange={() => setSelected(allChecked ? [] : shown.map((p) => p.id))}
              />
            </th>
            <th>{t(kindKey(kind, "row"), { unit: unitText(board.work, 1) })}</th>
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
              onDragOver={hasRows ? (e) => onRowDragOver(e, page.id) : undefined}
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
                  {hasRows && (
                    <span
                      className="handle"
                      draggable
                      title={t("dragToReorder")}
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = "move";
                        dragging.current = page.id;
                      }}
                      onDragEnd={onRowDragEnd}
                    >
                      ⋮⋮
                    </span>
                  )}
                  {!isManual && <Thumb path={page.path} spread={page.span === 2} free={isFiles} />}
                  <div className={hasRows ? "pinfo" : "pinfo inline"}>
                    {isManual ? (
                      <button
                        className="pno name rename"
                        title={t("renameHint")}
                        onClick={() => setRenaming({ page, title: page.label })}
                      >
                        {page.label}
                      </button>
                    ) : (
                      <span className={`pno${isFiles ? " name" : ""}`} title={isFiles ? page.path : undefined}>
                        {page.label}
                      </span>
                    )}
                    {!page.found &&
                      (isFiles ? (
                        <button className="lost" title={t("fileNotFound")} onClick={() => relinkFile(page)}>
                          {t("setLocation")}
                        </button>
                      ) : (
                        <span className="lost">{t("notFound")}</span>
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
                      <button className="tag add" title={t("addTag")} onClick={() => setTagging(page.id)}>
                        ＋
                      </button>
                    </div>
                  </div>
                  {hasRows && (
                    <button
                      className="mini remove"
                      title={isManual ? t("removeRowHint", { unit: unitText(board.work, 1) }) : t("removeFileHint")}
                      onClick={() => setRemoving(page)}
                    >
                      ×
                    </button>
                  )}
                </div>
                {tagging === page.id && (
                  <TagPopover
                    title={t("pageTags", { label: page.label })}
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
      {shown.length === 0 && <p className="muted center">{t("noPages")}</p>}
      <div style={{ height: 160 }} />

      {missing.length > 0 && (
        <>
          <div className="section-title">{t("missingTitle")}</div>
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
                        <option value="">{t("moveToPlaceholder")}</option>
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
                        {t("moveRecords")}
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
          label={t("mergeLabel")}
          title={t("mergeTitle", { label: changes[0].m.toLabel })}
          onClose={() => setChanges(changes.slice(1))}
          actions={
            <>
              <button className="btn" onClick={() => setChanges(changes.slice(1))}>
                {t("later")}
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
                {t("merge")}
              </button>
            </>
          }
        >
          <p>
            {tn("mergeBody", {
              file: changes[0].m.fromFileName,
              time: <b>{hours(changes[0].m.ms)}</b>,
              label: changes[0].m.toLabel,
            })}
          </p>
          <p className="muted small-text">{t("mergeNote")}</p>
        </Dialog>
      )}
      {changes[0]?.kind === "split" && (
        <Dialog
          label={t("splitLabel")}
          title={t("splitTitle", { a: changes[0].s.label, b: changes[0].s.newLabel })}
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
              {t("decide")}
            </button>
          }
        >
          <p>
            {tn("splitBody", { time: <b>{hours(changes[0].s.ms)}</b> })}
          </p>
          <button className={`choice${splitHalf ? " on" : ""}`} onClick={() => setSplitHalf(true)}>
            <span className="radio" />
            <span>
              <b>{t("splitHalf")}</b>
              {t("splitHalfDetail", { a: changes[0].s.label, b: changes[0].s.newLabel, half: hours(changes[0].s.ms / 2) })}
            </span>
          </button>
          <button className={`choice${splitHalf ? "" : " on"}`} onClick={() => setSplitHalf(false)}>
            <span className="radio" />
            <span>
              <b>{t("splitKeep", { a: changes[0].s.label })}</b>
            </span>
          </button>
        </Dialog>
      )}

      {relink.dialog}
      {removing && (
        <Dialog
          title={t("removeTitle", { label: removing.label })}
          onClose={() => setRemoving(null)}
          actions={
            <>
              <button className="btn" onClick={() => setRemoving(null)}>
                {t("cancel")}
              </button>
              <button
                className="btn danger"
                onClick={() => {
                  const page = removing;
                  setRemoving(null);
                  run(() => api.removeFile(page.id));
                }}
              >
                {t("remove")}
              </button>
            </>
          }
        >
          <p>
            {t(isManual ? "removeRowBody" : "removeBody", {
              time: hours(removing.cells.reduce((n, c) => n + c.totalMs, 0)),
              unit: unitText(board.work, 1),
            })}
            {!isManual && (
              <>
                <br />
                {t("removeBodyNote")}
              </>
            )}
          </p>
        </Dialog>
      )}
      {addingRows !== null && (
        <Dialog
          title={t("addRowsTitle", { unit })}
          onClose={() => setAddingRows(null)}
          actions={
            <>
              <button className="btn" onClick={() => setAddingRows(null)}>
                {t("cancel")}
              </button>
              <button className="btn primary" disabled={!addingRows.trim()} onClick={addRows}>
                {t("add")}
              </button>
            </>
          }
        >
          <textarea
            className="field"
            rows={5}
            autoFocus
            placeholder={t("addRowsPlaceholder")}
            value={addingRows}
            onChange={(e) => setAddingRows(e.target.value)}
            style={{ width: "100%", resize: "vertical" }}
          />
        </Dialog>
      )}
      {renaming && (
        <Dialog
          title={t("renameTitle", { label: renaming.page.label })}
          onClose={() => setRenaming(null)}
          actions={
            <>
              <button className="btn" onClick={() => setRenaming(null)}>
                {t("cancel")}
              </button>
              <button
                className="btn primary"
                disabled={!renaming.title.trim()}
                onClick={() => {
                  const { page, title } = renaming;
                  setRenaming(null);
                  if (title.trim() !== page.label) run(() => api.renameRow(page.id, title));
                }}
              >
                {t("rename")}
              </button>
            </>
          }
        >
          <input
            className="field"
            autoFocus
            value={renaming.title}
            onChange={(e) => setRenaming({ ...renaming, title: e.target.value })}
            onKeyDown={(e) => {
              if (e.key !== "Enter" || !renaming.title.trim()) return;
              const { page, title } = renaming;
              setRenaming(null);
              if (title.trim() !== page.label) run(() => api.renameRow(page.id, title));
            }}
            style={{ width: "100%" }}
          />
        </Dialog>
      )}
      {undo && (
        <Dialog
          title={t("undoTitle", { page: undo.page.label, stage: undo.stage.name })}
          onClose={() => setUndo(null)}
          actions={
            <>
              <button className="btn" onClick={() => setUndo(null)}>
                {t("cancel")}
              </button>
              <button
                className="btn primary"
                onClick={() => {
                  run(() => api.setTaskDone(undo.page.id, undo.stage.id, false));
                  setUndo(null);
                }}
              >
                {t("undoDone")}
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
        <div className="section-title">{t("finishTitle")}</div>
        <div className="big">{t("finished")}</div>
      </div>
    );
  }
  const week = schedule.weekdayHours;
  const weekday = week.slice(0, 5).every((h) => h === week[0]) ? t("weekdayHours", { h: hours(week[0] * HOUR) }) : t("weekdays");
  const weekend =
    week[5] === week[6]
      ? t("weekendHours", { h: hours(week[5] * HOUR) })
      : t("satSun", { sat: hours(week[5] * HOUR), sun: hours(week[6] * HOUR) });
  return (
    <div className="card">
      <div className="section-title">{t("finishTitle")}</div>
      {finish.mid ? (
        <>
          <div className="big">{dayLabel(finish.mid)}</div>
          <div className="range">
            {t("finishRange", { low: finish.low ? dayLabel(finish.low) : "—", high: finish.high ? dayLabel(finish.high) : "—" })}
          </div>
          <div className="range">
            {t("remaining", { time: estimate(prediction.remainingMs), weekday, weekend })}
          </div>
        </>
      ) : (
        <>
          <div className="big">—</div>
          <div className="range">{t("noWorkHours")}</div>
        </>
      )}
    </div>
  );
}

const STATUS = {
  ok: { label: "status.ok", cls: "ok" },
  tight: { label: "status.tight", cls: "warn" },
  late: { label: "status.late", cls: "late" },
} as const;

function DeadlineCard({ forecast, onSet }: { forecast: Forecast; onSet: () => void }) {
  const d = forecast.deadline;
  if (!d) {
    return (
      <div className="card">
        <div className="section-title">{t("deadline")}</div>
        <p className="range" style={{ margin: "0 0 10px" }}>
          {t("deadlineHint")}
        </p>
        <button className="btn small" onClick={onSet}>
          {t("setDeadline")}
        </button>
      </div>
    );
  }
  const s = STATUS[d.status];
  return (
    <div className="card">
      <div className="section-title">{t("deadlineOn", { date: dayLabel(d.date) })}</div>
      <div className="big">{d.plan.days > 0 ? t("daysLeft", { n: d.plan.days }) : t("overdue")}</div>
      <div className="range">
        <span className={`tag status ${s.cls}`}>{t(s.label)}</span> {t("onTimeChance", { p: Math.round(d.probability * 100) })}
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
          {tn("quotaIntro", {
            time: <b className="num">{estimate(forecast.quotaMs)}</b>,
            basis: forecast.deadline ? t("quotaFromDeadline") : t("quotaFromHours"),
          })}
        </span>
        <button className="btn small primary" onClick={onChoose}>
          {t("choosePlan")}
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
        <div className="small-text muted">{t("todayTodo")}</div>
        <b>{planName(plan, board.stages)}</b>
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
              title={done ? t("chipDone") : t("clickToStart")}
              onClick={() => app.start(page.id, stage.id)}
            >
              <span className="sdot" style={{ background: stage.color }}>
                {stage.name.slice(0, 1)}
              </span>
              {page.label} {stage.name}
              {running ? t("chipTracking") : done ? "" : ` ${estimate(step.ms)}${step.partial ? t("partial") : ""}`}
            </button>
          );
        })}
      </div>
      <span className="grow" />
      <button className="btn small" onClick={onChoose}>
        {t("rechoose")}
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
  if (state === "done") {
    return (
      <div className="cell done" style={{ background: stage.color }}>
        <div className="line">
          <span>{t("cellDone")}</span>
          <span className="num">{hours(totalMs)}</span>
        </div>
        <div className="cell-actions">
          <button className="mini light" title={t("undoDone")} onClick={onUndo}>
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
          <span>{t("tracking")}</span>
        </div>
        <div className="line muted">
          <span className="num">{t("total", { time: hours(totalMs) })}</span>
        </div>
        <div className="line muted">
          <span className="num">{t("predicted", { time: estimate(predictedMs) })}</span>
        </div>
        <div className="bar">
          <span style={{ width: `${pct}%`, background: stage.color }} />
        </div>
        <div className="cell-actions show">
          <button className="mini dark" title={t("pause")} onClick={onPause}>
            ❚❚
          </button>
        </div>
      </div>
    );
  }
  // 前の工程待ち（locked）でも計測はできる（工程順に進めないこともあるため）。完了にするのは前の工程が終わってから
  return (
    <div className={`cell ${state}${state === "locked" && totalMs > 0 ? " doing" : ""}`} onClick={onStart} title={t("clickToStart")}>
      {totalMs > 0 ? (
        <>
          <div className="line">
            <span>{t("cellPartial")}</span>
            <span className="num">
              <b>{hours(totalMs)}</b>
            </span>
          </div>
          <div className="line muted">
            <span className="num">{t("predicted", { time: estimate(predictedMs) })}</span>
          </div>
          <div className="bar">
            <span style={{ width: `${pct}%`, background: stage.color }} />
          </div>
        </>
      ) : (
        <>
          <div className="line">
            <span>{t(state === "locked" ? "waiting" : "notStarted")}</span>
          </div>
          <div className="line">
            <span className="num">{t("predicted", { time: estimate(predictedMs) })}</span>
          </div>
        </>
      )}
      <div className="cell-actions">
        {state !== "locked" && (
          <button
            className="mini"
            title={t("markDone")}
            onClick={(e) => {
              e.stopPropagation();
              onDone();
            }}
          >
            ✓
          </button>
        )}
        <button className="mini accent" title={t("startTracking")}>
          ▶
        </button>
      </div>
    </div>
  );
}
