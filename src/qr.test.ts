// 接続先の QR コード（仕様書 5.17）
import { describe, expect, it } from "vitest";
import { qrPath } from "./components/Qr";

const URL_SAMPLE = "http://100.111.204.11:8787/?t=0123456789abcdef0123456789abcdef";

describe("QR コード", () => {
  it("接続先の URL を描ける", () => {
    const { side, d } = qrPath(URL_SAMPLE);
    // 1 辺は QR のマス数 + 余白 4 マス × 2。この長さの URL なら 25〜45 マスに収まる
    expect(side).toBeGreaterThanOrEqual(25 + 8);
    expect(side).toBeLessThanOrEqual(45 + 8);
    expect(d.length).toBeGreaterThan(0);
  });

  it("左上の目印（切り出しシンボル）が必ず入る", () => {
    const { d } = qrPath(URL_SAMPLE);
    // 余白のぶんだけずらした (4,4) から始まる 7×7 の角は、QR なら必ず黒
    expect(d).toContain("M4 4h1v1h-1z");
    expect(d).toContain("M10 4h1v1h-1z");
    expect(d).toContain("M4 10h1v1h-1z");
  });

  it("余白の中には何も描かない", () => {
    const { d } = qrPath(URL_SAMPLE);
    // 余白は 0〜3 マスめ。そこから始まる四角が無いことを確かめる
    expect(d).not.toMatch(/M[0-3] \d/);
    expect(d).not.toMatch(/M\d+ [0-3]h/);
  });

  it("中身が変われば絵も変わり、同じ中身なら同じ絵になる", () => {
    const a = qrPath(URL_SAMPLE);
    const b = qrPath(URL_SAMPLE.replace("0123", "4567"));
    expect(a.d).not.toBe(b.d);
    expect(qrPath(URL_SAMPLE).d).toBe(a.d);
  });
});
