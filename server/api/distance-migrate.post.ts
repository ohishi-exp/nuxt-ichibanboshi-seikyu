import { ensureSchema } from '../../src/distance-db'
import { ensureFuelSchema } from '../../src/fuel-efficiency-db'
import { ensureDieselSchema } from '../../src/diesel-price-db'
import { ensureSurchargeSkipsSchema } from '../../src/surcharge-skips-db'
import { getDb } from '../utils/db'
import { requireAdmin } from '../utils/auth'

// POST /api/distance-migrate — D1 に全マスタのスキーマを適用する。
// `wrangler d1 migrations apply` を CLI で叩く代わりに画面ボタンから実行する用途。
// CREATE TABLE IF NOT EXISTS なので何度呼んでも安全。Refs #11
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const db = getDb(event)
  await ensureSchema(db) // kenchokan_prefecture / kenchokan_distance
  await ensureFuelSchema(db) // fuel_efficiency
  await ensureDieselSchema(db) // diesel_price
  await ensureSurchargeSkipsSchema(db) // surcharge_skips
  return {
    ok: true,
    message:
      'スキーマを適用しました (kenchokan_prefecture / kenchokan_distance / fuel_efficiency / diesel_price / surcharge_skips)',
  }
})
