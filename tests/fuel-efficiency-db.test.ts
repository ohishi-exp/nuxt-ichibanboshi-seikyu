import { describe, it, expect } from 'vitest'
import {
  rowsToEntries,
  entriesToRows,
  loadFuelEfficiency,
  replaceFuelEfficiency,
  upsertFuelEntry,
  deleteFuelEntry,
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
    if (this.sql.startsWith('DELETE FROM fuel_efficiency WHERE')) {
      // 1 行削除 (PK = sharu_c, valid_from)
      const [sharuC, validFrom] = this.binds as [string, string]
      this.db.rows = this.db.rows.filter(
        (r) => !(r.sharu_c === sharuC && r.valid_from === validFrom),
      )
    } else if (this.sql.startsWith('DELETE FROM fuel_efficiency')) {
      this.db.rows = []
    } else if (this.sql.startsWith('INSERT OR REPLACE INTO fuel_efficiency')) {
      // upsert: 同 PK を置換
      const row: FuelRow = {
        sharu_c: this.binds[0] as string,
        name: this.binds[1] as string,
        km_per_l: this.binds[2] as number,
        valid_from: this.binds[3] as string,
        valid_to: this.binds[4] as string,
      }
      this.db.rows = this.db.rows.filter(
        (r) => !(r.sharu_c === row.sharu_c && r.valid_from === row.valid_from),
      )
      this.db.rows.push(row)
    } else if (this.sql.startsWith('INSERT INTO fuel_efficiency')) {
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

describe('upsertFuelEntry / deleteFuelEntry (行機能)', () => {
  it('1 行を追加でき、同 PK は置換される', async () => {
    const db = new FakeD1()
    await upsertFuelEntry(db, { sharuC: '04', name: '大型幌', kmPerL: 3.5, validFrom: '2026-01-01' })
    expect(db.rows).toHaveLength(1)
    // 同 (車種C, 有効開始) を再投入 → 置換 (重複しない)
    await upsertFuelEntry(db, { sharuC: '04', name: '大型幌', kmPerL: 3.8, validFrom: '2026-01-01' })
    expect(db.rows).toHaveLength(1)
    expect(db.rows[0]?.km_per_l).toBe(3.8)
    // validTo 省略は空文字で入る
    expect(db.rows[0]?.valid_to).toBe('')
  })

  it('validTo つきも投入できる', async () => {
    const db = new FakeD1()
    await upsertFuelEntry(db, {
      sharuC: '16',
      name: 'トレーラー',
      kmPerL: 3.0,
      validFrom: '2026-01-01',
      validTo: '2026-03-31',
    })
    const loaded = await loadFuelEfficiency(db)
    expect(loaded[0]?.validTo).toBe('2026-03-31')
  })

  it('1 行を PK 指定で削除する (他行は残る)', async () => {
    const db = new FakeD1()
    await upsertFuelEntry(db, { sharuC: '04', name: '大型幌', kmPerL: 3.5, validFrom: '2026-01-01' })
    await upsertFuelEntry(db, { sharuC: '07', name: 'トレーラー', kmPerL: 3.0, validFrom: '2026-01-01' })
    await deleteFuelEntry(db, '04', '2026-01-01')
    expect(db.rows).toHaveLength(1)
    expect(db.rows[0]?.sharu_c).toBe('07')
  })
})
