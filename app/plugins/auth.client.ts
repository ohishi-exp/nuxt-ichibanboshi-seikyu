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
    initAuthSession({ lineWorksParam: false })
  },
})
