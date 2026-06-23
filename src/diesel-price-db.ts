// 当月軽油価格マスタの D1 データアクセス。Refs #11 (#2)
//
// 燃費マスタ (fuel-efficiency-db.ts) と同じ作り。CSV 全置換 upload / download に加え、
// 1 行 upsert / delete (行登録・インライン編集) をサポートする。

import type { D1Database, D1PreparedStatement } from './distance-db'
import type { DieselPriceEntry } from './diesel-price'

// migrations/0003_diesel_price.sql と同一 DDL (idempotent)。
export const DIESEL_SCHEMA_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS diesel_price (
    month TEXT PRIMARY KEY,
    price REAL NOT NULL
  )`,
]

/** D1 に軽油価格マスタのスキーマを適用する (CREATE TABLE IF NOT EXISTS、何度でも安全) */
export async function ensureDieselSchema(db: D1Database): Promise<void> {
  for (const ddl of DIESEL_SCHEMA_DDL) {
    await db.prepare(ddl).run()
  }
}

export interface DieselRow {
  month: string
  price: number
}

/** D1 行 → DieselPriceEntry[] (純粋) */
export function rowsToEntries(rows: DieselRow[]): DieselPriceEntry[] {
  return rows.map((r) => ({ month: r.month, price: r.price }))
}

/** DieselPriceEntry[] → D1 行 (純粋) */
export function entriesToRows(entries: DieselPriceEntry[]): DieselRow[] {
  return entries.map((e) => ({ month: e.month, price: e.price }))
}

/** D1 から現行の軽油価格マスタを読み出す (年月昇順) */
export async function loadDieselPrice(db: D1Database): Promise<DieselPriceEntry[]> {
  const res = await db
    .prepare('SELECT month, price FROM diesel_price ORDER BY month')
    .all<DieselRow>()
  return rowsToEntries(res.results)
}

// D1 の bound parameter 上限を避けるため 1 INSERT あたりの行数を抑える (2 列)。
const INSERT_CHUNK = 45

/** 軽油価格マスタを D1 へ全置換する (upload 取込)。DELETE → chunked INSERT を 1 batch で */
export async function replaceDieselPrice(
  db: D1Database,
  entries: DieselPriceEntry[],
): Promise<void> {
  const rows = entriesToRows(entries)
  const stmts: D1PreparedStatement[] = [db.prepare('DELETE FROM diesel_price')]
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const chunk = rows.slice(i, i + INSERT_CHUNK)
    const placeholders = chunk.map(() => '(?, ?)').join(', ')
    const binds: unknown[] = []
    for (const r of chunk) binds.push(r.month, r.price)
    stmts.push(
      db.prepare(`INSERT INTO diesel_price (month, price) VALUES ${placeholders}`).bind(...binds),
    )
  }
  await db.batch(stmts)
}

/** 軽油価格 1 行を upsert する (新規登録 / インライン編集)。PK = month で後勝ち置換 */
export async function upsertDieselEntry(db: D1Database, entry: DieselPriceEntry): Promise<void> {
  await db
    .prepare('INSERT OR REPLACE INTO diesel_price (month, price) VALUES (?, ?)')
    .bind(entry.month, entry.price)
    .run()
}

/** 軽油価格 1 行を削除する (PK = month) */
export async function deleteDieselEntry(db: D1Database, month: string): Promise<void> {
  await db.prepare('DELETE FROM diesel_price WHERE month = ?').bind(month).run()
}
