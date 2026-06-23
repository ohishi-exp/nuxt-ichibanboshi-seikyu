<script setup lang="ts">
// 認証 gate は app/plugins/auth.client.ts (initAuthSession) が担う。
// 未認証ならこのページに到達する前に auth-worker ログインへ redirect される。
// = ここが描画される時点で「大石運輸倉庫テナントで認証済み」。
const config = useRuntimeConfig()
const authWorkerUrl = config.public.authWorkerUrl as string

// 県庁間距離マスタ CSV upload (距離制 input)。Refs #11
type UploadState = 'idle' | 'uploading' | 'done' | 'error'
const uploadState = ref<UploadState>('idle')
const uploadMsg = ref('')
const uploadWarnings = ref<string[]>([])

async function onUpload(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  uploadState.value = 'uploading'
  uploadMsg.value = ''
  uploadWarnings.value = []
  try {
    const text = await file.text()
    const res = await $fetch<{
      ok: boolean
      prefectures: number
      distances: number
      warnings: string[]
    }>('/api/distance', {
      method: 'POST',
      body: text,
      headers: { 'Content-Type': 'text/csv' },
    })
    uploadState.value = 'done'
    uploadMsg.value = `取込完了: ${res.prefectures} 県 / ${res.distances} 距離`
    uploadWarnings.value = res.warnings ?? []
  } catch (err: unknown) {
    uploadState.value = 'error'
    uploadMsg.value = err instanceof Error ? err.message : '取込に失敗しました'
  } finally {
    input.value = ''
  }
}

// D1 スキーマ初期化 (wrangler d1 migrations apply の代わり)。Refs #11
type MigrateState = 'idle' | 'running' | 'done' | 'error'
const migrateState = ref<MigrateState>('idle')
const migrateMsg = ref('')

async function onMigrate() {
  migrateState.value = 'running'
  migrateMsg.value = ''
  try {
    const res = await $fetch<{ ok: boolean; message: string }>('/api/distance-migrate', {
      method: 'POST',
    })
    migrateState.value = 'done'
    migrateMsg.value = res.message
  } catch (err: unknown) {
    migrateState.value = 'error'
    migrateMsg.value = err instanceof Error ? err.message : 'スキーマ適用に失敗しました'
  }
}
</script>

<template>
  <main class="wrap">
    <h1>一番星 燃料サーチャージ請求</h1>
    <p class="lead">確認・計算・表示専用システム</p>

    <section class="card">
      <h2>県庁間距離マスタ (距離制)</h2>
      <p>
        距離制サーチャージの県庁間距離 (47×47) を CSV で download / input します。
        Excel で編集し「CSV UTF-8」で保存したファイルをアップロードすると全置換されます。
      </p>
      <div class="actions">
        <a class="btn" href="/api/distance" download="kenchokan-distance.csv">CSV ダウンロード</a>
        <label class="btn file">
          CSV アップロード
          <input type="file" accept=".csv,text/csv" @change="onUpload" />
        </label>
        <button class="btn" :disabled="migrateState === 'running'" @click="onMigrate">
          DB スキーマ初期化
        </button>
      </div>
      <p v-if="migrateState === 'running'" class="status">スキーマ適用中…</p>
      <p v-else-if="migrateState === 'done'" class="status ok">{{ migrateMsg }}</p>
      <p v-else-if="migrateState === 'error'" class="status err">{{ migrateMsg }}</p>
      <p v-if="uploadState === 'uploading'" class="status">取込中…</p>
      <p v-else-if="uploadState === 'done'" class="status ok">{{ uploadMsg }}</p>
      <p v-else-if="uploadState === 'error'" class="status err">{{ uploadMsg }}</p>
      <ul v-if="uploadWarnings.length" class="warnings">
        <li v-for="(w, i) in uploadWarnings.slice(0, 20)" :key="i">{{ w }}</li>
        <li v-if="uploadWarnings.length > 20">…他 {{ uploadWarnings.length - 20 }} 件</li>
      </ul>
    </section>

    <section class="card">
      <h2>確認 UI</h2>
      <p>
        期間選択 → 明細・得意先別集計・警告は
        <a href="https://github.com/ohishi-exp/nuxt-ichibanboshi-seikyu/issues/5">#5</a>
        で実装予定です。
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
  margin-bottom: 1rem;
}
.card h2 {
  font-size: 1.1rem;
  font-weight: 600;
  margin: 0 0 0.5rem;
}
.actions {
  display: flex;
  gap: 0.75rem;
  margin-top: 0.75rem;
}
.btn {
  display: inline-block;
  padding: 0.4rem 0.9rem;
  border: 1px solid #d1d5db;
  border-radius: 0.375rem;
  background: #fff;
  color: #1f2937;
  font-size: 0.875rem;
  text-decoration: none;
  cursor: pointer;
}
.btn.file input {
  display: none;
}
.status {
  margin: 0.5rem 0 0;
  font-size: 0.875rem;
}
.status.ok {
  color: #047857;
}
.status.err {
  color: #b91c1c;
}
.warnings {
  margin: 0.5rem 0 0;
  padding-left: 1.25rem;
  font-size: 0.8rem;
  color: #b45309;
}
.foot {
  margin-top: 2rem;
  display: flex;
  justify-content: space-between;
  font-size: 0.8rem;
  color: #9ca3af;
}
</style>
