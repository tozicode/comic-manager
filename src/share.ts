// 進捗を共有する画像（仕様書 5.20）に載せる中身を、ボードと今日の作業記録から計算する。描くのは share-draw.ts
import type { Board, StageRef } from "./api";
import { dayLabel, hours } from "./format";
import { kindKey, unitText } from "./i18n/common";
import { t } from "./i18n/share";
import type { ShareInfo } from "./share-draw";

/** マスの状態：これまでに終えた／今日終えた／今日手を付けたが終わっていない／未着手 */
export type CellState = "before" | "today" | "touched" | "open";

export type ShareData = {
  stages: StageRef[];
  /** 行（ページ・ファイル）ごとのマス。消えたページは除く */
  rows: CellState[][];
  /** 行の幅（見開きは 2）と名前（p1 など）。rows と同じ並び */
  spans: number[];
  labels: string[];
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
    spans: pages.map((p) => p.span),
    labels: pages.map((p) => p.label),
    doneToday: board.stages.map((stage, i) => ({ stage, count: counts[i] })).filter((d) => d.count > 0),
    progress: total > 0 ? done / total : 0,
    todayProgress: total > 0 ? today / total : 0,
  };
}

export const HASHTAG = "#Otosazu";

/**
 * X に投稿するときの文面。「今日は 3時間25分 作業して、下書きを 1 ページ、ペン入れを 3 ページ進めました。」に、
 * 全体の進み具合と完成見込みを添える。隠した項目（info で null）は文面にも入れない
 */
export function postText(data: ShareData, info: ShareInfo): string {
  const items = data.doneToday.map((d) =>
    t(kindKey(info.row.kind, "postItem"), { stage: d.stage.name, n: d.count, unit: unitText(info.row, d.count) }),
  );
  const list = items.join(t("postSep"));
  const worked = info.workedMs !== null && info.workedMs > 0 ? hours(info.workedMs) : null;
  const sentences = [
    worked && list
      ? t("postWorkedDone", { time: worked, list })
      : worked
        ? t("postWorked", { time: worked })
        : list
          ? t("postDone", { list })
          : "",
    info.completed ? t("postCompleted") : t("postProgress", { p: Math.round(data.progress * 100) }),
    !info.completed && info.finish ? t("postFinish", { date: dayLabel(info.finish) }) : "",
  ].filter(Boolean);
  const head = info.title ? t("postTitle", { title: info.title }) : "";
  return `${head}${sentences.join(t("postJoin"))} ${HASHTAG}`;
}
