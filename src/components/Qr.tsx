// 接続先の URL を QR コードにして出す（仕様書 5.17）。別端末のカメラで読み取って開いてもらう。
// 合言葉の入った URL は長いので、手で打ち込まずに済むようにするためのもの
import { useMemo } from "react";
import qrcode from "qrcode-generator";

/** 読み取りやすさのため、まわりに 4 マスぶんの余白（クワイエットゾーン）を取る */
const MARGIN = 4;

/** QR コードの黒いマスを 1 本の path にする。side は余白を含めた 1 辺のマス数 */
export function qrPath(text: string): { side: number; d: string } {
  // 型番 0 は、中身の長さに合わせて自動で決める。M は汚れに少し強い水準
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const count = qr.getModuleCount();
  let d = "";
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      // マスごとに要素を作ると数百個になるので、1 本の path にまとめる
      if (qr.isDark(row, col)) d += `M${col + MARGIN} ${row + MARGIN}h1v1h-1z`;
    }
  }
  return { side: count + MARGIN * 2, d };
}

/** 色は、暗い配色のときでも読み取れるよう、必ず白地に黒で描く */
export function Qr({ text, label, size = 136 }: { text: string; label: string; size?: number }) {
  const { side, d } = useMemo(() => qrPath(text), [text]);
  return (
    <svg
      className="qr-box"
      width={size}
      height={size}
      viewBox={`0 0 ${side} ${side}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={label}
    >
      <rect width={side} height={side} fill="#ffffff" />
      <path d={d} fill="#000000" />
    </svg>
  );
}
