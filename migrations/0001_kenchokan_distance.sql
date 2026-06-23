-- 県庁間距離マスタ (距離制サーチャージ用)。Refs #11
-- 都道府県の表示順・県庁所在地と、from/to ペアの距離 km を保持する。
CREATE TABLE IF NOT EXISTS kenchokan_prefecture (
  pref       TEXT PRIMARY KEY,
  city       TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS kenchokan_distance (
  from_pref TEXT NOT NULL,
  to_pref   TEXT NOT NULL,
  km        INTEGER NOT NULL,
  PRIMARY KEY (from_pref, to_pref)
);
