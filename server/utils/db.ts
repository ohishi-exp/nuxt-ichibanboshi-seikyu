import type { H3Event } from 'h3'
import type { D1Database } from '../../src/distance-db'

// nitro cloudflare_module preset では D1 binding は event.context.cloudflare.env に入る。
// 未設定 (ローカル dev / binding 漏れ) は 503 で loud に返す。
export function getDb(event: H3Event): D1Database {
  const env = (
    event.context.cloudflare as { env?: { DB?: D1Database } } | undefined
  )?.env
  const db = env?.DB
  if (!db) {
    throw createError({
      statusCode: 503,
      statusMessage: 'D1 binding "DB" が未設定です (wrangler.toml の d1_databases を確認)',
    })
  }
  return db
}
