import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api, StageSet, WorkKind, WorkSummary, WorkTag } from "../api";
import { useApp } from "../app-context";
import { Dialog } from "../components/Dialog";
import { useRelink } from "../components/Relink";
import { Thumb } from "../components/Thumb";
import { UpcomingDeadline, useForecast, useTimetable } from "../forecast";
import { dayLabel, estimate, hours } from "../format";
import { kindKey, setName, unitText } from "../i18n/common";
import { t as ts } from "../i18n/schedule";
import { t } from "../i18n/works";

type Props = {
  works: WorkSummary[];
  /** 作品を開く。to を "schedule" にするとスケジュール画面で開く */
  onOpen: (workId: number, to?: "board" | "schedule") => void;
  /** 作品の追加で「新しいセットを作る」を選んだ（設定の工程へ飛ぶ） */
  onAddSet: () => void;
};

/**
 * 作品一覧の絞り込み（5.26）。進み具合（未完成 ／ 完成済み）と作品のタグを同じ並びのチップで選び、選んだものすべてに当てはまる作品を出す。
 * 何も選んでいなければ「すべて」。アプリを閉じるまで覚え、起動したときは「未完成」
 */
type Selection = { status: "open" | "done" | null; tags: number[] };
let lastSelection: Selection = { status: "open", tags: [] };

export function WorksScreen({ works, onOpen, onAddSet }: Props) {
  const app = useApp();
  const tt = useTimetable();
  const [selection, setSelectionState] = useState<Selection>(lastSelection);
  /** タグを付け外ししている作品 */
  const [tagging, setTagging] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<WorkSummary | null>(null);
  /** 作品名を変えている作品と、入力中の名前 */
  const [renaming, setRenaming] = useState<{ work: WorkSummary; title: string } | null>(null);
  const relink = useRelink();

  const renameWork = async () => {
    if (!renaming || !renaming.title.trim()) return;
    const { work, title } = renaming;
    setRenaming(null);
    if (title.trim() === work.title) return;
    try {
      await api.renameWork(work.id, title);
      app.refresh();
    } catch (e) {
      app.showError(e);
    }
  };

  const setSelection = (next: Selection) => {
    lastSelection = next;
    setSelectionState(next);
  };
  // 未完成と完成済みは両方当てはまる作品が無いので、片方を選ぶともう片方は外す
  const toggleStatus = (status: "open" | "done") =>
    setSelection({ ...selection, status: selection.status === status ? null : status });
  const toggleTag = (id: number) =>
    setSelection({
      ...selection,
      tags: selection.tags.includes(id) ? selection.tags.filter((x) => x !== id) : [...selection.tags, id],
    });

  // 今あるタグ。誰にも付いていないタグは消えるので、作品に付いているタグを集めれば全部になる
  const allTags = [...new Map(works.flatMap((w) => w.tags).map((tag) => [tag.id, tag])).values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  // 選んでいたタグが消えていたら、そのタグは外して数える
  const tags = selection.tags.filter((id) => allTags.some((tag) => tag.id === id));
  const all = selection.status === null && tags.length === 0;
  const shown = works.filter(
    (w) =>
      (selection.status === null || w.completed === (selection.status === "done")) &&
      tags.every((id) => w.tags.some((tag) => tag.id === id)),
  );
  const shownIds = new Set(shown.map((w) => w.id));

  const removeWork = async (work: WorkSummary) => {
    setRemoving(null);
    try {
      await api.removeWork(work.id);
      app.refresh();
    } catch (e) {
      app.showError(e);
    }
  };

  const card = (w: WorkSummary) => (
    <div key={w.id} className="card work-card" role="button" tabIndex={0} onClick={() => onOpen(w.id)}>
      {/* 代表のサムネイル（最初のページ・ファイル）。ファイルを持たない作品は枠だけ */}
      <div className="work-thumb">
        {w.thumbPath ? <Thumb path={w.thumbPath} free={w.kind === "files"} width={56} /> : <div className="thumb none" />}
      </div>
      <div className="grow">
        <div className="row">
          <h3 className="grow">{w.title}</h3>
          <button
            className="btn small ghost"
            title={t("tagsHint")}
            onClick={(e) => {
              e.stopPropagation();
              setTagging(tagging === w.id ? null : w.id);
            }}
          >
            {t("tags")}
          </button>
          <button
            className="btn small ghost"
            title={t("renameHint")}
            onClick={(e) => {
              e.stopPropagation();
              setRenaming({ work: w, title: w.title });
            }}
          >
            {t("rename")}
          </button>
          <button
            className="btn small ghost"
            title={t("removeHint")}
            onClick={(e) => {
              e.stopPropagation();
              setRemoving(w);
            }}
          >
            {t("remove")}
          </button>
        </div>
        <div className="muted small-text">
          {t(kindKey(w.kind, "meta"), { n: w.pageCount, stages: w.stageCount, unit: unitText(w, w.pageCount) })}
        </div>
        {w.tags.length > 0 && (
          <div className="work-tags">
            {w.tags.map((tag) => (
              <span key={tag.id} className="tag">
                {tag.name}
              </span>
            ))}
          </div>
        )}
        <div className="bar" style={{ marginTop: 10 }}>
          <span style={{ width: `${w.progress * 100}%`, background: "var(--accent)" }} />
        </div>
        <dl className="kv">
          <dt>{t("progress")}</dt>
          <dd className="num">{Math.round(w.progress * 100)}%</dd>
          <dt>{t("workingTime")}</dt>
          <dd className="num">{hours(w.totalMs)}</dd>
          <WorkOutlook workId={w.id} />
          <dt>{t("lastWork")}</dt>
          <dd>{w.lastWorkedAt ? dayLabel(new Date(w.lastWorkedAt)) : t("noneYet")}</dd>
        </dl>
        {w.cmcPath && (
          <div className="path" title={w.cmcPath}>
            {w.cmcPath}
          </div>
        )}
        {w.fileMissing && (
          <div className="file-missing" onClick={(e) => e.stopPropagation()}>
            {w.kind === "files" ? (
              <>
                <span className="grow">{t("missingFiles")}</span>
                <button className="btn small primary" onClick={() => onOpen(w.id)}>
                  {t("openWork")}
                </button>
              </>
            ) : (
              <>
                <span className="grow">{t("missingComic")}</span>
                <button className="btn small primary" onClick={() => relink.start(w.id, w.title)}>
                  {t("relink")}
                </button>
              </>
            )}
          </div>
        )}
      </div>
      {tagging === w.id && <WorkTagPopover work={w} allTags={allTags} onClose={() => setTagging(null)} />}
    </div>
  );

  return (
    <>
      {works.length === 0 && (
        <p className="lead">
          {t("leadIntro")}
          <br />
          {t("leadDetail")}
        </p>
      )}
      {tt && <TimetableWarning tt={tt} onOpen={onOpen} />}
      {tt && works.length > 0 && (
        <UpcomingDeadlines rows={tt.upcoming.filter((r) => shownIds.has(r.workId))} today={tt.today} onOpen={onOpen} />
      )}
      {works.length > 0 && (
        <div className="tag-filter">
          {/* 「すべて」は選んでいるものを全部外す。ほかは押すたびに付け外しし、選んだものすべてに当てはまる作品を出す */}
          <button className={`opt${all ? " on" : ""}`} onClick={() => setSelection({ status: null, tags: [] })}>
            {t("tagAll")}
          </button>
          <button className={`opt${selection.status === "open" ? " on" : ""}`} onClick={() => toggleStatus("open")}>
            {t("statusOpen")}
          </button>
          <button className={`opt${selection.status === "done" ? " on" : ""}`} onClick={() => toggleStatus("done")}>
            {t("statusDone")}
          </button>
          {allTags.map((tag) => (
            <button key={tag.id} className={`opt${tags.includes(tag.id) ? " on" : ""}`} onClick={() => toggleTag(tag.id)}>
              {tag.name}
            </button>
          ))}
        </div>
      )}
      {!all && shown.length === 0 && <p className="muted">{t("filteredEmpty")}</p>}
      <div className="works">
        {shown.map(card)}
        <button className="work-add" onClick={() => setAdding(true)}>
          <span className="plus">＋</span>
          <b>{t("addWork")}</b>
          <span className="small-text">{t("addWorkKinds")}</span>
        </button>
      </div>

      {relink.dialog}
      {renaming && (
        <Dialog
          title={t("renameTitle")}
          onClose={() => setRenaming(null)}
          actions={
            <>
              <button className="btn" onClick={() => setRenaming(null)}>
                {t("cancel")}
              </button>
              <button className="btn primary" disabled={!renaming.title.trim()} onClick={renameWork}>
                {t("renameSave")}
              </button>
            </>
          }
        >
          <input
            className="field"
            autoFocus
            value={renaming.title}
            onChange={(e) => setRenaming({ ...renaming, title: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && renameWork()}
            style={{ width: "100%" }}
          />
        </Dialog>
      )}
      {adding && (
        <AddWorkDialog
          onClose={() => setAdding(false)}
          onAddSet={onAddSet}
          onAdded={(id) => {
            setAdding(false);
            app.refresh();
            onOpen(id);
          }}
        />
      )}
      {removing && (
        <Dialog
          title={t("removeTitle", { title: removing.title })}
          onClose={() => setRemoving(null)}
          actions={
            <>
              <button className="btn" onClick={() => setRemoving(null)}>
                {t("cancel")}
              </button>
              <button className="btn danger" onClick={() => removeWork(removing)}>
                {t("remove")}
              </button>
            </>
          }
        >
          <p>
            {t("removeLog", { time: hours(removing.totalMs) })}
            <br />
            {t("removeStats")}
            {removing.kind !== "manual" && (
              <>
                <br />
                {t(removing.kind === "files" ? "removeKeepFiles" : "removeKeepComic")}
              </>
            )}
          </p>
        </Dialog>
      )}
    </>
  );
}

// 締切の状況ごとの見た目のクラス（ラベルは描画時に status.<キー> を訳す）
const STATUS = {
  ok: "ok",
  tight: "warn",
  late: "late",
} as const;

/** 時間割で締切までに残りを配りきれない作品の 1 行（5.24）。作品名を押すとその作品のスケジュール画面へ */
function TimetableWarning({ tt, onOpen }: { tt: NonNullable<ReturnType<typeof useTimetable>>; onOpen: Props["onOpen"] }) {
  const late = tt.works
    .filter((w) => w.deadline && (tt.shares.get(w.workId)?.shortMs ?? 0) > 0)
    .sort((a, b) => a.deadline!.getTime() - b.deadline!.getTime());
  if (late.length === 0) return null;
  const shortMs = late.reduce((n, w) => n + tt.shares.get(w.workId)!.shortMs, 0);
  return (
    <div className="notice warn">
      <span>
        ⚠{" "}
        {late.map((w, i) => (
          <span key={w.workId}>
            {i > 0 && t("warnSep")}
            <button className="link" style={{ color: "inherit", textDecoration: "underline" }} onClick={() => onOpen(w.workId, "schedule")}>
              {w.title}（{dayLabel(w.deadline!)}）
            </button>
          </span>
        ))}
        {t("warnTail", { time: hours(shortMs) })}
      </span>
    </div>
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** これからの締切（未完成の作品の今日以降の締切を日付の順に。5.26）。行を押すとその作品のスケジュール画面へ。無ければその旨を出す */
function UpcomingDeadlines({ rows, today, onOpen }: { rows: UpcomingDeadline[]; today: Date; onOpen: Props["onOpen"] }) {
  return (
    <section className="upcoming">
      <h3>{t("upcomingTitle")}</h3>
      {rows.length === 0 ? (
        <p className="muted small-text" style={{ margin: 0 }}>
          {t("upcomingNone")}
        </p>
      ) : (
        <table className="rec">
          <thead>
            <tr>
              <th>{t("upcomingDate")}</th>
              <th>{t("upcomingWork")}</th>
              <th>{t("deadline")}</th>
              <th>{t("upcomingStatus")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const days = Math.round((r.date.getTime() - today.getTime()) / DAY_MS);
              return (
                <tr
                  key={r.id}
                  className={r.picked ? "link-row" : "link-row other"}
                  title={r.picked ? undefined : t("upcomingOther")}
                  onClick={() => onOpen(r.workId, "schedule")}
                >
                  <td className="num">
                    {dayLabel(r.date)} <span className="muted">{days === 0 ? ts("today") : ts("daysLeft", { n: days })}</span>
                  </td>
                  <td>{r.title}</td>
                  <td>{r.name || t("deadline")}</td>
                  <td>
                    <span className={`tag status ${STATUS[r.status]}`}>{t(`status.${r.status}`)}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** 作品のタグの付け外し（5.26）。今あるタグを押して付け外しし、新しい名前を入れると作って付ける */
function WorkTagPopover({ work, allTags, onClose }: { work: WorkSummary; allTags: WorkTag[]; onClose: () => void }) {
  const app = useApp();
  const ref = useRef<HTMLDivElement>(null);
  const [name, setName] = useState("");

  useEffect(() => {
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    // 開いたクリック自体で閉じないよう、次のイベントから受け付ける
    const timer = setTimeout(() => {
      window.addEventListener("mousedown", onDown);
      window.addEventListener("keydown", onKey);
    });
    return () => {
      clearTimeout(timer);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const on = (tag: WorkTag) => work.tags.some((x) => x.id === tag.id);
  const toggle = async (tag: WorkTag) => {
    try {
      await api.setWorkTag(work.id, tag.id, !on(tag));
      app.refresh();
    } catch (e) {
      app.showError(e);
    }
  };
  const add = async () => {
    if (!name.trim()) return;
    try {
      await api.addWorkTag(work.id, name);
      setName("");
      app.refresh();
    } catch (e) {
      app.showError(e);
    }
  };

  return (
    // カードを押したことにしない（作品が開かないように）
    <div className="popover work-tag-pop" ref={ref} onClick={(e) => e.stopPropagation()}>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
        <b>{t("tagsTitle", { title: work.title })}</b>
        {allTags.length > 0 && <span className="muted small-text">{t("tagsToggle")}</span>}
      </div>
      {allTags.length > 0 ? (
        <div className="opts" style={{ marginBottom: 10 }}>
          {allTags.map((tag) => (
            <button key={tag.id} className={`opt${on(tag) ? " on" : ""}`} onClick={() => toggle(tag)}>
              {tag.name}
            </button>
          ))}
        </div>
      ) : (
        <p className="muted small-text" style={{ marginTop: 0 }}>
          {t("tagsNone")}
        </p>
      )}
      <div className="row">
        <input
          className="field grow"
          autoFocus
          placeholder={t("tagsNew")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <button className="btn small" disabled={!name.trim()} onClick={add}>
          {t("tagsAdd")}
        </button>
      </div>
    </div>
  );
}

/** 完成見込みと締切の状況（作品カードの中に出す） */
function WorkOutlook({ workId }: { workId: number }) {
  const f = useForecast(workId);
  if (!f) return null;
  if (f.prediction.remainingMs === 0) {
    return (
      <>
        <dt>{t("state")}</dt>
        <dd>{t("completed")}</dd>
      </>
    );
  }
  return (
    <>
      <dt>{t("finish")}</dt>
      <dd>
        {f.finish.mid ? <b>{dayLabel(f.finish.mid)}</b> : "—"}
        {f.finish.low && f.finish.high && (
          <span className="muted">
            {" "}
            {t("finishRange", { low: dayLabel(f.finish.low), high: dayLabel(f.finish.high) })}
          </span>
        )}
      </dd>
      {f.deadline && (
        <>
          <dt>{t("deadline")}</dt>
          <dd>
            {f.deadline.name && `${f.deadline.name} `}
            {dayLabel(f.deadline.date)} <span className={`tag status ${STATUS[f.deadline.status]}`}>{t(`status.${f.deadline.status}`)}</span>
          </dd>
        </>
      )}
      <dt>{t("todayQuota")}</dt>
      <dd className="num">
        {estimate(f.quotaMs)}
        {f.workedTodayMs > 0 && (
          <span className="muted"> {f.quotaMet ? t("todayDone") : t("todayLeft", { time: estimate(f.quotaMs - f.workedTodayMs) })}</span>
        )}
      </dd>
    </>
  );
}

/** 作品を追加するダイアログ：種類と工程のセットを選んでから、ファイルを選ぶ（ファイルを持たない作品は行の名前を入れる） */
function AddWorkDialog({
  onClose,
  onAdded,
  onAddSet,
}: {
  onClose: () => void;
  onAdded: (workId: number) => void;
  onAddSet: () => void;
}) {
  const app = useApp();
  const [kind, setKind] = useState<WorkKind>("comic");
  const [sets, setSets] = useState<StageSet[]>([]);
  const [setId, setSetId] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [rows, setRows] = useState("");
  /** 漫画：見開きを 1 ページずつ（2 行）で管理する */
  const [splitSpreads, setSplitSpreads] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.listStageSets().then(setSets).catch(app.showError);
  }, [app.showError]);

  // 種類を変えたら、その種類の既定のセットを選び直す（自作のセットが無ければ漫画のセット）
  useEffect(() => {
    const first = sets.find((st) => st.kind === kind) ?? sets[0];
    if (first) setSetId(first.id);
  }, [kind, sets]);

  // 選んだセットの単位の言葉（「パーツの名前」のように、行の呼び方を入力欄に出す）
  const chosen = sets.find((st) => st.id === setId);
  const rowUnit = chosen ? unitText(chosen) : "";

  const addManual = async () => {
    if (setId === null) return;
    setBusy(true);
    try {
      onAdded(await api.addManualWork(title, rows.split(/\r?\n/), setId));
    } catch (e) {
      app.showError(e);
    } finally {
      setBusy(false);
    }
  };

  const pick = async () => {
    if (setId === null) return;
    if (kind === "manual") return addManual();
    const picked = await open(
      kind === "comic"
        ? { title: t("pickComicTitle"), multiple: false, directory: false, filters: [{ name: t("comicFilter"), extensions: ["cmc"] }] }
        : {
            title: t("pickFilesTitle"),
            multiple: true,
            directory: false,
            filters: [{ name: t("filesFilter"), extensions: ["clip", "psd", "psb"] }],
          },
    );
    const paths = Array.isArray(picked) ? picked : typeof picked === "string" ? [picked] : [];
    if (paths.length === 0) return;
    setBusy(true);
    try {
      if (kind === "comic") {
        onAdded(await api.addWork(paths[0], setId, splitSpreads));
      } else {
        // 作品名を入れていなければ、最初のファイル名を使う
        const name = title.trim() || (paths[0].split(/[\\/]/).pop() ?? "").replace(/\.[^.]+$/, "");
        onAdded(await api.addFilesWork(name, paths, setId));
      }
    } catch (e) {
      app.showError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={t("addWork")}
      onClose={onClose}
      actions={
        <>
          <button className="btn" onClick={onClose}>
            {t("cancel")}
          </button>
          <button
            className="btn primary"
            onClick={pick}
            disabled={busy || setId === null || (kind === "manual" && (!title.trim() || !rows.trim()))}
          >
            {busy ? t("loading") : kind === "comic" ? t("pickComic") : kind === "files" ? t("pickFiles") : t("addManual")}
          </button>
        </>
      }
    >
      <button className={`choice${kind === "comic" ? " on" : ""}`} onClick={() => setKind("comic")}>
        <span className="radio" />
        <span>
          <b>{t("comic")}</b>
          <br />
          <span className="muted">{t("comicDesc")}</span>
        </span>
      </button>
      <button className={`choice${kind === "files" ? " on" : ""}`} onClick={() => setKind("files")}>
        <span className="radio" />
        <span>
          <b>{t("illustration")}</b>
          <br />
          <span className="muted">{t("filesDesc")}</span>
        </span>
      </button>
      <button className={`choice${kind === "manual" ? " on" : ""}`} onClick={() => setKind("manual")}>
        <span className="radio" />
        <span>
          <b>{t("manual")}</b>
          <br />
          <span className="muted">{t("manualDesc")}</span>
        </span>
      </button>
      <div className="form" style={{ marginTop: 8 }}>
        {kind !== "comic" && (
          <label className="row">
            <span style={{ width: 90 }}>{t("workName")}</span>
            <input
              className="field grow"
              placeholder={t(kind === "files" ? "workNamePlaceholder" : "workNamePlaceholderManual")}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
        )}
        <label className="row">
          <span style={{ width: 90 }}>{t("stages")}</span>
          <select
            className="field grow"
            value={setId ?? ""}
            onChange={(e) => {
              // 欲しい工程のセットが無いときは、設定の工程でセットを作ってから戻ってきてもらう
              if (e.target.value === "new") onAddSet();
              else setSetId(Number(e.target.value));
            }}
          >
            {sets.map((st) => (
              <option key={st.id} value={st.id}>
                {t("stageSet", { name: setName(st) })}
              </option>
            ))}
            <option value="new">{t("stageSetNew")}</option>
          </select>
        </label>
        {kind === "comic" && (
          <label className="row" style={{ alignItems: "flex-start" }}>
            <input type="checkbox" checked={splitSpreads} onChange={(e) => setSplitSpreads(e.target.checked)} style={{ marginTop: 4 }} />
            <span>
              {t("splitSpreads")}
              <br />
              <span className="muted small-text">{t("splitSpreadsDesc")}</span>
            </span>
          </label>
        )}
        {kind === "manual" && (
          <label className="row" style={{ alignItems: "flex-start" }}>
            <span style={{ width: 90, paddingTop: 6 }}>{t("rows", { unit: rowUnit })}</span>
            <textarea
              className="field grow"
              rows={5}
              placeholder={t("rowsPlaceholder", { unit: rowUnit })}
              value={rows}
              onChange={(e) => setRows(e.target.value)}
              style={{ resize: "vertical" }}
            />
          </label>
        )}
      </div>
    </Dialog>
  );
}
