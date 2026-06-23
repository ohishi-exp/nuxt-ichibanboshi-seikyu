import { ensureFuelSchema, deleteFuelEntry } from '../../src/fuel-efficiency-db'
import { getDb } from '../utils/db'
import { requireAdmin } from '../utils/auth'

// DELETE /api/fuel-efficiency-row?sharuC=..&validFrom=.. — 燃費マスタの 1 行を削除 (行機能)。
// PK (sharu_c, valid_from) で特定する。管理者限定。Refs #11
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const db = getDb(event)
  const q = getQuery(event)
  const sharuC = typeof q.sharuC === 'string' ? q.sharuC : ''
  const validFrom = typeof q.validFrom === 'string' ? q.validFrom : ''
  if (!sharuC || !validFrom) {
    throw createError({ statusCode: 400, statusMessage: 'sharuC と validFrom が必要です' })
  }
  await ensureFuelSchema(db)
  await deleteFuelEntry(db, sharuC, validFrom)
  return { ok: true }
})
