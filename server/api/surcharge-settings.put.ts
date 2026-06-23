import { getDb } from '../utils/db'
import { requireAdmin } from '../utils/auth'
import {
  ensureSurchargeSettingsSchema,
  validateSurchargeSettings,
  saveSurchargeSettings,
} from '../../src/surcharge-settings'

// PUT /api/surcharge-settings — サーチャージ設定 (基準価格 / 刻み幅) を保存する。管理者限定。
// body: { basePrice: number, priceStep: number }。Refs #11
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const db = getDb(event)
  await ensureSurchargeSettingsSchema(db)
  const body = await readBody<{ basePrice?: unknown; priceStep?: unknown }>(event)
  const v = validateSurchargeSettings({ basePrice: body?.basePrice, priceStep: body?.priceStep })
  if (!v.ok) {
    throw createError({ statusCode: 400, statusMessage: v.error })
  }
  await saveSurchargeSettings(db, v.value)
  return v.value
})
