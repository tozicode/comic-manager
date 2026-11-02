// 共同作業の取り込み（仕様書 5.23）の設定ダイアログ。
// 読んでいる場所と状態、メンバーごとの「反映で完了にする工程」、反映の履歴を出す
import { useCallback, useEffect, useState } from "react";
import { api, CollabInfo, StageRef } from "../api";
import { useApp } from "../app-context";
import { dayLabel, time } from "../format";
import { t } from "../i18n/collab";
import { Dialog } from "./Dialog";

type Props = { workId: number; stages: StageRef[]; onClose: () => void };

export function CollabDialog({ workId, stages, onClose }: Props) {
  const app = useApp();
  const [info, setInfo] = useState<CollabInfo | null>(null);
  const [reading, setReading] = useState(false);

  const reload = useCallback(() => api.getCollabInfo(workId).then(setInfo).catch(app.showError), [workId, app.showError]);
  useEffect(() => {
    reload();
  }, [reload]);

  const readNow = async () => {
    setReading(true);
    try {
      const r = await api.readCollab(workId);
      await reload();
      if (r && (r.newCommits > 0 || r.appliedCells > 0 || r.assignmentsChanged)) app.refresh();
    } catch (e) {
      app.showError(e);
    } finally {
      setReading(false);
    }
  };

  const setMember = async (name: string, stageIds: number[], color: string) => {
    try {
      await api.setCollabMember(workId, name, stageIds, color);
      await reload();
      // 担当の印は工程の対応で変わるので描き直す
      app.refresh();
    } catch (e) {
      app.showError(e);
    }
  };

  const status = !info
    ? ""
    : reading
      ? t("reading")
      : info.lastError
        ? t("failed", { error: info.lastError })
        : info.lastReadAt
          ? t("lastRead", { time: `${dayLabel(new Date(info.lastReadAt))} ${time(info.lastReadAt)}` })
          : t("neverRead");

  return (
    <Dialog
      className="collab-dialog"
      title={t("title")}
      onClose={onClose}
      actions={
        <button className="btn" onClick={onClose}>
          {t("close")}
        </button>
      }
    >
      <p className="muted small-text">{t("intro")}</p>
      {info && (
        <>
          <div className="row">
            <span className="grow">
              {t("folder")}
              <br />
              <span className="muted small-text path-text">{info.folder}</span>
            </span>
            <button className="btn small" disabled={reading} onClick={readNow}>
              {t("readNow")}
            </button>
          </div>
          <p className={info.lastError ? "error small-text" : "muted small-text"}>{status}</p>

          <div className="section-title">{t("members")}</div>
          <p className="muted small-text">{t("membersHint")}</p>
          {info.members.length === 0 ? (
            <p className="muted small-text">{t("noMembers")}</p>
          ) : (
            <table className="collab-members">
              <tbody>
                {info.members.map((m) => (
                  <tr key={m.name}>
                    <td>
                      <label className="row tight">
                        <input
                          type="color"
                          value={m.color}
                          title={m.name}
                          onChange={(e) => setMember(m.name, m.stageIds, e.target.value)}
                        />
                        <span className="member-badge" style={{ background: m.color }}>
                          {initial(m.name)}
                        </span>
                        <b>{m.name}</b>
                      </label>
                    </td>
                    <td>
                      <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
                        {stages.map((s) => (
                          <label key={s.id} className="row tight small-text">
                            <input
                              type="checkbox"
                              checked={m.stageIds.includes(s.id)}
                              onChange={(e) =>
                                setMember(
                                  m.name,
                                  e.target.checked ? [...m.stageIds, s.id] : m.stageIds.filter((id) => id !== s.id),
                                  m.color,
                                )
                              }
                            />
                            <span className="swatch" style={{ background: s.color }} />
                            {s.name}
                          </label>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="muted small-text">{t("adminNote")}</p>

          <div className="section-title">{t("history")}</div>
          {info.commits.length === 0 ? (
            <p className="muted small-text">{t("noHistory")}</p>
          ) : (
            <div className="collab-history">
              <table>
                <thead>
                  <tr>
                    <th>{t("colWhen")}</th>
                    <th>{t("colWho")}</th>
                    <th>{t("colPages")}</th>
                    <th>{t("colComment")}</th>
                    <th>{t("colApplied")}</th>
                  </tr>
                </thead>
                <tbody>
                  {info.commits.map((c) => (
                    <tr key={c.revision}>
                      <td className="num">
                        {dayLabel(new Date(c.committedAt))} {time(c.committedAt)}
                      </td>
                      <td>{c.userName}</td>
                      <td className="small-text">{c.files.map(pageName).join(" ")}</td>
                      <td className="small-text">{c.comment}</td>
                      <td className="center">{c.applied ? t("appliedMark") : t("notAppliedMark")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Dialog>
  );
}

/** メンバーの印に使う頭文字（1 文字） */
export function initial(name: string): string {
  const c = Array.from(name.trim())[0] ?? "?";
  return c.toUpperCase();
}

/** `page0003.clip` → `p3`。それ以外の名前はそのまま */
function pageName(file: string): string {
  const m = /^page(\d+)\.clip$/i.exec(file);
  return m ? `p${Number(m[1])}` : file.replace(/\.clip$/i, "");
}
