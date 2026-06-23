import { describe, it, expect } from 'vitest'
import {
  ensureDieselImportStateSchema,
  getLastImportKey,
  setLastImportKey,
  DIESEL_IMPORT_STATE_DDL,
} from '../src/diesel-import-state'
import type { D1Database, D1PreparedStatement } from '../src/distance-db'

// single-row (id=1) のマーカーだけを扱う最小 FakeD1
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
    if (this.sql.includes('SELECT last_source_key')) {
      const rows = this.db.row ? [{ last_source_key: this.db.row.key }] : []
      return { results: rows as unknown as T[] }
    }
    return { results: [] }
  }
  async run(): Promise<unknown> {
    if (this.sql.startsWith('INSERT INTO diesel_import_state')) {
      const [key, runAt] = this.binds as [string, string]
      this.db.row = { key, runAt }
    }
    // CREATE TABLE は no-op
    return {}
  }
}

class FakeD1 implements D1Database {
  row: { key: string; runAt: string } | null = null
  prepare(sql: string): D1PreparedStatement {
    return new FakeStmt(this, sql)
  }
  async batch<T = unknown>(stmts: D1PreparedStatement[]): Promise<T[]> {
    for (const s of stmts) await (s as FakeStmt).run()
    return [] as T[]
  }
}

describe('diesel-import-state', () => {
  it('DDL は single-row 制約付き', () => {
    expect(DIESEL_IMPORT_STATE_DDL[0]).toContain('CHECK (id = 1)')
  })

  it('初期状態は null、set → get で往復', async () => {
    const db = new FakeD1()
    await ensureDieselImportStateSchema(db)
    expect(await getLastImportKey(db)).toBeNull()

    await setLastImportKey(db, '260617', '2026-06-17T05:05:00.000Z')
    expect(await getLastImportKey(db)).toBe('260617')

    // 後勝ち upsert
    await setLastImportKey(db, '260624', '2026-06-24T05:15:00.000Z')
    expect(await getLastImportKey(db)).toBe('260624')
  })
})
