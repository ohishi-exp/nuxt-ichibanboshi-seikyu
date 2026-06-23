import { ensureDieselSchema, deleteDieselEntry } from '../../src/diesel-price-db'
import { getDb } from '../utils/db'
import { requireAdmin } from '../utils/auth'

// DELETE /api/diesel-price-row?month=YYYY-MM — 軽油価格マスタの 1 行を削除。管理者限定。Refs #11
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const db = getDb(event)
  const q = getQuery(event)
  const month = typeof q.month === 'string' ? q.month : ''
  if (!month) {
    throw createError({ statusCode: 400, statusMessage: 'month が必要です' })
  }
  await ensureDieselSchema(db)
  await deleteDieselEntry(db, month)
  return { ok: true }
})
