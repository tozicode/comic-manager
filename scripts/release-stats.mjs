// GitHub Releases のダウンロード数を版ごとに出す（利用者数の目安）
// 使い方: node scripts/release-stats.mjs
//   - 更新ファイル（setup.exe・.app.tar.gz）の数：その版が最新だった間に開いて更新した人の数
//     BOOTH は zip で配っているので、GitHub からの取得はほぼ自動更新だけ。1 人 1 版 1 回
//   - latest.json の数：起動した回数（メインの窓を開くたびに 1 回読む）
//   版をまたいで足すと同じ人を数え直すので、合計は出さない
//   置き場所は otosazu-releases。3.1.0 までは comic-manager に置いていたので、読めるうちはそちらも合わせて出す
//   （comic-manager を非公開にすると読めなくなる。その頃の数字は docs/release.md の記録を見る）
const REPOS = ["tozicode/otosazu-releases", "tozicode/comic-manager"];

/** 版（タグ）ごとにまとめた公開情報。同じ版が両方にあれば、ファイルを合わせて数える */
const byTag = new Map();
for (const repo of REPOS) {
  const res = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=100`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!res.ok) {
    console.warn(`${repo} は読めませんでした（${res.status} ${res.statusText}）。飛ばします`);
    continue;
  }
  for (const r of await res.json()) {
    if (r.draft || r.prerelease) continue;
    const seen = byTag.get(r.tag_name);
    if (!seen) {
      byTag.set(r.tag_name, { tag_name: r.tag_name, published_at: r.published_at, assets: [...r.assets] });
    } else {
      // 先に出した方の公開日を使う
      if (r.published_at < seen.published_at) seen.published_at = r.published_at;
      seen.assets.push(...r.assets);
    }
  }
}
if (byTag.size === 0) {
  console.error("どのリポジトリからも読めませんでした");
  process.exit(1);
}
const releases = [...byTag.values()].sort((a, b) => a.published_at.localeCompare(b.published_at));

/** 名前が条件に合うファイルのダウンロード数 */
function count(release, test) {
  return release.assets.filter((a) => test(a.name)).reduce((sum, a) => sum + a.download_count, 0);
}

const rows = releases.map((r, i) => {
  const from = new Date(r.published_at);
  // 最新だった期間：次の版を出すまで（最新の版は今日まで）
  const to = releases[i + 1] ? new Date(releases[i + 1].published_at) : new Date();
  const win = count(r, (n) => n.endsWith("-setup.exe"));
  const mac = count(r, (n) => n.endsWith(".app.tar.gz"));
  const launches = count(r, (n) => n === "latest.json");
  return {
    版: r.tag_name,
    公開日: r.published_at.slice(0, 10),
    最新の日数: Math.round((to - from) / 86400000),
    Windows: win,
    Mac: mac,
    人数: win + mac,
    起動: launches,
    "起動/人": win + mac ? (launches / (win + mac)).toFixed(1) : "-",
  };
});
console.table(rows.reverse());
