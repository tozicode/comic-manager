import { useEffect, useMemo, useState } from "react";
import { api, ModelStats, Span, StageDef, StageSet, TagApplies, TagGroup } from "../api";
import { useApp } from "../app-context";
import { dayLabel, estimate, factor, hours } from "../format";
import { factorDiffers, STATS_WEEKS, weekdayAverages } from "../stats";

const HOUR = 3_600_000;
const WEEKDAYS = ["月", "火", "水", "木", "金", "土", "日"];
const APPLIES: Record<TagApplies, string> = { comic: "漫画", files: "イラスト", both: "漫画・イラスト" };

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
      <div className="section-title">タグの倍率</div>
      <p className="muted small-text">
        予測には、初期倍率と実績を混ぜた倍率を使います。実績が増えるほど「実績から見た倍率」に近づきます。
      </p>
      <table className="rec stats-table">
        <thead>
          <tr>
            <th>タグ</th>
            <th className="right">初期倍率</th>
            <th className="right">予測に使う倍率</th>
            <th className="right">実績から見た倍率</th>
            <th className="right">実績の数</th>
          </tr>
        </thead>
        {visible.map((g) => (
          <tbody key={g.id}>
            <tr className="group-row">
              <td colSpan={5}>
                {g.name}
                <span className="muted small-text">　{APPLIES[g.applies]}</span>
              </td>
            </tr>
            {g.tags.map((t) => {
              const fit = fits.get(t.id);
              const differs = fit ? factorDiffers(t.initialFactor, fit.observed, fit.samples) : false;
              flagged ||= differs;
              return (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td className="num right">×{factor(t.initialFactor)}</td>
                  <td className="num right">×{fit ? fit.factor.toFixed(2) : factor(t.initialFactor)}</td>
                  <td className={`num right${differs ? " differs" : ""}`}>
                    {fit ? `×${fit.observed.toFixed(2)}` : "—"}
                    {differs && " ⚠"}
                  </td>
                  <td className="num right">{fit ? `${fit.samples} 件` : <span className="muted">0 件</span>}</td>
                </tr>
              );
            })}
          </tbody>
        ))}
      </table>
      {flagged && (
        <p className="small-text differs-note">
          ⚠ 実績から見た倍率が初期倍率と大きく違うタグがあります。設定 → タグ で初期倍率を見直せます。
        </p>
      )}
      <p className="muted small-text">実績の数は、そのタグが付いた完了したタスク（ページ × 工程）の数です。</p>
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
      <div className="section-title">曜日ごとの作業時間</div>
      {!result.from ? (
        <p className="muted">まだ作業記録がありません。</p>
      ) : (
        <>
          <div className="wd-legend small-text">
            <span>
              <i className="actual" />
              実際（平均）
            </span>
            <span>
              <i className="planned" />
              設定
            </span>
          </div>
          {WEEKDAYS.map((d, i) => (
            <div key={d} className="wd-stat">
              <b>{d}</b>
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
            {dayLabel(result.from)}〜{dayLabel(result.to)}（直近 {STATS_WEEKS} 週間・休みの日を除く）の、全作品を合わせた 1
            日あたりの平均です。設定は 設定 → 作業時間・休み で変えられます。
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
      <div className="section-title">工程ごとの基準時間</div>
      {sets.map((set) => {
        const list = stages.filter((s) => s.setId === set.id && !s.hidden).sort((a, b) => a.sortOrder - b.sortOrder);
        if (list.length === 0) return null;
        return (
          <div key={set.id} className="stats-set">
            <h3>
              {set.name}
              <span className="muted small-text">　1{set.unit}あたり・タグの影響を除いた時間</span>
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
                        {!b || b.fromHint ? "目安を使用中" : `実績 ${b.samples} 件`}
                      </td>
                      <td className="muted small-text right">目安 {estimate(s.hintMinutes * 60_000)}</td>
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
