// 進捗を共有する画像（仕様書 5.20）を Canvas に描く。中身の計算は share.ts
import type { RowKind, WorkKind } from "./api";
import { LOGO_TEXT_PATH, LOGO_VIEWBOX } from "./components/Logo";
import { dayLabel, estimate, hours } from "./format";
import { kindKey, unitText } from "./i18n/common";
import { t } from "./i18n/share";
import { gridLayout, ShareData } from "./share";

export const SHARE_W = 1200;
export const SHARE_H = 675;

// ロゴの明るい背景の色（docs/brand/README.md）。アプリのライト／ダークによらずこの色で描く
const BG = "#fbf1ec";
const INK = "#3a2a25";
const MUTED = "#8a6f66";
const ACCENT = "#c8553d";
const TRACK = "#e8b9ac";
const EMPTY = "#efe3dd";

export type ShareInfo = {
  /** 隠すときは null */
  title: string | null;
  today: Date;
  /** 今日の作業時間。隠すときは null */
  workedMs: number | null;
  quotaMs: number;
  quotaMet: boolean;
  /** 完成見込み。隠すとき・見込みが無いときは null */
  finish: Date | null;
  completed: boolean;
  row: RowKind & { kind: WorkKind };
};

export function drawShare(canvas: HTMLCanvasElement, data: ShareData, info: ShareInfo) {
  canvas.width = SHARE_W;
  canvas.height = SHARE_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const family = getComputedStyle(document.body).fontFamily || "sans-serif";
  const font = (size: number, weight = 400) => `${weight} ${size}px ${family}`;
  const text = (s: string, x: number, y: number, size: number, color = INK, weight = 400, maxWidth = 420) => {
    ctx.font = font(size, weight);
    ctx.fillStyle = color;
    ctx.fillText(fit(ctx, s, maxWidth), x, y);
  };

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, SHARE_W, SHARE_H);
  ctx.textBaseline = "alphabetic";

  // ---- 左：今日の作業と全体の進み具合 ----
  const L = 72;
  let y = 104;
  if (info.title) {
    text(info.title, L, y, 30, INK, 800);
    y += 40;
  }
  text(t("dayWork", { date: dayLabel(info.today) }), L, y, 22, MUTED);
  y += 96;
  const pct = (p: number) => Math.round(p * 100);
  const showTime = info.workedMs !== null && info.workedMs > 0;
  if (showTime) {
    text(hours(info.workedMs!), L, y, 76, INK, 800);
    y += 46;
    if (info.quotaMs > 0) {
      const q = estimate(info.quotaMs);
      text(info.quotaMet ? t("quotaMet", { time: q }) : t("quota", { time: q }), L, y, 24, info.quotaMet ? ACCENT : MUTED, 800);
      y += 34;
    }
  } else {
    text(`${pct(data.progress)}%`, L, y, 76, INK, 800);
    y += 46;
    ctx.font = font(24, 800);
    const label = t("progressBig");
    text(label, L, y, 24, MUTED, 800);
    if (data.todayProgress > 0) {
      text(t("todayGain", { p: Math.max(1, pct(data.todayProgress)) }), L + ctx.measureText(label).width + 4, y, 22, ACCENT, 800);
    }
    y += 34;
  }
  y += 18;
  for (const d of data.doneToday.slice(0, 4)) {
    const key = kindKey(info.row.kind, "done");
    text(t(key, { stage: d.stage.name, n: d.count, unit: unitText(info.row, d.count) }), L, y, 22, INK, 400);
    y += 34;
  }
  // 下端：全体の進み具合と完成見込み
  let by = SHARE_H - 72;
  if (info.completed) {
    text(t("completed"), L, by, 24, ACCENT, 800);
  } else {
    if (info.finish) {
      text(t("finish", { date: dayLabel(info.finish) }), L, by, 22, MUTED);
      by -= 36;
    }
    if (showTime) {
      ctx.font = font(26, 800);
      const head = t("progress", { p: pct(data.progress) });
      text(head, L, by, 26, INK, 800);
      if (data.todayProgress > 0) {
        text(t("todayGain", { p: Math.max(1, pct(data.todayProgress)) }), L + ctx.measureText(head).width + 4, by, 22, ACCENT, 800);
      }
    }
  }

  // ---- 右：ページ × 工程のマス ----
  const area = { x: 540, y: 96, w: SHARE_W - 540 - 72, h: SHARE_H - 96 - 170 };
  const labelW = 110;
  const S = Math.max(data.stages.length, 1);
  const n = Math.max(data.rows.length, 1);
  const g = gridLayout(n, S, area.w - labelW, area.h);
  const cell = Math.min(g.cell, 44);
  const gap = Math.max(1, Math.round(cell * 0.14));
  const bandH = S * cell;
  const gridH = g.bands * bandH + (g.bands - 1) * cell * 0.8;
  const gx = area.x + labelW;
  const gy = area.y + (area.h - gridH) / 2;
  const labelSize = Math.min(18, Math.max(11, cell * 0.6));
  for (let b = 0; b < g.bands; b++) {
    const top = gy + b * (bandH + cell * 0.8);
    data.stages.forEach((stage, si) => {
      const cy = top + si * cell;
      ctx.font = font(labelSize, 400);
      ctx.fillStyle = MUTED;
      ctx.textBaseline = "middle";
      ctx.fillText(fit(ctx, stage.name, labelW - 12), area.x, cy + cell / 2);
      ctx.textBaseline = "alphabetic";
      for (let c = 0; c < g.cols; c++) {
        const r = b * g.cols + c;
        if (r >= data.rows.length) break;
        const state = data.rows[r][si];
        const x = gx + c * cell;
        drawCell(ctx, x + gap / 2, cy + gap / 2, cell - gap, state, stage.color);
      }
    });
  }

  // 凡例
  const ly = SHARE_H - 72;
  const legendColor = data.stages[data.stages.length - 1]?.color ?? ACCENT;
  let lx = area.x;
  for (const [state, label] of [
    ["before", t("legendBefore")],
    ["today", t("legendToday")],
    ["touched", t("legendTouched")],
  ] as const) {
    drawCell(ctx, lx, ly - 15, 18, state, legendColor);
    ctx.font = font(18);
    ctx.fillStyle = MUTED;
    ctx.fillText(label, lx + 26, ly);
    lx += 26 + ctx.measureText(label).width + 28;
  }

  drawLogo(ctx, SHARE_W - 72, SHARE_H - 52, 40);
}

function drawCell(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, state: string, color: string) {
  const r = Math.min(4, size / 5);
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, size, size, r);
  if (state === "touched") {
    const w = Math.max(2, size / 9);
    ctx.fillStyle = EMPTY;
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(x + w / 2, y + w / 2, size - w, size - w, r);
    ctx.lineWidth = w;
    ctx.strokeStyle = color;
    ctx.stroke();
  } else {
    if (state === "before") {
      ctx.fillStyle = BG;
      ctx.fill();
      ctx.globalAlpha = 0.35;
    }
    ctx.fillStyle = state === "open" ? EMPTY : color;
    ctx.fill();
  }
  ctx.restore();
}

/** ロゴを右下（right, bottom）に合わせて高さ h で描く */
function drawLogo(ctx: CanvasRenderingContext2D, right: number, bottom: number, h: number) {
  const [vx, vy, vw, vh] = LOGO_VIEWBOX;
  const k = h / vh;
  ctx.save();
  ctx.translate(right - vw * k, bottom - h);
  ctx.scale(k, k);
  ctx.translate(-vx, -vy);
  ctx.lineCap = "round";
  ctx.lineWidth = 10;
  ctx.strokeStyle = TRACK;
  ctx.beginPath();
  ctx.arc(50, 54, 22, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = ACCENT;
  ctx.beginPath();
  ctx.arc(50, 54, 22, -Math.PI / 2, Math.PI);
  ctx.stroke();
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(47, 20);
  ctx.lineTo(53, 20);
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.arc(50, 54, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fill(new Path2D(LOGO_TEXT_PATH));
  ctx.restore();
}

/** 幅に収まらなければ末尾を … にする */
function fit(ctx: CanvasRenderingContext2D, s: string, maxWidth: number): string {
  if (ctx.measureText(s).width <= maxWidth) return s;
  let out = s;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) out = out.slice(0, -1);
  return `${out}…`;
}
