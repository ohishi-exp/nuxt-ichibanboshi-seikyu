import { parseDistanceCsv } from '../../src/distance'
import { ensureSchema, replaceDistanceMaster } from '../../src/distance-db'
import { getDb } from '../utils/db'
import { requireAuth } from '../utils/auth'

// POST /api/distance — Excel→CSV を upload して県庁間距離マスタ (D1) を全置換する。
// body は CSV テキスト (text/csv もしくは text/plain)。Refs #11
//
// 破壊的 (全置換) なので requireAuth で auth-worker JWT を署名検証してから実行する。
export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const db = getDb(event)
  const body = await readRawBody(event, 'utf8')
  if (!body || body.trim() === '') {
    throw createError({ statusCode: 400, statusMessage: 'CSV body が空です' })
  }

  await ensureSchema(db) // 初回 upload でも動くようスキーマを ensure (idempotent)

  const { master, warnings } = parseDistanceCsv(body)
  if (master.prefs.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: `CSV を解釈できません: ${warnings.join('; ') || 'ヘッダ不正'}`,
    })
  }

  await replaceDistanceMaster(db, master)
  return {
    ok: true,
    prefectures: master.prefs.length,
    distances: Object.keys(master.distanceKm).length,
    warnings,
  }
})
