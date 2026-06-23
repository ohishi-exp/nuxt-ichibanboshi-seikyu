import { validateFuelEntry, type FuelEfficiencyEntry } from '../../src/fuel-efficiency'
import { ensureFuelSchema, upsertFuelEntry } from '../../src/fuel-efficiency-db'
import { getDb } from '../utils/db'
import { requireAdmin } from '../utils/auth'

// POST /api/fuel-efficiency-row — 燃費マスタに 1 行を新規登録 / 上書きする (行機能)。
// body は JSON { sharuC, name, kmPerL, validFrom, validTo? }。管理者限定。Refs #11
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const db = getDb(event)
  const body = await readBody<{
    sharuC?: string
    name?: string
    kmPerL?: number | string
    validFrom?: string
    validTo?: string
  }>(event)

  const sharuC = (body?.sharuC ?? '').trim()
  const name = (body?.name ?? '').trim()
  const kmPerL = typeof body?.kmPerL === 'string' ? Number(body.kmPerL) : (body?.kmPerL ?? NaN)
  const validFrom = (body?.validFrom ?? '').trim()
  const validTo = (body?.validTo ?? '').trim()

  const err = validateFuelEntry({ sharuC, kmPerL, validFrom, validTo })
  if (err) {
    throw createError({ statusCode: 400, statusMessage: err })
  }

  await ensureFuelSchema(db)
  const entry: FuelEfficiencyEntry = { sharuC, name, kmPerL, validFrom }
  if (validTo !== '') entry.validTo = validTo
  await upsertFuelEntry(db, entry)
  return { ok: true, entry }
})
