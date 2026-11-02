// 進捗の公開（仕様書 5.22）の自動送信。メインの窓だけで動かす。
// 起動の少しあとに 1 回、記録が変わるたびに 30 秒おいて 1 回、公開中の作品をすべて送る。
// オフにしたのに消せていない作品（pending_delete）もここで片付ける。失敗は記録するだけで知らせは出さない
import { useEffect, useRef } from "react";
import { useApp } from "../app-context";
import { publishAll } from "../publish";

/** 起動してから最初に送るまで。起動直後の読み込みと重ねない */
const STARTUP_DELAY_MS = 10_000;
/** 記録が変わってから送るまで。続けて変わっても 1 回にまとめる */
const DEBOUNCE_MS = 30_000;

export function Publisher() {
  const app = useApp();
  const busy = useRef(false);
  const again = useRef(false);

  // 送っている最中に次の要求が来たら、終わってからもう 1 回送る（取りこぼさない）
  const run = useRef(async () => {
    if (busy.current) {
      again.current = true;
      return;
    }
    busy.current = true;
    try {
      do {
        again.current = false;
        await publishAll().catch(() => {});
      } while (again.current);
    } finally {
      busy.current = false;
    }
  });

  useEffect(() => {
    const timer = setTimeout(() => run.current(), STARTUP_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  // version は自分の窓の変更でも他の窓からの知らせでも進む
  useEffect(() => {
    if (app.version === 0) return;
    const timer = setTimeout(() => run.current(), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [app.version]);

  return null;
}
