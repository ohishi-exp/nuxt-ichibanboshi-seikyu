export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  future: { compatibilityVersion: 4 },
  // SPA。auth-worker JWT を fragment/storage で復元して gate するため SSR は使わない。
  ssr: false,

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
  },

  // lib は .vue/.ts をそのまま ship するので consumer 側で transpile する。
  build: {
    transpile: ['@ippoan/auth-client'],
  },
})
