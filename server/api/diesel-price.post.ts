import { parseDieselPriceCsv } from '../../src/diesel-price'
import { ensureDieselSchema, replaceDieselPrice } from '../../src/diesel-price-db'
import { getDb } from '../utils/db'
import { requireAdmin } from '../utils/auth'

// POST /api/diesel-price — Excel→CSV を upload して軽油価格マスタ (D1) を全置換する。
// body は CSV テキスト (年月,軽油価格)。破壊的 (全置換) かつ管理者限定。Refs #11
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const db = getDb(event)
  const body = await readRawBody(event, 'utf8')
  if (!body || body.trim() === '') {
    throw createError({ statusCode: 400, statusMessage: 'CSV body が空です' })
  }
  await ensureDieselSchema(db)
  const { entries, warnings } = parseDieselPriceCsv(body)
  if (entries.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: `軽油価格 CSV を解釈できません: ${warnings.join('; ') || '有効な行なし'}`,
    })
  }
  await replaceDieselPrice(db, entries)
  return { ok: true, entries: entries.length, warnings }
})
