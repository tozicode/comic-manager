import { useEffect, useRef, useState } from "react";
import { api } from "../api";

type Props = { cmcPath: string; fileName: string; spread?: boolean; width?: number };

/** ページのサムネイル。画面に入ってから読み込む */
export function Thumb({ cmcPath, fileName, spread = false, width = 36 }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => entry.isIntersecting && setVisible(true));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    api
      .loadThumbnail(cmcPath, fileName)
      .then((u) => !cancelled && setUrl(u))
      .catch(() => {
        // 読めないページは枠だけ表示する
      });
    return () => {
      cancelled = true;
    };
  }, [visible, cmcPath, fileName]);

  return (
    <div ref={ref} className={`thumb${spread ? " spread" : ""}`} style={{ width: spread ? width * 2 : width }}>
      {url && <img src={url} alt="" />}
    </div>
  );
}
