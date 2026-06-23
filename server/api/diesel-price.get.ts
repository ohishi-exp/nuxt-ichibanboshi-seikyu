import { ensureDieselSchema, loadDieselPrice } from '../../src/diesel-price-db'
import { serializeDieselPriceCsv } from '../../src/diesel-price'
import { getDb } from '../utils/db'
import { requireAdmin } from '../utils/auth'

// GET /api/diesel-price — 現行の軽油価格マスタ (D1) を CSV で download する。
// UTF-8 BOM 付き。空でもヘッダ行を返すのでテンプレートとして使える。Refs #11
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const db = getDb(event)
  await ensureDieselSchema(db)
  const entries = await loadDieselPrice(db)
  const csv = serializeDieselPriceCsv(entries)
  setHeader(event, 'Content-Type', 'text/csv; charset=utf-8')
  setHeader(event, 'Content-Disposition', 'attachment; filename="diesel-price.csv"')
  return csv
})
