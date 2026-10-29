// 進捗を共有する画像（仕様書 5.20）に載せる中身を、ボードと今日の作業記録から計算する。描くのは share-draw.ts
import type { Board, StageRef } from "./api";

/** マスの状態：これまでに終えた／今日終えた／今日手を付けたが終わっていない／未着手 */
export type CellState = "before" | "today" | "touched" | "open";

export type ShareData = {
  stages: StageRef[];
  /** 行（ページ・ファイル）ごとのマス。消えたページは除く */
  rows: CellState[][];
  /** 工程ごとに今日終えた数（見開きは 2 ページ分）。0 の工程は入れない */
  doneToday: { stage: StageRef; count: number }[];
  /** 全体の進み具合（0〜1。作品一覧と同じく完了したタスクの数で数える） */
  progress: number;
  /** そのうち今日完了にしたぶん */
  todayProgress: number;
};

/** 作業記録のうち、ここで使うところ */
export type SessionLike = { pageId: number; stageId: number; startedAt: number; endedAt: number | null };

/** dayStart は今日が始まる時刻（1 日の区切りに沿ったもの） */
export function shareData(board: Board, sessions: SessionLike[], dayStart: number): ShareData {
  const pages = board.pages.filter((p) => !p.missing);
  const touched = new Set(
    sessions.filter((s) => (s.endedAt ?? Infinity) > dayStart).map((s) => `${s.pageId}:${s.stageId}`),
  );
  const counts = board.stages.map(() => 0);
  let total = 0;
  let done = 0;
  let today = 0;
  const rows = pages.map((page) =>
    page.cells.map((cell, i): CellState => {
      total += page.span;
      if (cell.done) {
        done += page.span;
        if ((cell.doneAt ?? 0) >= dayStart) {
          today += page.span;
          counts[i] += page.span;
          return "today";
        }
        return "before";
      }
      return touched.has(`${page.id}:${cell.stageId}`) ? "touched" : "open";
    }),
  );
  return {
    stages: board.stages,
    rows,
    doneToday: board.stages.map((stage, i) => ({ stage, count: counts[i] })).filter((d) => d.count > 0),
    progress: total > 0 ? done / total : 0,
    todayProgress: total > 0 ? today / total : 0,
  };
}

export type GridLayout = { bands: number; cols: number; cell: number };

/**
 * マスの並べ方。行（ページ）を横に並べ、入りきらなければ段に折り返す。マスがいちばん大きくなる段数を選ぶ。
 * 1 段は工程の数だけの高さで、段と段の間は gapCells マス分あける
 */
export function gridLayout(rows: number, stages: number, width: number, height: number, gapCells = 0.8): GridLayout {
  let best: GridLayout = { bands: 1, cols: Math.max(rows, 1), cell: 0 };
  for (let bands = 1; bands <= Math.max(rows, 1); bands++) {
    const cols = Math.ceil(Math.max(rows, 1) / bands);
    const cell = Math.min(width / cols, height / (bands * stages + (bands - 1) * gapCells));
    if (cell > best.cell) best = { bands, cols, cell };
  }
  return best;
}
