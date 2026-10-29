// 進捗を共有する画像（仕様書 5.20）を Canvas に描く。中身の計算は share.ts
import type { RowKind, WorkKind } from "./api";
import { LOGO_TEXT_PATH, LOGO_VIEWBOX } from "./components/Logo";
import { dayLabel, estimate, hours } from "./format";
import { kindKey, unitText } from "./i18n/common";
import { t } from "./i18n/share";
import type { ShareData } from "./share";

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
  const text = (s: string, x: number, y: number, size: number, color = INK, weight = 400, maxWidth = 520) => {
    ctx.font = font(size, weight);
    ctx.fillStyle = color;
    const out = fit(ctx, s, maxWidth);
    ctx.fillText(out, x, y);
    return ctx.measureText(out).width;
  };

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, SHARE_W, SHARE_H);
  ctx.textBaseline = "alphabetic";
  const L = 72;
  const R = SHARE_W - 72;
  const pct = (p: number) => Math.round(p * 100);

  // ---- 上：左に今日の作業、右に全体の進み具合（数字は横に並べる） ----
  let leftW = 0;
  let y = 104;
  if (info.title) {
    leftW = Math.max(leftW, text(info.title, L, y, 30, INK, 800));
    y += 38;
  }
  leftW = Math.max(leftW, text(t("dayWork", { date: dayLabel(info.today) }), L, y, 22, MUTED));
  const showTime = info.workedMs !== null && info.workedMs > 0;
  if (showTime) {
    leftW = Math.max(leftW, text(hours(info.workedMs!), L, 232, 76, INK, 800));
    if (info.quotaMs > 0) {
      const q = estimate(info.quotaMs);
      const label = info.quotaMet ? t("quotaMet", { time: q }) : t("quota", { time: q });
      leftW = Math.max(leftW, text(label, L, 272, 24, info.quotaMet ? ACCENT : MUTED, 800));
    }
  }

  // 右端：全体の進み具合（今日の伸び）と完成見込み
  ctx.textAlign = "right";
  text(t("progressBig"), R, 150, 22, MUTED);
  ctx.font = font(76, 800);
  const big = `${pct(data.progress)}%`;
  text(big, R, 232, 76, INK, 800);
  const rightW = Math.max(ctx.measureText(big).width, 160);
  if (data.todayProgress > 0) text(t("todayGain", { p: Math.max(1, pct(data.todayProgress)) }).trim(), R, 272, 22, ACCENT, 800);
  if (info.completed) text(t("completed"), R, 306, 22, ACCENT, 800);
  else if (info.finish) text(t("finish", { date: dayLabel(info.finish) }), R, 306, 22, MUTED);
  ctx.textAlign = "left";

  // 真ん中：工程ごとに今日終えた数（下を揃える）
  const listX = L + Math.min(leftW, 520) + 56;
  const listW = R - rightW - 48 - listX;
  const items = data.doneToday.slice(0, 4);
  items.forEach((d, i) => {
    const key = kindKey(info.row.kind, "done");
    const line = t(key, { stage: d.stage.name, n: d.count, unit: unitText(info.row, d.count) });
    text(line, listX, 272 - (items.length - 1 - i) * 34, 22, INK, 400, listW);
  });

  // ---- 下：ページ × 工程のマス。必ず 1 段で、幅いっぱいに並べる ----
  const labelW = 120;
  const barX = L + labelW;
  const barW = R - barX;
  const top = 350;
  const bottom = SHARE_H - 132;
  const S = Math.max(data.stages.length, 1);
  const rowGap = 6;
  const rowH = Math.min(56, (bottom - top - (S - 1) * rowGap) / S);
  const gridTop = top + (bottom - top - (S * rowH + (S - 1) * rowGap)) / 2;
  // 見開きは 2 ページ分の幅にする
  const units = data.spans.reduce((n, s) => n + s, 0) || 1;
  const unitW = barW / units;
  const gap = Math.min(3, unitW * 0.18);
  const xs: number[] = [];
  data.spans.reduce((x, s) => (xs.push(x), x + s * unitW), barX);
  data.stages.forEach((stage, si) => {
    const cy = gridTop + si * (rowH + rowGap);
    ctx.font = font(18);
    ctx.fillStyle = MUTED;
    ctx.textBaseline = "middle";
    ctx.fillText(fit(ctx, stage.name, labelW - 14), L, cy + rowH / 2);
    ctx.textBaseline = "alphabetic";
    data.rows.forEach((cells, r) => {
      drawCell(ctx, xs[r] + gap / 2, cy, data.spans[r] * unitW - gap, rowH, cells[si], stage.color);
    });
  });
  // ページの目印：最初・真ん中・最後
  if (data.labels.length > 0) {
    const tickY = gridTop + S * rowH + (S - 1) * rowGap + 24;
    ctx.font = font(16);
    ctx.fillStyle = MUTED;
    const marks = [...new Set([0, Math.floor((data.labels.length - 1) / 2), data.labels.length - 1])];
    marks.forEach((r, i) => {
      ctx.textAlign = i === 0 ? "left" : r === data.labels.length - 1 ? "right" : "center";
      const x = ctx.textAlign === "left" ? xs[r] : ctx.textAlign === "right" ? xs[r] + data.spans[r] * unitW : xs[r] + (data.spans[r] * unitW) / 2;
      ctx.fillText(data.labels[r], x, tickY);
    });
    ctx.textAlign = "left";
  }

  // 凡例とロゴ
  const ly = SHARE_H - 56;
  const legendColor = data.stages[data.stages.length - 1]?.color ?? ACCENT;
  let lx = L;
  for (const [state, label] of [
    ["before", t("legendBefore")],
    ["today", t("legendToday")],
    ["touched", t("legendTouched")],
  ] as const) {
    drawCell(ctx, lx, ly - 15, 18, 18, state, legendColor);
    ctx.font = font(18);
    ctx.fillStyle = MUTED;
    ctx.fillText(label, lx + 26, ly);
    lx += 26 + ctx.measureText(label).width + 28;
  }
  drawLogo(ctx, R, SHARE_H - 44, 36);
}

function drawCell(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, state: string, color: string) {
  const r = Math.min(4, w / 4, h / 4);
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  if (state === "touched") {
    // 細い棒でも見えるよう、枠の太さは棒の幅に合わせる
    const lw = Math.max(1.5, Math.min(3, w / 4));
    ctx.fillStyle = EMPTY;
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(x + lw / 2, y + lw / 2, w - lw, h - lw, r);
    ctx.lineWidth = lw;
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
