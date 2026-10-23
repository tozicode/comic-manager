import { useEffect, useRef, useState } from "react";
import { api } from "../api";

type Props = {
  /** ページのファイルの場所 */
  path: string;
  /** 見開き（横に 2 ページ分） */
  spread?: boolean;
  /** イラストのように縦横の比率が決まっていない絵（正方形の枠に収める） */
  free?: boolean;
  width?: number;
};

/** ページのサムネイル。画面に入ってから読み込む */
export function Thumb({ path, spread = false, free = false, width = 36 }: Props) {
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
    setUrl(null);
    api
      .loadThumbnail(path)
      .then((u) => !cancelled && setUrl(u))
      .catch(() => {
        // 読めないファイル（見つからない・サムネイルが無い）は枠だけ表示する
      });
    return () => {
      cancelled = true;
    };
  }, [visible, path]);

  const cls = `thumb${spread ? " spread" : ""}${free ? " free" : ""}`;
  return (
    <div ref={ref} className={cls} style={{ width: spread ? width * 2 : free ? width * 1.4 : width }}>
      {url && <img src={url} alt="" />}
    </div>
  );
}
