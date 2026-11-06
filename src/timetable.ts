// 複数の作品の時間割（仕様書 5.24）：全作品の残りを 1 つの器（日ごとの作業可能時間）に敷き、
// 作品ごとの完成見込み・締切までに配った時間・今日の取り分を出す。純粋関数だけで、DB も画面も触らない。
//
// 組み方は 2 通り。
// - いっぱい：全作品が器いっぱいを欲しがり、締切の早い作品から埋める。完成見込み・間に合う確率・警告に使う
// - ならし：いっぱいで間に合う作品は締切ごろに完成するよう比例配分し、それ以外は器いっぱい。今日のノルマと月の予定に使う
import { addDays, Calendar, capacity, DAY_LIMIT } from "./schedule";

export type TimetableWork = {
  workId: number;
  title: string;
  /** 残りの作業時間（標準） */
  remainingMs: number;
  lowMs: number;
  highMs: number;
  sigma: number;
  /** 計算に使う締切（pickDeadline の結果）。無ければ null */
  deadline: Date | null;
  /** 「この作品に毎日かならず」（ミリ秒／日） */
  minMs: number;
  /** 今日この作品で作業した時間 */
  workedTodayMs: number;
};

export type WorkShare = {
  /** ならしの今日の取り分（今日の作業済みぶんを含む。= 今日のノルマ） */
  todayMs: number;
  /** ならしのその日の取り分（月の予定の 1 日の予算） */
  dayMs: (d: Date) => number;
  /** その日のほかの作品の取り分の合計（月の予定の「ほか：」） */
  othersDayMs: (d: Date) => number;
  /** いっぱいで残りが尽きる日。尽きなければ null */
  finish: { low: Date | null; mid: Date | null; high: Date | null };
  /** いっぱいで締切までにこの作品に配った時間（今日の作業済みぶんを含む）。締切が無ければ配った全部 */
  allottedMs: number;
  /**
   * その日までにこの作品が使えた器（間に合う確率の分母）：その日までの器から、締切の早い作品が取ったぶんと、
   * 締切の遅い作品の下限を除いたもの。作品が 1 つなら器そのもの（今までの確率と同じ）
   */
  availableUntil: (d: Date) => number;
  /** 締切までに配りきれなかった時間（正なら足りない。締切が無ければ 0） */
  shortMs: number;
  /** この作品だけなら間に合う（deadlinePlan.feasible と同じ）。締切が無ければ true */
  aloneFeasible: boolean;
  /** 締切（無ければ完成）までにほかの作品へ配った、作業できる日 1 日あたりの平均 */
  othersPerDayMs: number;
  /** 締切（無ければ完成）までにどの作品へ何時間配ったか（締切順。0 の作品は入れない） */
  breakdown: { workId: number; ms: number }[];
};

/** これより小さい残りは 0 とみなす（ミリ秒） */
const EPS = 1;
const DAY_MS = 86_400_000;

type Run = {
  /** alloc[i][k]：今日から i 日目に k 番目の作品へ配った時間。全作品が尽きた日の翌日以降は無い */
  alloc: number[][];
  /** 残りが尽きた日（0 = 今日）。尽きなければ -1 */
  finishIdx: number[];
};

/** 全作品の時間割を組み、作品 id ごとの取り分を返す */
export function buildTimetable(works: TimetableWork[], today: Date, cal: Calendar): Map<number, WorkShare> {
  const n = works.length;
  // 器と、その累積（capUntilFrom を O(1) で出すため）
  const cap: number[] = [];
  const pre: number[] = [0];
  for (let i = 0; i < DAY_LIMIT; i++) {
    cap.push(capacity(addDays(today, i), cal));
    pre.push(pre[i] + cap[i]);
  }
  // 締切の日（今日 = 0）。過ぎていれば負
  const dIdx = works.map((w) => (w.deadline ? Math.round((w.deadline.getTime() - today.getTime()) / DAY_MS) : null));
  // 優先順位：締切の早い順（無ければ最後）、同じなら作品 id の小さい順（日によって揺れないように）
  const order = works
    .map((_, k) => k)
    .sort((a, b) => (dIdx[a] ?? Infinity) - (dIdx[b] ?? Infinity) || works[a].workId - works[b].workId);
  /** i 日目から締切までの器の合計。締切が無い・過ぎていれば 0 */
  const capUntilFrom = (i: number, k: number) => {
    const d = dIdx[k];
    if (d === null || d < i) return 0;
    return pre[Math.min(d, DAY_LIMIT - 1) + 1] - pre[i];
  };
  // ほかの作品の下限（1 日あたり floors）を除いた器の累積。floors の値ごとに 1 回だけ作る
  const netPrefixes = new Map<number, number[]>();
  const netPrefix = (floors: number) => {
    let p = netPrefixes.get(floors);
    if (!p) {
      p = [0];
      for (let i = 0; i < DAY_LIMIT; i++) p.push(p[i] + Math.max(0, cap[i] - floors));
      netPrefixes.set(floors, p);
    }
    return p;
  };
  /** i 日目から締切までの、ほかの作品の下限を除いた器の合計 */
  const netCapUntilFrom = (i: number, k: number, floors: number) => {
    const d = dIdx[k];
    if (d === null || d < i) return 0;
    const p = netPrefix(floors);
    return p[Math.min(d, DAY_LIMIT - 1) + 1] - p[i];
  };
  // 今日は全作品の作業済みぶんを残りに足し戻してから組む（5.6。ノルマは日中変わらない）
  const base = (pick: (w: TimetableWork) => number) =>
    works.map((w) => Math.max(0, pick(w)) + Math.max(0, w.workedTodayMs));

  /**
   * 日ごとに配る。smooth が null なら「いっぱい」、配列なら true の作品だけ「ならし」の必要量にする
   */
  const run = (rem0: number[], smooth: boolean[] | null): Run => {
    const rem = [...rem0];
    const alloc: number[][] = [];
    const finishIdx = rem.map((r): number => (r <= EPS ? 0 : -1));
    let open = finishIdx.filter((f) => f < 0).length;
    for (let i = 0; i < DAY_LIMIT && open > 0; i++) {
      const give = new Array<number>(n).fill(0);
      let room = cap[i];
      if (room > 0) {
        // 1. 下限：締切順に確保する
        for (const k of order) {
          if (rem[k] <= EPS || works[k].minMs <= 0) continue;
          const x = Math.min(works[k].minMs, rem[k], room);
          give[k] += x;
          room -= x;
        }
        // 2. 必要量：ならしで間に合う作品は締切までの器に比例、それ以外は器いっぱい（= 残り全部）。
        //    比例の分母は、ほかの作品の下限が毎日先に取られるぶんを除いた器にする（除かないと、下限のぶん毎日少しずつ遅れて締切に届かない）
        const openFloors = works.reduce((a, w, k) => (rem[k] > EPS ? a + w.minMs : a), 0);
        const need = works.map((w, k) => {
          if (rem[k] <= EPS) return 0;
          let want = rem[k];
          if (smooth && smooth[k] && dIdx[k] !== null) {
            const floors = openFloors - w.minMs;
            const until = netCapUntilFrom(i, k, floors);
            if (until > 0) want = Math.min(rem[k], (rem[k] * Math.max(0, cap[i] - floors)) / until);
          }
          return Math.max(0, want - give[k]);
        });
        // 3. 取り合い：収まればそのまま。収まらなければ締切の早い順に満たし、締切の無い作品どうしは残りに比例
        const total = need.reduce((a, b) => a + b, 0);
        if (total <= room) {
          need.forEach((x, k) => {
            give[k] += x;
          });
          room -= total;
        } else {
          const free: number[] = [];
          for (const k of order) {
            if (dIdx[k] === null) {
              free.push(k);
              continue;
            }
            const x = Math.min(need[k], room);
            give[k] += x;
            room -= x;
          }
          const freeTotal = free.reduce((a, k) => a + need[k], 0);
          if (freeTotal > 0) {
            const ratio = Math.min(1, room / freeTotal);
            for (const k of free) give[k] += need[k] * ratio;
            room -= Math.min(room, freeTotal);
          }
        }
      }
      alloc.push(give);
      for (let k = 0; k < n; k++) {
        if (give[k] <= 0) continue;
        rem[k] -= give[k];
        if (rem[k] <= EPS && finishIdx[k] < 0) {
          finishIdx[k] = i;
          open--;
        }
      }
    }
    return { alloc, finishIdx };
  };

  const sumUntil = (r: Run, k: number, last: number) => {
    let s = 0;
    for (let i = 0; i <= last && i < r.alloc.length; i++) s += r.alloc[i][k];
    return s;
  };

  const mid = base((w) => w.remainingMs);
  const full = run(mid, null);
  const allotted = works.map((_, k) => sumUntil(full, k, dIdx[k] ?? DAY_LIMIT));
  const feasible = works.map((_, k) => dIdx[k] === null || allotted[k] >= mid[k] - EPS);
  // ならし。比例配分のままでは締切に届かない作品（取り合いで押されたもの）が出たら、その作品だけ器いっぱいに切り替えて組み直す。
  // 切り替えた作品はいっぱいの組み方と同じ量を同じ順で受け取るので、多くても作品の数だけ繰り返せば全部が締切に収まる
  let smoothFlags = feasible;
  let smooth = run(mid, smoothFlags);
  for (let iter = 0; iter < n; iter++) {
    const late = works.map((_, k) => smoothFlags[k] && dIdx[k] !== null && sumUntil(smooth, k, dIdx[k]) < mid[k] - EPS);
    if (!late.some(Boolean)) break;
    smoothFlags = smoothFlags.map((f, k) => f && !late[k]);
    smooth = run(mid, smoothFlags);
  }
  const low = run(
    base((w) => w.lowMs),
    null,
  );
  const high = run(
    base((w) => w.highMs),
    null,
  );

  const dateOf = (idx: number) => (idx < 0 ? null : addDays(today, idx));
  const indexOf = (d: Date) => Math.round((d.getTime() - today.getTime()) / DAY_MS);
  /** k 番目の作品が last 日目までに使えた器。締切の早い作品の取り分と、遅い作品の下限（floor は min(下限, 取り分)）を除く */
  const availableUntil = (k: number, last: number) => {
    const pos = order.indexOf(k);
    let s = 0;
    for (let i = 0; i <= last && i < DAY_LIMIT; i++) {
      let used = 0;
      const row = full.alloc[i];
      if (row) order.forEach((j, p) => (p < pos ? (used += row[j]) : p > pos ? (used += Math.min(works[j].minMs, row[j])) : 0));
      s += Math.max(0, cap[i] - used);
    }
    return s;
  };

  const result = new Map<number, WorkShare>();
  works.forEach((w, k) => {
    // 内訳と平均は、締切（無ければ完成する日）までのいっぱいの組み方で見る
    const horizon = dIdx[k] ?? (full.finishIdx[k] >= 0 ? full.finishIdx[k] : full.alloc.length - 1);
    const breakdown = order
      .filter((j) => j !== k)
      .map((j) => ({ workId: works[j].workId, ms: sumUntil(full, j, horizon) }))
      .filter((b) => b.ms > EPS);
    let workDays = 0;
    for (let i = 0; i <= horizon && i < DAY_LIMIT; i++) if (cap[i] > 0) workDays++;
    const othersMs = breakdown.reduce((a, b) => a + b.ms, 0);
    result.set(w.workId, {
      todayMs: smooth.alloc[0]?.[k] ?? 0,
      dayMs: (d) => smooth.alloc[indexOf(d)]?.[k] ?? 0,
      othersDayMs: (d) => {
        const row = smooth.alloc[indexOf(d)];
        return row ? row.reduce((a, x, j) => (j === k ? a : a + x), 0) : 0;
      },
      finish: { low: dateOf(low.finishIdx[k]), mid: dateOf(full.finishIdx[k]), high: dateOf(high.finishIdx[k]) },
      allottedMs: allotted[k],
      availableUntil: (d) => availableUntil(k, indexOf(d)),
      shortMs: dIdx[k] === null ? 0 : Math.max(0, mid[k] - allotted[k]),
      aloneFeasible: dIdx[k] === null || (dIdx[k] >= 0 && capUntilFrom(0, k) >= mid[k] - EPS),
      othersPerDayMs: workDays > 0 ? othersMs / workDays : 0,
      breakdown,
    });
  });
  return result;
}
