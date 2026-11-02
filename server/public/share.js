// 進捗の公開の閲覧ページ（仕様書 5.22）で共通に使うもの：言葉・取得・描画。
// 要約の形は docs/snapshot-format.md。ビルドなしで動く素の JS に保つ
/* global document, window, navigator, fetch, localStorage, location */

/** 閲覧鍵を送るヘッダ（server/src/index.ts と合わせる） */
const READ_HEADER = "X-Otosazu-Read";
/** 最終更新がこれより前なら「しばらく更新されていません」 */
const STALE_MS = 3 * 24 * 60 * 60 * 1000;

const MESSAGES = {
  ja: {
    brand: "Otosazu",
    pageSub: "進捗の公開",
    listSub: "進捗のまとめ",
    loading: "読み込み中…",
    hiddenTitle: "（作品名は非公開）",
    progress: "進み具合",
    todayGain: "今日 +{p}%",
    completed: "完成しました",
    deadline: "締切",
    deadlineIn: "あと {n} 日",
    deadlineToday: "今日",
    deadlinePast: "{n} 日過ぎています",
    noDeadline: "締切なし",
    finish: "完成見込み",
    finishRange: "{low} 〜 {high}",
    noFinish: "見込みなし",
    statusOk: "間に合う見込み",
    statusTight: "厳しい",
    statusLate: "遅れる見込み",
    stagesDone: "工程ごとの完了",
    unitComic: "{n} ページ",
    unitFiles: "{n} 枚",
    unitOther: "{n} {unit}",
    ofRows: "／{n}",
    cells: "ページ × 工程",
    legendDone: "完了",
    legendWorking: "作業中",
    legendOpen: "未着手",
    todayTime: "今日の作業 {t}",
    totalTime: "合計 {t}",
    lastWorked: "最後に作業した日 {d}",
    neverWorked: "まだ作業していません",
    updated: "最終更新 {d}",
    stale: "しばらく更新されていません（最終更新 {d}）。作者のパソコンで Otosazu が動いていないか、公開が止まっている可能性があります。",
    ended: "この公開は終わっています。",
    forbidden: "この URL では見られません。作者から新しい URL をもらってください。",
    offline: "読み込めませんでした。しばらくしてから開き直してください。",
    badUrl: "URL が正しくありません（鍵が入っていません）。",
    hours: "{h}時間{m}分",
    minutes: "{m}分",
    // まとめページ
    addLabel: "閲覧 URL を貼り付けて追加",
    addButton: "追加",
    addBad: "閲覧 URL の形ではありません（https://…/p/…#k=… の URL を貼り付けてください）",
    colName: "作者",
    colTitle: "作品",
    colProgress: "進み具合",
    colDeadline: "締切",
    colFinish: "見込み",
    colLast: "最後の作業",
    colUpdated: "最終更新",
    namePlaceholder: "名前",
    open: "開く",
    remove: "外す",
    empty: "まだ何もありません。作者からもらった閲覧 URL を上の欄に貼り付けてください。",
    copyList: "このまとめの URL をコピー",
    copied: "コピーしました。共同の主催者に渡せば、同じまとめが見られます。",
    listNote: "作者の名前はこのブラウザにだけ保存されます。URL には入りません。",
    daysAgo: "{n} 日前",
    today: "今日",
    yesterday: "昨日",
  },
  en: {
    brand: "Otosazu",
    pageSub: "Shared progress",
    listSub: "Progress overview",
    loading: "Loading…",
    hiddenTitle: "(title hidden)",
    progress: "Progress",
    todayGain: "today +{p}%",
    completed: "Completed",
    deadline: "Deadline",
    deadlineIn: "{n} days left",
    deadlineToday: "today",
    deadlinePast: "{n} days overdue",
    noDeadline: "No deadline",
    finish: "Estimated finish",
    finishRange: "{low} – {high}",
    noFinish: "No estimate",
    statusOk: "on track",
    statusTight: "tight",
    statusLate: "likely late",
    stagesDone: "Done per stage",
    unitComic: "{n} pages",
    unitFiles: "{n} files",
    unitOther: "{n} {unit}",
    ofRows: "/{n}",
    cells: "Pages × stages",
    legendDone: "done",
    legendWorking: "in progress",
    legendOpen: "not started",
    todayTime: "Worked today {t}",
    totalTime: "Total {t}",
    lastWorked: "Last worked {d}",
    neverWorked: "No work yet",
    updated: "Updated {d}",
    stale: "Not updated for a while (last update {d}). Otosazu may not be running on the author's PC, or sharing may have stopped.",
    ended: "This share has ended.",
    forbidden: "This URL no longer works. Ask the author for a new one.",
    offline: "Could not load. Please try again later.",
    badUrl: "The URL is incomplete (no key).",
    hours: "{h}h {m}m",
    minutes: "{m}m",
    addLabel: "Paste a share URL to add",
    addButton: "Add",
    addBad: "That is not a share URL (paste a https://…/p/…#k=… URL)",
    colName: "Author",
    colTitle: "Work",
    colProgress: "Progress",
    colDeadline: "Deadline",
    colFinish: "Estimate",
    colLast: "Last worked",
    colUpdated: "Updated",
    namePlaceholder: "name",
    open: "Open",
    remove: "Remove",
    empty: "Nothing here yet. Paste the share URLs you received from authors into the box above.",
    copyList: "Copy this overview's URL",
    copied: "Copied. Anyone with this URL sees the same overview.",
    listNote: "Author names are stored only in this browser. They are not part of the URL.",
    daysAgo: "{n} days ago",
    today: "today",
    yesterday: "yesterday",
  },
  ko: {
    brand: "Otosazu",
    pageSub: "진행 상황 공개",
    listSub: "진행 상황 모아보기",
    loading: "불러오는 중…",
    hiddenTitle: "(작품명 비공개)",
    progress: "진행률",
    todayGain: "오늘 +{p}%",
    completed: "완성했습니다",
    deadline: "마감",
    deadlineIn: "{n}일 남음",
    deadlineToday: "오늘",
    deadlinePast: "{n}일 지남",
    noDeadline: "마감 없음",
    finish: "완성 예상",
    finishRange: "{low} ~ {high}",
    noFinish: "예상 없음",
    statusOk: "여유 있음",
    statusTight: "빠듯함",
    statusLate: "늦어질 전망",
    stagesDone: "공정별 완료",
    unitComic: "{n}페이지",
    unitFiles: "{n}장",
    unitOther: "{n} {unit}",
    ofRows: "/{n}",
    cells: "페이지 × 공정",
    legendDone: "완료",
    legendWorking: "작업 중",
    legendOpen: "미착수",
    todayTime: "오늘 작업 {t}",
    totalTime: "합계 {t}",
    lastWorked: "마지막 작업일 {d}",
    neverWorked: "아직 작업하지 않았습니다",
    updated: "최종 갱신 {d}",
    stale: "한동안 갱신되지 않았습니다(최종 갱신 {d}). 작가의 PC에서 Otosazu가 실행되고 있지 않거나 공개가 중단되었을 수 있습니다.",
    ended: "이 공개는 종료되었습니다.",
    forbidden: "이 URL로는 볼 수 없습니다. 작가에게 새 URL을 받아 주세요.",
    offline: "불러오지 못했습니다. 잠시 후 다시 열어 주세요.",
    badUrl: "URL이 올바르지 않습니다(키가 없습니다).",
    hours: "{h}시간 {m}분",
    minutes: "{m}분",
    addLabel: "열람 URL을 붙여넣어 추가",
    addButton: "추가",
    addBad: "열람 URL 형식이 아닙니다(https://…/p/…#k=… URL을 붙여넣어 주세요)",
    colName: "작가",
    colTitle: "작품",
    colProgress: "진행률",
    colDeadline: "마감",
    colFinish: "예상",
    colLast: "마지막 작업",
    colUpdated: "최종 갱신",
    namePlaceholder: "이름",
    open: "열기",
    remove: "제외",
    empty: "아직 아무것도 없습니다. 작가에게 받은 열람 URL을 위 칸에 붙여넣어 주세요.",
    copyList: "이 모아보기 URL 복사",
    copied: "복사했습니다. 공동 주최자에게 전달하면 같은 모아보기를 볼 수 있습니다.",
    listNote: "작가 이름은 이 브라우저에만 저장됩니다. URL에는 들어가지 않습니다.",
    daysAgo: "{n}일 전",
    today: "오늘",
    yesterday: "어제",
  },
  "zh-Hans": {
    brand: "Otosazu",
    pageSub: "进度公开",
    listSub: "进度汇总",
    loading: "加载中…",
    hiddenTitle: "（作品名未公开）",
    progress: "进度",
    todayGain: "今天 +{p}%",
    completed: "已完成",
    deadline: "截止",
    deadlineIn: "还有 {n} 天",
    deadlineToday: "今天",
    deadlinePast: "已过 {n} 天",
    noDeadline: "无截止日期",
    finish: "预计完成",
    finishRange: "{low} ～ {high}",
    noFinish: "无预测",
    statusOk: "有望赶上",
    statusTight: "紧张",
    statusLate: "可能延迟",
    stagesDone: "各工序完成数",
    unitComic: "{n} 页",
    unitFiles: "{n} 张",
    unitOther: "{n} {unit}",
    ofRows: "/{n}",
    cells: "页 × 工序",
    legendDone: "完成",
    legendWorking: "进行中",
    legendOpen: "未开始",
    todayTime: "今天工作 {t}",
    totalTime: "合计 {t}",
    lastWorked: "最后工作日 {d}",
    neverWorked: "尚未开始工作",
    updated: "最后更新 {d}",
    stale: "已有一段时间未更新（最后更新 {d}）。作者的电脑上可能没有运行 Otosazu，或公开已停止。",
    ended: "此公开已结束。",
    forbidden: "此 URL 无法查看。请向作者索取新的 URL。",
    offline: "无法加载。请稍后再打开。",
    badUrl: "URL 不正确（缺少密钥）。",
    hours: "{h}小时{m}分",
    minutes: "{m}分",
    addLabel: "粘贴查看 URL 以添加",
    addButton: "添加",
    addBad: "这不是查看 URL（请粘贴 https://…/p/…#k=… 形式的 URL）",
    colName: "作者",
    colTitle: "作品",
    colProgress: "进度",
    colDeadline: "截止",
    colFinish: "预计",
    colLast: "最后工作",
    colUpdated: "最后更新",
    namePlaceholder: "名字",
    open: "打开",
    remove: "移除",
    empty: "这里还没有内容。请把作者提供的查看 URL 粘贴到上方。",
    copyList: "复制此汇总的 URL",
    copied: "已复制。交给共同主办者即可看到同一汇总。",
    listNote: "作者名字只保存在此浏览器中，不会包含在 URL 里。",
    daysAgo: "{n} 天前",
    today: "今天",
    yesterday: "昨天",
  },
  "zh-Hant": {
    brand: "Otosazu",
    pageSub: "進度公開",
    listSub: "進度彙整",
    loading: "載入中…",
    hiddenTitle: "（作品名未公開）",
    progress: "進度",
    todayGain: "今天 +{p}%",
    completed: "已完成",
    deadline: "截止",
    deadlineIn: "還有 {n} 天",
    deadlineToday: "今天",
    deadlinePast: "已過 {n} 天",
    noDeadline: "無截止日期",
    finish: "預計完成",
    finishRange: "{low} ～ {high}",
    noFinish: "無預測",
    statusOk: "有望趕上",
    statusTight: "吃緊",
    statusLate: "可能延遲",
    stagesDone: "各工序完成數",
    unitComic: "{n} 頁",
    unitFiles: "{n} 張",
    unitOther: "{n} {unit}",
    ofRows: "/{n}",
    cells: "頁 × 工序",
    legendDone: "完成",
    legendWorking: "進行中",
    legendOpen: "未開始",
    todayTime: "今天工作 {t}",
    totalTime: "合計 {t}",
    lastWorked: "最後工作日 {d}",
    neverWorked: "尚未開始工作",
    updated: "最後更新 {d}",
    stale: "已有一段時間未更新（最後更新 {d}）。作者的電腦上可能沒有執行 Otosazu，或公開已停止。",
    ended: "此公開已結束。",
    forbidden: "此 URL 無法檢視。請向作者索取新的 URL。",
    offline: "無法載入。請稍後再開啟。",
    badUrl: "URL 不正確（缺少金鑰）。",
    hours: "{h}小時{m}分",
    minutes: "{m}分",
    addLabel: "貼上檢視 URL 以新增",
    addButton: "新增",
    addBad: "這不是檢視 URL（請貼上 https://…/p/…#k=… 形式的 URL）",
    colName: "作者",
    colTitle: "作品",
    colProgress: "進度",
    colDeadline: "截止",
    colFinish: "預計",
    colLast: "最後工作",
    colUpdated: "最後更新",
    namePlaceholder: "名字",
    open: "開啟",
    remove: "移除",
    empty: "這裡還沒有內容。請把作者提供的檢視 URL 貼到上方。",
    copyList: "複製此彙整的 URL",
    copied: "已複製。交給共同主辦者即可看到同一彙整。",
    listNote: "作者名字只儲存在此瀏覽器中，不會包含在 URL 裡。",
    daysAgo: "{n} 天前",
    today: "今天",
    yesterday: "昨天",
  },
};

/** ブラウザの言語からアプリと同じ 5 言語のどれかを選ぶ */
function pickLang() {
  const langs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || "en"];
  for (const l of langs) {
    const low = l.toLowerCase();
    if (low.startsWith("ja")) return "ja";
    if (low.startsWith("ko")) return "ko";
    if (low.startsWith("zh")) {
      if (low.includes("hant") || low.includes("tw") || low.includes("hk") || low.includes("mo")) return "zh-Hant";
      return "zh-Hans";
    }
    if (low.startsWith("en")) return "en";
  }
  return "en";
}
const LANG = pickLang();
document.documentElement.lang = LANG;

/** 訳文。{name} を埋める */
function t(key, vars) {
  let s = (MESSAGES[LANG] && MESSAGES[LANG][key]) || MESSAGES.en[key] || key;
  if (vars) for (const k of Object.keys(vars)) s = s.split(`{${k}}`).join(String(vars[k]));
  return s;
}

/** `YYYY-MM-DD` をローカルの Date に（UTC にずれないよう分解して作る） */
function parseDay(s) {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}
function startOfToday() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function dayDiff(from, to) {
  return Math.round((to - from) / 86400000);
}
const dayFmt = new Intl.DateTimeFormat(LANG, { month: "numeric", day: "numeric", weekday: "short" });
const timeFmt = new Intl.DateTimeFormat(LANG, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
function fmtDay(s) {
  const d = parseDay(s);
  return d ? dayFmt.format(d) : "";
}
function fmtDuration(ms) {
  const mins = Math.round(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? t("hours", { h, m }) : t("minutes", { m });
}
/** 「今日」「昨日」「n 日前」。それより前は日付 */
function fmtRelativeDay(s) {
  const d = parseDay(s);
  if (!d) return "";
  const n = dayDiff(d, startOfToday());
  if (n <= 0) return t("today");
  if (n === 1) return t("yesterday");
  if (n < 14) return t("daysAgo", { n });
  return dayFmt.format(d);
}

/** 締切の状態（5.5 と同じ）。finish が無ければ null */
function deadlineStatus(finish, dateStr) {
  if (!finish || !finish.mid) return null;
  const date = parseDay(dateStr);
  const mid = parseDay(finish.mid);
  const high = parseDay(finish.high);
  if (!date || !mid) return null;
  if (mid <= date) return high && high <= date ? "ok" : "tight";
  return "late";
}
/** いま見ている締切（selected）。無ければ最初の締切 */
function mainDeadline(snapshot) {
  const ds = snapshot.deadlines || [];
  return ds.find((d) => d.selected) || ds[0] || null;
}

/** 要約を取りに行く。結果は { ok, status, updatedAt, snapshot } */
async function fetchSnapshot(id, key) {
  try {
    const res = await fetch(`/p/${encodeURIComponent(id)}/snapshot`, { headers: { [READ_HEADER]: key } });
    if (!res.ok) return { ok: false, status: res.status };
    const body = await res.json();
    return { ok: true, status: 200, updatedAt: body.updatedAt, snapshot: body.snapshot };
  } catch {
    return { ok: false, status: 0 };
  }
}
function errorMessage(status) {
  if (status === 404) return t("ended");
  if (status === 403 || status === 401) return t("forbidden");
  return t("offline");
}

/** 閲覧 URL（https://…/p/<id>#k=<鍵>）を分解する。合わなければ null */
function parseShareUrl(text) {
  try {
    const u = new URL(text.trim());
    const m = /^\/p\/([0-9a-f]{16,64})\/?$/.exec(u.pathname);
    const k = new URLSearchParams(u.hash.replace(/^#/, "")).get("k");
    if (!m || !k || k.length < 16) return null;
    return { id: m[1], key: k };
  } catch {
    return null;
  }
}

function el(tag, attrs, children) {
  const e = document.createElement(tag);
  if (attrs) {
    for (const k of Object.keys(attrs)) {
      if (k === "class") e.className = attrs[k];
      else if (k === "style") e.setAttribute("style", attrs[k]);
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) e.setAttribute(k, attrs[k]);
    }
  }
  for (const c of [].concat(children || [])) {
    if (c === null || c === undefined || c === false) continue;
    e.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return e;
}

/** 工程ごとの完了数（見開きは 2）。cells が無ければ null */
function doneCounts(snapshot) {
  if (!snapshot.cells) return null;
  const counts = snapshot.stages.map(() => 0);
  snapshot.cells.forEach((row, r) => {
    const span = (snapshot.spans && snapshot.spans[r]) || 1;
    row.forEach((v, i) => {
      if (v === 2) counts[i] += span;
    });
  });
  return counts;
}
/** 行の数（見開きは 2）。cells が無ければ work.rows */
function totalUnits(snapshot) {
  if (snapshot.spans) return snapshot.spans.reduce((a, b) => a + b, 0);
  return snapshot.work.rows;
}
function unitText(snapshot, n) {
  const kind = snapshot.work.kind;
  if (kind === "comic") return t("unitComic", { n });
  if (kind === "files") return t("unitFiles", { n });
  return t("unitOther", { n, unit: snapshot.work.unit || "" });
}

/** 作品 1 つのカードを描く（p.html の本体。list.html では使わない） */
function renderWork(root, updatedAt, s) {
  root.textContent = "";
  const stale = Date.now() - updatedAt > STALE_MS;
  if (stale) root.appendChild(el("div", { class: "notice warn" }, t("stale", { d: timeFmt.format(new Date(updatedAt)) })));

  const card = el("div", { class: "card" });
  card.appendChild(
    s.work.title
      ? el("h1", { class: "title" }, s.work.title)
      : el("h1", { class: "title hidden-title" }, t("hiddenTitle")),
  );

  // 上段
  const pct = Math.round((s.progress || 0) * 100);
  const todayPct = Math.round((s.todayProgress || 0) * 100);
  const progressStat = el("div", { class: "stat" }, [
    el("div", { class: "label" }, t("progress")),
    el("div", { class: "value big" }, s.completed ? t("completed") : `${pct}%`),
    el("div", { class: "bar" }, el("i", { style: `width:${Math.min(100, pct)}%` })),
    todayPct > 0 ? el("div", { class: "note muted" }, t("todayGain", { p: todayPct })) : null,
  ]);

  const dl = mainDeadline(s);
  let deadlineStat;
  if (dl) {
    const n = dayDiff(startOfToday(), parseDay(dl.date));
    const when = n === 0 ? t("deadlineToday") : n > 0 ? t("deadlineIn", { n }) : t("deadlinePast", { n: -n });
    const st = s.completed ? null : deadlineStatus(s.finish, dl.date);
    deadlineStat = el("div", { class: "stat" }, [
      el("div", { class: "label" }, dl.name || t("deadline")),
      el("div", { class: "value" }, fmtDay(dl.date)),
      el("div", { class: "note" }, [
        when,
        st ? " · " : null,
        st ? el("span", { class: `status ${st}` }, t(st === "ok" ? "statusOk" : st === "tight" ? "statusTight" : "statusLate")) : null,
      ]),
    ]);
  } else {
    deadlineStat = el("div", { class: "stat" }, [el("div", { class: "label" }, t("deadline")), el("div", { class: "value muted" }, t("noDeadline"))]);
  }

  let finishStat = null;
  if (!s.completed) {
    finishStat = el("div", { class: "stat" }, [
      el("div", { class: "label" }, t("finish")),
      s.finish && s.finish.mid
        ? el("div", { class: "value" }, fmtDay(s.finish.mid))
        : el("div", { class: "value muted" }, t("noFinish")),
      s.finish && s.finish.low && s.finish.high
        ? el("div", { class: "note muted" }, t("finishRange", { low: fmtDay(s.finish.low), high: fmtDay(s.finish.high) }))
        : null,
    ]);
  }
  card.appendChild(el("div", { class: "summary" }, [progressStat, deadlineStat, finishStat]));

  // 工程ごとの完了数
  const counts = doneCounts(s);
  if (counts) {
    const total = totalUnits(s);
    card.appendChild(el("div", { class: "label muted small" }, t("stagesDone")));
    card.appendChild(
      el(
        "div",
        { class: "stages" },
        s.stages.map((st, i) =>
          el("span", { class: "stage" }, [
            el("i", { class: "dot", style: `background:${st.color}` }),
            el("span", null, `${st.name} `),
            el("b", null, unitText(s, counts[i])),
            el("span", { class: "muted small" }, t("ofRows", { n: total })),
          ]),
        ),
      ),
    );
  }

  // マス
  if (s.cells && s.cells.length) {
    const cols = s.cells.length;
    const grid = el("div", { class: "cells", style: `grid-template-columns: auto repeat(${cols}, max-content)` });
    s.stages.forEach((st, i) => {
      grid.appendChild(el("div", { class: "stage-name" }, st.name));
      s.cells.forEach((row, r) => {
        const v = row[i];
        const span = (s.spans && s.spans[r]) || 1;
        grid.appendChild(
          el("div", {
            class: `cell${span > 1 ? " span2" : ""}${v === 2 ? " done" : v === 1 ? " working" : ""}`,
            style: `--c:${st.color}`,
            title: `${(s.labels && s.labels[r]) || ""} ${st.name}`,
          }),
        );
      });
    });
    // 下に最初・真ん中・最後の行の名前
    grid.appendChild(el("div"));
    s.cells.forEach((_, r) => {
      const show = r === 0 || r === cols - 1 || r === Math.floor((cols - 1) / 2);
      grid.appendChild(el("div", { class: "page-label" }, show && s.labels ? s.labels[r] : ""));
    });
    card.appendChild(el("div", { class: "label muted small", style: "margin-top:12px" }, t("cells")));
    card.appendChild(el("div", { class: "cells-wrap" }, grid));
    card.appendChild(
      el("div", { class: "legend" }, [
        el("span", null, [el("i", { style: "background:var(--accent)" }), t("legendDone")]),
        el("span", null, [el("i", { style: "box-shadow:inset 0 0 0 2px var(--accent)" }), t("legendWorking")]),
        el("span", null, [el("i", { style: "background:var(--empty)" }), t("legendOpen")]),
      ]),
    );
  }

  // 下段：作業時間・最後に作業した日・最終更新
  const meta = [];
  if (s.time) {
    meta.push(el("span", null, t("todayTime", { t: fmtDuration(s.time.todayMs || 0) })));
    meta.push(el("span", null, t("totalTime", { t: fmtDuration(s.time.totalMs || 0) })));
  }
  meta.push(el("span", null, s.lastWorkedOn ? t("lastWorked", { d: fmtRelativeDay(s.lastWorkedOn) }) : t("neverWorked")));
  meta.push(el("span", null, t("updated", { d: timeFmt.format(new Date(updatedAt)) })));
  card.appendChild(el("div", { class: "meta" }, meta));

  root.appendChild(card);
}

window.OtosazuShare = {
  t,
  LANG,
  STALE_MS,
  el,
  fetchSnapshot,
  errorMessage,
  parseShareUrl,
  renderWork,
  mainDeadline,
  deadlineStatus,
  fmtDay,
  fmtRelativeDay,
  timeFmt,
  dayDiff,
  parseDay,
  startOfToday,
};
