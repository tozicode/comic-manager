import { useEffect, useMemo, useState } from "react";
import { api, Span } from "../api";
import { useApp } from "../app-context";
import { dailyTotals, dayKey, dayLabel, dayStartMs, hours, startOfDay } from "../format";

const WEEKS = 26;
const HOUR = 3_600_000;

function level(ms: number): string {
  if (ms <= 0) return "";
  if (ms < HOUR) return "l1";
  if (ms < 2 * HOUR) return "l2";
  if (ms < 4 * HOUR) return "l3";
  return "l4";
}

/** 半年ぶんの日ごとの作業時間（全作品）。マスをクリックするとその日を選ぶ */
export function Heatmap({ selected, onSelect }: { selected: string | null; onSelect: (key: string) => void }) {
  const app = useApp();
  const [spans, setSpans] = useState<Span[]>([]);
  const [hover, setHover] = useState<{ key: string; x: number; y: number } | null>(null);

  // 今週の月曜日から 25 週前の月曜日まで
  const today = startOfDay(Date.now());
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const first = new Date(monday);
  first.setDate(monday.getDate() - (WEEKS - 1) * 7);

  useEffect(() => {
    api.listSpans(dayStartMs(first)).then(setSpans).catch(app.showError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.version, app.showError]);

  const totals = useMemo(() => dailyTotals(spans, Date.now(), (s) => s.stageName), [spans, app.now]);
  const dayMs = (d: Date) => totals.get(dayKey(d))?.total ?? 0;

  const days: Date[] = [];
  for (let i = 0; i < WEEKS * 7; i++) days.push(new Date(first.getFullYear(), first.getMonth(), first.getDate() + i));

  // 月の見出し（前の見出しと近すぎるときは出さない）
  const months: { week: number; label: string }[] = [];
  for (let w = 0; w < WEEKS; w++) {
    const d = days[w * 7];
    const prev = w > 0 ? days[(w - 1) * 7] : null;
    if ((!prev || prev.getMonth() !== d.getMonth()) && (months.length === 0 || w - months[months.length - 1].week >= 3)) {
      months.push({ week: w, label: `${d.getMonth() + 1}月` });
    }
  }

  // 右側の数字
  const sumRange = (from: Date, n: number) => {
    let ms = 0;
    for (let i = 0; i < n; i++) ms += dayMs(new Date(from.getFullYear(), from.getMonth(), from.getDate() + i));
    return ms;
  };
  const daysThisWeek = Math.round((today.getTime() - monday.getTime()) / 86_400_000) + 1;
  const lastMonday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 7);
  const thisWeek = sumRange(monday, daysThisWeek);
  const lastWeekSame = sumRange(lastMonday, daysThisWeek);
  const lastWeek = sumRange(lastMonday, 7);
  const past = days.filter((d) => d <= today);
  const workedDays = past.filter((d) => dayMs(d) > 0).length;
  const halfYear = past.reduce((n, d) => n + dayMs(d), 0);
  let streak = 0;
  let longest = 0;
  let run = 0;
  for (const d of past) {
    run = dayMs(d) > 0 ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  // 今日まだ作業していなくても、昨日まで続いていれば連続とみなす
  for (let i = past.length - 1; i >= 0; i--) {
    if (dayMs(past[i]) > 0) streak++;
    else if (i === past.length - 1) continue;
    else break;
  }

  const hovered = hover ? totals.get(hover.key) : null;

  return (
    <div className="card heat-card">
      <div style={{ position: "relative" }}>
        <div className="row" style={{ marginBottom: 8 }}>
          <div className="section-title" style={{ margin: 0 }}>
            日ごとの作業時間（すべての作品）
          </div>
          <span className="muted small-text">マスをクリックすると、その日の記録へ移動</span>
        </div>
        <div className="heat-wrap">
          <div className="heat-months">
            {months.map((m) => (
              <span key={m.week} style={{ left: m.week * 17 }}>
                {m.label}
              </span>
            ))}
          </div>
          <div className="heat-days">
            <span>月</span>
            <span />
            <span>水</span>
            <span />
            <span>金</span>
            <span />
            <span>日</span>
          </div>
          <div className="heat">
            {days.map((d) => {
              const key = dayKey(d);
              if (d > today) return <i key={key} className="future" />;
              const cls = [level(dayMs(d)), d.getTime() === today.getTime() ? "today" : "", key === selected ? "sel" : ""]
                .join(" ")
                .trim();
              return (
                <i
                  key={key}
                  className={cls}
                  onClick={() => onSelect(key)}
                  onMouseEnter={(e) => {
                    const box = (e.currentTarget.closest(".heat-card") as HTMLElement).getBoundingClientRect();
                    const r = e.currentTarget.getBoundingClientRect();
                    setHover({ key, x: r.right - box.left, y: r.top - box.top });
                  }}
                  onMouseLeave={() => setHover(null)}
                />
              );
            })}
          </div>
        </div>
        <div className="heat-legend">
          <span style={{ marginRight: 4 }}>少</span>
          <i className="l0" />
          <i className="l1" />
          <i className="l2" />
          <i className="l3" />
          <i className="l4" />
          <span style={{ marginLeft: 4 }}>多</span>
          <span style={{ marginLeft: 14 }}>
            {hours(0)} ／ 〜{hours(HOUR)} ／ 〜{hours(2 * HOUR)} ／ 〜{hours(4 * HOUR)} ／ {hours(4 * HOUR)}〜
          </span>
        </div>
        {hover && (
          <div className="heat-tip" style={{ right: `calc(100% - ${hover.x + 6}px)`, top: hover.y - 44 }}>
            {dayLabel(new Date(`${hover.key}T00:00`))} {hours(hovered?.total ?? 0)}
            {hovered && hovered.byKey.size > 0 && (
              <>
                {" ・ "}
                {[...hovered.byKey.entries()]
                  .sort((a, b) => b[1] - a[1])
                  .map(([name, ms]) => `${name} ${hours(ms)}`)
                  .join(" ／ ")}
              </>
            )}
          </div>
        )}
      </div>
      <div className="heat-stats">
        <div>
          <div className="lbl">今週</div>
          <div className="v num">{hours(thisWeek)}</div>
          <div className="d muted">先週の同じ曜日まで {hours(lastWeekSame)}</div>
        </div>
        <div>
          <div className="lbl">先週</div>
          <div className="v num">{hours(lastWeek)}</div>
          <div className="d muted">1日平均 {hours(lastWeek / 7)}</div>
        </div>
        <div>
          <div className="lbl">連続で作業した日</div>
          <div className="v num">{streak} 日</div>
          <div className="d muted">最長 {longest} 日</div>
        </div>
        <div>
          <div className="lbl">半年の合計</div>
          <div className="v num">{hours(halfYear)}</div>
          <div className="d muted">作業した日 {workedDays} 日</div>
        </div>
      </div>
    </div>
  );
}
