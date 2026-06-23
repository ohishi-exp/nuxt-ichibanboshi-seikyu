import { getDb } from '../utils/db'
import { requireAdmin } from '../utils/auth'
import { ensureDieselWeeklySchema, loadDieselWeekly } from '../../src/diesel-weekly-db'

// GET /api/diesel-weekly — 軽油価格の週次全国平均 (検算用) を返す。管理者限定。
// diesel_price (月次平均) の根拠。取込済みの月のみ週次が入る。Refs #11 (#2)
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const db = getDb(event)
  await ensureDieselWeeklySchema(db)
  return { weekly: await loadDieselWeekly(db) }
})
