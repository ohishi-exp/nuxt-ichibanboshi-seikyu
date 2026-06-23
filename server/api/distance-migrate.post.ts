import { ensureSchema } from '../../src/distance-db'
import { getDb } from '../utils/db'
import { requireAuth } from '../utils/auth'

// POST /api/distance-migrate — D1 にスキーマ (kenchokan_*) を適用する。
// `wrangler d1 migrations apply` を CLI で叩く代わりに画面ボタンから実行する用途。
// CREATE TABLE IF NOT EXISTS なので何度呼んでも安全。Refs #11
export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const db = getDb(event)
  await ensureSchema(db)
  return { ok: true, message: 'スキーマを適用しました (kenchokan_prefecture / kenchokan_distance)' }
})
