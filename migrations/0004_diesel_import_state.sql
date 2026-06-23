-- 軽油価格 自動取込の重複防止マーカー。Refs #11 (#2)
-- cron が「取得後実施不要」を満たすため、最後に取込んだ週次ファイルの公表日キー (YYMMDD) を保持する。
-- single-row (id=1)。
CREATE TABLE IF NOT EXISTS diesel_import_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_source_key TEXT,
  last_run_at TEXT
);
