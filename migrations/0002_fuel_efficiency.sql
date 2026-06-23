-- 燃費マスタ (有効期間つき)。Refs #11 (#1 マスタ整備)
-- 車種ごとの燃費 km/L を「いつから・いつまで」で保持する。valid_to 空 = 無期限。
-- 同一車種で期間が重なる場合は valid_from が新しい方を採用する (resolveFuelEfficiency)。
CREATE TABLE IF NOT EXISTS fuel_efficiency (
  sharu_c    TEXT NOT NULL,
  name       TEXT NOT NULL DEFAULT '',
  km_per_l   REAL NOT NULL,
  valid_from TEXT NOT NULL,
  valid_to   TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (sharu_c, valid_from)
);
