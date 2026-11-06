# 実装計画：複数の作品の時間割（仕様書 5.24、3.2.0）

Skeb のような短い締切の依頼をいくつか抱えながら 2 か月後の漫画を描く人のために、全作品の残りを 1 つの時間割に敷き、
各作品の見込み・確率・ノルマ・月の予定を「ほかの作品込み」の数字にする。時間が足りないときは作品一覧とスケジュール画面で警告する。
仕様は [SPEC.md](SPEC.md) の 5.24 が正本。ここには「どの順で、何を作り、何で確かめるか」だけを書く。終わった工程は見出しに（済）を付ける。
前の計画（共同作業の取り込み、3.0.0）は [docs/plan-collab-3.0.0.md](docs/plan-collab-3.0.0.md) に移した。

## 0. 先に決めたこと

| 決めごと | 決定 |
|---|---|
| 計算の場所 | 時間割は TypeScript の純粋関数（新しい `src/timetable.ts`）。Rust は全作品ぶんの入力を 1 つのコマンドで返すだけ |
| 組み方 | 「いっぱい」と「ならし」の 2 通り（5.24 の配り方）。先に「いっぱい」で各作品が間に合うかを決め、それを見て「ならし」を組む |
| どの数字がどちらか | 完成見込み・間に合う確率・警告 = いっぱい。今日のノルマ・今日の案・月の予定 = ならし。1 日あたりの必要時間は今の `deadlinePlan` のまま（この作品だけの数字） |
| 作品が 1 つのとき | いっぱい = 今の `finishDate`、ならしの今日の取り分 = 今の `deadlinePlan.todayQuotaMs` に一致させる（テストで固定する） |
| 入力の読み方 | `get_timetable_input` を**版（`app.version`）ごとに 1 回だけ**読み、全画面で共有する。作品一覧はカードごとに `useForecast` を呼ぶので、ここを共有しないと作品数の 2 乗で予測を計算してしまう |
| 予測の計算量 | Rust 側はタグ倍率のモデル（`model()`）を 1 回だけ学習し、作品ごとの残りはそれを使い回す（今の `prediction()` は呼ぶたびに学習している） |
| 作品ごとの作業時間 | `work.weekday_hours` を消す。更新時に上書きの値は捨てる。データベースは版 11 |
| 締切の扱い | 選んだ締切は全部「必ず守る」。収まらなければ利用者が別の締切を選ぶ（複数の締切で「最悪どこまで遅らせられるか」を表す）。作品ごとの下限・優先度・緩さの区分は置かない（3 の「作ってみて決まったこと」） |
| スライダー | 5.5 A のスライダーは残すが、保存先は全作品の既定値（`set_default_hours`）にする。動かしている間は下書きの器で全作品の時間割を組み直す |
| 出す版 | 3.2.0。公開の要約の形式（snapshot）は変えない（完成見込みの中身が変わるだけ） |

**リスク**：時間割を全画面で使うので、1 作品のときの結果が今と変わると既存の利用者が気づく。工程 1 の「一致するテスト」を最初に書き、
以降の工程でも `npm test` で守る。もう 1 つ、`get_timetable_input` は作品数ぶんの盤面を読むので、作品が多い人（20 作品など）で
遅くなりうる。`dummy-data` で作品を増やして測り、遅ければ盤面を読まずに残りだけを集計する SQL に替える。

## 1. 時間割の計算（TypeScript、`src/timetable.ts`、テスト）（済）

純粋関数だけ。DB も画面も触らない。

作ってみて決まったこと：
- 比例配分のままでは締切に届かない作品（取り合いで押されたもの）が出たら、その作品だけ器いっぱいに切り替えて組み直す安全弁を置く
  （作品の数だけで必ず収まる。乱数のテストで見つかった）
- はじめは作品ごとの下限（「この作品に毎日かならず」）を先に確保する段があったが、工程 3 のあとで消した（3 を参照）
- 間に合わない作品の今日のノルマは器いっぱい（作業可能時間まで）。今の `deadlinePlan.todayQuotaMs` は作業可能時間を超える値を出すので、
  ここだけは一致しない。1 作品のときの一致は「間に合うときのノルマ」と「完成日（3 通り）」で確かめる

```ts
export type TimetableWork = {
  workId: number;
  title: string;
  remainingMs: number;   // 標準
  lowMs: number;
  highMs: number;
  sigma: number;
  deadline: Date | null; // 計算に使う締切（pickDeadline の結果）。無ければ null。必ず守るものとして扱う
  workedTodayMs: number; // 今日この作品で作業した時間（spans から。5.11 の区切りで）
};
export type WorkShare = {
  todayMs: number;                  // ならしの今日の取り分（作業済みぶんを含む。= 今日のノルマ）
  dayMs: (d: Date) => number;       // ならしのその日の取り分（月の予定の 1 日の予算）
  othersDayMs: (d: Date) => number; // その日のほかの作品の取り分の合計（月の予定の「ほか：」）
  finish: { low: Date | null; mid: Date | null; high: Date | null }; // いっぱい
  allottedMs: number;               // いっぱいで締切までにこの作品に配った時間
  availableUntil: (d: Date) => number; // その日までにこの作品が使えた器（確率の分母。器 − 締切の早い作品の取り分）
  shortMs: number;                  // 残り − allottedMs（正なら足りない。締切が無ければ 0）
  aloneFeasible: boolean;           // この作品だけなら間に合う（deadlinePlan.feasible）
  othersPerDayMs: number;           // 締切までにほかの作品へ配った 1 日平均
  breakdown: { workId: number; ms: number }[]; // 締切までにどの作品へ何時間（内訳）
};
export function buildTimetable(works: TimetableWork[], today: Date, cal: Calendar): Map<number, WorkShare>;
```

- 器 `capacity(d, cal)` は `schedule.ts` のものをそのまま使う。期間は今日から `DAY_LIMIT`（3 年）まで
- **いっぱい**：日ごとに、器を締切の早い作品から埋める（締切の無い作品は最後。複数あれば残りに比例）。
  少なめ／多めは、全作品の残りを `lowMs` / `highMs` にして同じように組む
- **ならし**：いっぱいの結果で間に合う作品だけ必要量を `残り × その日の器 ÷ 締切までの器の合計` にし、それ以外は器いっぱい。
  器の累積は前計算する
- 今日は全作品の `workedTodayMs` を残りに足し戻してから組む（5.6）。`todayMs` は足し戻した取り分
- 優先順位の同点（同じ締切日）は作品 id の小さい順で固定する（表示が日によって揺れないように）
- `schedule.ts` の `DAY_LIMIT` を export して `calendar.ts` と共有する（今はそれぞれに 3 年を持っている）

**テスト（`src/timetable.test.ts`）**
- 作品 1 つ：`finish.mid` が `finishDate` と、`todayMs` が `deadlinePlan(...).todayQuotaMs` と、残りを 0.5 時間刻みで振った 20 通りで一致する。
  締切なし・間に合わない・休みの日を含む・今日の作業済みあり、の 4 条件でも
- 締切の早い作品が先に埋まり、遅い作品の `finish.mid` が後ろにずれる
- 早い作品が間に合わないあいだ、遅い作品には回らない（締切を過ぎても早い作品が先。終わった日から遅い作品に回る）
- 締切の無い作品どうしは残りに比例して分かれる
- 配れなかったぶんが翌日に持ち越され、残りの合計は保存される（全日の取り分の合計 = 全作品の残り + 今日の作業済み）
- 警告の出し分け：`aloneFeasible && shortMs > 0`（ほかの作品のせい）と `!aloneFeasible`（この作品だけでも足りない）
- 器が 0 の期間（全日休み）で null と `shortMs` が正しく出る

**確かめ方**：`npm test -- timetable`

## 2. 入力の呼び口（Rust、版 11）（済）

作ってみて決まったこと：
- アプリに「アーカイブ」は無いので、時間割の入力は残りのある全作品。休止したい作品は残りのマスを対象外にして外す（仕様書 5.24 も直した）
- `set_work_hours` を消したので、5.5 A のスライダーの保存先はこの工程で `set_default_hours` に替えた（工程 3 の先取り。
  「全作品の既定に戻す」のボタンと文言 `resetHours` は消した）。`WorkSchedule` の型とテストの雛形も合わせた
- はじめは `work.min_hours`（下限）と `set_min_hours` も足していたが、工程 3 のあとで消した（3 を参照）。版 11 はまだ配っていないので、移行を書き直した

```sql
-- 版 11
ALTER TABLE work DROP COLUMN weekday_hours;  -- 作品ごとの上書きをやめる（値は捨てる）
```

- `store/mod.rs`：`LATEST = 11`、上の移行。移行テスト（版 10 → 11 で `weekday_hours` が無くなる）。
  rusqlite の bundled SQLite は `DROP COLUMN` に対応している（3.35 以降）
- `store/schedule.rs`：`WorkSchedule` から `custom_hours` と `default_weekday_hours` を消し、`weekday_hours` は全作品の既定値そのものにする。
  `set_work_hours` を消す
- `store/predict.rs`：`prediction()` を「モデルを受け取って作品の残りを出す」`prediction_with(&model, work_id, now)` に分け、
  `timetable_input(now) -> Vec<TimetableWorkInput>` を足す。全作品について
  `{ work_id, title, remaining_ms, low_ms, high_ms, sigma, deadlines, selected_deadline }`。残りが 0 の作品は入れない。
  モデルの学習は 1 回だけ
- `lib.rs`：`get_timetable_input`。`set_work_hours` を消す。
  `server.rs` の `ALLOWED` に `get_timetable_input` を足す（遠隔の画面のノルマに要る。秘密は含まない）
- テスト：移行、`timetable_input` が完成済みの作品を入れないこと、`prediction_with` が `prediction()` と同じ結果

**確かめ方**：`cargo test`（`src-tauri/` で）

## 3. forecast と画面をつなぐ（TypeScript）（済）

作ってみて決まったこと：
- **作品ごとの下限（「この作品に毎日かならず」）はやめた。** 画面まで作って動かしてみたが、何時間と指定させるのは利用者に手段を
  決めさせていて筋が悪い。「絶対に間に合わせる／遅れてもよい」の区分も考えたが、「どのくらい緩いか」が利用者ごとの価値判断になる。
  代わりに**選んだ締切は全部「必ず守る」**として扱い、収まらないときは別の締切を選んでもらう（「最悪どこまで遅らせられるか」を
  5.19 の複数の締切で表す）。締切の早い順に配れば、収まる並べ方があるなら必ず収まるので、優先度は要らない。
  そのために、締切ごとに「その締切を選んだら収まるか」（`DeadlineView.shortMs`。この作品の締切をその日に差し替えて組み直す）を出し、
  タブに ⚠、警告に「○○ なら収まります」と切り替えるボタンを足した。下限の段と、それを除いた器の計算は `timetable.ts` から消した
- 確率の分母は「配った時間」ではなく「使えた器」（`WorkShare.availableUntil`）。配った時間は残りで頭打ちになるので、
  間に合う作品の確率が必ず 50% になってしまう。使えた器 = 器 − 締切の早い作品の取り分。1 作品なら器そのもの（テストで固定）
- `computeForecast` はこの作品のぶんを、いま読んだ盤面と予測から作り直して時間割に入れる（時間割の入力と読んだ時刻がずれても食い違わない）。
  `timetable` を渡さなければこの作品だけで組むので、既存のテストはそのまま通る
- 作品一覧の警告の 1 行は、カードの `useForecast` とは別に `useTimetable()`（入力 + 今日の記録 + 器）で全作品の取り分を組む
- 月の欄の「ほか」は作品名を出さず合計だけ（欄が狭い。仕様書も合わせた）
- 作品名を押すとスケジュール画面へ：`WorksScreen` の `onOpen` に行き先（`"schedule"`）を足した

- `src/api.ts`：`WorkSchedule` の型を 2 に合わせる。`TimetableWorkInput`、`getTimetableInput()`。`setWorkHours` を消す
- `src/forecast.ts`
  - `useTimetableInput()`：`app.version` をキーにした小さなキャッシュ（モジュール変数に Promise を 1 つ）。同じ版なら 1 回しか読まない
  - `useForecast(workId, hoursOverride?)` は時間割の入力も読み、`computeForecast(..., timetable)` に渡す。
    `computeForecast` は `buildTimetable` を呼び、`Forecast` に `share: WorkShare` を足す。
    `finish` は `share.finish`、`deadlines[].probability` は `onTimeProbability(remaining, sigma, share.allottedMs − 今日の作業済み)`、
    `quotaMs` は `share.todayMs`。`deadlines[].plan`（1 日あたりの必要時間）はそのまま残す
  - `monthInput()`：`MonthInput` の `cal` と `ratio` をやめ、`budgetOf: (d: Date) => number` にする（`calendar.ts` の `planMonth` も合わせる）。
    今日のぶんは `share.todayMs − workedTodayMs`
  - 時間割の入力はスライダーの下書き（`hoursOverride`）でも組み直せる（純粋関数なので、器だけ差し替える）
- `src/publish.ts`：`publishAll` が作品ごとに `getBoard/getPrediction/getSchedule/listSpans` を読んでいるところに、時間割の入力を 1 回読んで全作品に渡す
- `src/ai.ts`：締切の節に「ほかの作品に 1 日 ○時間」と、確率がほかの作品込みであることを添える
- 画面
  - `screens/ScheduleScreen.tsx` の FinishTab：スライダーの保存先を `api.setDefaultHours` にする。「全作品の既定に戻す」を消す
  - 同 DeadlineTab：「このままでは間に合いません」に理由を添える（`aloneFeasible` で 2 通り）と、内訳（`breakdown`）、
    どうすればよいかの 1 行（収まる締切があれば「○○ なら収まります」と切り替えるボタン、無ければ締切の見直しを促す）。
    締切のタブに、その締切なら収まるかの ⚠。1 日あたりの必要時間の横に「ほかの作品に ○時間/日 → この作品に使えるのは ○時間/日」
  - `screens/WorksScreen.tsx`：一覧の上に警告の 1 行（`shortMs > 0` の作品を締切順に。作品名を押すとその作品のスケジュール画面へ）。
    カードに「今日 ○h」（`share.todayMs`）
  - `screens/MonthTab.tsx`：日の欄に「ほか：Skeb A 1.5h」（`othersDayMs` が 0 より大きい日だけ、薄く）
  - `BoardScreen.tsx` の FinishCard・TodayStrip、`MiniApp.tsx`、`RemoteApp.tsx`、`ShareDialog.tsx`：`Forecast` を使うだけなので直さない。
    ボードの FinishCard が出す曜日の時間は全作品の既定値になる（今も `schedule.weekdayHours` を出している）
- `src/i18n/`：`schedule.ts`（理由・内訳・ほかの作品・収まる締切）、`works.ts`（警告・今日）、`month.ts`（ほか：）、`ai.ts` を 5 言語
- テスト：`ai.test.ts`・`publish.test.ts` の `computeForecast` の呼び出しを直す。`calendar.test.ts` の `MonthInput` を `budgetOf` に

**確かめ方**：`npm test`。画面は `OTOSAZU_DB` を分けた `tauri dev` で下の「手で確かめること」

## 4. 説明書・BOOTH・版

- `docs/guide/guide.html`：「完成日を見る」の行を全作品共通の作業時間に書き換える。新しい節「複数の作品を同時に進めるとき」
  （時間割の考え方、警告の 2 通り、収まらないときは別の締切を選ぶ、Skeb と漫画の例）。更新で作品ごとの作業時間が消える旨を「更新したとき」に
- `docs/booth.md`：詳細に 1 段落、アップデート履歴に 3.2.0
- 版を 3.2.0 に上げる（`docs/release.md` の 1 の 5 か所）

## 手で確かめること（3.2.0 を出す前）

`OTOSAZU_DB` を分けた `tauri dev` に、締切 5 日後の「Skeb A」、10 日後の「Skeb B」、60 日後の「漫画」の 3 作品を作る（ファイルを持たない作品でよい）。

1. 設定の作業時間を平日 3h・土日 6h にして、Skeb A・B の残りを大きめに入れる → 作品一覧の上に警告が出て、漫画のカードの完成見込みが締切の後ろへずれる
2. 漫画のスケジュール画面：「この作品だけなら間に合いますが、Skeb A・Skeb B と合わせると ○時間 足りません」と内訳。Skeb A は「この作品だけで計算しても…」
3. Skeb B に遅い締切を足す → 選んでいる締切のタブに ⚠、遅い締切のタブには無し。警告に「○○ なら収まります」と切り替えるボタンが出て、
   押すと警告が消え、漫画の月の予定の「ほか」が変わる。ミニ窓と遠隔の画面のゲージも同じノルマ
4. 5.5 A のスライダーを動かす → 3 作品すべての見込みがその場で変わり、設定画面の曜日ごとの作業時間も同じ値になっている
5. 漫画の月の予定：日の欄に「ほか：Skeb A ○h」が出て、Skeb の締切を過ぎた日から漫画の時間が増える。.ics は作品ごとのまま
6. Skeb A を完了（残り 0）にする → 警告から消え、漫画の見込みが前に戻る
7. 進捗の公開をオンにして、閲覧ページの完成見込みが時間割の値になっている。AI の文の締切の節に「ほかの作品に」が入る
8. 版 10 のバックアップを復元して起動 → 作品ごとの作業時間の上書きが消え、エラーなく開く

## 順番と区切り

1 → 2 → 3 → 4。1 は純粋関数なので先に単独でテストまで終える。2 と 1 は独立で、3 が両方をつなぐ。4 は 3 の画面が固まってから。
コミットは工程ごと（3 は forecast／スケジュール画面／作品一覧と月の予定／AI と公開、の 4 つに分けてよい）。

## やらないこと（3.2.0 では）

- 全作品をまとめた「今日のやること」（横断の今日画面）
- 作品の休止（時間割から外す）。アーカイブで外す
- 作品ごとの上限（「この作品には 1 日 2 時間まで」）・下限・優先度や緩さの区分（3 の「作ってみて決まったこと」）
- 受ける前の試算（仮の依頼を足して見込みの動きを見る専用の画面）
- 「この作品だけで計算する」への切り替え
- 全作品をまとめた AI 相談（5.21）
