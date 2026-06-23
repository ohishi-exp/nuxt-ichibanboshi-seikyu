import { validateDieselPriceEntry } from '../../src/diesel-price'
import { ensureDieselSchema, upsertDieselEntry } from '../../src/diesel-price-db'
import { getDb } from '../utils/db'
import { requireAdmin } from '../utils/auth'

// POST /api/diesel-price-row — 軽油価格マスタに 1 行を新規登録 / 上書き (行登録・編集)。
// body は JSON { month, price }。管理者限定。Refs #11
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const db = getDb(event)
  const body = await readBody<{ month?: string; price?: number | string }>(event)
  const month = (body?.month ?? '').trim()
  const price = typeof body?.price === 'string' ? Number(body.price) : (body?.price ?? NaN)

  const err = validateDieselPriceEntry({ month, price })
  if (err) {
    throw createError({ statusCode: 400, statusMessage: err })
  }
  await ensureDieselSchema(db)
  await upsertDieselEntry(db, { month, price })
  return { ok: true, entry: { month, price } }
})
