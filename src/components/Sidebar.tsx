import type { ReactElement } from "react";
import { WorkSummary } from "../api";
import type { Screen } from "../App";
import { t } from "../i18n/shell";
import { Logo } from "./Logo";

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
  stats: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M3 17h14" />
      <path d="M5.5 14V9M10 14V4.5M14.5 14v-7" />
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
      title={disabled ? t("needsWork") : undefined}
    >
      {ICONS[key]}
      {label}
    </button>
  );

  return (
    <aside className="sidebar">
      <div className="logo">
        <Logo />
        <small>{t("tagline")}</small>
      </div>
      <label className="work-switch">
        <span className="label">{t("work")}</span>
        <select
          value={work?.id ?? ""}
          onChange={(e) => onWork(Number(e.target.value))}
          disabled={works.length === 0}
        >
          {!work && <option value="">{t("chooseWork")}</option>}
          {works.map((w) => (
            <option key={w.id} value={w.id}>
              {w.title}
            </option>
          ))}
        </select>
      </label>
      {item("board", t("screen.board"), !work)}
      {item("schedule", t("screen.schedule"), !work)}
      {item("records", t("screen.records"), !work)}
      <div className="nav-spacer" />
      {item("works", t("screen.works"))}
      {item("stats", t("screen.stats"))}
      {item("settings", t("screen.settings"))}
    </aside>
  );
}
