import { useEffect, useRef } from "react";
import { TagGroup } from "../api";
import { factor } from "../format";

type Props = {
  title: string;
  groups: TagGroup[];
  /** 付いているタグ（まとめて付けるときは、選んだ全ページに付いているタグ） */
  active: number[];
  onToggle: (tagId: number, on: boolean) => void;
  onClose: () => void;
};

/** タグの付け外し。クリックで付け外しし、排他グループは選び直すと入れ替わる */
export function TagPopover({ title, groups, active, onToggle, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    // 開いたクリック自体で閉じないよう、次のイベントから受け付ける
    const timer = setTimeout(() => {
      window.addEventListener("mousedown", onDown);
      window.addEventListener("keydown", onKey);
    });
    return () => {
      clearTimeout(timer);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div className="popover" ref={ref}>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
        <b>{title}</b>
        <span className="muted small-text">クリックで付け外し</span>
      </div>
      {groups.map((g) => {
        const tags = g.tags.filter((t) => !t.hidden);
        if (tags.length === 0) return null;
        return (
          <div className="group" key={g.id}>
            <h4>{g.exclusive ? `${g.name}（どれか1つ）` : g.name}</h4>
            <div className="opts">
              {tags.map((t) =>
                t.system ? (
                  <span key={t.id} className={`opt lock${active.includes(t.id) ? " on-sys" : ""}`} title="CLIP STUDIO の設定から自動で付きます">
                    {t.name} ×{factor(t.initialFactor)} — CLIP STUDIO で見開きにすると自動で付きます
                  </span>
                ) : (
                  <button
                    key={t.id}
                    className={`opt${active.includes(t.id) ? " on" : ""}`}
                    onClick={() => onToggle(t.id, !active.includes(t.id))}
                  >
                    {t.name} ×{factor(t.initialFactor)}
                  </button>
                ),
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
