import { describe, it, expect } from 'vitest'
import {
  ensureSurchargeSkipsSchema,
  loadSkippedRowIds,
  addSurchargeSkip,
  deleteSurchargeSkip,
} from '../src/surcharge-skips-db'
import type { D1Database, D1PreparedStatement } from '../src/distance-db'

interface SkipRecord {
  row_id: string
  customer_code: string | null
  sale_date: string | null
  billing_date: string | null
  note: string | null
  created_at: string | null
}

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
    if (this.sql.includes('SELECT row_id')) {
      const rows = [...this.db.rows.values()].sort((a, b) => a.row_id.localeCompare(b.row_id))
      return { results: rows as unknown as T[] }
    }
    return { results: [] }
  }
  async run(): Promise<unknown> {
    if (this.sql.includes('INSERT INTO surcharge_skips')) {
      const [row_id, customer_code, sale_date, billing_date, note, created_at] = this.binds as [
        string,
        string | null,
        string | null,
        string | null,
        string | null,
        string | null,
      ]
      this.db.rows.set(row_id, { row_id, customer_code, sale_date, billing_date, note, created_at })
    } else if (this.sql.includes('DELETE FROM surcharge_skips')) {
      this.db.rows.delete(this.binds[0] as string)
    }
    return {}
  }
}
class FakeD1 implements D1Database {
  rows = new Map<string, SkipRecord>()
  prepare(sql: string): D1PreparedStatement {
    return new FakeStmt(this, sql)
  }
  async batch<T = unknown>(stmts: D1PreparedStatement[]): Promise<T[]> {
    for (const s of stmts) await (s as FakeStmt).run()
    return [] as T[]
  }
}

describe('surcharge-skips-db', () => {
  it('空なら空配列', async () => {
    const db = new FakeD1()
    await ensureSurchargeSkipsSchema(db)
    expect(await loadSkippedRowIds(db)).toEqual([])
  })

  it('add → row_id 昇順で load、メタも保持', async () => {
    const db = new FakeD1()
    await addSurchargeSkip(
      db,
      { rowId: '20260620-1002', customerCode: '000002', saleDate: '2026-06-20' },
      'now',
    )
    await addSurchargeSkip(db, { rowId: '20260621-1001' }, 'now')
    expect(await loadSkippedRowIds(db)).toEqual(['20260620-1002', '20260621-1001'])
    expect(db.rows.get('20260620-1002')?.customer_code).toBe('000002')
  })

  it('同じ row_id は upsert (件数増えない、メタ後勝ち)', async () => {
    const db = new FakeD1()
    await addSurchargeSkip(db, { rowId: 'R1', note: 'a' }, 'now')
    await addSurchargeSkip(db, { rowId: 'R1', note: 'b' }, 'now')
    expect(await loadSkippedRowIds(db)).toEqual(['R1'])
    expect(db.rows.get('R1')?.note).toBe('b')
  })

  it('delete で解除', async () => {
    const db = new FakeD1()
    await addSurchargeSkip(db, { rowId: 'R1' }, 'now')
    await deleteSurchargeSkip(db, 'R1')
    expect(await loadSkippedRowIds(db)).toEqual([])
  })

  it('未指定メタは null で保存される', async () => {
    const db = new FakeD1()
    await addSurchargeSkip(db, { rowId: 'R1' }, 'now')
    const rec = db.rows.get('R1')!
    expect(rec.customer_code).toBeNull()
    expect(rec.note).toBeNull()
  })
})
