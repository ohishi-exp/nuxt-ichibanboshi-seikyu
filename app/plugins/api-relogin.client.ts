/**
 * API 401 → 再ログイン (ブラウザ専用)
 *
 * セッション (auth-worker JWT = logi_auth_token cookie) が実行中に期限切れすると、
 * /api/* が 401 を返し画面がそのまま固まる。initAuthSession は「起動時」と「期限
 * タイマー」でしか未認証 redirect しないため、稼働中の失効を取りこぼす。
 *
 * ここでグローバル $fetch に onResponseError を被せ、同一オリジン API の 401 を
 * 捕まえたら auth-worker ログインへリダイレクトする (再ログイン → 新 cookie → 復帰)。
 * 多重リダイレクト防止に 1 度きりの flag を持つ。403 (admin 不足) は対象外。
 */
import { useAuth } from '@ippoan/auth-client'

export default defineNuxtPlugin({
  name: 'api-relogin',
  enforce: 'post',
  setup() {
    const { redirectToLogin } = useAuth()
    let redirecting = false

    globalThis.$fetch = $fetch.create({
      onResponseError({ request, response }) {
        if (response?.status !== 401 || redirecting) return
        const url = typeof request === 'string' ? request : (request as Request).url ?? ''
        // 同一オリジンの API 呼び出しのみ対象 (外部 fetch には干渉しない)
        if (!url.includes('/api/')) return
        redirecting = true
        redirectToLogin()
      },
    }) as typeof $fetch
  },
})
