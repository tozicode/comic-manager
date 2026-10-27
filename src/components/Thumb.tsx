import { useEffect, useRef, useState } from "react";
import { api } from "../api";

type Props = {
  /** ページのファイルの場所 */
  path: string;
  /** 見開き（横に 2 ページ分） */
  spread?: boolean;
  /** 見開きを分けた行：見開きの絵のどちら側のページか（1 ページ分の枠に切り出す） */
  half?: Side | null;
  /** イラストのように縦横の比率が決まっていない絵（正方形の枠に収める） */
  free?: boolean;
  width?: number;
};

export type Side = "left" | "right";

/**
 * 見開きを分けた行が、見開きの絵のどちら側か。
 * 右綴じなら若い番号のページが右側（p4-5 なら p4 が右、p5 が左）、左綴じならその逆
 */
export function spreadSide(page: { half: number }, work: { rightBound: boolean }): Side | null {
  if (page.half === 0) return null;
  return (page.half === 1) === work.rightBound ? "right" : "left";
}

/** ページのサムネイル。画面に入ってから読み込む */
export function Thumb({ path, spread = false, half = null, free = false, width = 36 }: Props) {
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

  const cls = `thumb${spread ? " spread" : ""}${free ? " free" : ""}${half ? ` half ${half}` : ""}`;
  return (
    <div ref={ref} className={cls} style={{ width: spread ? width * 2 : free ? width * 1.4 : width }}>
      {url && <img src={url} alt="" />}
    </div>
  );
}
