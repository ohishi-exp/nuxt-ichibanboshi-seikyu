-- 軽油価格の週次全国平均 (検算用)。Refs #11 (#2)
-- diesel_price (月次平均) の検算用に、取込時の元の週次 全国平均を保存する。
CREATE TABLE IF NOT EXISTS diesel_price_weekly (
  survey_date TEXT PRIMARY KEY,
  month TEXT NOT NULL,
  price REAL NOT NULL
);
