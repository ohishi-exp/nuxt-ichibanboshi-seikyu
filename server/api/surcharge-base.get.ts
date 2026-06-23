import { requireAdmin } from '../utils/auth'
import { resolveIchibanConfig } from '../utils/ichiban'

// GET /api/surcharge-base — 一番星 (rust-ichibanboshi) の /api/surcharge/base を proxy する。
// 確認 UI (#5) が請求基礎データ (得意先/積地県/卸地県/車種/売上年月日/運賃/請求日) を取得する。
// query: from / to (YYYY-MM) / kind (billing_only|transport|all) / limit。管理者限定。
//
// 失敗 (連携未設定 / 接続失敗 / 上流非200) でも 200 + reason を返し、UI 側で扱う。
// 上流の本文値は client に echo せず log のみ。upstreamStatus は診断のため返す。
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const cfg = await resolveIchibanConfig(event)
  if (!cfg) {
    return { rows: [], reason: 'not_configured' }
  }

  const q = getQuery(event)
  const params = new URLSearchParams()
  for (const k of ['from', 'to', 'kind', 'limit']) {
    const v = q[k]
    if (typeof v === 'string' && v !== '') params.set(k, v)
  }
  const qs = params.toString()
  const url = `${cfg.base}/api/surcharge/base${qs ? `?${qs}` : ''}`

  let res: Response
  try {
    res = await fetch(url, {
      headers: {
        'CF-Access-Client-Id': cfg.clientId,
        'CF-Access-Client-Secret': cfg.clientSecret,
      },
    })
  } catch (e: unknown) {
    console.error('surcharge-base proxy: fetch threw', e instanceof Error ? e.message : e)
    return { rows: [], reason: 'connect_failed' }
  }

  if (!res.ok) {
    let snippet = ''
    try {
      snippet = (await res.text()).slice(0, 300)
    } catch {
      // ignore
    }
    console.error(`surcharge-base proxy: upstream ${res.status}`, snippet)
    return { rows: [], reason: 'upstream', upstreamStatus: res.status }
  }

  const json = (await res.json()) as { data?: unknown[] }
  return { rows: json.data ?? [] }
})
