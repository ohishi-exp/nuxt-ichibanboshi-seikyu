import { getDb } from '../utils/db'
import { requireAdmin } from '../utils/auth'
import {
  ensureSurchargeCustomersSchema,
  deleteSurchargeCustomer,
} from '../../src/surcharge-customers-db'

// DELETE /api/surcharge-customers?code=... — 取引先をサーチャージ対象から削除。管理者限定。Refs #11
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const db = getDb(event)
  await ensureSurchargeCustomersSchema(db)
  const code = getQuery(event).code
  const customerCode = typeof code === 'string' ? code.trim() : ''
  if (!customerCode) {
    throw createError({ statusCode: 400, statusMessage: '取引先コード (code) が必要です' })
  }
  await deleteSurchargeCustomer(db, customerCode)
  return { ok: true, customerCode }
})
