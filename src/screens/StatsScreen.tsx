import { useEffect, useMemo, useState } from "react";
import { api, CompletedCounts, ModelStats, Span, StageDef, StageSet, TagGroup, WorkStageStats, WorkSummary } from "../api";
import { useApp } from "../app-context";
import { dailyTotals, dayLabel, estimate, factor, hours, startOfDay, weekdayName } from "../format";
import { kindKey, setName, unitText } from "../i18n/common";
import { t } from "../i18n/stats";
import { factorDiffers, STATS_WEEKS, weekdayAverages } from "../stats";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// 月曜始まりの曜日（weekdayName の番号。0 = 日曜）
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0];

/** 統計画面（仕様書 5.12）。全作品の実績から、予測の前提を見せる */
export function StatsScreen() {
  const app = useApp();
  const [stats, setStats] = useState<ModelStats | null>(null);
  const [groups, setGroups] = useState<TagGroup[]>([]);
  const [sets, setSets] = useState<StageSet[]>([]);
  const [stages, setStages] = useState<StageDef[]>([]);
  const [spans, setSpans] = useState<Span[]>([]);
  const [calendar, setCalendar] = useState<[number[], string[]] | null>(null);
  const [works, setWorks] = useState<WorkSummary[]>([]);
  const [workStats, setWorkStats] = useState<WorkStageStats[]>([]);
  const [counts, setCounts] = useState<CompletedCounts | null>(null);

  useEffect(() => {
    api.getModelStats().then(setStats).catch(app.showError);
    api.getCompletedCounts().then(setCounts).catch(app.showError);
    api.listWorks().then(setWorks).catch(app.showError);
    api.getWorkStageStats().then(setWorkStats).catch(app.showError);
    api.listTags().then(setGroups).catch(app.showError);
    api.listStageSets().then(setSets).catch(app.showError);
    api.listStages().then(setStages).catch(app.showError);
    api.listSpans(0).then(setSpans).catch(app.showError);
    api.getCalendar().then(setCalendar).catch(app.showError);
  }, [app.version, app.showError]);

  return (
    <>
      <Achievements spans={spans} counts={counts} />
      <div className="stats">
        <div className="stats-side">
          <TagFactors stats={stats} groups={groups} sets={sets} />
          <WorkStages stats={stats} works={works} workStats={workStats} stages={stages} />
        </div>
        <div className="stats-side">
          <WeekdayHours spans={spans} calendar={calendar} />
          <StageBases stats={stats} sets={sets} stages={stages} />
        </div>
      </div>
    </>
  );
}

/** これまでの実績（5.12）。使い続ける楽しみのための 4 つの数字。予測には使わない */
function Achievements({ spans, counts }: { spans: Span[]; counts: CompletedCounts | null }) {
  const now = Date.now();
  const totals = dailyTotals(spans, now);
  const totalMs = spans.reduce((n, s) => n + (s.endedAt ?? now) - s.startedAt, 0);
  const firstMs = spans.reduce((m, s) => Math.min(m, s.startedAt), Infinity);
  const since = Number.isFinite(firstMs) ? Math.round((startOfDay(now).getTime() - startOfDay(firstMs).getTime()) / DAY) + 1 : 0;
  const tile = (label: string, value: string, sub?: string) => (
    <div className="card stats-tile">
      <div className="muted small-text">{label}</div>
      <div className="stats-tile-value">{value}</div>
      {sub && <div className="muted small-text">{sub}</div>}
    </div>
  );
  return (
    <div className="stats-tiles">
      {tile(t("ach.hours"), hours(totalMs))}
      {tile(t("ach.pages"), String(counts?.pages ?? 0))}
      {tile(t("ach.works"), String(counts?.works ?? 0))}
      {tile(t("ach.days"), t("ach.daysN", { n: totals.size }), since > 0 ? t("ach.since", { n: since }) : undefined)}
    </div>
  );
}

function TagFactors({ stats, groups, sets }: { stats: ModelStats | null; groups: TagGroup[]; sets: StageSet[] }) {
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
                <span className="muted small-text">
                  　{g.setIds.length === 0 ? t("sets.all") : sets.filter((s) => g.setIds.includes(s.id)).map(setName).join("・")}
                </span>
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
              {setName(set)}
              <span className="muted small-text">　{t(kindKey(set.kind, "base.per"), { unit: unitText(set, 1) })}</span>
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
                      <td className="num right">{b ? hours(b.baseMs) : "—"}</td>
                      <td className="muted small-text">
                        {!b || b.fromHint
                          ? t("base.fromHint")
                          : `${t("base.samples", { n: b.samples })}・${t("base.mean", { time: hours(b.meanMs) })}`}
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
      <p className="muted small-text">{t("base.note")}</p>
    </div>
  );
}

/** 作品ごとの工程の時間（5.12）。振り返りと次の見積もりのために、タグの影響を除かない平均を全作品と並べる */
function WorkStages({
  stats,
  works,
  workStats,
  stages,
}: {
  stats: ModelStats | null;
  works: WorkSummary[];
  workStats: WorkStageStats[];
  stages: StageDef[];
}) {
  // 最後に作業した作品を先頭に
  const ordered = useMemo(() => [...works].sort((a, b) => (b.lastWorkedAt ?? 0) - (a.lastWorkedAt ?? 0)), [works]);
  const [workId, setWorkId] = useState<number | null>(null);
  const selected = ordered.find((w) => w.id === workId) ?? ordered[0];
  const rows = workStats.find((w) => w.workId === selected?.id)?.stages ?? [];
  const allMeans = new Map(stats?.stages.map((s) => [s.stageId, s]));
  const defs = new Map(stages.map((s) => [s.id, s]));
  const hasRecords = rows.some((r) => r.totalMs > 0);

  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 8 }}>
        <div className="section-title" style={{ margin: 0 }}>
          {t("work.title")}
        </div>
        {ordered.length > 0 && (
          <select className="field" value={selected?.id ?? ""} onChange={(e) => setWorkId(Number(e.target.value))}>
            {ordered.map((w) => (
              <option key={w.id} value={w.id}>
                {w.title}
              </option>
            ))}
          </select>
        )}
      </div>
      <p className="muted small-text">{t("work.lead")}</p>
      {!selected ? (
        <p className="muted">{t("work.noWorks")}</p>
      ) : !hasRecords ? (
        <p className="muted">{t("work.empty")}</p>
      ) : (
        <>
          <table className="rec stats-table">
            <thead>
              <tr>
                <th>{t("col.stage")}</th>
                <th className="right">{t("col.workMean")}</th>
                <th className="right">{t("col.samples")}</th>
                <th className="right">{t("col.allMean")}</th>
                <th className="right">{t("col.ratio")}</th>
                <th className="right">{t("col.total")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const def = defs.get(r.stageId);
                const all = allMeans.get(r.stageId);
                const allMean = all && !all.fromHint ? all.meanMs : 0;
                const ratio = r.samples > 0 && allMean > 0 ? r.meanMs / allMean : null;
                const differs = ratio !== null && factorDiffers(allMean, r.meanMs, r.samples);
                return (
                  <tr key={r.stageId}>
                    <td>
                      <span className="stage-label">
                        <i style={{ background: def?.color ?? "transparent" }} />
                        {def?.name ?? "—"}
                      </span>
                    </td>
                    <td className="num right">{r.samples > 0 ? hours(r.meanMs) : "—"}</td>
                    <td className="num right">{t("count", { n: r.samples })}</td>
                    <td className="num right">{allMean > 0 ? hours(allMean) : "—"}</td>
                    <td className={`num right${differs ? " differs" : ""}`}>
                      {ratio !== null ? `×${ratio.toFixed(2)}` : "—"}
                      {differs && " ⚠"}
                    </td>
                    <td className="num right">{r.totalMs > 0 ? hours(r.totalMs) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="muted small-text">{t("work.note")}</p>
        </>
      )}
    </div>
  );
}
