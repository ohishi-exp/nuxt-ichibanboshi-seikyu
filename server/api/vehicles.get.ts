import { requireAdmin } from '../utils/auth'
import { resolveIchibanConfig } from '../utils/ichiban'

// GET /api/vehicles — 一番星 (rust-ichibanboshi) の車種ﾏｽﾀを proxy する。
// 燃費マスタの新規登録フォームの車種ドロップダウン用。管理者限定。Refs #11 / rust-ichibanboshi#12
//
// 一番星連携 (ICHIBAN_API_BASE / CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET) が
// 未設定なら 503 を返す。UI 側は 503 を見て車種C 手入力にフォールバックする。
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const cfg = await resolveIchibanConfig(event)
  if (!cfg) {
    throw createError({
      statusCode: 503,
      statusMessage: '一番星連携が未設定です (ICHIBAN_API_BASE / CF Access service token)',
    })
  }

  let res: Response
  try {
    res = await fetch(`${cfg.base}/api/vehicles`, {
      headers: {
        'CF-Access-Client-Id': cfg.clientId,
        'CF-Access-Client-Secret': cfg.clientSecret,
      },
    })
  } catch {
    throw createError({ statusCode: 502, statusMessage: '一番星への接続に失敗しました' })
  }
  if (!res.ok) {
    // 上流の詳細は response に echo せず status だけ伝える
    throw createError({ statusCode: 502, statusMessage: `一番星が ${res.status} を返しました` })
  }

  const json = (await res.json()) as {
    data?: { vehicle_code: string; vehicle_name: string }[]
  }
  return { vehicles: json.data ?? [] }
})
