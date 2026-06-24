-- 「計算しない (skip) 行」。Refs #63
-- 締め日別 取引先の照合画面で、特定の運転日報明細行を計算対象から外す操作を永続化する。
-- キーは producer (rust-ichibanboshi#27) の行 ID (= 管理年月日+管理C)。値カラムに依存しない
-- 安定キーなので、行が編集されても skip は残る。
CREATE TABLE IF NOT EXISTS surcharge_skips (
  row_id TEXT PRIMARY KEY,
  customer_code TEXT,
  sale_date TEXT,
  billing_date TEXT,
  note TEXT,
  created_at TEXT
);
