// Rust 側（src-tauri/src/lib.rs）のコマンドを呼ぶ薄いラッパー。
// 型は src-tauri/src/store.rs の構造体に対応する。時刻はすべて UNIX 時間のミリ秒。
import { invoke } from "@tauri-apps/api/core";

/** 作品の種類：漫画（cmc）とイラスト（.clip / .psd を束ねたもの） */
export type WorkKind = "comic" | "files";

export type StageSet = { id: number; name: string; unit: string; kind: WorkKind };

export type StageDef = {
  id: number;
  setId: number;
  name: string;
  color: string;
  sortOrder: number;
  hintMinutes: number;
  hidden: boolean;
};

export type WorkSummary = {
  id: number;
  title: string;
  kind: WorkKind;
  /** 漫画の cmc の場所（イラストは null） */
  cmcPath: string | null;
  pageCount: number;
  stageCount: number;
  progress: number;
  totalMs: number;
  lastWorkedAt: number | null;
  /** 登録した場所にファイルが見つからない（イラストはどれか 1 つでも） */
  fileMissing: boolean;
};

export type DisplayPrefs = { timeFormat: "hm" | "clock" | "decimal" };

export type RelinkCheck = { title: string; newPages: number; oldPages: number; matched: number };

export type StageRef = { id: number; name: string; color: string };

export type Cell = { stageId: number; done: boolean; totalMs: number };

export type BoardPage = {
  id: number;
  fileName: string;
  /** ページのファイルの場所 */
  path: string;
  label: string;
  number: number;
  span: number;
  /** cmc から消えたページ（漫画のみ） */
  missing: boolean;
  /** ファイルが今の場所にあるか */
  found: boolean;
  /** 付いているタグの ID（自動の「見開き」も含む） */
  tags: number[];
  cells: Cell[];
};

export type Board = {
  work: { id: number; title: string; kind: WorkKind; cmcPath: string | null; lastSyncedAt: number | null };
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
  sessionId: number;
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

export type Span = { workId: number; startedAt: number; endedAt: number | null; stageName: string };

export type Tag = { id: number; groupId: number; name: string; initialFactor: number; system: boolean; hidden: boolean };

/** タググループを使う作品の種類 */
export type TagApplies = "comic" | "files" | "both";

export type TagGroup = { id: number; name: string; exclusive: boolean; applies: TagApplies; system: boolean; tags: Tag[] };

export type TaskPrediction = {
  pageId: number;
  stageId: number;
  predictedMs: number;
  spentMs: number;
  remainingMs: number;
  done: boolean;
};

export type Prediction = {
  tasks: TaskPrediction[];
  remainingMs: number;
  lowMs: number;
  highMs: number;
  sigma: number;
  stages: { stageId: number; baseMs: number; samples: number; fromHint: boolean }[];
};

export type WorkSchedule = {
  /** 月〜日の作業時間（時間） */
  weekdayHours: number[];
  customHours: boolean;
  defaultWeekdayHours: number[];
  deadline: string | null;
  workOrder: "stage" | "page";
  daysOff: string[];
};

export type PageMerge = { fromPageId: number; fromFileName: string; toPageId: number; toLabel: string; ms: number };
export type PageSplit = { pageId: number; label: string; newPageId: number; newLabel: string; ms: number };

export type SyncResult = { added: number; missing: number; merges: PageMerge[]; splits: PageSplit[] };

export type TimerPrefs = { idleMinutes: number; shortcut: string; watchSaves: boolean };

export const api = {
  listWorks: () => invoke<WorkSummary[]>("list_works"),
  addWork: (cmcPath: string, setId: number) => invoke<number>("add_work", { cmcPath, setId }),
  addFilesWork: (title: string, paths: string[], setId: number) => invoke<number>("add_files_work", { title, paths, setId }),
  addFiles: (workId: number, paths: string[]) => invoke<number>("add_files", { workId, paths }),
  removeFile: (pageId: number) => invoke<void>("remove_file", { pageId }),
  setFileOrder: (workId: number, pageIds: number[]) => invoke<void>("set_file_order", { workId, pageIds }),
  relinkFile: (pageId: number, path: string) => invoke<void>("relink_file", { pageId, path }),
  listStageSets: () => invoke<StageSet[]>("list_stage_sets"),
  removeWork: (workId: number) => invoke<void>("remove_work", { workId }),
  syncWork: (workId: number) => invoke<SyncResult>("sync_work", { workId }),
  getBoard: (workId: number) => invoke<Board>("get_board", { workId }),
  setTaskDone: (pageId: number, stageId: number, done: boolean) =>
    invoke<void>("set_task_done", { pageId, stageId, done }),
  loadThumbnail: (path: string) => invoke<string>("load_thumbnail", { path }),

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
  addStage: (setId: number, name: string, color: string) => invoke<StageDef>("add_stage", { setId, name, color }),
  updateStage: (id: number, name: string, color: string, hintMinutes: number) =>
    invoke<StageDef>("update_stage", { id, name, color, hintMinutes }),
  setStageHidden: (id: number, hidden: boolean) => invoke<void>("set_stage_hidden", { id, hidden }),
  moveStage: (id: number, delta: number) => invoke<void>("move_stage", { id, delta }),

  listTags: () => invoke<TagGroup[]>("list_tags"),
  setPageTag: (pageIds: number[], tagId: number, on: boolean) => invoke<void>("set_page_tag", { pageIds, tagId, on }),
  addTagGroup: (name: string, exclusive: boolean, applies: TagApplies) =>
    invoke<number>("add_tag_group", { name, exclusive, applies }),
  updateTagGroup: (id: number, name: string, exclusive: boolean, applies: TagApplies) =>
    invoke<void>("update_tag_group", { id, name, exclusive, applies }),
  addTag: (groupId: number, name: string, initialFactor: number) =>
    invoke<number>("add_tag", { groupId, name, initialFactor }),
  updateTag: (id: number, name: string, initialFactor: number) => invoke<void>("update_tag", { id, name, initialFactor }),
  setTagHidden: (id: number, hidden: boolean) => invoke<void>("set_tag_hidden", { id, hidden }),

  getPrediction: (workId: number) => invoke<Prediction>("get_prediction", { workId }),
  getSchedule: (workId: number) => invoke<WorkSchedule>("get_schedule", { workId }),
  setWorkHours: (workId: number, hours: number[] | null) => invoke<void>("set_work_hours", { workId, hours }),
  setDefaultHours: (hours: number[]) => invoke<void>("set_default_hours", { hours }),
  setDeadline: (workId: number, deadline: string | null) => invoke<void>("set_deadline", { workId, deadline }),
  setWorkOrder: (workId: number, order: string) => invoke<void>("set_work_order", { workId, order }),
  setDayOff: (date: string, off: boolean) => invoke<void>("set_day_off", { date, off }),
  /** [全作品の既定の作業時間（月〜日）, 休みの日] */
  getCalendar: () => invoke<[number[], string[]]>("get_calendar"),

  stopTimerAt: (at: number) => invoke<StopResult | null>("stop_timer_at", { at }),
  setSessionEnd: (id: number, endedAt: number) => invoke<void>("set_session_end", { id, endedAt }),
  idleMs: () => invoke<number>("idle_ms"),
  pageMtimes: (workId: number) => invoke<[number, number][]>("page_mtimes", { workId }),
  mergePages: (from: number, to: number) => invoke<void>("merge_pages", { from, to }),
  splitPage: (pageId: number, newPageId: number, half: boolean) => invoke<void>("split_page", { pageId, newPageId, half }),
  setStageOrder: (ids: number[]) => invoke<void>("set_stage_order", { ids }),
  getTimerPrefs: () => invoke<TimerPrefs>("get_timer_prefs"),
  setTimerPrefs: (prefs: TimerPrefs) => invoke<void>("set_timer_prefs", { prefs }),
  openMini: () => invoke<void>("open_mini"),
  closeMini: () => invoke<void>("close_mini"),
  setMiniCompact: (compact: boolean) => invoke<void>("set_mini_compact", { compact }),
  setMiniOnTop: (onTop: boolean) => invoke<void>("set_mini_on_top", { onTop }),
  focusMain: () => invoke<void>("focus_main"),

  dataInfo: () => invoke<{ dbPath: string; version: string }>("data_info"),
  backupData: (dest: string) => invoke<void>("backup_data", { dest }),
  revealData: () => invoke<void>("reveal_data"),
  checkRelink: (workId: number, cmcPath: string) => invoke<RelinkCheck>("check_relink", { workId, cmcPath }),
  relinkWork: (workId: number, cmcPath: string) => invoke<SyncResult>("relink_work", { workId, cmcPath }),
  getDisplayPrefs: () => invoke<DisplayPrefs>("get_display_prefs"),
  setDisplayPrefs: (prefs: DisplayPrefs) => invoke<void>("set_display_prefs", { prefs }),
};

/** 作品の種類ごとの言葉 */
export const UNIT: Record<WorkKind, { row: string; count: string }> = {
  comic: { row: "ページ", count: "ページ" },
  files: { row: "ファイル", count: "枚" },
};
