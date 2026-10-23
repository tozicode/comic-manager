import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api, StageSet, UNIT, WorkKind, WorkSummary } from "../api";
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
          はじめに、CLIP STUDIO PAINT で描いている作品を登録しましょう。
          <br />
          漫画（.cmc）ならページ × 工程、イラスト（.clip・.psd）ならファイル × 工程ごとに作業時間を記録できます。
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
                {w.kind === "files" ? "イラスト · " : ""}
                {w.pageCount}
                {UNIT[w.kind].count} · {w.stageCount}工程
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
              {w.cmcPath && (
                <div className="path" title={w.cmcPath}>
                  {w.cmcPath}
                </div>
              )}
              {w.fileMissing && (
                <div className="file-missing" onClick={(e) => e.stopPropagation()}>
                  {w.kind === "files" ? (
                    <>
                      <span className="grow">⚠ 見つからないファイルがあります</span>
                      <button className="btn small primary" onClick={() => onOpen(w.id)}>
                        作品を開く
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="grow">⚠ この場所に漫画ファイルが見つかりません</span>
                      <button className="btn small primary" onClick={() => relink.start(w.id, w.title)}>
                        場所を指定し直す
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
          <b>作品を追加</b>
          <span className="small-text">漫画（.cmc）／イラスト（.clip・.psd）</span>
        </button>
      </div>

      {relink.dialog}
      {adding && (
        <AddWorkDialog
          onClose={() => setAdding(false)}
          onAdded={(id) => {
            setAdding(false);
            app.refresh();
            onOpen(id);
          }}
        />
      )}
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
            {removing.kind === "files" ? "イラストのファイル" : "CLIP STUDIO の漫画ファイル"}そのものは消えません。
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

/** 作品を追加するダイアログ：種類と工程のセットを選んでから、ファイルを選ぶ */
function AddWorkDialog({ onClose, onAdded }: { onClose: () => void; onAdded: (workId: number) => void }) {
  const app = useApp();
  const [kind, setKind] = useState<WorkKind>("comic");
  const [sets, setSets] = useState<StageSet[]>([]);
  const [setId, setSetId] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.listStageSets().then(setSets).catch(app.showError);
  }, [app.showError]);

  // 種類を変えたら、その種類の既定のセットを選び直す
  useEffect(() => {
    const first = sets.find((st) => st.kind === kind) ?? sets[0];
    if (first) setSetId(first.id);
  }, [kind, sets]);

  const pick = async () => {
    if (setId === null) return;
    const picked = await open(
      kind === "comic"
        ? { title: "漫画ファイルを選ぶ", multiple: false, directory: false, filters: [{ name: "CLIP STUDIO 漫画ファイル", extensions: ["cmc"] }] }
        : {
            title: "イラストのファイルを選ぶ（複数選べます）",
            multiple: true,
            directory: false,
            filters: [{ name: "イラスト（.clip / .psd）", extensions: ["clip", "psd", "psb"] }],
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
      title="作品を追加"
      onClose={onClose}
      actions={
        <>
          <button className="btn" onClick={onClose}>
            やめる
          </button>
          <button className="btn primary" onClick={pick} disabled={busy || setId === null}>
            {busy ? "読み込み中…" : kind === "comic" ? "漫画ファイルを選ぶ…" : "ファイルを選ぶ…"}
          </button>
        </>
      }
    >
      <button className={`choice${kind === "comic" ? " on" : ""}`} onClick={() => setKind("comic")}>
        <span className="radio" />
        <span>
          <b>漫画</b>
          <br />
          <span className="muted">CLIP STUDIO の漫画ファイル（.cmc）。ページの一覧を自動で読み込みます</span>
        </span>
      </button>
      <button className={`choice${kind === "files" ? " on" : ""}`} onClick={() => setKind("files")}>
        <span className="radio" />
        <span>
          <b>イラスト</b>
          <br />
          <span className="muted">.clip / .psd を 1 つ以上。連作や表紙と挿絵などをまとめて 1 つの作品にできます</span>
        </span>
      </button>
      <div className="form" style={{ marginTop: 8 }}>
        {kind === "files" && (
          <label className="row">
            <span style={{ width: 90 }}>作品名</span>
            <input
              className="field grow"
              placeholder="空欄なら最初のファイル名"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
        )}
        <label className="row">
          <span style={{ width: 90 }}>工程</span>
          <select className="field grow" value={setId ?? ""} onChange={(e) => setSetId(Number(e.target.value))}>
            {sets.map((st) => (
              <option key={st.id} value={st.id}>
                {st.name}のセット
              </option>
            ))}
          </select>
        </label>
      </div>
    </Dialog>
  );
}
