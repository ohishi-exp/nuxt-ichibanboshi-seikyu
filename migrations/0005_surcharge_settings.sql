-- サーチャージ設定 (基準価格 / 刻み幅)。Refs #11
-- 届出書の前提値を画面から変更可能にする。single-row (id=1)。
CREATE TABLE IF NOT EXISTS surcharge_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  base_price REAL NOT NULL,
  price_step REAL NOT NULL
);
