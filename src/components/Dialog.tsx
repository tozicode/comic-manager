import { ReactNode, useEffect } from "react";

type Props = {
  label?: string;
  title: string;
  children?: ReactNode;
  actions: ReactNode;
  onClose: () => void;
};

/** 画面中央に出す確認ダイアログ。Esc か背景クリックで閉じる */
export function Dialog({ label, title, children, actions, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-label={title}>
        {label && <div className="dlabel">{label}</div>}
        <h3>{title}</h3>
        {children}
        <div className="actions">{actions}</div>
      </div>
    </div>
  );
}
