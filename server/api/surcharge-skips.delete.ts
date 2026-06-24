import { getDb } from '../utils/db'
import { requireAdmin } from '../utils/auth'
import { ensureSurchargeSkipsSchema, deleteSurchargeSkip } from '../../src/surcharge-skips-db'

// DELETE /api/surcharge-skips?rowId=... — 行の skip を解除 (計算対象に戻す)。管理者限定。Refs #63
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const db = getDb(event)
  await ensureSurchargeSkipsSchema(db)
  const q = getQuery(event).rowId
  const rowId = typeof q === 'string' ? q.trim() : ''
  if (!rowId) {
    throw createError({ statusCode: 400, statusMessage: '行 ID (rowId) が必要です' })
  }
  await deleteSurchargeSkip(db, rowId)
  return { ok: true, rowId }
})
