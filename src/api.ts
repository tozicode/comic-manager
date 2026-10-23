// Rust 側（src-tauri/src/lib.rs）のコマンドを呼ぶ薄いラッパー。
// 型は src-tauri/src/store.rs の構造体に対応する。時刻はすべて UNIX 時間のミリ秒。
import { invoke } from "@tauri-apps/api/core";

export type StageDef = {
  id: number;
  name: string;
  color: string;
  sortOrder: number;
  hintMinutes: number;
  hidden: boolean;
};

export type WorkSummary = {
  id: number;
  title: string;
  cmcPath: string;
  pageCount: number;
  stageCount: number;
  progress: number;
  totalMs: number;
  lastWorkedAt: number | null;
};

export type StageRef = { id: number; name: string; color: string };

export type Cell = { stageId: number; done: boolean; totalMs: number };

export type BoardPage = {
  id: number;
  fileName: string;
  label: string;
  number: number;
  span: number;
  missing: boolean;
  cells: Cell[];
};

export type Board = {
  work: { id: number; title: string; cmcPath: string; lastSyncedAt: number | null };
  stages: StageRef[];
  pages: BoardPage[];
};

export type ActiveSession = {
  id: number;
  workId: number;
  workTitle: string;
  pageId: number;
  pageLabel: string;
  stageId: number;
  stageName: string;
  stageColor: string;
  startedAt: number;
};

export type StopResult = {
  pageId: number;
  pageLabel: string;
  stageId: number;
  stageName: string;
  durationMs: number;
  totalMs: number;
  alreadyDone: boolean;
};

export type SessionRow = {
  id: number;
  pageId: number;
  pageLabel: string;
  stageId: number;
  stageName: string;
  stageColor: string;
  startedAt: number;
  endedAt: number | null;
  edited: boolean;
};

export type Span = { startedAt: number; endedAt: number | null; stageName: string };

export type SyncResult = { added: number; missing: number };

export const api = {
  listWorks: () => invoke<WorkSummary[]>("list_works"),
  addWork: (cmcPath: string) => invoke<number>("add_work", { cmcPath }),
  removeWork: (workId: number) => invoke<void>("remove_work", { workId }),
  syncWork: (workId: number) => invoke<SyncResult>("sync_work", { workId }),
  getBoard: (workId: number) => invoke<Board>("get_board", { workId }),
  setTaskDone: (pageId: number, stageId: number, done: boolean) =>
    invoke<void>("set_task_done", { pageId, stageId, done }),
  loadThumbnail: (cmcPath: string, fileName: string) => invoke<string>("load_thumbnail", { cmcPath, fileName }),

  getActiveSession: () => invoke<ActiveSession | null>("get_active_session"),
  startTimer: (pageId: number, stageId: number) => invoke<ActiveSession>("start_timer", { pageId, stageId }),
  stopTimer: () => invoke<StopResult | null>("stop_timer"),

  listSessions: (workId: number, from: number) => invoke<SessionRow[]>("list_sessions", { workId, from }),
  listSpans: (from: number) => invoke<Span[]>("list_spans", { from }),
  addSession: (pageId: number, stageId: number, startedAt: number, endedAt: number) =>
    invoke<void>("add_session", { pageId, stageId, startedAt, endedAt }),
  updateSession: (id: number, pageId: number, stageId: number, startedAt: number, endedAt: number | null) =>
    invoke<void>("update_session", { id, pageId, stageId, startedAt, endedAt }),
  deleteSession: (id: number) => invoke<void>("delete_session", { id }),

  listStages: () => invoke<StageDef[]>("list_stages"),
  addStage: (name: string, color: string) => invoke<StageDef>("add_stage", { name, color }),
  updateStage: (id: number, name: string, color: string, hintMinutes: number) =>
    invoke<StageDef>("update_stage", { id, name, color, hintMinutes }),
  setStageHidden: (id: number, hidden: boolean) => invoke<void>("set_stage_hidden", { id, hidden }),
  moveStage: (id: number, delta: number) => invoke<void>("move_stage", { id, delta }),
};
