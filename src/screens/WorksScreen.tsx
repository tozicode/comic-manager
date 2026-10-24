import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api, StageSet, WorkKind, WorkSummary } from "../api";
import { useApp } from "../app-context";
import { Dialog } from "../components/Dialog";
import { useRelink } from "../components/Relink";
import { useForecast } from "../forecast";
import { dayLabel, hours } from "../format";
import { kindKey, setName, unitText } from "../i18n/common";
import { t } from "../i18n/works";

type Props = {
  works: WorkSummary[];
  onOpen: (workId: number) => void;
  /** 作品の追加で「新しいセットを作る」を選んだ（設定の工程へ飛ぶ） */
  onAddSet: () => void;
};

export function WorksScreen({ works, onOpen, onAddSet }: Props) {
  const app = useApp();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<WorkSummary | null>(null);
  const relink = useRelink();

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
          {t("leadIntro")}
          <br />
          {t("leadDetail")}
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
          </div>
        ))}
        <button className="work-add" onClick={() => setAdding(true)}>
          <span className="plus">＋</span>
          <b>{t("addWork")}</b>
          <span className="small-text">{t("addWorkKinds")}</span>
        </button>
      </div>

      {relink.dialog}
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
            {dayLabel(f.deadline.date)} <span className={`tag status ${STATUS[f.deadline.status]}`}>{t(`status.${f.deadline.status}`)}</span>
          </dd>
        </>
      )}
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
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.listStageSets().then(setSets).catch(app.showError);
  }, [app.showError]);

  // 種類を変えたら、その種類の既定のセットを選び直す（自作のセットが無ければ漫画のセット）
  useEffect(() => {
    const first = sets.find((st) => st.kind === kind) ?? sets[0];
    if (first) setSetId(first.id);
  }, [kind, sets]);

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
        onAdded(await api.addWork(paths[0], setId));
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
        {kind === "manual" && (
          <label className="row" style={{ alignItems: "flex-start" }}>
            <span style={{ width: 90, paddingTop: 6 }}>{t("rows")}</span>
            <textarea
              className="field grow"
              rows={5}
              placeholder={t("rowsPlaceholder")}
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
