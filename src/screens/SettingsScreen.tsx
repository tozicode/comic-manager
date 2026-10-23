import { useEffect, useState } from "react";
import { api, StageDef, Tag, TagGroup } from "../api";
import { useApp } from "../app-context";
import { dayKey, dayLabel } from "../format";

type Section = "stages" | "tags" | "hours";
const SECTIONS: { key: Section; label: string }[] = [
  { key: "stages", label: "工程" },
  { key: "tags", label: "タグ" },
  { key: "hours", label: "作業時間・休み" },
];

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
      <div>{section === "stages" ? <StagesSection /> : section === "tags" ? <TagsSection /> : <HoursSection />}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 工程
// ---------------------------------------------------------------------------

function StagesSection() {
  const app = useApp();
  const run = useRun();
  const [stages, setStages] = useState<StageDef[]>([]);
  const [newName, setNewName] = useState("");

  useEffect(() => {
    api.listStages().then(setStages).catch(app.showError);
  }, [app.version, app.showError]);

  const add = async () => {
    if (!newName.trim()) return;
    await run(() => api.addStage(newName, PALETTE[stages.length % PALETTE.length]));
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
      <div className="slist">
        {stages.map((s, i) => (
          <StageRow
            key={`${s.id}-${s.name}-${s.color}-${s.hintMinutes}`}
            stage={s}
            first={i === 0}
            last={i === stages.length - 1}
            onSave={(name, color, hint) => run(() => api.updateStage(s.id, name, color, hint))}
            onMove={(delta) => run(() => api.moveStage(s.id, delta))}
            onHidden={(hidden) => run(() => api.setStageHidden(s.id, hidden))}
          />
        ))}
        <div className="row">
          <input
            className="field"
            placeholder="新しい工程の名前（例：ネーム、ベタ、仕上げ）"
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
  first: boolean;
  last: boolean;
  onSave: (name: string, color: string, hintMinutes: number) => void;
  onMove: (delta: number) => void;
  onHidden: (hidden: boolean) => void;
};

function StageRow({ stage, first, last, onSave, onMove, onHidden }: RowProps) {
  const [name, setName] = useState(stage.name);
  const [hint, setHint] = useState(String(stage.hintMinutes));

  const save = (color = stage.color) => {
    const minutes = Number(hint);
    if (name.trim() === stage.name && color === stage.color && minutes === stage.hintMinutes) return;
    onSave(name, color, Number.isFinite(minutes) ? Math.round(minutes) : stage.hintMinutes);
  };

  return (
    <div className={`card sitem${stage.hidden ? " archived" : ""}`}>
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
        分 / ページ
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
    run(() => api.addTagGroup(newGroup, false));
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
        <GroupCard key={`${g.id}-${g.name}-${g.exclusive}`} group={g} run={run} />
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
        「どれか1つだけ」にしたグループは、ページに 1 つだけ付けられます（選び直すと入れ替わる）。隠したタグはボードに出ず、予測にも使いません。
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
              onBlur={() => name.trim() !== group.name && run(() => api.updateTagGroup(group.id, name, group.exclusive))}
            />
            <label className="small-text row tight">
              <input
                type="checkbox"
                checked={group.exclusive}
                onChange={(e) => run(() => api.updateTagGroup(group.id, group.name, e.target.checked))}
              />
              どれか1つだけ
            </label>
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

  useEffect(() => {
    api
      .getCalendar()
      .then(([h, d]) => {
        setHours(h);
        setDaysOff(d);
      })
      .catch(app.showError);
  }, [app.version, app.showError]);

  if (!hours) return <p className="muted">読み込み中…</p>;
  const today = dayKey(new Date());
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
