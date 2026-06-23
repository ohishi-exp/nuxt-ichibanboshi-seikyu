// 燃費マスタ (有効期間つき) の D1 データアクセス。Refs #11 (#1 マスタ整備)
//
// 県庁間距離マスタ (distance-db.ts) と同じく、データ投入は Excel→CSV upload で全置換
// (/api/fuel-efficiency POST)、download は現行 D1 を CSV 化 (/api/fuel-efficiency GET)。
// 純粋変換 (rowsToEntries / entriesToRows) と D1 glue を分離してテストする。

import type { D1Database, D1PreparedStatement } from './distance-db'
import type { FuelEfficiencyEntry } from './fuel-efficiency'

// migrations/0002_fuel_efficiency.sql と同一 DDL (idempotent)。
export const FUEL_SCHEMA_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS fuel_efficiency (
    sharu_c    TEXT NOT NULL,
    name       TEXT NOT NULL DEFAULT '',
    km_per_l   REAL NOT NULL,
    valid_from TEXT NOT NULL,
    valid_to   TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (sharu_c, valid_from)
  )`,
]

/** D1 に燃費マスタのスキーマを適用する (CREATE TABLE IF NOT EXISTS、何度呼んでも安全) */
export async function ensureFuelSchema(db: D1Database): Promise<void> {
  for (const ddl of FUEL_SCHEMA_DDL) {
    await db.prepare(ddl).run()
  }
}

export interface FuelRow {
  sharu_c: string
  name: string
  km_per_l: number
  valid_from: string
  valid_to: string
}

/** D1 行 → FuelEfficiencyEntry[] (純粋)。valid_to の空文字は undefined に正規化 */
export function rowsToEntries(rows: FuelRow[]): FuelEfficiencyEntry[] {
  return rows.map((r) => {
    const entry: FuelEfficiencyEntry = {
      sharuC: r.sharu_c,
      name: r.name,
      kmPerL: r.km_per_l,
      validFrom: r.valid_from,
    }
    if (r.valid_to !== '') entry.validTo = r.valid_to
    return entry
  })
}

/** FuelEfficiencyEntry[] → D1 行 (純粋)。undefined の validTo は空文字へ */
export function entriesToRows(entries: FuelEfficiencyEntry[]): FuelRow[] {
  return entries.map((e) => ({
    sharu_c: e.sharuC,
    name: e.name,
    km_per_l: e.kmPerL,
    valid_from: e.validFrom,
    valid_to: e.validTo ?? '',
  }))
}

/** D1 から現行の燃費マスタを読み出す */
export async function loadFuelEfficiency(db: D1Database): Promise<FuelEfficiencyEntry[]> {
  const res = await db
    .prepare(
      'SELECT sharu_c, name, km_per_l, valid_from, valid_to FROM fuel_efficiency ORDER BY sharu_c, valid_from',
    )
    .all<FuelRow>()
  return rowsToEntries(res.results)
}

// D1 の bound parameter 上限 (~100) を避けるため 1 INSERT あたりの行数を抑える (5 列)。
const INSERT_CHUNK = 18

/** 燃費マスタを D1 へ全置換する (upload 取込)。DELETE → chunked INSERT を 1 batch で実行 */
export async function replaceFuelEfficiency(
  db: D1Database,
  entries: FuelEfficiencyEntry[],
): Promise<void> {
  const rows = entriesToRows(entries)
  const stmts: D1PreparedStatement[] = [db.prepare('DELETE FROM fuel_efficiency')]
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const chunk = rows.slice(i, i + INSERT_CHUNK)
    const placeholders = chunk.map(() => '(?, ?, ?, ?, ?)').join(', ')
    const binds: unknown[] = []
    for (const r of chunk) binds.push(r.sharu_c, r.name, r.km_per_l, r.valid_from, r.valid_to)
    stmts.push(
      db
        .prepare(
          `INSERT INTO fuel_efficiency (sharu_c, name, km_per_l, valid_from, valid_to) VALUES ${placeholders}`,
        )
        .bind(...binds),
    )
  }
  await db.batch(stmts)
}
