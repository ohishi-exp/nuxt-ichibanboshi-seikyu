import { getDb } from '../utils/db'
import { requireAdmin } from '../utils/auth'
import { ensureDieselSchema } from '../../src/diesel-price-db'
import { importDieselFromEnecho } from '../utils/diesel-import'

// POST /api/diesel-import — 経産省 (資源エネルギー庁) 公表の最新週次 xlsx から全国平均軽油を
// 月次平均で diesel_price へ取込む (動的に最新 URL を解決)。管理者限定。Refs #11 (#2)
//
// upsert なので手入力月は保持。?recentMonths= で取込月数を指定 (既定 24)。
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const db = getDb(event)
  await ensureDieselSchema(db)
  const q = getQuery(event)
  const recentMonths =
    typeof q.recentMonths === 'string' && /^\d+$/.test(q.recentMonths)
      ? Number(q.recentMonths)
      : undefined
  const result = await importDieselFromEnecho(db, { recentMonths })
  if (!result.ok) {
    throw createError({ statusCode: 502, statusMessage: `取込失敗: ${result.reason}` })
  }
  return result
})
