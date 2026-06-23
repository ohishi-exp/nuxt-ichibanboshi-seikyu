/**
 * PWA Service Worker 登録 (ブラウザ専用)。
 * /sw.js を登録し、インストール可能 + オフラインのアプリシェルを有効化する。
 * 失敗しても握りつぶす (PWA は付加機能で、本体動作には必須でない)。
 */
export default defineNuxtPlugin(() => {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
})
