import { getDb } from '../utils/db'
import { requireAdmin } from '../utils/auth'
import {
  ensureSurchargeCustomersSchema,
  loadSurchargeCustomers,
} from '../../src/surcharge-customers-db'

// GET /api/surcharge-customers — サーチャージ対象として登録済みの取引先を返す。管理者限定。Refs #11
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const db = getDb(event)
  await ensureSurchargeCustomersSchema(db)
  return { customers: await loadSurchargeCustomers(db) }
})
