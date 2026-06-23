-- 当月軽油価格マスタ (燃料サーチャージの monthlyDieselPrice)。Refs #11 (#2)
-- 年月 (YYYY-MM) ごとの全国平均軽油価格 (円/L) を保持する。
CREATE TABLE IF NOT EXISTS diesel_price (
  month TEXT PRIMARY KEY,
  price REAL NOT NULL
);
