// サーチャージ設定 (基準価格 / 刻み幅) の D1 アクセス。Refs #11
//
// 届出書の前提値 (基準価格 100 円/L・刻み幅 5 円/L) を画面から設定変更できるようにする。
// single-row (id=1)。未設定時は notification-form の既定値を返す (backward compat)。
// 計算エンジン (computeSurcharge) と届出書の段階表は同じ値を参照する (single-source)。

import type { D1Database } from './distance-db'
import { NOTIFICATION_BASE_PRICE, NOTIFICATION_PRICE_STEP } from './notification-form'

export interface SurchargeSettings {
  /** 基準価格 (円/L)。これを下回ると廃止 */
  basePrice: number
  /** 改定する刻み幅 (円/L) */
  priceStep: number
}

export const DEFAULT_SURCHARGE_SETTINGS: SurchargeSettings = {
  basePrice: NOTIFICATION_BASE_PRICE,
  priceStep: NOTIFICATION_PRICE_STEP,
}

export const SURCHARGE_SETTINGS_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS surcharge_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    base_price REAL NOT NULL,
    price_step REAL NOT NULL
  )`,
]

export async function ensureSurchargeSettingsSchema(db: D1Database): Promise<void> {
  for (const ddl of SURCHARGE_SETTINGS_DDL) {
    await db.prepare(ddl).run()
  }
}

interface SettingsRow {
  base_price: number
  price_step: number
}

/** 現在のサーチャージ設定を読む。未設定なら既定値 (100 / 5) */
export async function loadSurchargeSettings(db: D1Database): Promise<SurchargeSettings> {
  const res = await db
    .prepare('SELECT base_price, price_step FROM surcharge_settings WHERE id = 1')
    .all<SettingsRow>()
  const row = res.results[0]
  if (!row) return { ...DEFAULT_SURCHARGE_SETTINGS }
  return { basePrice: row.base_price, priceStep: row.price_step }
}

/** 入力検証 (純粋)。基準価格は 0 以上、刻み幅は正 */
export function validateSurchargeSettings(
  input: { basePrice: unknown; priceStep: unknown },
): { ok: true; value: SurchargeSettings } | { ok: false; error: string } {
  const basePrice = Number(input.basePrice)
  const priceStep = Number(input.priceStep)
  if (!Number.isFinite(basePrice) || basePrice < 0) {
    return { ok: false, error: '基準価格は 0 以上の数値で指定してください' }
  }
  if (!Number.isFinite(priceStep) || priceStep <= 0) {
    return { ok: false, error: '刻み幅は正の数値で指定してください' }
  }
  return { ok: true, value: { basePrice, priceStep } }
}

/** サーチャージ設定を保存する (single-row upsert) */
export async function saveSurchargeSettings(db: D1Database, s: SurchargeSettings): Promise<void> {
  await db
    .prepare(
      `INSERT INTO surcharge_settings (id, base_price, price_step) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET base_price = excluded.base_price, price_step = excluded.price_step`,
    )
    .bind(s.basePrice, s.priceStep)
    .run()
}
