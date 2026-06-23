import { describe, it, expect } from 'vitest'
import {
  ensureDieselWeeklySchema,
  loadDieselWeekly,
  upsertManyDieselWeekly,
} from '../src/diesel-weekly-db'
import type { D1Database, D1PreparedStatement } from '../src/distance-db'
import type { WeeklyDieselPrice } from '../src/diesel-xlsx'

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
    if (this.sql.includes('SELECT survey_date')) {
      const rows = [...this.db.rows.values()].sort((a, b) => a.survey_date.localeCompare(b.survey_date))
      return { results: rows as unknown as T[] }
    }
    return { results: [] }
  }
  async run(): Promise<unknown> {
    if (this.sql.startsWith('INSERT OR REPLACE INTO diesel_price_weekly')) {
      for (let i = 0; i < this.binds.length; i += 3) {
        const [survey_date, month, price] = this.binds.slice(i, i + 3) as [string, string, number]
        this.db.rows.set(survey_date, { survey_date, month, price })
      }
    }
    return {}
  }
}
class FakeD1 implements D1Database {
  rows = new Map<string, { survey_date: string; month: string; price: number }>()
  prepare(sql: string): D1PreparedStatement {
    return new FakeStmt(this, sql)
  }
  async batch<T = unknown>(stmts: D1PreparedStatement[]): Promise<T[]> {
    for (const s of stmts) await (s as FakeStmt).run()
    return [] as T[]
  }
}

const WK: WeeklyDieselPrice[] = [
  { date: '2025-06-03', month: '2025-06', price: 160 },
  { date: '2025-05-27', month: '2025-05', price: 152 },
  { date: '2025-05-20', month: '2025-05', price: 150 },
]

describe('diesel-weekly-db', () => {
  it('空配列 upsert は no-op', async () => {
    const db = new FakeD1()
    await ensureDieselWeeklySchema(db)
    await upsertManyDieselWeekly(db, [])
    expect(await loadDieselWeekly(db)).toEqual([])
  })

  it('upsert → 調査日昇順で load', async () => {
    const db = new FakeD1()
    await upsertManyDieselWeekly(db, WK)
    const loaded = await loadDieselWeekly(db)
    expect(loaded.map((w) => w.date)).toEqual(['2025-05-20', '2025-05-27', '2025-06-03'])
    expect(loaded[0]).toEqual({ date: '2025-05-20', month: '2025-05', price: 150 })
  })

  it('survey_date PK で後勝ち (同じ日を更新)', async () => {
    const db = new FakeD1()
    await upsertManyDieselWeekly(db, WK)
    await upsertManyDieselWeekly(db, [{ date: '2025-05-20', month: '2025-05', price: 999 }])
    const loaded = await loadDieselWeekly(db)
    expect(loaded.find((w) => w.date === '2025-05-20')?.price).toBe(999)
    expect(loaded).toHaveLength(3) // 件数は増えない
  })
})
