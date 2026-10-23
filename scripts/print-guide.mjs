// 知人向けの説明書（docs/guide/guide.html）を Microsoft Edge で PDF にして release/ に置く
// 使い方: npm run guide
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const edge = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].find(existsSync);
if (!edge) {
  console.error("Microsoft Edge が見つかりませんでした");
  process.exit(1);
}

const root = resolve(import.meta.dirname, "..");
const out = join(root, "release", "Otosazu_はじめにお読みください.pdf");
mkdirSync(join(root, "release"), { recursive: true });
if (existsSync(out)) rmSync(out);

// 普段使いの Edge と混ざらないよう、使い捨てのプロファイルで動かす
const profile = mkdtempSync(join(tmpdir(), "otosazu-guide-"));
execFileSync(edge, [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  `--user-data-dir=${profile}`,
  "--no-pdf-header-footer",
  `--print-to-pdf=${out}`,
  pathToFileURL(join(root, "docs", "guide", "guide.html")).href,
]);

// Edge は PDF を書き終える前に戻ることがあるので、できるまで待つ
for (let i = 0; i < 60 && !existsSync(out); i++) await new Promise((r) => setTimeout(r, 500));
if (!existsSync(out)) {
  console.error("PDF を作れませんでした");
  process.exit(1);
}
console.log(`作りました: ${out}`);
