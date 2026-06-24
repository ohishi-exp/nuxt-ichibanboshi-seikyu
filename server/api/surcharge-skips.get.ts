import { getDb } from '../utils/db'
import { requireAdmin } from '../utils/auth'
import { ensureSurchargeSkipsSchema, loadSkippedRowIds } from '../../src/surcharge-skips-db'

// GET /api/surcharge-skips — skip 登録済みの行 ID 一覧を返す。管理者限定。Refs #63
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const db = getDb(event)
  await ensureSurchargeSkipsSchema(db)
  return { rowIds: await loadSkippedRowIds(db) }
})
