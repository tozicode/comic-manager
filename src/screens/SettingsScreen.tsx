import { useEffect, useState } from "react";
import { api, StageDef } from "../api";
import { useApp } from "../app-context";

/** 新しい工程に順番に割り当てる色 */
const PALETTE = ["#9a7fb8", "#d0913a", "#3f8f8f", "#b85b8a", "#6b6b6b"];

export function SettingsScreen() {
  const app = useApp();
  const [stages, setStages] = useState<StageDef[]>([]);
  const [newName, setNewName] = useState("");

  useEffect(() => {
    api.listStages().then(setStages).catch(app.showError);
  }, [app.version, app.showError]);

  const run = async (f: () => Promise<unknown>) => {
    try {
      await f();
      app.refresh();
    } catch (e) {
      app.showError(e);
    }
  };

  const add = async () => {
    if (!newName.trim()) return;
    await run(() => api.addStage(newName, PALETTE[stages.length % PALETTE.length]));
    setNewName("");
  };

  return (
    <div className="settings">
      <nav className="snav">
        <span className="on">工程</span>
        <span className="soon" title="次のバージョンで追加します">
          タグ
        </span>
        <span className="soon" title="次のバージョンで追加します">
          作業時間・休み
        </span>
      </nav>
      <div>
        <div className="row" style={{ marginBottom: 8 }}>
          <div className="section-title" style={{ margin: 0 }}>
            工程
          </div>
          <span className="muted small-text">工程の追加・並べ替え・隠すは、登録済みの作品にも反映されます</span>
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
      </div>
    </div>
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
      {stage.hidden ? (
        <button className="btn small" onClick={() => onHidden(false)}>
          表示する
        </button>
      ) : (
        <button className="btn small" onClick={() => onHidden(true)}>
          隠す
        </button>
      )}
    </div>
  );
}
