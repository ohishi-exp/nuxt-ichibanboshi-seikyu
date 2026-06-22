<script setup lang="ts">
// 認証 gate は app/plugins/auth.client.ts (initAuthSession) が担う。
// 未認証ならこのページに到達する前に auth-worker ログインへ redirect される。
// = ここが描画される時点で「大石運輸倉庫テナントで認証済み」。
const config = useRuntimeConfig()
const authWorkerUrl = config.public.authWorkerUrl as string
</script>

<template>
  <main class="wrap">
    <h1>一番星 燃料サーチャージ請求</h1>
    <p class="lead">確認・計算・表示専用システム</p>

    <section class="card">
      <h2>準備中</h2>
      <p>
        確認 UI (期間選択 → 明細・得意先別集計・警告) は
        <a href="https://github.com/ohishi-exp/nuxt-ichibanboshi-seikyu/issues/5">#5</a>
        で実装予定です。現在は認証とデプロイ経路の疎通のみ有効です。
      </p>
    </section>

    <footer class="foot">
      <span>大石運輸倉庫株式会社テナント限定 (auth-worker 認証)</span>
      <a v-if="authWorkerUrl" :href="authWorkerUrl">auth-worker</a>
    </footer>
  </main>
</template>

<style scoped>
.wrap {
  max-width: 640px;
  margin: 0 auto;
  padding: 2rem 1.25rem;
  font-family: system-ui, sans-serif;
  color: #1f2937;
}
h1 {
  font-size: 1.5rem;
  font-weight: 700;
}
.lead {
  color: #6b7280;
  margin: 0.25rem 0 1.5rem;
}
.card {
  border: 1px solid #e5e7eb;
  border-radius: 0.5rem;
  padding: 1rem 1.25rem;
  background: #f9fafb;
}
.card h2 {
  font-size: 1.1rem;
  font-weight: 600;
  margin: 0 0 0.5rem;
}
.foot {
  margin-top: 2rem;
  display: flex;
  justify-content: space-between;
  font-size: 0.8rem;
  color: #9ca3af;
}
</style>
