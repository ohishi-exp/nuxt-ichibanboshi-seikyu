import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  rowsToMaster,
  masterToRows,
  loadDistanceMaster,
  replaceDistanceMaster,
  type D1Database,
  type D1PreparedStatement,
  type PrefRow,
  type DistRow,
} from '../src/distance-db'
import { parseDistanceCsv, distanceKey } from '../src/distance'

const realCsv = readFileSync(
  fileURLToPath(new URL('../docs/surcharge/kenchokan-distance.csv', import.meta.url)),
  'utf-8',
)

// --- 純粋変換 ---
describe('rowsToMaster / masterToRows', () => {
  it('sort_order 順に prefs を並べ、cities/distanceKm を組む', () => {
    const m = rowsToMaster(
      [
        { pref: '青森県', city: '青森市', sort_order: 1 },
        { pref: '北海道', city: '札幌市', sort_order: 0 },
      ],
      [
        { from_pref: '北海道', to_pref: '青森県', km: 440 },
        { from_pref: '北海道', to_pref: '北海道', km: 0 },
      ],
    )
    expect(m.prefs).toEqual(['北海道', '青森県'])
    expect(m.cities['北海道']).toBe('札幌市')
    expect(m.distanceKm[distanceKey('北海道', '青森県')]).toBe(440)
  })

  it('masterToRows はキー `from\\tto` を分解する', () => {
    const { prefRows, distRows } = masterToRows({
      prefs: ['北海道', '青森県'],
      cities: { 北海道: '札幌市', 青森県: '青森市' },
      distanceKm: { [distanceKey('北海道', '青森県')]: 440 },
    })
    expect(prefRows).toEqual<PrefRow[]>([
      { pref: '北海道', city: '札幌市', sort_order: 0 },
      { pref: '青森県', city: '青森市', sort_order: 1 },
    ])
    expect(distRows).toEqual<DistRow[]>([
      { from_pref: '北海道', to_pref: '青森県', km: 440 },
    ])
  })

  it('rowsToMaster ∘ masterToRows は CSV master と一致 (round-trip)', () => {
    const { master } = parseDistanceCsv(realCsv)
    const { prefRows, distRows } = masterToRows(master)
    const back = rowsToMaster(prefRows, distRows)
    expect(back.prefs).toEqual(master.prefs)
    expect(back.cities).toEqual(master.cities)
    expect(back.distanceKm).toEqual(master.distanceKm)
  })
})

// --- D1 glue を in-memory fake で検証 (INSERT 列順 / SELECT 形を含む) ---
class FakeStmt implements D1PreparedStatement {
  binds: unknown[] = []
  constructor(
    private db: FakeD1,
    private sql: string,
  ) {}
  bind(...values: unknown[]): D1PreparedStatement {
    this.binds = values
    return this
  }
  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    if (this.sql.includes('FROM kenchokan_prefecture')) {
      const sorted = [...this.db.prefRows].sort((a, b) => a.sort_order - b.sort_order)
      return { results: sorted as unknown as T[] }
    }
    if (this.sql.includes('FROM kenchokan_distance')) {
      return { results: this.db.distRows as unknown as T[] }
    }
    return { results: [] }
  }
  async run(): Promise<unknown> {
    if (this.sql.startsWith('DELETE FROM kenchokan_distance')) this.db.distRows = []
    else if (this.sql.startsWith('DELETE FROM kenchokan_prefecture')) this.db.prefRows = []
    else if (this.sql.startsWith('INSERT INTO kenchokan_prefecture')) {
      this.db.prefRows.push({
        pref: this.binds[0] as string,
        city: this.binds[1] as string,
        sort_order: this.binds[2] as number,
      })
    } else if (this.sql.startsWith('INSERT INTO kenchokan_distance')) {
      for (let i = 0; i < this.binds.length; i += 3) {
        this.db.distRows.push({
          from_pref: this.binds[i] as string,
          to_pref: this.binds[i + 1] as string,
          km: this.binds[i + 2] as number,
        })
      }
    }
    return {}
  }
}
class FakeD1 implements D1Database {
  prefRows: PrefRow[] = []
  distRows: DistRow[] = []
  prepare(sql: string): D1PreparedStatement {
    return new FakeStmt(this, sql)
  }
  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<T[]> {
    for (const s of statements) await s.run()
    return []
  }
}

describe('loadDistanceMaster / replaceDistanceMaster (fake D1)', () => {
  it('replace → load で CSV master を round-trip する', async () => {
    const { master } = parseDistanceCsv(realCsv)
    const db = new FakeD1()
    await replaceDistanceMaster(db, master)
    // 47 県 + 47×47 距離が入る
    expect(db.prefRows).toHaveLength(47)
    expect(db.distRows).toHaveLength(47 * 47)
    const loaded = await loadDistanceMaster(db)
    expect(loaded.prefs).toEqual(master.prefs)
    expect(loaded.cities).toEqual(master.cities)
    expect(loaded.distanceKm).toEqual(master.distanceKm)
  })

  it('replace は冪等 (2 回で重複しない)', async () => {
    const { master } = parseDistanceCsv(realCsv)
    const db = new FakeD1()
    await replaceDistanceMaster(db, master)
    await replaceDistanceMaster(db, master)
    expect(db.prefRows).toHaveLength(47)
    expect(db.distRows).toHaveLength(47 * 47)
  })
})
