import { describe, it, expect } from 'vitest'
import {
  ensureSurchargeSettingsSchema,
  loadSurchargeSettings,
  saveSurchargeSettings,
  validateSurchargeSettings,
  DEFAULT_SURCHARGE_SETTINGS,
} from '../src/surcharge-settings'
import type { D1Database, D1PreparedStatement } from '../src/distance-db'

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
    if (this.sql.includes('SELECT base_price')) {
      const rows = this.db.row ? [this.db.row] : []
      return { results: rows as unknown as T[] }
    }
    return { results: [] }
  }
  async run(): Promise<unknown> {
    if (this.sql.startsWith('INSERT INTO surcharge_settings')) {
      const [base_price, price_step] = this.binds as [number, number]
      this.db.row = { base_price, price_step }
    }
    return {}
  }
}
class FakeD1 implements D1Database {
  row: { base_price: number; price_step: number } | null = null
  prepare(sql: string): D1PreparedStatement {
    return new FakeStmt(this, sql)
  }
  async batch<T = unknown>(stmts: D1PreparedStatement[]): Promise<T[]> {
    for (const s of stmts) await (s as FakeStmt).run()
    return [] as T[]
  }
}

describe('validateSurchargeSettings', () => {
  it('正常値を通す', () => {
    expect(validateSurchargeSettings({ basePrice: 110, priceStep: 5 })).toEqual({
      ok: true,
      value: { basePrice: 110, priceStep: 5 },
    })
  })
  it('基準価格が負 / 非数は弾く', () => {
    expect(validateSurchargeSettings({ basePrice: -1, priceStep: 5 }).ok).toBe(false)
    expect(validateSurchargeSettings({ basePrice: 'x', priceStep: 5 }).ok).toBe(false)
  })
  it('刻み幅が 0 以下は弾く', () => {
    expect(validateSurchargeSettings({ basePrice: 100, priceStep: 0 }).ok).toBe(false)
    expect(validateSurchargeSettings({ basePrice: 100, priceStep: -5 }).ok).toBe(false)
  })
  it('基準価格 0 は許可 (廃止条件の境界)', () => {
    expect(validateSurchargeSettings({ basePrice: 0, priceStep: 5 }).ok).toBe(true)
  })
})

describe('load/save surcharge settings', () => {
  it('未設定なら既定 (100 / 5)', async () => {
    const db = new FakeD1()
    await ensureSurchargeSettingsSchema(db)
    expect(await loadSurchargeSettings(db)).toEqual(DEFAULT_SURCHARGE_SETTINGS)
    expect(DEFAULT_SURCHARGE_SETTINGS).toEqual({ basePrice: 100, priceStep: 5 })
  })
  it('保存 → 読込で往復、後勝ち upsert', async () => {
    const db = new FakeD1()
    await saveSurchargeSettings(db, { basePrice: 120, priceStep: 10 })
    expect(await loadSurchargeSettings(db)).toEqual({ basePrice: 120, priceStep: 10 })
    await saveSurchargeSettings(db, { basePrice: 95, priceStep: 5 })
    expect(await loadSurchargeSettings(db)).toEqual({ basePrice: 95, priceStep: 5 })
  })
})
