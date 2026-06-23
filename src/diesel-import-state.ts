// 軽油価格 自動取込の重複防止マーカーの D1 アクセス。Refs #11 (#2)
//
// cron が「取得後実施不要」を満たすため、最後に取込んだ週次ファイルの公表日キー (YYMMDD) を
// single-row (id=1) で保持する。最新の利用可能ファイルのキーが保存済みキーと同じなら skip する。

import type { D1Database } from './distance-db'

export const DIESEL_IMPORT_STATE_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS diesel_import_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    last_source_key TEXT,
    last_run_at TEXT
  )`,
]

export async function ensureDieselImportStateSchema(db: D1Database): Promise<void> {
  for (const ddl of DIESEL_IMPORT_STATE_DDL) {
    await db.prepare(ddl).run()
  }
}

interface StateRow {
  last_source_key: string | null
}

/** 最後に取込んだ週次ファイルの公表日キー (YYMMDD) を返す。未取込なら null */
export async function getLastImportKey(db: D1Database): Promise<string | null> {
  const res = await db
    .prepare('SELECT last_source_key FROM diesel_import_state WHERE id = 1')
    .all<StateRow>()
  return res.results[0]?.last_source_key ?? null
}

/** 取込んだ週次ファイルの公表日キーと実行時刻を記録する (upsert) */
export async function setLastImportKey(
  db: D1Database,
  key: string,
  runAt: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO diesel_import_state (id, last_source_key, last_run_at) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET last_source_key = excluded.last_source_key, last_run_at = excluded.last_run_at`,
    )
    .bind(key, runAt)
    .run()
}
