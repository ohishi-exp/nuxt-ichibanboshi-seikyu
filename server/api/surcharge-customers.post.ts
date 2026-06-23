import { getDb } from '../utils/db'
import { requireAdmin } from '../utils/auth'
import {
  ensureSurchargeCustomersSchema,
  addSurchargeCustomer,
} from '../../src/surcharge-customers-db'

// POST /api/surcharge-customers — 取引先をサーチャージ対象に登録 (upsert)。管理者限定。
// body: { customerCode: string, customerName?: string }。Refs #11
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const db = getDb(event)
  await ensureSurchargeCustomersSchema(db)
  const body = await readBody<{ customerCode?: unknown; customerName?: unknown }>(event)
  const customerCode = typeof body?.customerCode === 'string' ? body.customerCode.trim() : ''
  const customerName = typeof body?.customerName === 'string' ? body.customerName : ''
  if (!customerCode) {
    throw createError({ statusCode: 400, statusMessage: '取引先コードが必要です' })
  }
  await addSurchargeCustomer(db, { customerCode, customerName }, new Date().toISOString())
  return { ok: true, customerCode, customerName }
})
