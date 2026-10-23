import type { ReactElement } from "react";
import { WorkSummary } from "../api";
import type { Screen } from "../App";

const ICONS: Record<Screen, ReactElement> = {
  board: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="2.5" y="3" width="15" height="14" rx="2" />
      <path d="M2.5 8h15M8 8v9M12.5 8v9" />
    </svg>
  ),
  schedule: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="2.5" y="4" width="15" height="13" rx="2" />
      <path d="M2.5 8h15M6.5 2v4M13.5 2v4" />
    </svg>
  ),
  records: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="10" cy="10.5" r="6.5" />
      <path d="M10 7v4l2.5 1.5M8 2h4" />
    </svg>
  ),
  works: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M4 3h9l3 3v11H4z" />
      <path d="M7 9h6M7 12h6" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="10" cy="10" r="2.6" />
      <path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" />
    </svg>
  ),
};

type Props = {
  works: WorkSummary[];
  work: WorkSummary | null;
  screen: Screen;
  onScreen: (s: Screen) => void;
  onWork: (id: number) => void;
};

export function Sidebar({ works, work, screen, onScreen, onWork }: Props) {
  const item = (key: Screen, label: string, disabled = false) => (
    <button
      className={`nav-item${screen === key ? " on" : ""}`}
      disabled={disabled}
      onClick={() => onScreen(key)}
      title={disabled ? "作品を選ぶと使えます" : undefined}
    >
      {ICONS[key]}
      {label}
    </button>
  );

  return (
    <aside className="sidebar">
      <div className="logo">
        Otosazu<small>原稿を落とさず描き上げる</small>
      </div>
      <label className="work-switch">
        <span className="label">作品</span>
        <select
          value={work?.id ?? ""}
          onChange={(e) => onWork(Number(e.target.value))}
          disabled={works.length === 0}
        >
          {!work && <option value="">（作品を選んでください）</option>}
          {works.map((w) => (
            <option key={w.id} value={w.id}>
              {w.title}
            </option>
          ))}
        </select>
      </label>
      {item("board", "進捗ボード", !work)}
      {item("schedule", "スケジュール", !work)}
      {item("records", "作業記録", !work)}
      <div className="nav-spacer" />
      {item("works", "作品一覧")}
      {item("settings", "設定")}
    </aside>
  );
}
