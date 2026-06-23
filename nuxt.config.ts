export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  future: { compatibilityVersion: 4 },
  // SPA。auth-worker JWT を fragment/storage で復元して gate するため SSR は使わない。
  ssr: false,

  // PWA (インストール可能 + オフラインのアプリシェル)。manifest / icon / sw は public/、
  // Service Worker 登録は app/plugins/pwa.client.ts。
  app: {
    head: {
      link: [
        { rel: 'manifest', href: '/manifest.webmanifest' },
        { rel: 'icon', type: 'image/svg+xml', href: '/icon.svg' },
        { rel: 'apple-touch-icon', href: '/icon.svg' },
      ],
      meta: [
        { name: 'theme-color', content: '#0b1f3a' },
        { name: 'mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
        { name: 'apple-mobile-web-app-title', content: '一番星請求' },
      ],
    },
  },

  runtimeConfig: {
    public: {
      // auth-worker (JWT 発行 / refresh)。tenant 制限は auth-worker 側
      // (APP_TENANT_ACL) に集約 — 大石運輸倉庫テナントのみ許可する。
      authWorkerUrl: process.env.NUXT_PUBLIC_AUTH_WORKER_URL || '',
      // initAuthSession の gate 判定用。auth-worker → rust-alc-api 系 JWT。
      apiBackend: 'rust-alc-api',
      googleClientId: process.env.NUXT_PUBLIC_GOOGLE_CLIENT_ID || '',
    },
  },

  nitro: {
    preset: 'cloudflare_module',
    // 軽油価格 自動取込 cron。水曜 14:05/14:15/14:25 JST (= 05:05/05:15/05:25 UTC)。
    // 公表 (毎週水曜 14:00) 直後に最大 3 回叩き、新ファイルが出た 1 回だけ取込 + 通知
    // (取得後不要 = diesel_import_state の dedup)。実 cron トリガーは wrangler.toml の
    // [triggers] crons にも同じ式を宣言する (両方必要)。
    experimental: { tasks: true },
    scheduledTasks: {
      // task 名は server/tasks/ からのパス由来 (server/tasks/diesel-import.ts → 'diesel-import')。
      '5,15,25 5 * * 3': ['diesel-import'],
    },
  },

  // lib は .vue/.ts をそのまま ship するので consumer 側で transpile する。
  build: {
    transpile: ['@ippoan/auth-client'],
  },
})
