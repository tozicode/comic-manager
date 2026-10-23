import { useEffect, useState } from "react";
import { api, Board, SessionRow, UNIT } from "../api";
import { useApp } from "../app-context";
import { Dialog } from "../components/Dialog";
import { Heatmap } from "../components/Heatmap";
import { dayKey, dayLabel, dayStartMs, fromInputs, hours, startOfDay, time, timeInDay } from "../format";

const DAY = 86_400_000;
const PERIODS = [
  { label: "直近 2 週間", days: 14 },
  { label: "直近 1 か月", days: 31 },
  { label: "直近 3 か月", days: 92 },
  { label: "すべて", days: 0 },
];

/** 編集中・追加中の記録の入力値 */
type Draft = { id: number | null; pageId: number; stageId: number; date: string; start: string; end: string; running: boolean };

function toDraft(row: SessionRow): Draft {
  return {
    id: row.id,
    pageId: row.pageId,
    stageId: row.stageId,
    date: dayKey(startOfDay(row.startedAt)),
    start: time(row.startedAt),
    end: row.endedAt ? time(row.endedAt) : "",
    running: row.endedAt === null,
  };
}

/** 入力値を時刻にする。終了が開始より前なら日付をまたいだとみなす */
function draftRange(d: Draft): { start: number; end: number | null } | string {
  const start = fromInputs(d.date, d.start);
  if (start === null) return "開始時刻を入力してください";
  if (d.running) return { start, end: null };
  let end = fromInputs(d.date, d.end);
  if (end === null) return "終了時刻を入力してください";
  if (end <= start) end += DAY; // 区切りをまたいで翌日まで作業した場合
  return { start, end };
}

export function RecordsScreen({ workId }: { workId: number }) {
  const app = useApp();
  const [board, setBoard] = useState<Board | null>(null);
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [period, setPeriod] = useState(0);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState<SessionRow | null>(null);

  const days = PERIODS[period].days;
  const today = startOfDay(Date.now());
  const dayStart = (n: number) => dayStartMs(new Date(today.getFullYear(), today.getMonth(), today.getDate() - n));
  const from = days ? dayStart(days - 1) : 0;

  useEffect(() => {
    api.getBoard(workId).then(setBoard).catch(app.showError);
    api.listSessions(workId, from).then(setRows).catch(app.showError);
  }, [workId, from, app.version, app.showError]);

  // ヒートマップで選んだ日へスクロールする（期間外なら期間を広げる）
  const selectDay = (key: string) => {
    setSelectedDay(key);
    const t = dayStartMs(new Date(`${key}T00:00`));
    if (t < from) setPeriod(PERIODS.findIndex((p) => p.days === 0 || dayStart(p.days - 1) <= t));
  };
  useEffect(() => {
    if (!selectedDay) return;
    document.getElementById(`day-${selectedDay}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [selectedDay, rows]);

  const save = async () => {
    if (!draft) return;
    const range = draftRange(draft);
    if (typeof range === "string") return app.showError(range);
    try {
      if (draft.id === null) await api.addSession(draft.pageId, draft.stageId, range.start, range.end ?? 0);
      else await api.updateSession(draft.id, draft.pageId, draft.stageId, range.start, range.end);
      setDraft(null);
      app.refresh();
    } catch (e) {
      app.showError(e);
    }
  };

  const remove = async (row: SessionRow) => {
    setDeleting(null);
    try {
      await api.deleteSession(row.id);
      app.refresh();
    } catch (e) {
      app.showError(e);
    }
  };

  const newDraft = (): Draft | null => {
    const page = board?.pages.find((p) => !p.missing);
    const stage = board?.stages[0];
    if (!page || !stage) return null;
    return { id: null, pageId: page.id, stageId: stage.id, date: dayKey(today), start: "", end: "", running: false };
  };

  // 日ごとにまとめる（日付は開始時刻で決める）
  const groups = new Map<string, SessionRow[]>();
  for (const row of rows) {
    const key = dayKey(startOfDay(row.startedAt));
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const todayKey = dayKey(today);

  const editor = (d: Draft) => (
    <>
      <td>
        <div className="row tight">
          {d.id === null && (
            <input type="date" className="field" value={d.date} onChange={(e) => setDraft({ ...d, date: e.target.value })} />
          )}
          <input type="time" className="field" value={d.start} onChange={(e) => setDraft({ ...d, start: e.target.value })} />–
          {d.running ? (
            <span className="tag sys">計測中</span>
          ) : (
            <input type="time" className="field" value={d.end} onChange={(e) => setDraft({ ...d, end: e.target.value })} />
          )}
        </div>
      </td>
      <td>
        <select className="field" value={d.pageId} onChange={(e) => setDraft({ ...d, pageId: Number(e.target.value) })}>
          {board?.pages.map((p) => (
            <option key={p.id} value={p.id}>
              {p.missing ? `${p.fileName}（消えたページ）` : p.label}
            </option>
          ))}
        </select>
      </td>
      <td>
        <select className="field" value={d.stageId} onChange={(e) => setDraft({ ...d, stageId: Number(e.target.value) })}>
          {board?.stages.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </td>
      <td className="num">
        {(() => {
          const r = draftRange(d);
          return typeof r === "string" || r.end === null ? "" : hours(r.end - r.start);
        })()}
      </td>
      <td />
      <td className="right">
        <div className="row tight" style={{ justifyContent: "flex-end" }}>
          <button className="btn small ghost" onClick={() => setDraft(null)}>
            やめる
          </button>
          <button className="btn small primary" onClick={save}>
            保存
          </button>
        </div>
      </td>
    </>
  );

  const header = (
    <tr>
      <th style={{ width: 230 }}>時間</th>
      <th style={{ width: 110 }}>{board ? UNIT[board.work.kind].row : "ページ"}</th>
      <th style={{ width: 130 }}>工程</th>
      <th style={{ width: 110 }}>長さ</th>
      <th />
      <th style={{ width: 140 }} />
    </tr>
  );

  return (
    <>
      <Heatmap selected={selectedDay} onSelect={selectDay} />

      <div className="toolbar">
        <select className="field" value={period} onChange={(e) => setPeriod(Number(e.target.value))}>
          {PERIODS.map((p, i) => (
            <option key={p.label} value={i}>
              {p.label}
            </option>
          ))}
        </select>
        <span className="grow" />
        <button className="btn" onClick={() => setDraft(newDraft())} disabled={!board || draft?.id === null}>
          ＋ 記録を手で追加
        </button>
      </div>

      {draft?.id === null && (
        <div className="rec-day">
          <h3>新しい記録</h3>
          <table className="rec">
            <thead>{header}</thead>
            <tbody>
              <tr className="editing">{editor(draft)}</tr>
            </tbody>
          </table>
        </div>
      )}

      {groups.size === 0 && <p className="muted center">この期間の作業記録はありません</p>}
      {[...groups.entries()].map(([key, list]) => {
        const groupDay = new Date(`${key}T00:00`);
        const total = list.reduce((n, r) => n + (r.endedAt ?? app.now) - r.startedAt, 0);
        return (
          <div key={key} id={`day-${key}`} className={`rec-day${key === selectedDay ? " selected" : ""}`}>
            <h3>
              <span>
                {dayLabel(new Date(`${key}T00:00`))}
                {key === todayKey && " 今日"}
              </span>
              <span className="muted num">合計 {hours(total)}</span>
            </h3>
            <table className="rec">
              <thead>{header}</thead>
              <tbody>
                {list.map((row) =>
                  draft?.id === row.id ? (
                    <tr key={row.id} className="editing">
                      {editor(draft)}
                    </tr>
                  ) : (
                    <tr key={row.id}>
                      <td className="num">
                        {timeInDay(row.startedAt, groupDay)} –{" "}
                        {row.endedAt ? timeInDay(row.endedAt, groupDay) : <span className="tag sys">計測中</span>}
                      </td>
                      <td>{row.pageLabel}</td>
                      <td>
                        <span className="stage-label">
                          <i style={{ background: row.stageColor }} />
                          {row.stageName}
                        </span>
                      </td>
                      <td className="num">{hours((row.endedAt ?? app.now) - row.startedAt)}</td>
                      <td>{row.edited && <span className="edited">✎ 手修正</span>}</td>
                      <td className="right">
                        <button className="btn small ghost" onClick={() => setDraft(toDraft(row))}>
                          直す
                        </button>
                        <button className="btn small ghost" onClick={() => setDeleting(row)} disabled={!row.endedAt}>
                          消す
                        </button>
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        );
      })}

      {deleting && (
        <Dialog
          title="この作業記録を消しますか？"
          onClose={() => setDeleting(null)}
          actions={
            <>
              <button className="btn" onClick={() => setDeleting(null)}>
                やめる
              </button>
              <button className="btn danger" onClick={() => remove(deleting)}>
                消す
              </button>
            </>
          }
        >
          <p>
            {dayLabel(startOfDay(deleting.startedAt))} {timeInDay(deleting.startedAt, startOfDay(deleting.startedAt))} –{" "}
            {deleting.endedAt && timeInDay(deleting.endedAt, startOfDay(deleting.startedAt))}{" "}
            {deleting.pageLabel} {deleting.stageName}（{hours((deleting.endedAt ?? 0) - deleting.startedAt)}）
          </p>
        </Dialog>
      )}
    </>
  );
}
