import { getDb } from '../utils/db'
import { requireAdmin } from '../utils/auth'
import { ensureSurchargeSettingsSchema, loadSurchargeSettings } from '../../src/surcharge-settings'

// GET /api/surcharge-settings — サーチャージ設定 (基準価格 / 刻み幅) を返す。管理者限定。
// 未設定なら既定値 (100 / 5)。届出書・計算エンジンが参照する。Refs #11
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const db = getDb(event)
  await ensureSurchargeSettingsSchema(db)
  return loadSurchargeSettings(db)
})
