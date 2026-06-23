import { ensureFuelSchema, loadFuelEfficiency } from '../../src/fuel-efficiency-db'
import { serializeFuelEfficiencyCsv } from '../../src/fuel-efficiency'
import { getDb } from '../utils/db'
import { requireAdmin } from '../utils/auth'

// GET /api/fuel-efficiency — 現行の燃費マスタ (D1) を CSV で download する。
// UTF-8 BOM 付き。空でもヘッダ行を返すのでテンプレートとして使える。Refs #11
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const db = getDb(event)
  await ensureFuelSchema(db) // 未初期化 D1 でも空 CSV を返せるよう ensure
  const entries = await loadFuelEfficiency(db)
  const csv = serializeFuelEfficiencyCsv(entries)
  setHeader(event, 'Content-Type', 'text/csv; charset=utf-8')
  setHeader(event, 'Content-Disposition', 'attachment; filename="fuel-efficiency.csv"')
  return csv
})
