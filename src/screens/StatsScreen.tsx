import { useEffect, useMemo, useState } from "react";
import { api, ModelStats, Span, StageDef, StageSet, TagApplies, TagGroup } from "../api";
import { useApp } from "../app-context";
import { dayLabel, estimate, factor, hours, weekdayName } from "../format";
import { setName } from "../i18n/common";
import { t } from "../i18n/stats";
import { factorDiffers, STATS_WEEKS, weekdayAverages } from "../stats";

const HOUR = 3_600_000;
// 月曜始まりの曜日（weekdayName の番号。0 = 日曜）
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0];
// タググループの対象（名前は描画時に訳す）
const APPLIES = { comic: "applies.comic", files: "applies.files", both: "applies.both" } as const satisfies Record<TagApplies, string>;

/** 統計画面（仕様書 5.12）。全作品の実績から、予測の前提を見せる */
export function StatsScreen() {
  const app = useApp();
  const [stats, setStats] = useState<ModelStats | null>(null);
  const [groups, setGroups] = useState<TagGroup[]>([]);
  const [sets, setSets] = useState<StageSet[]>([]);
  const [stages, setStages] = useState<StageDef[]>([]);
  const [spans, setSpans] = useState<Span[]>([]);
  const [calendar, setCalendar] = useState<[number[], string[]] | null>(null);

  useEffect(() => {
    api.getModelStats().then(setStats).catch(app.showError);
    api.listTags().then(setGroups).catch(app.showError);
    api.listStageSets().then(setSets).catch(app.showError);
    api.listStages().then(setStages).catch(app.showError);
    api.listSpans(0).then(setSpans).catch(app.showError);
    api.getCalendar().then(setCalendar).catch(app.showError);
  }, [app.version, app.showError]);

  return (
    <div className="stats">
      <TagFactors stats={stats} groups={groups} />
      <div className="stats-side">
        <WeekdayHours spans={spans} calendar={calendar} />
        <StageBases stats={stats} sets={sets} stages={stages} />
      </div>
    </div>
  );
}

function TagFactors({ stats, groups }: { stats: ModelStats | null; groups: TagGroup[] }) {
  const fits = new Map(stats?.tags.map((t) => [t.tagId, t]));
  const visible = groups.map((g) => ({ ...g, tags: g.tags.filter((t) => !t.hidden) })).filter((g) => g.tags.length > 0);
  let flagged = false;

  return (
    <div className="card">
      <div className="section-title">{t("tags.title")}</div>
      <p className="muted small-text">
        {t("tags.lead")}
      </p>
      <table className="rec stats-table">
        <thead>
          <tr>
            <th>{t("col.tag")}</th>
            <th className="right">{t("col.initial")}</th>
            <th className="right">{t("col.used")}</th>
            <th className="right">{t("col.observed")}</th>
            <th className="right">{t("col.samples")}</th>
          </tr>
        </thead>
        {visible.map((g) => (
          <tbody key={g.id}>
            <tr className="group-row">
              <td colSpan={5}>
                {g.name}
                <span className="muted small-text">　{t(APPLIES[g.applies])}</span>
              </td>
            </tr>
            {g.tags.map((tag) => {
              const fit = fits.get(tag.id);
              const differs = fit ? factorDiffers(tag.initialFactor, fit.observed, fit.samples) : false;
              flagged ||= differs;
              return (
                <tr key={tag.id}>
                  <td>{tag.name}</td>
                  <td className="num right">×{factor(tag.initialFactor)}</td>
                  <td className="num right">×{fit ? fit.factor.toFixed(2) : factor(tag.initialFactor)}</td>
                  <td className={`num right${differs ? " differs" : ""}`}>
                    {fit ? `×${fit.observed.toFixed(2)}` : "—"}
                    {differs && " ⚠"}
                  </td>
                  <td className="num right">{fit ? t("count", { n: fit.samples }) : <span className="muted">{t("count", { n: 0 })}</span>}</td>
                </tr>
              );
            })}
          </tbody>
        ))}
      </table>
      {flagged && (
        <p className="small-text differs-note">
          {t("tags.differs")}
        </p>
      )}
      <p className="muted small-text">{t("tags.note")}</p>
    </div>
  );
}

function WeekdayHours({ spans, calendar }: { spans: Span[]; calendar: [number[], string[]] | null }) {
  const app = useApp();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const result = useMemo(() => weekdayAverages(spans, Date.now(), calendar?.[1] ?? []), [spans, calendar, app.version]);
  const setting = calendar?.[0] ?? Array(7).fill(0);
  const max = Math.max(1, ...setting.map((h) => h * HOUR), ...result.averages.map((a) => a.avgMs));

  return (
    <div className="card">
      <div className="section-title">{t("wd.title")}</div>
      {!result.from ? (
        <p className="muted">{t("wd.empty")}</p>
      ) : (
        <>
          <div className="wd-legend small-text">
            <span>
              <i className="actual" />
              {t("wd.actual")}
            </span>
            <span>
              <i className="planned" />
              {t("wd.planned")}
            </span>
          </div>
          {WEEKDAYS.map((d, i) => (
            <div key={d} className="wd-stat">
              <b>{weekdayName(d)}</b>
              <div className="wd-bars">
                <div className="bar">
                  <span className="actual" style={{ width: `${(result.averages[i].avgMs / max) * 100}%` }} />
                </div>
                <div className="bar">
                  <span className="planned" style={{ width: `${((setting[i] * HOUR) / max) * 100}%` }} />
                </div>
              </div>
              <span className="num">
                {result.averages[i].days ? hours(result.averages[i].avgMs) : "—"}
                <span className="muted"> / {hours(setting[i] * HOUR)}</span>
              </span>
            </div>
          ))}
          <p className="muted small-text">
            {t("wd.note", { from: dayLabel(result.from), to: dayLabel(result.to), weeks: STATS_WEEKS })}
          </p>
        </>
      )}
    </div>
  );
}

function StageBases({ stats, sets, stages }: { stats: ModelStats | null; sets: StageSet[]; stages: StageDef[] }) {
  const bases = new Map(stats?.stages.map((s) => [s.stageId, s]));
  return (
    <div className="card">
      <div className="section-title">{t("base.title")}</div>
      {sets.map((set) => {
        const list = stages.filter((s) => s.setId === set.id && !s.hidden).sort((a, b) => a.sortOrder - b.sortOrder);
        if (list.length === 0) return null;
        return (
          <div key={set.id} className="stats-set">
            <h3>
              {setName(set.kind)}
              <span className="muted small-text">　{t(set.kind === "files" ? "base.perFiles" : "base.perComic")}</span>
            </h3>
            <table className="rec stats-table">
              <tbody>
                {list.map((s) => {
                  const b = bases.get(s.id);
                  return (
                    <tr key={s.id}>
                      <td>
                        <span className="stage-label">
                          <i style={{ background: s.color }} />
                          {s.name}
                        </span>
                      </td>
                      <td className="num right">{b ? estimate(b.baseMs) : "—"}</td>
                      <td className="muted small-text">
                        {!b || b.fromHint ? t("base.fromHint") : t("base.samples", { n: b.samples })}
                      </td>
                      <td className="muted small-text right">{t("base.hint", { time: estimate(s.hintMinutes * 60_000) })}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
