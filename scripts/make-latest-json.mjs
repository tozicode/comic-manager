// 自動更新用の latest.json を作る（仕様書 5.13・docs/release.md）
// 使い方: node scripts/make-latest-json.mjs <版> [更新内容のテキストファイル]
//   release/<版>/ にある次のファイルから release/<版>/latest.json を書き出す
//   - Otosazu_<版>_x64-setup.exe と .sig（Windows）
//   - Otosazu_<版>_universal.app.tar.gz と .sig（Mac。無ければ Windows だけ載せる）
// 環境変数 OTOSAZU_UPDATE_BASE で置き場所の URL を差し替えられる（動作確認用）
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [, , version, notesFile] = process.argv;
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("使い方: node scripts/make-latest-json.mjs <版（例 1.1.0）> [更新内容のテキストファイル]");
  process.exit(1);
}

const dir = join("release", version);
const base = process.env.OTOSAZU_UPDATE_BASE ?? `https://github.com/tozicode/comic-manager/releases/download/v${version}`;

/** ファイルと署名があれば { url, signature } を返す */
function entry(file, required) {
  const path = join(dir, file);
  if (!existsSync(path) || !existsSync(`${path}.sig`)) {
    if (required) {
      console.error(`${path} か ${path}.sig が見つかりません`);
      process.exit(1);
    }
    console.warn(`${path} が無いので、Mac は載せません`);
    return null;
  }
  return { url: `${base}/${encodeURIComponent(file)}`, signature: readFileSync(`${path}.sig`, "utf8").trim() };
}

const platforms = { "windows-x86_64": entry(`Otosazu_${version}_x64-setup.exe`, true) };
const mac = entry(`Otosazu_${version}_universal.app.tar.gz`, false);
if (mac) {
  // universal なので、Apple シリコンにも Intel にも同じファイルを配る
  platforms["darwin-aarch64"] = mac;
  platforms["darwin-x86_64"] = mac;
}

const latest = {
  version,
  notes: notesFile ? readFileSync(notesFile, "utf8").trim() : "",
  pub_date: new Date().toISOString(),
  platforms,
};
writeFileSync(join(dir, "latest.json"), JSON.stringify(latest, null, 2) + "\n");
console.log(`${join(dir, "latest.json")} を書き出しました（${Object.keys(platforms).join(", ")}）`);
