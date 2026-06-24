import { requireAdmin } from '../utils/auth'
import { resolveIchibanConfig } from '../utils/ichiban'

// GET /api/ichiban-columns — 一番星 (rust-ichibanboshi) の /api/schema/columns?table=運転日報明細 を
// proxy する。明細に出す「車番」など追加カラムの正確な DB カラム名を特定するための debug 経路。
// 管理者限定。値ではなくカラム名/型のメタデータのみ返す。失敗時は 200 + reason。
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const cfg = await resolveIchibanConfig(event)
  if (!cfg) {
    return { columns: [], reason: 'not_configured' }
  }
  const url = `${cfg.base}/api/schema/columns?table=${encodeURIComponent('運転日報明細')}`

  let res: Response
  try {
    res = await fetch(url, {
      headers: {
        'CF-Access-Client-Id': cfg.clientId,
        'CF-Access-Client-Secret': cfg.clientSecret,
      },
    })
  } catch (e: unknown) {
    console.error('ichiban-columns proxy: fetch threw', e instanceof Error ? e.message : e)
    return { columns: [], reason: 'connect_failed' }
  }
  if (!res.ok) {
    console.error(`ichiban-columns proxy: upstream ${res.status}`)
    return { columns: [], reason: 'upstream', upstreamStatus: res.status }
  }
  const json = (await res.json()) as unknown
  return { columns: json }
})
