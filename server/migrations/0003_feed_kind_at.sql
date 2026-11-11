-- 作業中の人数（12 時間以内に start を送った送り手の数）を、この索引だけで数える。
-- 無いと feed_sender_at を端から端まで読む。アプリが 1 分おきに取りに来るので、表が育つと
-- D1 の無料枠（1 日 500 万行の読み取り）を超える（2026-11-11 に実際に超えた）。
CREATE INDEX feed_kind_at ON feed (kind, at, sender);
