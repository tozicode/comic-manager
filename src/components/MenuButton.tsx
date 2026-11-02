// 押すと下に選択肢が出るボタン（進捗ボードの上段の［進捗をシェア］と［⋯］）。
// 閉じ方は TagPopover と同じ：外をクリックするか Escape
import { ReactNode, useEffect, useRef, useState } from "react";

export type MenuItem = {
  label: ReactNode;
  /** 項目の下に小さく出す説明 */
  hint?: string;
  onClick: () => void;
  /** 選んでも閉じない（チェックの切り替えなど） */
  keepOpen?: boolean;
};

type Props = {
  label: ReactNode;
  title?: string;
  items: MenuItem[];
  /** メニューを右端に揃える（画面の右端に置くとき） */
  alignRight?: boolean;
  className?: string;
};

export function MenuButton({ label, title, items, alignRight, className }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="menu-wrap" ref={ref}>
      <button className={`btn small ghost menu-btn${className ? ` ${className}` : ""}`} title={title} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {label}
      </button>
      {open && (
        <div className={`popover menu${alignRight ? " right" : ""}`} role="menu">
          {items.map((it, i) => (
            <button
              key={i}
              className="menu-item"
              role="menuitem"
              onClick={() => {
                it.onClick();
                if (!it.keepOpen) setOpen(false);
              }}
            >
              <span>{it.label}</span>
              {it.hint && <span className="muted small-text">{it.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
