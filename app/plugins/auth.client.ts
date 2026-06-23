/**
 * Auth プラグイン (ブラウザ専用)
 *
 * アプリ起動時に auth-worker JWT を復元/検証し、未認証なら auth-worker ログイン
 * 画面へリダイレクトする。共通フロー (fragment・storage・cookie 復元 / 未認証
 * redirect / 組織一覧取得 / 期限切れタイマー) は @ippoan/auth-client の
 * initAuthSession に集約 (Refs ippoan/auth-worker#257)。
 *
 * テナント制限 (大石運輸倉庫のみ) は auth-worker 側 (APP_TENANT_ACL) で gate する
 * ため、本アプリ側に tenant_id は持たない。
 */
import { initAuthSession } from '@ippoan/auth-client'

export default defineNuxtPlugin({
  name: 'auth',
  enforce: 'pre',
  setup() {
    const config = useRuntimeConfig()
    const backend = config.public.apiBackend as string

    if (backend !== 'rust-logi' && backend !== 'rust-alc-api') return

    // ?lw= の処理は使わない (本アプリは LINE WORKS 経路を持たない)。
    // initAuthSession が fragment の token を consume (同期) + URL 掃除する。
    initAuthSession({ lineWorksParam: false })

    // 念のため消費側でも URL を掃除する (auth-client のバージョン/挙動に依存せず確実に)。
    // ログイン callback は `/?lw_callback=1#token=...&expires_at=...&org_id=...`。token を
    // consume した後、fragment と認証クエリを history.replaceState で除去し、アドレスバー/
    // 履歴に残さない。次フレームでも一度掃除する (SPA hydration 後の再付与対策)。
    if (typeof window !== 'undefined') {
      const cleanAuthParamsFromUrl = (): void => {
        const hasTokenHash = window.location.hash.includes('token=')
        const url = new URL(window.location.href)
        const authKeys = ['lw_callback', 'token', 'expires_at', 'org_id']
        const hadAuthQuery = authKeys.some((k) => url.searchParams.has(k))
        if (!hasTokenHash && !hadAuthQuery) return
        for (const k of authKeys) url.searchParams.delete(k)
        // url.hash は付けない = fragment を削除
        window.history.replaceState(null, '', url.pathname + (url.search || ''))
      }
      cleanAuthParamsFromUrl()
      // ルーター/hydration 後に再付与されるケースに備えて次タスクでもう一度
      setTimeout(cleanAuthParamsFromUrl, 0)
    }
  },
})
