// 「更新する」を押したことを控え、次の起動で更新が終わっていたかを確かめる（仕様書 5.13）。
// Windows はインストーラーを起こした直後にアプリが終わるので、インストーラーが止められても
// アプリ側では気づけない。押した時点の版を控えておき、次の起動でまだその版なら失敗とみなす
const KEY = "otosazu.updateAttempt";

type Attempt = { from: string; to: string };

/** 「更新する」を押した。from は今の版、to は入れようとした版 */
export function recordUpdateAttempt(from: string, to: string) {
  localStorage.setItem(KEY, JSON.stringify({ from, to } satisfies Attempt));
}

/** ダウンロードなどで失敗してその場で知らせたときは、次の起動で重ねて知らせないよう消す */
export function clearUpdateAttempt() {
  localStorage.removeItem(KEY);
}

/**
 * 起動したときに呼ぶ。前回「更新する」を押したのに、まだその時の版のままなら入れようとした版を返す。
 * 控えは 1 回読んだら消す（知らせるのは 1 回だけ。もう一度押せばまた控える）
 */
export function takeFailedUpdate(current: string): string | null {
  const raw = localStorage.getItem(KEY);
  if (raw === null) return null;
  localStorage.removeItem(KEY);
  try {
    const a = JSON.parse(raw) as Attempt;
    return a.from === current ? a.to : null;
  } catch {
    return null;
  }
}

/**
 * 入れようとした版のインストーラーがどこまで進んだか（仕様書 5.13）。
 * インストーラーは動き始めたときに installer.log を「start 版」で書き直し、最後まで終わると「done 版」を足す。
 * - notStarted：その版の印が無い。動き始める前に止められた（セキュリティソフトなど）
 * - stopped：動き始めたが、終わりの印が無い。ファイルの入れ替えの途中で止まった
 * - installed：最後まで終わっている。別の場所にある古い版を開いている
 * - unknown：記録が読めなかった（Mac など）
 */
export type UpdateDiagnosis = "notStarted" | "stopped" | "installed" | "unknown";

export function diagnoseUpdate(log: string | null | undefined, to: string): UpdateDiagnosis {
  if (log === undefined) return "unknown";
  const lines = (log ?? "").split(/\r?\n/).map((l) => l.trim());
  if (lines.includes(`done ${to}`)) return "installed";
  if (lines.includes(`start ${to}`)) return "stopped";
  return "notStarted";
}
