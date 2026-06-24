import { requireAuth } from '../utils/auth'

// GET /api/whoami — 認証済みユーザの email を返す。
// debug ボタン (一番星 生データ取得) を特定ユーザにだけ出すための出し分けに使う。
// 値の露出は自分の email のみ。admin 権限は要求しない (認証済みなら誰でも自分の email)。
export default defineEventHandler(async (event) => {
  const payload = await requireAuth(event)
  return { email: typeof payload.email === 'string' ? payload.email : null }
})
