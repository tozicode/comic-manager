import { DragEvent, useEffect, useRef, useState } from "react";
import { api, DisplayPrefs, StageDef, StageSet, Tag, TagApplies, TagGroup, TimerPrefs } from "../api";
import { useApp } from "../app-context";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { dayKey, dayLabel, estimate, hours, startOfDay, TimeFormat } from "../format";

type Section = "stages" | "tags" | "hours" | "timer" | "display" | "data" | "about";
const SECTIONS: { key: Section; label: string }[] = [
  { key: "stages", label: "工程" },
  { key: "tags", label: "タグ" },
  { key: "hours", label: "作業時間・休み" },
  { key: "timer", label: "タイマー" },
  { key: "display", label: "表示" },
  { key: "data", label: "データ" },
  { key: "about", label: "このソフトについて" },
];

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
          <button key={s.key} className={section === s.key ? "on" : ""} onClick={() => setSection(s.key)}>
            {s.label}
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
  const unit = sets.find((st) => st.id === setId)?.unit ?? "ページ";
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
          工程
        </div>
        <span className="muted small-text">
          追加した工程は、これから登録する作品で使われます。並べ替えと隠すは、登録済みの作品にも反映されます
        </span>
      </div>
      <div className="seg" style={{ marginBottom: 10 }}>
        {sets.map((st) => (
          <button key={st.id} className={st.id === setId ? "on" : ""} onClick={() => setSetId(st.id)}>
            {st.name}
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
            placeholder={`新しい工程の名前（例：${sets.find((st) => st.id === setId)?.kind === "files" ? "下塗り、背景、エフェクト" : "ネーム、ベタ、仕上げ"}）`}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            style={{ width: 320 }}
          />
          <button className="btn" onClick={add} disabled={!newName.trim()}>
            ＋ 工程を追加
          </button>
        </div>
      </div>
      <p className="muted small-text">
        「隠す」と一覧やボードに出なくなりますが、過去の記録は残ります。目安の時間は、実績がまだ無い工程の予測に使います。
      </p>
    </>
  );
}

type RowProps = {
  stage: StageDef;
  /** 1 単位の呼び方（ページ・枚） */
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
        title="ドラッグで並べ替え"
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
        <button className="mini" title="上へ" disabled={first} onClick={() => onMove(-1)}>
          ▲
        </button>
        <button className="mini" title="下へ" disabled={last} onClick={() => onMove(1)}>
          ▼
        </button>
      </div>
      <input
        type="color"
        className="swatch"
        value={stage.color}
        title="色を変える"
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
        目安
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
        分 / {unit}
      </label>
      <button className="btn small" onClick={() => onHidden(!stage.hidden)}>
        {stage.hidden ? "表示する" : "隠す"}
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
          タグ
        </div>
        <span className="muted small-text">倍率は予測に使う目安です（×1.3 なら 3 割長くかかる）</span>
      </div>
      {groups.map((g) => (
        <GroupCard key={`${g.id}-${g.name}-${g.exclusive}-${g.applies}`} group={g} run={run} />
      ))}
      <div className="row">
        <input
          className="field"
          placeholder="新しいグループの名前（例：背景の種類）"
          value={newGroup}
          onChange={(e) => setNewGroup(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addGroup()}
          style={{ width: 320 }}
        />
        <button className="btn" disabled={!newGroup.trim()} onClick={addGroup}>
          ＋ グループを追加
        </button>
      </div>
      <p className="muted small-text">
        「どれか1つだけ」にしたグループは、ページに 1 つだけ付けられます（選び直すと入れ替わる）。「漫画だけ」「イラストだけ」にしたグループは、その種類の作品でだけ出ます。隠したタグはボードに出ず、予測にも使いません。
      </p>
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
            {group.name} <span className="tag sys">CLIP STUDIO に連動</span>
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
              どれか1つだけ
            </label>
            <select
              className="field small-text"
              title="このグループを使う作品の種類"
              value={group.applies}
              onChange={(e) => run(() => api.updateTagGroup(group.id, group.name, group.exclusive, e.target.value as TagApplies))}
            >
              <option value="both">漫画とイラスト</option>
              <option value="comic">漫画だけ</option>
              <option value="files">イラストだけ</option>
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
            placeholder="タグの名前"
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addTag()}
          />
          <button className="btn small" disabled={!newTag.trim()} onClick={addTag}>
            ＋ タグを追加
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
        倍率 ×
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
        {tag.hidden ? "表示する" : "隠す"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 作業時間・休み
// ---------------------------------------------------------------------------

const WEEKDAYS = ["月", "火", "水", "木", "金", "土", "日"];

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

  if (!hours) return <p className="muted">読み込み中…</p>;
  const today = dayKey(startOfDay(Date.now()));
  const upcoming = daysOff.filter((d) => d >= today);

  return (
    <>
      <div className="section-title">1日に作業する時間（全作品の既定値）</div>
      <div className="card pad">
        <div className="hours-grid">
          {WEEKDAYS.map((d, i) => (
            <label key={d}>
              <b>{d}</b>
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
              <span className="muted small-text">時間</span>
            </label>
          ))}
        </div>
        <p className="muted small-text" style={{ margin: "8px 0 0" }}>
          作品ごとに変えたいときは、スケジュール画面の「完成日を見る」で調整できます。
        </p>
      </div>

      <div className="section-title" style={{ marginTop: 22 }}>
        1日の区切り
      </div>
      <div className="card pad form">
        <label className="row">
          <span className="grow">この時刻から次の日のこの時刻までを「1日」として数えます</span>
          <select
            className="field num"
            value={dayStart ?? 0}
            onChange={(e) => run(() => api.setDayStartHour(Number(e.target.value)))}
          >
            {Array.from({ length: 13 }, (_, h) => (
              <option key={h} value={h}>
                {h === 0 ? "0時（午前0時）" : `朝${h}時`}
              </option>
            ))}
          </select>
        </label>
        <p className="muted small-text">
          夜型で深夜まで作業する場合に変えてください。たとえば朝5時にすると、深夜2時の作業は前の日の作業として数え、
          「今日のノルマ」も朝5時に切り替わります。記録はそのままで、過去の分も新しい区切りで数え直します。
        </p>
      </div>

      <div className="section-title" style={{ marginTop: 22 }}>
        休みの日（全作品共通）
      </div>
      <div className="card pad">
        <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
          {upcoming.length === 0 && <span className="muted small-text">まだありません</span>}
          {upcoming.map((d) => (
            <span key={d} className="tag">
              {dayLabel(new Date(`${d}T00:00`))}
              <button className="tag-x" title="休みをやめる" onClick={() => run(() => api.setDayOff(d, false))}>
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
            ＋ 休みにする
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

  if (!prefs) return <p className="muted">読み込み中…</p>;

  const save = async (next: TimerPrefs) => {
    setPrefs(next);
    try {
      await api.setTimerPrefs(next);
      setSaved("保存しました");
      app.refresh();
    } catch (e) {
      app.showError(e);
      api.getTimerPrefs().then(setPrefs).catch(() => {});
    }
  };

  return (
    <>
      <div className="section-title">止め忘れの確認</div>
      <div className="card pad form">
        <label className="row">
          <span className="grow">PC の操作がこの時間なかったら、計測を一時停止して「休憩していましたか？」と聞く</span>
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
          <span>分</span>
        </label>
        <p className="muted small-text">0 にすると確認しません。</p>
        <label className="row">
          <input type="checkbox" checked={prefs.watchSaves} onChange={(e) => save({ ...prefs, watchSaves: e.target.checked })} />
          <span>計測中に別のページが CLIP STUDIO で保存されたら知らせる</span>
        </label>
      </div>

      <div className="section-title" style={{ marginTop: 22 }}>
        ショートカット
      </div>
      <div className="card pad form">
        <label className="row">
          <span className="grow">どのアプリを使っていても、このキーで一時停止 / 再開する</span>
          <input
            className="field shortcut"
            readOnly
            value={prefs.shortcut ? shortcutLabel(prefs.shortcut) : "（使わない）"}
            placeholder="キーを押してください"
            onKeyDown={(e) => {
              e.preventDefault();
              if (e.key === "Backspace" || e.key === "Delete") return save({ ...prefs, shortcut: "" });
              const sc = shortcutFromKey(e);
              if (sc) save({ ...prefs, shortcut: sc });
            }}
          />
        </label>
        <p className="muted small-text">
          {IS_MAC
            ? "欄をクリックしてから、control・option・shift・command のどれかと一緒にキーを押すと変わります。delete で使わない設定にできます。"
            : "欄をクリックしてから、Ctrl・Alt・Shift のどれかと一緒にキーを押すと変わります。Backspace で使わない設定にできます。"}
          {saved && <span className="ok-text"> {saved}</span>}
        </p>
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
      title: "バックアップの保存先",
      defaultPath: `otosazu-backup-${stamp}.db`,
      filters: [{ name: "Otosazu のデータ", extensions: ["db"] }],
    });
    if (!dest) return;
    try {
      await api.backupData(dest);
      setNote(`バックアップを作りました：${dest}`);
    } catch (e) {
      app.showError(e);
    }
  };

  return (
    <>
      <div className="section-title">データ</div>
      <div className="card pad form">
        <div className="row">
          <span className="grow">
            作業記録・工程・タグなどは、すべてこのファイルに保存されています。
            <br />
            <span className="muted small-text path-text">{info?.dbPath}</span>
          </span>
          <button className="btn small" onClick={() => api.revealData().catch(app.showError)}>
            保存場所を開く
          </button>
        </div>
        <div className="row">
          <span className="grow">
            今のデータを 1 つのファイルに書き出します。PC を買い替えるときや、不具合を相談するときに使えます。
          </span>
          <button className="btn small primary" onClick={backup}>
            バックアップを作る…
          </button>
        </div>
        {note && <p className="ok-text small-text">{note}</p>}
        <p className="muted small-text">
          バックアップから戻すときは、Otosazu を閉じてから、上の保存場所にある otosazu.db をバックアップのファイルで置き換えてください。
        </p>
      </div>

      <div className="section-title" style={{ marginTop: 22 }}>
        更新
      </div>
      <div className="card pad form">
        <label className="row">
          <input
            type="checkbox"
            checked={checkUpdates ?? true}
            disabled={checkUpdates === null}
            onChange={(e) => changeCheckUpdates(e.target.checked)}
          />
          <span>起動時に新しい版を確認する</span>
        </label>
        <p className="muted small-text">
          起動時に、配布元（GitHub）から最新の版の情報だけを読み込みます。作業記録などのデータを送ることはありません。
        </p>
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
      <div className="section-title">このソフトについて</div>
      <div className="card pad about">
        <div className="about-name">Otosazu</div>
        <div className="muted">原稿を落とさず描き上げる ── 漫画・イラスト制作のスケジュール管理ソフト</div>
        <div className="about-version num">ver {version ?? "…"}</div>
        <dl className="about-links">
          <dt>配布ページ</dt>
          <dd>
            <button className="link" onClick={() => open(BOOTH_URL)}>
              BOOTH
            </button>
            <span className="muted small-text">　最新版の入手・説明書はこちら</span>
          </dd>
          <dt>作者</dt>
          <dd>
            <button className="link" onClick={() => open(`https://x.com/${X_ACCOUNT}`)}>
              X（@{X_ACCOUNT}）
            </button>
            <span className="muted small-text">　不具合のご報告やご意見はこちらへ</span>
          </dd>
        </dl>
      </div>
      <p className="muted small-text">
        © 2026 tozicode.com
        <br />
        CLIP STUDIO PAINT は株式会社セルシスの商標です。Otosazu はセルシスとは関係のない個人制作のソフトです。
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------
// 表示
// ---------------------------------------------------------------------------

const TIME_FORMATS: { key: TimeFormat; label: string }[] = [
  { key: "hm", label: "時間と分" },
  { key: "clock", label: "時計の形" },
  { key: "decimal", label: "小数" },
];

const MIN = 60_000;
const EXAMPLES = [30 * MIN, 90 * MIN, 155 * 60 * MIN + 50 * MIN];

function DisplaySection() {
  const app = useApp();
  const [prefs, setPrefs] = useState<DisplayPrefs | null>(null);

  useEffect(() => {
    api.getDisplayPrefs().then(setPrefs).catch(app.showError);
  }, [app.version, app.showError]);

  if (!prefs) return <p className="muted">読み込み中…</p>;

  const choose = async (timeFormat: TimeFormat) => {
    try {
      await api.setDisplayPrefs({ timeFormat });
      setPrefs({ timeFormat });
      app.refresh();
    } catch (e) {
      app.showError(e);
    }
  };

  return (
    <>
      <div className="section-title">時間の表記</div>
      <div className="card pad form">
        {TIME_FORMATS.map((f) => (
          <button key={f.key} className={`choice${prefs.timeFormat === f.key ? " on" : ""}`} onClick={() => choose(f.key)}>
            <span className="radio" />
            <span className="grow">
              <b>{f.label}</b>
              {f.key === "hm" && <span className="muted">（おすすめ）</span>}
              <br />
              <span className="muted num">{EXAMPLES.map((ms) => hours(ms, f.key)).join(" ／ ")}</span>
            </span>
          </button>
        ))}
        <p className="muted small-text">
          記録した時間は 1 分単位、予測した時間は 5 分単位で表示します（例：予測 {estimate(68 * MIN)}）。
          タイマーの経過時間（00:42:13）は、どの表記でも変わりません。
        </p>
      </div>
    </>
  );
}
