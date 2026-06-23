// 県庁間距離マスタの D1 データアクセス (距離制 download / input)。Refs #11
//
// データ投入は migration の seed ではなく、Excel→CSV を upload して replace する
// 運用 (= /api/distance POST)。download は現行 D1 の内容を CSV 化する (/api/distance GET)。
//
// 純粋変換 (rowsToMaster / masterToRows) と D1 glue (loadDistanceMaster /
// replaceDistanceMaster) を分離し、変換側をユニットテストする。

import { type DistanceMaster, distanceKey } from './distance'

/** D1 の最小インターフェース (@cloudflare/workers-types 非依存・テストで fake 可能) */
export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>
  run(): Promise<unknown>
}
export interface D1Database {
  prepare(query: string): D1PreparedStatement
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<T[]>
}

// migrations/0001_kenchokan_distance.sql と同一の DDL (idempotent)。
// CLI (`wrangler d1 migrations apply`) を使わず画面/コードからスキーマを適用できるようにする。
export const SCHEMA_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS kenchokan_prefecture (
    pref       TEXT PRIMARY KEY,
    city       TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS kenchokan_distance (
    from_pref TEXT NOT NULL,
    to_pref   TEXT NOT NULL,
    km        INTEGER NOT NULL,
    PRIMARY KEY (from_pref, to_pref)
  )`,
]

/** D1 にスキーマを適用する (CREATE TABLE IF NOT EXISTS、何度呼んでも安全) */
export async function ensureSchema(db: D1Database): Promise<void> {
  for (const ddl of SCHEMA_DDL) {
    await db.prepare(ddl).run()
  }
}

export interface PrefRow {
  pref: string
  city: string
  sort_order: number
}
export interface DistRow {
  from_pref: string
  to_pref: string
  km: number
}

/** D1 行 → DistanceMaster (純粋) */
export function rowsToMaster(prefRows: PrefRow[], distRows: DistRow[]): DistanceMaster {
  const sorted = [...prefRows].sort((a, b) => a.sort_order - b.sort_order)
  const prefs = sorted.map((p) => p.pref)
  const cities: Record<string, string> = {}
  for (const p of sorted) cities[p.pref] = p.city
  const distanceKm: Record<string, number> = {}
  for (const d of distRows) distanceKm[distanceKey(d.from_pref, d.to_pref)] = d.km
  return { prefs, cities, distanceKm }
}

/** DistanceMaster → D1 行 (純粋)。distanceKm のキー `from\tto` を分解する */
export function masterToRows(master: DistanceMaster): {
  prefRows: PrefRow[]
  distRows: DistRow[]
} {
  const prefRows: PrefRow[] = master.prefs.map((pref, i) => ({
    pref,
    city: master.cities[pref] ?? '',
    sort_order: i,
  }))
  const distRows: DistRow[] = []
  for (const [key, km] of Object.entries(master.distanceKm)) {
    const tab = key.indexOf('\t')
    if (tab < 0) continue
    distRows.push({
      from_pref: key.slice(0, tab),
      to_pref: key.slice(tab + 1),
      km,
    })
  }
  return { prefRows, distRows }
}

/** D1 から現行の県庁間距離マスタを読み出す */
export async function loadDistanceMaster(db: D1Database): Promise<DistanceMaster> {
  const prefRes = await db
    .prepare('SELECT pref, city, sort_order FROM kenchokan_prefecture ORDER BY sort_order')
    .all<PrefRow>()
  const distRes = await db
    .prepare('SELECT from_pref, to_pref, km FROM kenchokan_distance')
    .all<DistRow>()
  return rowsToMaster(prefRes.results, distRes.results)
}

// D1 の bound parameter 上限を避けるため 1 INSERT あたりの行数を抑える (km/from/to の 3 列)。
const INSERT_CHUNK = 30

/** マスタを D1 へ全置換する (upload 取込)。DELETE → chunked INSERT を 1 batch で実行 */
export async function replaceDistanceMaster(
  db: D1Database,
  master: DistanceMaster,
): Promise<void> {
  const { prefRows, distRows } = masterToRows(master)
  const stmts: D1PreparedStatement[] = [
    db.prepare('DELETE FROM kenchokan_distance'),
    db.prepare('DELETE FROM kenchokan_prefecture'),
  ]
  for (const p of prefRows) {
    stmts.push(
      db
        .prepare('INSERT INTO kenchokan_prefecture (pref, city, sort_order) VALUES (?, ?, ?)')
        .bind(p.pref, p.city, p.sort_order),
    )
  }
  for (let i = 0; i < distRows.length; i += INSERT_CHUNK) {
    const chunk = distRows.slice(i, i + INSERT_CHUNK)
    const placeholders = chunk.map(() => '(?, ?, ?)').join(', ')
    const binds: unknown[] = []
    for (const d of chunk) binds.push(d.from_pref, d.to_pref, d.km)
    stmts.push(
      db
        .prepare(`INSERT INTO kenchokan_distance (from_pref, to_pref, km) VALUES ${placeholders}`)
        .bind(...binds),
    )
  }
  await db.batch(stmts)
}
