// 一番星 燃料サーチャージ請求 PWA の Service Worker。
// インストール可能要件 (fetch ハンドラ) を満たしつつ、アプリシェルを network-first でキャッシュし
// オフライン時にフォールバックする。API (/api/*) と非 GET はキャッシュ対象外。
const CACHE = 'ichibanboshi-seikyu-v1'

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  const url = new URL(req.url)
  // GET 以外・API・別オリジンはそのまま (キャッシュしない)
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) {
    return
  }
  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone()
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {})
        return res
      })
      .catch(async () => {
        const cached = await caches.match(req)
        // SPA: ナビゲーションはアプリシェル (/) にフォールバック
        return cached || (await caches.match('/')) || Response.error()
      }),
  )
})
