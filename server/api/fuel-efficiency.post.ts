import { parseFuelEfficiencyCsv } from '../../src/fuel-efficiency'
import { ensureFuelSchema, replaceFuelEfficiency } from '../../src/fuel-efficiency-db'
import { getDb } from '../utils/db'
import { requireAuth } from '../utils/auth'

// POST /api/fuel-efficiency — Excel→CSV を upload して燃費マスタ (D1) を全置換する。
// body は CSV テキスト (車種C,車種名,燃費,有効開始,有効終了)。Refs #11
//
// 破壊的 (全置換) なので requireAuth で auth-worker JWT を署名検証してから実行する。
export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const db = getDb(event)
  const body = await readRawBody(event, 'utf8')
  if (!body || body.trim() === '') {
    throw createError({ statusCode: 400, statusMessage: 'CSV body が空です' })
  }

  await ensureFuelSchema(db) // 初回 upload でも動くよう ensure (idempotent)

  const { entries, warnings } = parseFuelEfficiencyCsv(body)
  if (entries.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: `燃費 CSV を解釈できません: ${warnings.join('; ') || '有効な行なし'}`,
    })
  }

  await replaceFuelEfficiency(db, entries)
  return { ok: true, entries: entries.length, warnings }
})
