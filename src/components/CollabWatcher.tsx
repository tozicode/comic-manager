// 共同作業の取り込み（仕様書 5.23）の起動時の読み取り。メインの窓だけで動かす。
// 起動の少しあとに全作品の共同作業データを 1 回読み、何か変わっていれば画面を描き直す。
// ボードを開いている間の定期的な読み取りは BoardScreen が受け持つ
import { useEffect } from "react";
import { api } from "../api";
import { useApp } from "../app-context";

/** 起動してから読むまで。起動直後の読み込みと重ねない */
const STARTUP_DELAY_MS = 15_000;

export function CollabWatcher() {
  const app = useApp();
  useEffect(() => {
    const timer = setTimeout(() => {
      api
        .readCollabAll()
        .then((changed) => changed && app.refresh())
        .catch(() => {
          // 読めないことは普通にある（同期中など）。次に作品を開いたときに読み直す
        });
    }, STARTUP_DELAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
