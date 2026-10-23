//! 完成予測（v1）。
//!
//! タスク（ページ × 工程）の予測時間 = 工程の基準時間 × ページのタグの倍率の積。
//! - 工程の基準時間：全作品の完了したタスクの実績を、タグの倍率で割って揃えたものの中央値。
//!   実績がまだ無い工程は、設定の「目安の時間」を使う
//! - タグの倍率：v1 では設定の初期倍率をそのまま使う（実績からの学習は v2 で行う）
//! - 作業途中のタスクの残り = max(予測 − 経過, 予測 × 0.1)
//!
//! ばらつき：実績と予測のずれ（対数）の標準偏差 σ から、残り合計の幅を出す。
//! 残りのタスクが多いほど個々のずれは打ち消し合い、実績が少ないほど基準時間そのものが不確か、
//! という 2 つを合わせて σ_total = √(σ²/残りタスク数 + σ²/実績数) とする。

use std::collections::HashMap;

use rusqlite::params;
use serde::Serialize;

use super::tags::SYSTEM_SPREAD;
use super::{Result, Store, db_err};

/// 実績が少ないときに使う、1 タスクのずれの目安
const DEFAULT_SIGMA: f64 = 0.3;
/// 目安の時間だけで予測している工程があるときの、全体の幅の下限
const HINT_SIGMA: f64 = 0.35;
/// 標準正規分布の 90% 点
const Z90: f64 = 1.2816;

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskPrediction {
    pub page_id: i64,
    pub stage_id: i64,
    pub predicted_ms: i64,
    pub spent_ms: i64,
    pub remaining_ms: i64,
    pub done: bool,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StageBase {
    pub stage_id: i64,
    /// タグの影響を除いた 1 ページあたりの時間
    pub base_ms: i64,
    /// 基準に使った完了タスクの数
    pub samples: i64,
    /// 実績が無く、目安の時間を使っている
    pub from_hint: bool,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Prediction {
    pub tasks: Vec<TaskPrediction>,
    /// 残り時間（標準）
    pub remaining_ms: i64,
    /// 残り時間（少なめ：10% 点）
    pub low_ms: i64,
    /// 残り時間（多め：90% 点）
    pub high_ms: i64,
    /// 残り合計の対数標準偏差（締切に間に合う確率の計算に使う）
    pub sigma: f64,
    pub stages: Vec<StageBase>,
}

impl Store {
    pub fn prediction(&self, work_id: i64, now: i64) -> Result<Prediction> {
        let factors = self.page_factors()?;
        let factor = |page: i64| factors.get(&page).copied().unwrap_or(1.0);

        // 全作品の完了タスクの実績（計測中の記録は含めない）
        let mut stmt = self
            .conn
            .prepare(
                "SELECT t.page_id, t.stage_id, SUM(ss.ended_at - ss.started_at) FROM task_done t
                 JOIN work_session ss ON ss.page_id = t.page_id AND ss.stage_id = t.stage_id
                 WHERE ss.ended_at IS NOT NULL GROUP BY t.page_id, t.stage_id",
            )
            .map_err(db_err)?;
        let samples: Vec<(i64, i64, i64)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .and_then(|rows| rows.collect())
            .map_err(db_err)?;
        let samples: Vec<(i64, f64, f64)> = samples
            .into_iter()
            .filter(|s| s.2 > 0)
            .map(|(page, stage, spent)| (stage, spent as f64, factor(page)))
            .collect();

        // 工程ごとの基準時間
        let hints: HashMap<i64, i64> = self.list_stages()?.into_iter().map(|s| (s.id, s.hint_minutes * 60_000)).collect();
        let mut bases: HashMap<i64, StageBase> = HashMap::new();
        for (&stage, &hint) in &hints {
            let mut normalized: Vec<f64> = samples.iter().filter(|s| s.0 == stage).map(|s| s.1 / s.2).collect();
            let base = if normalized.is_empty() {
                StageBase { stage_id: stage, base_ms: hint, samples: 0, from_hint: true }
            } else {
                StageBase {
                    stage_id: stage,
                    base_ms: median(&mut normalized).round() as i64,
                    samples: normalized.len() as i64,
                    from_hint: false,
                }
            };
            bases.insert(stage, base);
        }

        // 1 タスクのずれ σ（実績が 2 件以上ある工程だけで測る。1 件だとずれが必ず 0 になるため）
        let residuals: Vec<f64> = samples
            .iter()
            .filter(|s| bases[&s.0].samples >= 2)
            .map(|s| (s.1 / (bases[&s.0].base_ms as f64 * s.2)).ln())
            .collect();
        let sigma = if residuals.len() >= 3 {
            let mean = residuals.iter().sum::<f64>() / residuals.len() as f64;
            (residuals.iter().map(|r| (r - mean).powi(2)).sum::<f64>() / residuals.len() as f64)
                .sqrt()
                .clamp(0.1, 0.8)
        } else {
            DEFAULT_SIGMA
        };

        // この作品のタスク
        let board = self.board(work_id, now)?;
        let mut tasks = Vec::new();
        for page in board.pages.iter().filter(|p| !p.missing) {
            for cell in &page.cells {
                let predicted = bases.get(&cell.stage_id).map(|b| b.base_ms as f64).unwrap_or(0.0) * factor(page.id);
                let remaining = if cell.done {
                    0.0
                } else {
                    (predicted - cell.total_ms as f64).max(predicted * 0.1)
                };
                tasks.push(TaskPrediction {
                    page_id: page.id,
                    stage_id: cell.stage_id,
                    predicted_ms: predicted.round() as i64,
                    spent_ms: cell.total_ms,
                    remaining_ms: remaining.round() as i64,
                    done: cell.done,
                });
            }
        }

        let open: Vec<&TaskPrediction> = tasks.iter().filter(|t| !t.done).collect();
        let remaining: i64 = open.iter().map(|t| t.remaining_ms).sum();
        let open_stages: Vec<i64> = board.stages.iter().map(|s| s.id).filter(|id| open.iter().any(|t| t.stage_id == *id)).collect();
        let n_samples: i64 = open_stages.iter().map(|id| bases[id].samples).sum();
        let uses_hint = open_stages.iter().any(|id| bases[id].from_hint);
        let total_sigma = if open.is_empty() {
            0.0
        } else {
            let s = (sigma.powi(2) / open.len() as f64 + sigma.powi(2) / n_samples.max(1) as f64).sqrt();
            if uses_hint { s.max(HINT_SIGMA) } else { s }
        };

        let stages = board.stages.iter().filter_map(|s| bases.remove(&s.id)).collect();
        Ok(Prediction {
            tasks,
            remaining_ms: remaining,
            low_ms: (remaining as f64 * (-Z90 * total_sigma).exp()).round() as i64,
            high_ms: (remaining as f64 * (Z90 * total_sigma).exp()).round() as i64,
            sigma: total_sigma,
            stages,
        })
    }

    /// 全ページのタグの倍率の積（隠したタグは除く。見開きは span = 2 から）
    fn page_factors(&self) -> Result<HashMap<i64, f64>> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT pt.page_id, t.initial_factor FROM page_tag pt JOIN tag_def t ON t.id = pt.tag_id
                 WHERE t.hidden = 0
                 UNION ALL
                 SELECT p.id, t.initial_factor FROM page p JOIN tag_def t ON t.system = ?1
                 WHERE p.span = 2 AND t.hidden = 0",
            )
            .map_err(db_err)?;
        let rows: Vec<(i64, f64)> = stmt
            .query_map(params![SYSTEM_SPREAD], |r| Ok((r.get(0)?, r.get(1)?)))
            .and_then(|rows| rows.collect())
            .map_err(db_err)?;
        let mut factors = HashMap::new();
        for (page, f) in rows {
            *factors.entry(page).or_insert(1.0) *= f;
        }
        Ok(factors)
    }
}

fn median(v: &mut [f64]) -> f64 {
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let n = v.len();
    if n % 2 == 1 { v[n / 2] } else { (v[n / 2 - 1] + v[n / 2]) / 2.0 }
}

#[cfg(test)]
mod tests {
    use super::super::tests::{MIN, setup, stage_ids};
    use super::*;

    fn tag(store: &Store, name: &str) -> i64 {
        store.list_tags().unwrap().into_iter().flat_map(|g| g.tags).find(|t| t.name == name).unwrap().id
    }

    /// ページにタスクの実績を入れて完了にする
    fn finish(store: &Store, page: i64, stage: i64, minutes: i64, at: &mut i64) {
        store.add_session(page, stage, *at, *at + minutes * MIN, i64::MAX).unwrap();
        store.set_task_done(page, stage, true, 0).unwrap();
        *at += minutes * MIN + MIN;
    }

    #[test]
    fn 実績が無い工程は目安の時間を使う() {
        let (store, id) = setup();
        let p = store.prediction(id, 0).unwrap();
        // 下書き 60 分 / ペン入れ 90 分 / トーン 60 分（目安）
        let bases: Vec<(i64, bool)> = p.stages.iter().map(|s| (s.base_ms / MIN, s.from_hint)).collect();
        assert_eq!(bases, [(60, true), (90, true), (60, true)]);
        // setup は p1・p2-3（見開き ×2.0）・p4 → 4 ページ分 × 210 分
        assert_eq!(p.remaining_ms, 4 * 210 * MIN);
        assert!(p.low_ms < p.remaining_ms && p.remaining_ms < p.high_ms);
        assert!((p.sigma - HINT_SIGMA).abs() < 1e-9);
    }

    #[test]
    fn 基準時間はタグの倍率で揃えた実績の中央値() {
        let (store, id) = setup();
        let st = stage_ids(&store);
        let pages: Vec<i64> = store.board(id, 0).unwrap().pages.iter().map(|p| p.id).collect();
        store.set_page_tag(&[pages[2]], tag(&store, "コマ多"), true).unwrap(); // p4 は ×1.3
        let mut at = 0;
        finish(&store, pages[0], st[0], 50, &mut at); // 50
        finish(&store, pages[1], st[0], 120, &mut at); // 見開き 120 / 2.0 = 60
        finish(&store, pages[2], st[0], 91, &mut at); // 91 / 1.3 = 70

        let p = store.prediction(id, at).unwrap();
        assert_eq!(p.stages[0].base_ms, 60 * MIN);
        assert_eq!(p.stages[0].samples, 3);
        assert!(!p.stages[0].from_hint);

        // p4 のペン入れ：目安 90 分 × コマ多 1.3
        let t = p.tasks.iter().find(|t| t.page_id == pages[2] && t.stage_id == st[1]).unwrap();
        assert_eq!(t.predicted_ms, 117 * MIN);
        // 下書きは全部完了しているので残りに入らない
        assert!(p.tasks.iter().filter(|t| t.stage_id == st[0]).all(|t| t.done && t.remaining_ms == 0));
    }

    #[test]
    fn 途中のタスクは経過時間を引き_最低でも予測の1割を残す() {
        let (store, id) = setup();
        let st = stage_ids(&store);
        let page = store.board(id, 0).unwrap().pages[0].id;
        store.add_session(page, st[0], 0, 20 * MIN, i64::MAX).unwrap();
        let p = store.prediction(id, 0).unwrap();
        let t = p.tasks.iter().find(|t| t.page_id == page && t.stage_id == st[0]).unwrap();
        assert_eq!((t.spent_ms, t.remaining_ms), (20 * MIN, 40 * MIN));

        // 予測より長くかかっていても、終わるまでは 1 割（6 分）残す
        store.add_session(page, st[0], 30 * MIN, 130 * MIN, i64::MAX).unwrap();
        let p = store.prediction(id, 0).unwrap();
        let t = p.tasks.iter().find(|t| t.page_id == page && t.stage_id == st[0]).unwrap();
        assert_eq!(t.remaining_ms, 6 * MIN);
    }

    #[test]
    fn 計測中の時間も経過に含める() {
        let (store, id) = setup();
        let st = stage_ids(&store);
        let page = store.board(id, 0).unwrap().pages[0].id;
        store.start_timer(page, st[0], 0).unwrap();
        let p = store.prediction(id, 15 * MIN).unwrap();
        let t = p.tasks.iter().find(|t| t.page_id == page && t.stage_id == st[0]).unwrap();
        assert_eq!(t.remaining_ms, 45 * MIN);
    }

    #[test]
    fn 実績が増えると幅が狭くなる() {
        let (store, id) = setup();
        let st = stage_ids(&store);
        let pages: Vec<i64> = store.board(id, 0).unwrap().pages.iter().map(|p| p.id).collect();
        let mut at = 0;
        // 全工程に実績を入れる（ばらつきは小さめ）
        for (i, &stage) in st.iter().enumerate() {
            finish(&store, pages[0], stage, 60 + i as i64 * 10, &mut at);
            finish(&store, pages[2], stage, 66 + i as i64 * 10, &mut at);
        }
        let few = store.prediction(id, at).unwrap();
        assert!(few.sigma < HINT_SIGMA);

        // 別の作品の実績も基準に使われる
        let other = store
            .add_work("C:/b.cmc", &super::super::tests::comic(&[("a.clip", 1), ("b.clip", 1), ("c.clip", 1)]), 0)
            .unwrap();
        for page in store.board(other, 0).unwrap().pages {
            for (i, &stage) in st.iter().enumerate() {
                finish(&store, page.id, stage, 62 + i as i64 * 10, &mut at);
            }
        }
        let many = store.prediction(id, at).unwrap();
        assert!(many.stages.iter().all(|s| s.samples == 5));
        assert!(many.sigma < few.sigma);
    }

    #[test]
    fn 全部終わると残りはゼロ() {
        let (store, id) = setup();
        let st = stage_ids(&store);
        for page in store.board(id, 0).unwrap().pages {
            for &stage in &st {
                store.set_task_done(page.id, stage, true, 0).unwrap();
            }
        }
        let p = store.prediction(id, 0).unwrap();
        assert_eq!((p.remaining_ms, p.low_ms, p.high_ms, p.sigma), (0, 0, 0, 0.0));
    }
}
