import { getDb } from '../utils/db'
import { requireAdmin } from '../utils/auth'
import { ensureSurchargeSkipsSchema, addSurchargeSkip } from '../../src/surcharge-skips-db'

// POST /api/surcharge-skips — 行を計算対象から外す (skip 登録、upsert)。管理者限定。Refs #63
// body: { rowId: string, customerCode?, saleDate?, billingDate?, note? }
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const db = getDb(event)
  await ensureSurchargeSkipsSchema(db)
  const body = await readBody<{
    rowId?: unknown
    customerCode?: unknown
    saleDate?: unknown
    billingDate?: unknown
    note?: unknown
  }>(event)
  const rowId = typeof body?.rowId === 'string' ? body.rowId.trim() : ''
  if (!rowId) {
    throw createError({ statusCode: 400, statusMessage: '行 ID (rowId) が必要です' })
  }
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined)
  await addSurchargeSkip(
    db,
    {
      rowId,
      customerCode: str(body?.customerCode),
      saleDate: str(body?.saleDate),
      billingDate: str(body?.billingDate),
      note: str(body?.note),
    },
    new Date().toISOString(),
  )
  return { ok: true, rowId }
})
