import { DragEvent, useEffect, useRef, useState } from "react";
import { askNotificationPermission } from "../components/Pomodoro";
import { api, DisplayPrefs, StageDef, StageSet, Tag, TagApplies, TagGroup, TimerPrefs } from "../api";
import { useApp } from "../app-context";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { dayKey, dayLabel, estimate, hours, startOfDay, TimeFormat, weekdayName } from "../format";
import type { ThemePref } from "../theme";
import { LANG_NAMES, LANGS, LangPref } from "../i18n";
import { t } from "../i18n/settings";

type Section = "stages" | "tags" | "hours" | "timer" | "display" | "data" | "about";
const SECTIONS: Section[] = ["stages", "tags", "hours", "timer", "display", "data", "about"];

const BOOTH_URL = "https://tozicode.booth.pm/items/8867379";
const X_ACCOUNT = "tozicode";

/** 新しい工程に順番に割り当てる色 */
const PALETTE = ["#9a7fb8", "#d0913a", "#3f8f8f", "#b85b8a", "#6b6b6b"];

type Run = (f: () => Promise<unknown>) => Promise<void>;

/** 保存して再読み込みする。失敗したらエラーを出す */
function useRun(): Run {
  const app = useApp();
  return async (f) => {
    try {
      await f();
      app.refresh();
    } catch (e) {
      app.showError(e);
    }
  };
}

export function SettingsScreen() {
  const [section, setSection] = useState<Section>("stages");
  return (
    <div className="settings">
      <nav className="snav">
        {SECTIONS.map((s) => (
          <button key={s} className={section === s ? "on" : ""} onClick={() => setSection(s)}>
            {t(`nav.${s}`)}
          </button>
        ))}
      </nav>
      <div>
        {section === "stages" ? (
          <StagesSection />
        ) : section === "tags" ? (
          <TagsSection />
        ) : section === "hours" ? (
          <HoursSection />
        ) : section === "timer" ? (
          <TimerSection />
        ) : section === "display" ? (
          <DisplaySection />
        ) : section === "data" ? (
          <DataSection />
        ) : (
          <AboutSection />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 工程
// ---------------------------------------------------------------------------

function StagesSection() {
  const app = useApp();
  const run = useRun();
  const [allStages, setAllStages] = useState<StageDef[]>([]);
  const [sets, setSets] = useState<StageSet[]>([]);
  const [setId, setSetId] = useState<number | null>(null);
  const [newName, setNewName] = useState("");
  /** ドラッグ中の並び（離したら保存する） */
  const [dragOrder, setDragOrder] = useState<StageDef[] | null>(null);
  const dragging = useRef<number | null>(null);

  useEffect(() => {
    api.listStages().then(setAllStages).catch(app.showError);
    api
      .listStageSets()
      .then((list) => {
        setSets(list);
        setSetId((cur) => cur ?? list[0]?.id ?? null);
      })
      .catch(app.showError);
  }, [app.version, app.showError]);

  // 工程はセット（漫画・イラスト）ごとに並べ替え・追加する
  const stages = allStages.filter((st) => st.setId === setId);
  const kind = sets.find((st) => st.id === setId)?.kind ?? "comic";
  const unit = t(kind === "files" ? "stage.minPerFile" : "stage.minPerPage");
  const list = dragOrder ?? stages;
  const onDragOver = (e: DragEvent, overId: number) => {
    const id = dragging.current;
    if (id === null || id === overId) return;
    e.preventDefault();
    const from = list.findIndex((s) => s.id === id);
    const to = list.findIndex((s) => s.id === overId);
    const next = [...list];
    next.splice(to, 0, next.splice(from, 1)[0]);
    setDragOrder(next);
  };
  const onDragEnd = () => {
    const order = dragOrder;
    dragging.current = null;
    setDragOrder(null);
    if (order && order.some((s, i) => s.id !== stages[i]?.id)) {
      run(() => api.setStageOrder(order.map((s) => s.id)));
    }
  };

  const add = async () => {
    if (!newName.trim() || setId === null) return;
    await run(() => api.addStage(setId, newName, PALETTE[stages.length % PALETTE.length]));
    setNewName("");
  };

  return (
    <>
      <div className="row" style={{ marginBottom: 8 }}>
        <div className="section-title" style={{ margin: 0 }}>
          {t("stages.title")}
        </div>
        <span className="muted small-text">{t("stages.note")}</span>
      </div>
      <div className="seg" style={{ marginBottom: 10 }}>
        {sets.map((st) => (
          <button key={st.id} className={st.id === setId ? "on" : ""} onClick={() => setSetId(st.id)}>
            {t(st.kind === "files" ? "set.files" : "set.comic")}
          </button>
        ))}
      </div>
      <div className="slist">
        {list.map((s, i) => (
          <StageRow
            key={`${s.id}-${s.name}-${s.color}-${s.hintMinutes}`}
            stage={s}
            first={i === 0}
            last={i === list.length - 1}
            dragging={dragOrder !== null && dragging.current === s.id}
            onDragStart={() => (dragging.current = s.id)}
            onDragOver={(e) => onDragOver(e, s.id)}
            onDragEnd={onDragEnd}
            unit={unit}
            onSave={(name, color, hint) => run(() => api.updateStage(s.id, name, color, hint))}
            onMove={(delta) => run(() => api.moveStage(s.id, delta))}
            onHidden={(hidden) => run(() => api.setStageHidden(s.id, hidden))}
          />
        ))}
        <div className="row">
          <input
            className="field"
            placeholder={t(kind === "files" ? "stages.placeholderFiles" : "stages.placeholderComic")}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            style={{ width: 320 }}
          />
          <button className="btn" onClick={add} disabled={!newName.trim()}>
            {t("stages.add")}
          </button>
        </div>
      </div>
      <p className="muted small-text">{t("stages.footer")}</p>
    </>
  );
}

type RowProps = {
  stage: StageDef;
  /** 目安の単位の表示（分 / ページ・分 / 枚） */
  unit: string;
  first: boolean;
  last: boolean;
  dragging: boolean;
  onDragStart: () => void;
  onDragOver: (e: DragEvent) => void;
  onDragEnd: () => void;
  onSave: (name: string, color: string, hintMinutes: number) => void;
  onMove: (delta: number) => void;
  onHidden: (hidden: boolean) => void;
};

function StageRow({ stage, unit, first, last, dragging, onDragStart, onDragOver, onDragEnd, onSave, onMove, onHidden }: RowProps) {
  const card = useRef<HTMLDivElement>(null);
  const [name, setName] = useState(stage.name);
  const [hint, setHint] = useState(String(stage.hintMinutes));

  const save = (color = stage.color) => {
    const minutes = Number(hint);
    if (name.trim() === stage.name && color === stage.color && minutes === stage.hintMinutes) return;
    onSave(name, color, Number.isFinite(minutes) ? Math.round(minutes) : stage.hintMinutes);
  };

  return (
    <div
      ref={card}
      className={`card sitem${stage.hidden ? " archived" : ""}${dragging ? " dragging" : ""}`}
      onDragOver={onDragOver}
      onDrop={(e) => e.preventDefault()}
    >
      <span
        className="handle"
        draggable
        title={t("stage.drag")}
        onDragStart={(e) => {
          if (card.current) e.dataTransfer.setDragImage(card.current, 20, 20);
          e.dataTransfer.effectAllowed = "move";
          onDragStart();
        }}
        onDragEnd={onDragEnd}
      >
        ⋮⋮
      </span>
      <div className="move">
        <button className="mini" title={t("stage.up")} disabled={first} onClick={() => onMove(-1)}>
          ▲
        </button>
        <button className="mini" title={t("stage.down")} disabled={last} onClick={() => onMove(1)}>
          ▼
        </button>
      </div>
      <input
        type="color"
        className="swatch"
        value={stage.color}
        title={t("stage.color")}
        onChange={(e) => save(e.target.value)}
      />
      <input
        className="field"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => save()}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
      <label className="muted small-text row tight">
        {t("stage.hint")}
        <input
          className="field num"
          type="number"
          min={1}
          step={5}
          value={hint}
          onChange={(e) => setHint(e.target.value)}
          onBlur={() => save()}
          style={{ width: 70 }}
        />
        {unit}
      </label>
      <button className="btn small" onClick={() => onHidden(!stage.hidden)}>
        {stage.hidden ? t("show") : t("hide")}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// タグ
// ---------------------------------------------------------------------------

function TagsSection() {
  const app = useApp();
  const run = useRun();
  const [groups, setGroups] = useState<TagGroup[]>([]);
  const [newGroup, setNewGroup] = useState("");

  useEffect(() => {
    api.listTags().then(setGroups).catch(app.showError);
  }, [app.version, app.showError]);

  const addGroup = () => {
    if (!newGroup.trim()) return;
    run(() => api.addTagGroup(newGroup, false, "both"));
    setNewGroup("");
  };

  return (
    <>
      <div className="row" style={{ marginBottom: 8 }}>
        <div className="section-title" style={{ margin: 0 }}>
          {t("tags.title")}
        </div>
        <span className="muted small-text">{t("tags.note")}</span>
      </div>
      {groups.map((g) => (
        <GroupCard key={`${g.id}-${g.name}-${g.exclusive}-${g.applies}`} group={g} run={run} />
      ))}
      <div className="row">
        <input
          className="field"
          placeholder={t("tags.groupPlaceholder")}
          value={newGroup}
          onChange={(e) => setNewGroup(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addGroup()}
          style={{ width: 320 }}
        />
        <button className="btn" disabled={!newGroup.trim()} onClick={addGroup}>
          {t("tags.addGroup")}
        </button>
      </div>
      <p className="muted small-text">{t("tags.footer")}</p>
    </>
  );
}

function GroupCard({ group, run }: { group: TagGroup; run: Run }) {
  const [name, setName] = useState(group.name);
  const [newTag, setNewTag] = useState("");
  const addTag = () => {
    if (!newTag.trim()) return;
    run(() => api.addTag(group.id, newTag, 1.0));
    setNewTag("");
  };
  return (
    <div className="card tgroup">
      <div className="thead">
        {group.system ? (
          <b>
            {group.name} <span className="tag sys">{t("tags.clipLinked")}</span>
          </b>
        ) : (
          <div className="row">
            <input
              className="field group-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() =>
                name.trim() !== group.name && run(() => api.updateTagGroup(group.id, name, group.exclusive, group.applies))
              }
            />
            <label className="small-text row tight">
              <input
                type="checkbox"
                checked={group.exclusive}
                onChange={(e) => run(() => api.updateTagGroup(group.id, group.name, e.target.checked, group.applies))}
              />
              {t("tags.exclusive")}
            </label>
            <select
              className="field small-text"
              title={t("tags.appliesTitle")}
              value={group.applies}
              onChange={(e) => run(() => api.updateTagGroup(group.id, group.name, group.exclusive, e.target.value as TagApplies))}
            >
              <option value="both">{t("tags.appliesBoth")}</option>
              <option value="comic">{t("tags.appliesComic")}</option>
              <option value="files">{t("tags.appliesFiles")}</option>
            </select>
          </div>
        )}
      </div>
      <div className="tlist">
        {group.tags.map((t) => (
          <TagRow key={`${t.id}-${t.name}-${t.initialFactor}`} tag={t} run={run} />
        ))}
      </div>
      {!group.system && (
        <div className="row tight" style={{ marginTop: 8 }}>
          <input
            className="field"
            placeholder={t("tags.tagPlaceholder")}
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addTag()}
          />
          <button className="btn small" disabled={!newTag.trim()} onClick={addTag}>
            {t("tags.addTag")}
          </button>
        </div>
      )}
    </div>
  );
}

function TagRow({ tag, run }: { tag: Tag; run: Run }) {
  const [name, setName] = useState(tag.name);
  const [factor, setFactor] = useState(String(tag.initialFactor));
  const save = () => {
    const f = Number(factor);
    if (name.trim() === tag.name && f === tag.initialFactor) return;
    run(() => api.updateTag(tag.id, name, Number.isFinite(f) ? f : tag.initialFactor));
  };
  return (
    <div className={`titem${tag.hidden ? " archived" : ""}`}>
      {tag.system ? (
        <span className="tname">{tag.name}</span>
      ) : (
        <input className="field tname" value={name} onChange={(e) => setName(e.target.value)} onBlur={save} />
      )}
      <label className="muted small-text row tight">
        {t("tags.factor")}
        <input
          className="field num"
          type="number"
          min={0.1}
          max={10}
          step={0.1}
          value={factor}
          onChange={(e) => setFactor(e.target.value)}
          onBlur={save}
          style={{ width: 70 }}
        />
      </label>
      <button className="btn small ghost" onClick={() => run(() => api.setTagHidden(tag.id, !tag.hidden))}>
        {tag.hidden ? t("show") : t("hide")}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 作業時間・休み
// ---------------------------------------------------------------------------

function HoursSection() {
  const app = useApp();
  const run = useRun();
  const [hours, setHours] = useState<number[] | null>(null);
  const [daysOff, setDaysOff] = useState<string[]>([]);
  const [newDay, setNewDay] = useState("");
  const [dayStart, setDayStart] = useState<number | null>(null);

  useEffect(() => {
    api.getDayStartHour().then(setDayStart).catch(app.showError);
    api
      .getCalendar()
      .then(([h, d]) => {
        setHours(h);
        setDaysOff(d);
      })
      .catch(app.showError);
  }, [app.version, app.showError]);

  if (!hours) return <p className="muted">{t("loading")}</p>;
  const today = dayKey(startOfDay(Date.now()));
  const upcoming = daysOff.filter((d) => d >= today);

  return (
    <>
      <div className="section-title">{t("hours.title")}</div>
      <div className="card pad">
        <div className="hours-grid">
          {/* 月曜始まりで並べる（hours[0] が月曜） */}
          {hours.map((_, i) => (
            <label key={i}>
              <b>{weekdayName((i + 1) % 7)}</b>
              <input
                className="field num"
                type="number"
                min={0}
                max={24}
                step={0.5}
                value={hours[i]}
                onChange={(e) => setHours(hours.map((h, k) => (k === i ? Number(e.target.value) : h)))}
                onBlur={() => run(() => api.setDefaultHours(hours))}
              />
              <span className="muted small-text">{t("hours.unit")}</span>
            </label>
          ))}
        </div>
        <p className="muted small-text" style={{ margin: "8px 0 0" }}>
          {t("hours.perWork")}
        </p>
      </div>

      <div className="section-title" style={{ marginTop: 22 }}>
        {t("dayStart.title")}
      </div>
      <div className="card pad form">
        <label className="row">
          <span className="grow">{t("dayStart.label")}</span>
          <select
            className="field num"
            value={dayStart ?? 0}
            onChange={(e) => run(() => api.setDayStartHour(Number(e.target.value)))}
          >
            {Array.from({ length: 13 }, (_, h) => (
              <option key={h} value={h}>
                {h === 0 ? t("dayStart.midnight") : t("dayStart.morning", { h })}
              </option>
            ))}
          </select>
        </label>
        <p className="muted small-text">{t("dayStart.note")}</p>
      </div>

      <div className="section-title" style={{ marginTop: 22 }}>
        {t("daysOff.title")}
      </div>
      <div className="card pad">
        <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
          {upcoming.length === 0 && <span className="muted small-text">{t("daysOff.none")}</span>}
          {upcoming.map((d) => (
            <span key={d} className="tag">
              {dayLabel(new Date(`${d}T00:00`))}
              <button className="tag-x" title={t("daysOff.remove")} onClick={() => run(() => api.setDayOff(d, false))}>
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="row tight" style={{ marginTop: 10 }}>
          <input type="date" className="field" value={newDay} onChange={(e) => setNewDay(e.target.value)} />
          <button
            className="btn small"
            disabled={!newDay}
            onClick={() => {
              run(() => api.setDayOff(newDay, true));
              setNewDay("");
            }}
          >
            {t("daysOff.add")}
          </button>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// タイマー
// ---------------------------------------------------------------------------

/** キー入力からショートカットの文字列を作る（例: Ctrl+Alt+Space） */
function shortcutFromKey(e: React.KeyboardEvent): string | null {
  const mods = [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Super"].filter(Boolean);
  if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return null; // 修飾キーだけはまだ途中
  if (mods.length === 0) return null; // 普段の入力とぶつからないよう、修飾キーを必須にする
  const code = e.code.replace(/^Key/, "").replace(/^Digit/, "");
  return [...mods, code].join("+");
}

const IS_MAC = navigator.userAgent.includes("Mac");
/** Mac の記号（⌃⌥⇧⌘） */
const MAC_KEYS: Record<string, string> = { Ctrl: "⌃", Alt: "⌥", Shift: "⇧", Super: "⌘" };

/** ショートカットの表示用の書き方。Mac ではキーボードの記号に置き換える（例: ⌃⌥Space） */
function shortcutLabel(sc: string): string {
  if (!IS_MAC) return sc;
  return sc
    .split("+")
    .map((k) => MAC_KEYS[k] ?? k)
    .join("");
}

function TimerSection() {
  const app = useApp();
  const [prefs, setPrefs] = useState<TimerPrefs | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    api.getTimerPrefs().then(setPrefs).catch(app.showError);
  }, [app.version, app.showError]);

  if (!prefs) return <p className="muted">{t("loading")}</p>;

  const save = async (next: TimerPrefs) => {
    setPrefs(next);
    try {
      await api.setTimerPrefs(next);
      setSaved(t("saved"));
      app.refresh();
    } catch (e) {
      app.showError(e);
      api.getTimerPrefs().then(setPrefs).catch(() => {});
    }
  };

  return (
    <>
      <div className="section-title">{t("idle.title")}</div>
      <div className="card pad form">
        <label className="row">
          <span className="grow">{t("idle.label")}</span>
          <input
            className="field num"
            type="number"
            min={0}
            max={240}
            value={prefs.idleMinutes}
            onChange={(e) => setPrefs({ ...prefs, idleMinutes: Number(e.target.value) })}
            onBlur={() => save(prefs)}
            style={{ width: 70 }}
          />
          <span>{t("minutes")}</span>
        </label>
        <p className="muted small-text">{t("idle.zero")}</p>
        <label className="row">
          <input type="checkbox" checked={prefs.watchSaves} onChange={(e) => save({ ...prefs, watchSaves: e.target.checked })} />
          <span>{t("idle.watchSaves")}</span>
        </label>
      </div>

      <div className="section-title" style={{ marginTop: 22 }}>
        {t("shortcut.title")}
      </div>
      <div className="card pad form">
        <label className="row">
          <span className="grow">{t("shortcut.label")}</span>
          <input
            className="field shortcut"
            readOnly
            value={prefs.shortcut ? shortcutLabel(prefs.shortcut) : t("shortcut.none")}
            placeholder={t("shortcut.placeholder")}
            onKeyDown={(e) => {
              e.preventDefault();
              if (e.key === "Backspace" || e.key === "Delete") return save({ ...prefs, shortcut: "" });
              const sc = shortcutFromKey(e);
              if (sc) save({ ...prefs, shortcut: sc });
            }}
          />
        </label>
        <p className="muted small-text">
          {IS_MAC ? t("shortcut.helpMac") : t("shortcut.helpWin")}
          {saved && <span className="ok-text"> {saved}</span>}
        </p>
      </div>

      <div className="section-title" style={{ marginTop: 22 }}>
        {t("pomo.title")}
      </div>
      <div className="card pad form">
        <label className="row">
          <input
            type="checkbox"
            checked={prefs.pomodoro}
            onChange={(e) => {
              if (e.target.checked) askNotificationPermission();
              save({ ...prefs, pomodoro: e.target.checked });
            }}
          />
          <span>{t("pomo.enable")}</span>
        </label>
        {prefs.pomodoro && (
          <>
            {(
              [
                ["pomoWorkMin", "pomo.work", 180, "minutes"],
                ["pomoShortMin", "pomo.short", 180, "minutes"],
                ["pomoLongMin", "pomo.long", 180, "minutes"],
                ["pomoLongEvery", "pomo.every", 12, "pomo.times"],
              ] as const
            ).map(([key, label, max, unit]) => (
              <label key={key} className="row">
                <span className="grow">{t(label)}</span>
                <input
                  className="field num"
                  type="number"
                  min={1}
                  max={max}
                  value={prefs[key]}
                  onChange={(e) => setPrefs({ ...prefs, [key]: Number(e.target.value) })}
                  onBlur={() => save(prefs)}
                  style={{ width: 70 }}
                />
                <span>{t(unit)}</span>
              </label>
            ))}
            <label className="row">
              <input type="checkbox" checked={prefs.pomoSound} onChange={(e) => save({ ...prefs, pomoSound: e.target.checked })} />
              <span>{t("pomo.sound")}</span>
            </label>
          </>
        )}
        <p className="muted small-text">{t("pomo.help")}</p>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// データ
// ---------------------------------------------------------------------------

function DataSection() {
  const app = useApp();
  const [info, setInfo] = useState<{ dbPath: string; version: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [checkUpdates, setCheckUpdates] = useState<boolean | null>(null);

  useEffect(() => {
    api.dataInfo().then(setInfo).catch(app.showError);
    api.getCheckUpdates().then(setCheckUpdates).catch(app.showError);
  }, [app.showError]);

  const changeCheckUpdates = async (on: boolean) => {
    try {
      await api.setCheckUpdates(on);
      setCheckUpdates(on);
    } catch (e) {
      app.showError(e);
    }
  };

  const backup = async () => {
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    const dest = await saveDialog({
      title: t("data.backupDialog"),
      defaultPath: `otosazu-backup-${stamp}.db`,
      filters: [{ name: t("data.filterName"), extensions: ["db"] }],
    });
    if (!dest) return;
    try {
      await api.backupData(dest);
      setNote(t("data.backupDone", { path: dest }));
    } catch (e) {
      app.showError(e);
    }
  };

  return (
    <>
      <div className="section-title">{t("data.title")}</div>
      <div className="card pad form">
        <div className="row">
          <span className="grow">
            {t("data.fileNote")}
            <br />
            <span className="muted small-text path-text">{info?.dbPath}</span>
          </span>
          <button className="btn small" onClick={() => api.revealData().catch(app.showError)}>
            {t("data.reveal")}
          </button>
        </div>
        <div className="row">
          <span className="grow">{t("data.exportNote")}</span>
          <button className="btn small primary" onClick={backup}>
            {t("data.backup")}
          </button>
        </div>
        {note && <p className="ok-text small-text">{note}</p>}
        <p className="muted small-text">{t("data.restoreNote")}</p>
      </div>

      <div className="section-title" style={{ marginTop: 22 }}>
        {t("update.title")}
      </div>
      <div className="card pad form">
        <label className="row">
          <input
            type="checkbox"
            checked={checkUpdates ?? true}
            disabled={checkUpdates === null}
            onChange={(e) => changeCheckUpdates(e.target.checked)}
          />
          <span>{t("update.check")}</span>
        </label>
        <p className="muted small-text">{t("update.note")}</p>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// このソフトについて
// ---------------------------------------------------------------------------

function AboutSection() {
  const app = useApp();
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    api.dataInfo().then((info) => setVersion(info.version)).catch(app.showError);
  }, [app.showError]);

  const open = (url: string) => openUrl(url).catch(app.showError);

  return (
    <>
      <div className="section-title">{t("about.title")}</div>
      <div className="card pad about">
        <div className="about-name">Otosazu</div>
        <div className="muted">{t("about.tagline")}</div>
        <div className="about-version num">ver {version ?? "…"}</div>
        <dl className="about-links">
          <dt>{t("about.download")}</dt>
          <dd>
            <button className="link" onClick={() => open(BOOTH_URL)}>
              BOOTH
            </button>
            <span className="muted small-text">{t("about.boothNote")}</span>
          </dd>
          <dt>{t("about.author")}</dt>
          <dd>
            <button className="link" onClick={() => open(`https://x.com/${X_ACCOUNT}`)}>
              {t("about.xLink", { account: X_ACCOUNT })}
            </button>
            <span className="muted small-text">{t("about.reportNote")}</span>
          </dd>
        </dl>
      </div>
      <p className="muted small-text">
        © 2026 tozicode.com
        <br />
        {t("about.trademark")}
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------
// 表示
// ---------------------------------------------------------------------------

const TIME_FORMATS: TimeFormat[] = ["hm", "clock", "decimal"];

const THEMES: ThemePref[] = ["system", "light", "dark"];

/** 言語の選択肢。自動のあとに各言語（その言語自身の名前で出す） */
const LANGUAGE_CHOICES: LangPref[] = ["system", ...LANGS];

const MIN = 60_000;
const EXAMPLES = [30 * MIN, 90 * MIN, 155 * 60 * MIN + 50 * MIN];

function DisplaySection() {
  const app = useApp();
  const [prefs, setPrefs] = useState<DisplayPrefs | null>(null);

  useEffect(() => {
    api.getDisplayPrefs().then(setPrefs).catch(app.showError);
  }, [app.version, app.showError]);

  if (!prefs) return <p className="muted">{t("loading")}</p>;

  const save = async (next: DisplayPrefs) => {
    try {
      await api.setDisplayPrefs(next);
      setPrefs(next);
      app.refresh();
    } catch (e) {
      app.showError(e);
    }
  };
  const choose = (timeFormat: TimeFormat) => save({ ...prefs, timeFormat });

  return (
    <>
      <div className="section-title">{t("display.timeFormat")}</div>
      <div className="card pad form">
        {TIME_FORMATS.map((f) => (
          <button key={f} className={`choice${prefs.timeFormat === f ? " on" : ""}`} onClick={() => choose(f)}>
            <span className="radio" />
            <span className="grow">
              <b>{t(`tf.${f}`)}</b>
              {f === "hm" && <span className="muted">{t("tf.recommended")}</span>}
              <br />
              <span className="muted num">{EXAMPLES.map((ms) => hours(ms, f)).join(" ／ ")}</span>
            </span>
          </button>
        ))}
        <p className="muted small-text">{t("display.timeNote", { example: estimate(68 * MIN) })}</p>
      </div>

      <div className="section-title" style={{ marginTop: 22 }}>
        {t("display.language")}
      </div>
      <div className="card pad form">
        {LANGUAGE_CHOICES.map((l) => (
          <button
            key={l}
            className={`choice${prefs.language === l ? " on" : ""}`}
            onClick={() => save({ ...prefs, language: l })}
          >
            <span className="radio" />
            <span className="grow">
              {l === "system" ? (
                <>
                  <b>{t("lang.system")}</b>
                  <br />
                  <span className="muted">{t("lang.systemNote")}</span>
                </>
              ) : (
                <b lang={l}>{LANG_NAMES[l]}</b>
              )}
            </span>
          </button>
        ))}
      </div>

      <div className="section-title" style={{ marginTop: 22 }}>
        {t("display.color")}
      </div>
      <div className="card pad form">
        {THEMES.map((th) => (
          <button key={th} className={`choice${prefs.theme === th ? " on" : ""}`} onClick={() => save({ ...prefs, theme: th })}>
            <span className="radio" />
            <span className="grow">
              <b>{t(`theme.${th}`)}</b>
              <br />
              <span className="muted">{t(`theme.${th}Note`)}</span>
            </span>
          </button>
        ))}
      </div>
    </>
  );
}
