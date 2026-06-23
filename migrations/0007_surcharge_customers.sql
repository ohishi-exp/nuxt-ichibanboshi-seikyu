-- サーチャージマスタ (サーチャージ対象として登録する取引先)。Refs #11
-- 締め日別の確認画面で「登録有無」を表示し、その場で追加/削除する。
CREATE TABLE IF NOT EXISTS surcharge_customers (
  customer_code TEXT PRIMARY KEY,
  customer_name TEXT NOT NULL DEFAULT '',
  created_at TEXT
);
