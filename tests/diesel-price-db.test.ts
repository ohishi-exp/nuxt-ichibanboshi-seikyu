import { describe, it, expect } from 'vitest'
import {
  rowsToEntries,
  entriesToRows,
  loadDieselPrice,
  replaceDieselPrice,
  upsertDieselEntry,
  deleteDieselEntry,
  ensureDieselSchema,
  DIESEL_SCHEMA_DDL,
  type DieselRow,
} from '../src/diesel-price-db'
import { parseDieselPriceCsv } from '../src/diesel-price'
import type { D1Database, D1PreparedStatement } from '../src/distance-db'

const SAMPLE = '年月,軽油価格\n2026-04,168.5\n2026-05,170\n2026-06,172.25\n'

describe('rowsToEntries / entriesToRows', () => {
  it('round-trip', () => {
    const { entries } = parseDieselPriceCsv(SAMPLE)
    expect(rowsToEntries(entriesToRows(entries))).toEqual(entries)
  })
})

// in-memory fake D1
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
    if (this.sql.includes('FROM diesel_price')) {
      const sorted = [...this.db.rows].sort((a, b) => a.month.localeCompare(b.month))
      return { results: sorted as unknown as T[] }
    }
    return { results: [] }
  }
  async run(): Promise<unknown> {
    if (this.sql.startsWith('DELETE FROM diesel_price WHERE')) {
      const [month] = this.binds as [string]
      this.db.rows = this.db.rows.filter((r) => r.month !== month)
    } else if (this.sql.startsWith('DELETE FROM diesel_price')) {
      this.db.rows = []
    } else if (this.sql.startsWith('INSERT OR REPLACE INTO diesel_price')) {
      const row: DieselRow = { month: this.binds[0] as string, price: this.binds[1] as number }
      this.db.rows = this.db.rows.filter((r) => r.month !== row.month)
      this.db.rows.push(row)
    } else if (this.sql.startsWith('INSERT INTO diesel_price')) {
      for (let i = 0; i < this.binds.length; i += 2) {
        this.db.rows.push({ month: this.binds[i] as string, price: this.binds[i + 1] as number })
      }
    }
    return {}
  }
}
class FakeD1 implements D1Database {
  rows: DieselRow[] = []
  prepare(sql: string): D1PreparedStatement {
    return new FakeStmt(this, sql)
  }
  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<T[]> {
    for (const s of statements) await s.run()
    return []
  }
}

describe('ensureDieselSchema', () => {
  it('DDL は 1 CREATE TABLE IF NOT EXISTS', () => {
    expect(DIESEL_SCHEMA_DDL).toHaveLength(1)
    expect(DIESEL_SCHEMA_DDL[0]).toContain('CREATE TABLE IF NOT EXISTS diesel_price')
  })
  it('fake D1 で冪等適用', async () => {
    const db = new FakeD1()
    await expect(ensureDieselSchema(db)).resolves.toBeUndefined()
    await expect(ensureDieselSchema(db)).resolves.toBeUndefined()
  })
})

describe('replace / load / upsert / delete (fake D1)', () => {
  it('replace → load で round-trip', async () => {
    const { entries } = parseDieselPriceCsv(SAMPLE)
    const db = new FakeD1()
    await replaceDieselPrice(db, entries)
    expect(db.rows).toHaveLength(3)
    expect(await loadDieselPrice(db)).toEqual(entries)
  })

  it('replace は全置換 (2 回で重複しない)', async () => {
    const { entries } = parseDieselPriceCsv(SAMPLE)
    const db = new FakeD1()
    await replaceDieselPrice(db, entries)
    await replaceDieselPrice(db, entries)
    expect(db.rows).toHaveLength(3)
  })

  it('upsert は同 month を置換', async () => {
    const db = new FakeD1()
    await upsertDieselEntry(db, { month: '2026-04', price: 168 })
    await upsertDieselEntry(db, { month: '2026-04', price: 170 })
    expect(db.rows).toHaveLength(1)
    expect(db.rows[0]?.price).toBe(170)
  })

  it('delete は month 指定で 1 行 (他は残る)', async () => {
    const db = new FakeD1()
    await upsertDieselEntry(db, { month: '2026-04', price: 168 })
    await upsertDieselEntry(db, { month: '2026-05', price: 170 })
    await deleteDieselEntry(db, '2026-04')
    expect(db.rows).toHaveLength(1)
    expect(db.rows[0]?.month).toBe('2026-05')
  })
})
