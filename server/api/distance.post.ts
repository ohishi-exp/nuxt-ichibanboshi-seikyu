import { parseDistanceCsv } from '../../src/distance'
import { replaceDistanceMaster } from '../../src/distance-db'
import { getDb } from '../utils/db'

// POST /api/distance — Excel→CSV を upload して県庁間距離マスタ (D1) を全置換する。
// body は CSV テキスト (text/csv もしくは text/plain)。Refs #11
//
// ⚠️ SECURITY: 破壊的 (全置換) なので、本番運用前に auth-worker JWT のサーバ側検証で
// 保護すること (現状はクライアント側の auth gate のみ)。フォローアップ: #11。
export default defineEventHandler(async (event) => {
  const db = getDb(event)
  const body = await readRawBody(event, 'utf8')
  if (!body || body.trim() === '') {
    throw createError({ statusCode: 400, statusMessage: 'CSV body が空です' })
  }

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
