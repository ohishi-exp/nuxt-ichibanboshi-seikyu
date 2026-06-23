import { loadDistanceMaster } from '../../src/distance-db'
import { serializeDistanceCsv } from '../../src/distance'
import { getDb } from '../utils/db'
import { requireAuth } from '../utils/auth'

// GET /api/distance — 現行の県庁間距離マスタ (D1) を CSV で download する。
// UTF-8 BOM 付きで Excel でそのまま開ける。Refs #11
export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const db = getDb(event)
  const master = await loadDistanceMaster(db)
  const csv = serializeDistanceCsv(master)
  setHeader(event, 'Content-Type', 'text/csv; charset=utf-8')
  setHeader(event, 'Content-Disposition', 'attachment; filename="kenchokan-distance.csv"')
  return csv
})
