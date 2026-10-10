import { requireAdmin } from '../utils/auth'
import { fetchIchiban } from '../utils/ichiban'

// GET /api/vehicles — 一番星 (rust-ichibanboshi) の車種ﾏｽﾀを proxy する。
// 上流は一番星 Worker (Service Binding ICHIBAN_DB)。Refs ohishi-exp/rust-ichibanboshi#322
// 燃費マスタの新規登録フォームの車種ドロップダウン用。管理者限定。Refs #11 / rust-ichibanboshi#12
//
// 失敗 (連携未設定 / 接続失敗 / 上流非200) でも 200 + reason を返し、UI は車種C 手入力に
// フォールバックする (= ドロップダウンが無いだけでフォーム自体は使える)。上流の本文値は
// client に echo せず log のみ。upstreamStatus (HTTP code) は診断のため返す。
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const pending = fetchIchiban(event, '/api/vehicles')
  if (!pending) {
    return { vehicles: [], reason: 'not_configured' }
  }

  let res: Response
  try {
    res = await pending
  } catch (e: unknown) {
    console.error('vehicles proxy: fetch threw', e instanceof Error ? e.message : e)
    return { vehicles: [], reason: 'connect_failed' }
  }

  if (!res.ok) {
    let snippet = ''
    try {
      snippet = (await res.text()).slice(0, 300)
    } catch {
      // ignore
    }
    console.error(`vehicles proxy: upstream ${res.status}`, snippet)
    return { vehicles: [], reason: 'upstream', upstreamStatus: res.status }
  }

  const json = (await res.json()) as {
    data?: { vehicle_code: string; vehicle_name: string }[]
  }
  return { vehicles: json.data ?? [] }
})
