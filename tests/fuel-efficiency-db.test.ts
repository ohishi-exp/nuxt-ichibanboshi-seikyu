import { describe, it, expect } from 'vitest'
import {
  rowsToEntries,
  entriesToRows,
  loadFuelEfficiency,
  replaceFuelEfficiency,
  ensureFuelSchema,
  FUEL_SCHEMA_DDL,
  type FuelRow,
} from '../src/fuel-efficiency-db'
import { parseFuelEfficiencyCsv, type FuelEfficiencyEntry } from '../src/fuel-efficiency'
import type { D1Database, D1PreparedStatement } from '../src/distance-db'

const SAMPLE_CSV =
  '車種C,車種名,燃費,有効開始,有効終了\n' +
  '04,大型車,3.5,2026-01-01,\n' +
  '16,トレーラー,3.0,2026-01-01,2026-03-31\n' +
  '16,トレーラー,3.2,2026-04-01,\n'

describe('rowsToEntries / entriesToRows', () => {
  it('valid_to の空文字 ⇔ undefined を相互変換する', () => {
    const entries = rowsToEntries([
      { sharu_c: '04', name: '大型車', km_per_l: 3.5, valid_from: '2026-01-01', valid_to: '' },
      { sharu_c: '16', name: 'トレーラー', km_per_l: 3.0, valid_from: '2026-01-01', valid_to: '2026-03-31' },
    ])
    expect(entries[0]?.validTo).toBeUndefined()
    expect(entries[1]?.validTo).toBe('2026-03-31')

    const rows = entriesToRows(entries)
    expect(rows[0]).toEqual<FuelRow>({
      sharu_c: '04',
      name: '大型車',
      km_per_l: 3.5,
      valid_from: '2026-01-01',
      valid_to: '',
    })
  })

  it('CSV → entries → rows → entries の round-trip', () => {
    const { entries } = parseFuelEfficiencyCsv(SAMPLE_CSV)
    const back = rowsToEntries(entriesToRows(entries))
    expect(back).toEqual<FuelEfficiencyEntry[]>(entries)
  })
})

// in-memory fake D1 (distance-db.test.ts と同方式)
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
    if (this.sql.includes('FROM fuel_efficiency')) {
      const sorted = [...this.db.rows].sort((a, b) =>
        a.sharu_c === b.sharu_c
          ? a.valid_from.localeCompare(b.valid_from)
          : a.sharu_c.localeCompare(b.sharu_c),
      )
      return { results: sorted as unknown as T[] }
    }
    return { results: [] }
  }
  async run(): Promise<unknown> {
    if (this.sql.startsWith('DELETE FROM fuel_efficiency')) this.db.rows = []
    else if (this.sql.startsWith('INSERT INTO fuel_efficiency')) {
      for (let i = 0; i < this.binds.length; i += 5) {
        this.db.rows.push({
          sharu_c: this.binds[i] as string,
          name: this.binds[i + 1] as string,
          km_per_l: this.binds[i + 2] as number,
          valid_from: this.binds[i + 3] as string,
          valid_to: this.binds[i + 4] as string,
        })
      }
    }
    return {}
  }
}
class FakeD1 implements D1Database {
  rows: FuelRow[] = []
  prepare(sql: string): D1PreparedStatement {
    return new FakeStmt(this, sql)
  }
  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<T[]> {
    for (const s of statements) await s.run()
    return []
  }
}

describe('ensureFuelSchema', () => {
  it('DDL は 1 つの CREATE TABLE IF NOT EXISTS', () => {
    expect(FUEL_SCHEMA_DDL).toHaveLength(1)
    expect(FUEL_SCHEMA_DDL[0]).toContain('CREATE TABLE IF NOT EXISTS fuel_efficiency')
  })
  it('fake D1 で例外なく適用できる (idempotent)', async () => {
    const db = new FakeD1()
    await expect(ensureFuelSchema(db)).resolves.toBeUndefined()
    await expect(ensureFuelSchema(db)).resolves.toBeUndefined()
  })
})

describe('loadFuelEfficiency / replaceFuelEfficiency (fake D1)', () => {
  it('replace → load で entries を round-trip する', async () => {
    const { entries } = parseFuelEfficiencyCsv(SAMPLE_CSV)
    const db = new FakeD1()
    await replaceFuelEfficiency(db, entries)
    expect(db.rows).toHaveLength(3)
    const loaded = await loadFuelEfficiency(db)
    expect(loaded).toEqual(entries)
  })

  it('replace は全置換 (2 回で重複しない)', async () => {
    const { entries } = parseFuelEfficiencyCsv(SAMPLE_CSV)
    const db = new FakeD1()
    await replaceFuelEfficiency(db, entries)
    await replaceFuelEfficiency(db, entries)
    expect(db.rows).toHaveLength(3)
  })
})
