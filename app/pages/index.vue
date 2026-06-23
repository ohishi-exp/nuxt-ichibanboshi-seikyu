<script setup lang="ts">
import { parseDistanceCsv, distanceKey, type DistanceMaster } from '../../src/distance'
import { parseFuelEfficiencyCsv, type FuelEfficiencyEntry } from '../../src/fuel-efficiency'

// 認証 gate は app/plugins/auth.client.ts (initAuthSession) が担う。
// 未認証ならこのページに到達する前に auth-worker ログインへ redirect される。
// = ここが描画される時点で「大石運輸倉庫テナントで認証済み」。
const config = useRuntimeConfig()
const authWorkerUrl = config.public.authWorkerUrl as string

// --- サイドバー (nuxt_dtako_logs ライクの左ナビ形式) ---
type Section = 'distance' | 'fuel' | 'review' | 'settings'
const active = ref<Section>('distance')
const nav: { key: Section; label: string; group: string }[] = [
  { key: 'distance', label: '県庁間距離マスタ', group: 'マスタ' },
  { key: 'fuel', label: '燃費マスタ', group: 'マスタ' },
  { key: 'review', label: '明細・集計', group: '確認' },
  { key: 'settings', label: 'DB スキーマ初期化', group: '設定' },
]
const groups = [...new Set(nav.map((n) => n.group))]

// --- 登録内容の表示 (アップロード結果の確認用)。GET CSV → 既存 parser で復元 ---
type ViewState = 'idle' | 'loading' | 'done' | 'error'

const distMaster = ref<DistanceMaster | null>(null)
const distViewState = ref<ViewState>('idle')
const distViewMsg = ref('')

async function loadDistanceView() {
  distViewState.value = 'loading'
  distViewMsg.value = ''
  try {
    const csv = await $fetch<string>('/api/distance', { responseType: 'text' })
    const { master } = parseDistanceCsv(csv)
    distMaster.value = master
    distViewState.value = 'done'
    if (master.prefs.length === 0) distViewMsg.value = '登録なし (まだアップロードされていません)'
  } catch (err: unknown) {
    distViewState.value = 'error'
    distViewMsg.value = err instanceof Error ? err.message : '読込に失敗しました'
  }
}

const fuelEntries = ref<FuelEfficiencyEntry[]>([])
const fuelViewState = ref<ViewState>('idle')
const fuelViewMsg = ref('')

async function loadFuelView() {
  fuelViewState.value = 'loading'
  fuelViewMsg.value = ''
  try {
    const csv = await $fetch<string>('/api/fuel-efficiency', { responseType: 'text' })
    const { entries } = parseFuelEfficiencyCsv(csv)
    fuelEntries.value = entries
    fuelViewState.value = 'done'
    if (entries.length === 0) fuelViewMsg.value = '登録なし (まだアップロードされていません)'
  } catch (err: unknown) {
    fuelViewState.value = 'error'
    fuelViewMsg.value = err instanceof Error ? err.message : '読込に失敗しました'
  }
}

// 距離セルの取り出し (noUncheckedIndexedAccess 対応)。自県は 0、未登録は空。
function distCell(from: string, to: string): string {
  if (from === to) return '0'
  const v = distMaster.value?.distanceKm[distanceKey(from, to)]
  return v === undefined ? '' : String(v)
}

// --- 燃費マスタ 新規登録 (行機能)。車種は一番星 (rust-ichibanboshi) から取得 ---
interface Vehicle {
  vehicle_code: string
  vehicle_name: string
}
const vehicles = ref<Vehicle[]>([])
const vehiclesLoaded = ref(false)
const vehiclesError = ref('') // 一番星連携未設定/失敗時は手入力にフォールバック

async function loadVehicles() {
  try {
    // proxy は常に 200 + reason で返す (失敗時も)。reason から手入力フォールバック理由を出す。
    const res = await $fetch<{
      vehicles: Vehicle[]
      reason?: string
      upstreamStatus?: number
    }>('/api/vehicles')
    vehicles.value = res.vehicles ?? []
    if (vehicles.value.length) {
      vehiclesError.value = ''
    } else if (res.reason === 'upstream') {
      vehiclesError.value = `一番星 status ${res.upstreamStatus}`
    } else if (res.reason === 'connect_failed') {
      vehiclesError.value = '一番星への接続に失敗'
    } else if (res.reason === 'not_configured') {
      vehiclesError.value = '一番星連携が未設定'
    } else {
      vehiclesError.value = '車種マスタ(一番星)が空です'
    }
  } catch (err: unknown) {
    vehiclesError.value = err instanceof Error ? err.message : '車種マスタ(一番星)の取得に失敗しました'
    vehicles.value = []
  } finally {
    vehiclesLoaded.value = true
  }
}

// 新規登録フォーム
const formSharuC = ref('')
const formName = ref('')
const formKmPerL = ref<number | null>(null)
const formValidFrom = ref('')
const formValidTo = ref('')
const rowState = ref<'idle' | 'saving' | 'error'>('idle')
const rowMsg = ref('')

// 車種選択で車種名を自動補完 (ドロップダウン使用時)
function onSelectVehicle() {
  const v = vehicles.value.find((x) => x.vehicle_code === formSharuC.value)
  if (v) formName.value = v.vehicle_name
}

async function onAddRow() {
  rowState.value = 'saving'
  rowMsg.value = ''
  try {
    await $fetch('/api/fuel-efficiency-row', {
      method: 'POST',
      body: {
        sharuC: formSharuC.value,
        name: formName.value,
        kmPerL: formKmPerL.value,
        validFrom: formValidFrom.value,
        validTo: formValidTo.value,
      },
    })
    rowState.value = 'idle'
    formKmPerL.value = null
    formValidTo.value = ''
    await loadFuelView()
  } catch (err: unknown) {
    rowState.value = 'error'
    rowMsg.value = err instanceof Error ? err.message : '登録に失敗しました'
  }
}

async function onDeleteRow(sharuC: string, validFrom: string) {
  try {
    await $fetch('/api/fuel-efficiency-row', {
      method: 'DELETE',
      query: { sharuC, validFrom },
    })
    await loadFuelView()
  } catch (err: unknown) {
    fuelViewMsg.value = err instanceof Error ? err.message : '削除に失敗しました'
    fuelViewState.value = 'error'
  }
}

// --- 県庁間距離マスタ CSV upload (距離制 input)。Refs #11 ---
type UploadState = 'idle' | 'uploading' | 'done' | 'error'
const distUploadState = ref<UploadState>('idle')
const distUploadMsg = ref('')
const distUploadWarnings = ref<string[]>([])

async function onDistanceUpload(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  distUploadState.value = 'uploading'
  distUploadMsg.value = ''
  distUploadWarnings.value = []
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
    distUploadState.value = 'done'
    distUploadMsg.value = `取込完了: ${res.prefectures} 県 / ${res.distances} 距離`
    distUploadWarnings.value = res.warnings ?? []
    await loadDistanceView() // 取込結果を即表示
  } catch (err: unknown) {
    distUploadState.value = 'error'
    distUploadMsg.value = err instanceof Error ? err.message : '取込に失敗しました'
  } finally {
    input.value = ''
  }
}

// --- 燃費マスタ CSV upload (有効期間つき、#1)。Refs #11 ---
const fuelUploadState = ref<UploadState>('idle')
const fuelUploadMsg = ref('')
const fuelUploadWarnings = ref<string[]>([])

async function onFuelUpload(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  fuelUploadState.value = 'uploading'
  fuelUploadMsg.value = ''
  fuelUploadWarnings.value = []
  try {
    const text = await file.text()
    const res = await $fetch<{ ok: boolean; entries: number; warnings: string[] }>(
      '/api/fuel-efficiency',
      {
        method: 'POST',
        body: text,
        headers: { 'Content-Type': 'text/csv' },
      },
    )
    fuelUploadState.value = 'done'
    fuelUploadMsg.value = `取込完了: ${res.entries} 件`
    fuelUploadWarnings.value = res.warnings ?? []
    await loadFuelView() // 取込結果を即表示
  } catch (err: unknown) {
    fuelUploadState.value = 'error'
    fuelUploadMsg.value = err instanceof Error ? err.message : '取込に失敗しました'
  } finally {
    input.value = ''
  }
}

// --- D1 スキーマ初期化 (wrangler d1 migrations apply の代わり)。Refs #11 ---
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

// セクションを開いた時に未読込なら現在の登録内容を自動表示する。
watch(
  active,
  (sec) => {
    if (sec === 'distance' && distViewState.value === 'idle') void loadDistanceView()
    if (sec === 'fuel') {
      if (fuelViewState.value === 'idle') void loadFuelView()
      if (!vehiclesLoaded.value) void loadVehicles()
    }
  },
  { immediate: true },
)
</script>

<template>
  <div class="shell">
    <aside class="sidebar">
      <div class="brand">
        <strong>一番星</strong>
        <span>燃料サーチャージ請求</span>
      </div>
      <nav>
        <template v-for="g in groups" :key="g">
          <p class="nav-group">{{ g }}</p>
          <button
            v-for="item in nav.filter((n) => n.group === g)"
            :key="item.key"
            class="nav-item"
            :class="{ active: active === item.key }"
            @click="active = item.key"
          >
            {{ item.label }}
          </button>
        </template>
      </nav>
      <footer class="side-foot">
        <span>大石運輸倉庫株式会社テナント限定</span>
        <a v-if="authWorkerUrl" :href="authWorkerUrl">auth-worker 認証</a>
      </footer>
    </aside>

    <main class="content">
      <!-- 県庁間距離マスタ -->
      <section v-if="active === 'distance'" class="card">
        <h2>県庁間距離マスタ (距離制)</h2>
        <p>
          距離制サーチャージの県庁間距離 (47×47) を CSV で download / input します。
          Excel で編集し「CSV UTF-8」で保存したファイルをアップロードすると全置換されます。
        </p>
        <div class="actions">
          <a class="btn" href="/api/distance" download="kenchokan-distance.csv">CSV ダウンロード</a>
          <label class="btn file">
            CSV アップロード
            <input type="file" accept=".csv,text/csv" @change="onDistanceUpload" />
          </label>
          <button class="btn" :disabled="distViewState === 'loading'" @click="loadDistanceView">
            表示を更新
          </button>
        </div>
        <p v-if="distUploadState === 'uploading'" class="status">取込中…</p>
        <p v-else-if="distUploadState === 'done'" class="status ok">{{ distUploadMsg }}</p>
        <p v-else-if="distUploadState === 'error'" class="status err">{{ distUploadMsg }}</p>
        <ul v-if="distUploadWarnings.length" class="warnings">
          <li v-for="(w, i) in distUploadWarnings.slice(0, 20)" :key="i">{{ w }}</li>
          <li v-if="distUploadWarnings.length > 20">…他 {{ distUploadWarnings.length - 20 }} 件</li>
        </ul>

        <!-- 現在の登録内容 -->
        <h3 class="view-title">現在の登録内容</h3>
        <p v-if="distViewState === 'loading'" class="status">読込中…</p>
        <p v-else-if="distViewState === 'error'" class="status err">{{ distViewMsg }}</p>
        <p v-else-if="distViewMsg" class="status">{{ distViewMsg }}</p>
        <template v-if="distViewState === 'done' && distMaster && distMaster.prefs.length">
          <p class="summary">{{ distMaster.prefs.length }} 県 登録済み</p>
          <div class="matrix-scroll">
            <table class="matrix">
              <thead>
                <tr>
                  <th class="corner">積地＼卸地</th>
                  <th v-for="to in distMaster.prefs" :key="to">{{ to }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="from in distMaster.prefs" :key="from">
                  <th class="rowhead">{{ from }}</th>
                  <td v-for="to in distMaster.prefs" :key="to">{{ distCell(from, to) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
      </section>

      <!-- 燃費マスタ -->
      <section v-else-if="active === 'fuel'" class="card">
        <h2>燃費マスタ (車種 × 有効期間)</h2>
        <p>
          車種別の燃費 km/L を「いつから・いつまで」(有効期間) つきで管理します。
          列は <code>車種C,車種名,燃費,有効開始,有効終了</code>。有効終了が空なら無期限、
          同一車種で期間が重なる場合は有効開始が新しい方を採用します。
        </p>
        <div class="actions">
          <a class="btn" href="/api/fuel-efficiency" download="fuel-efficiency.csv">CSV ダウンロード</a>
          <label class="btn file">
            CSV アップロード
            <input type="file" accept=".csv,text/csv" @change="onFuelUpload" />
          </label>
          <button class="btn" :disabled="fuelViewState === 'loading'" @click="loadFuelView">
            表示を更新
          </button>
        </div>
        <p v-if="fuelUploadState === 'uploading'" class="status">取込中…</p>
        <p v-else-if="fuelUploadState === 'done'" class="status ok">{{ fuelUploadMsg }}</p>
        <p v-else-if="fuelUploadState === 'error'" class="status err">{{ fuelUploadMsg }}</p>
        <ul v-if="fuelUploadWarnings.length" class="warnings">
          <li v-for="(w, i) in fuelUploadWarnings.slice(0, 20)" :key="i">{{ w }}</li>
          <li v-if="fuelUploadWarnings.length > 20">…他 {{ fuelUploadWarnings.length - 20 }} 件</li>
        </ul>

        <!-- 新規登録 (行機能)。車種は一番星から取得 -->
        <h3 class="view-title">新規登録</h3>
        <form class="row-form" @submit.prevent="onAddRow">
          <label>
            車種
            <!-- 一番星から取得できれば選択、未設定/失敗時は車種C 手入力にフォールバック -->
            <select
              v-if="vehicles.length"
              v-model="formSharuC"
              required
              @change="onSelectVehicle"
            >
              <option value="" disabled>選択…</option>
              <option v-for="v in vehicles" :key="v.vehicle_code" :value="v.vehicle_code">
                {{ v.vehicle_code }} {{ v.vehicle_name }}
              </option>
            </select>
            <input
              v-else
              v-model="formSharuC"
              placeholder="車種C (例 04)"
              required
              size="6"
            />
          </label>
          <label>
            車種名
            <input v-model="formName" placeholder="大型幌" />
          </label>
          <label>
            燃費 km/L
            <input v-model.number="formKmPerL" type="number" step="0.1" min="0" required />
          </label>
          <label>
            有効開始
            <input v-model="formValidFrom" type="date" required />
          </label>
          <label>
            有効終了 (任意)
            <input v-model="formValidTo" type="date" />
          </label>
          <button class="btn" type="submit" :disabled="rowState === 'saving'">追加</button>
        </form>
        <p v-if="vehiclesError" class="status warn-note">
          車種マスタ(一番星)未取得のため車種C は手入力です: {{ vehiclesError }}
        </p>
        <p v-if="rowState === 'error'" class="status err">{{ rowMsg }}</p>

        <!-- 現在の登録内容 -->
        <h3 class="view-title">現在の登録内容</h3>
        <p v-if="fuelViewState === 'loading'" class="status">読込中…</p>
        <p v-else-if="fuelViewState === 'error'" class="status err">{{ fuelViewMsg }}</p>
        <p v-else-if="fuelViewMsg" class="status">{{ fuelViewMsg }}</p>
        <table v-if="fuelViewState === 'done' && fuelEntries.length" class="grid">
          <thead>
            <tr>
              <th>車種C</th>
              <th>車種名</th>
              <th>燃費 (km/L)</th>
              <th>有効開始</th>
              <th>有効終了</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(e, i) in fuelEntries" :key="i">
              <td>{{ e.sharuC }}</td>
              <td>{{ e.name }}</td>
              <td class="num">{{ e.kmPerL }}</td>
              <td>{{ e.validFrom }}</td>
              <td>{{ e.validTo ?? '（無期限）' }}</td>
              <td>
                <button class="link-del" @click="onDeleteRow(e.sharuC, e.validFrom)">削除</button>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <!-- 確認 UI (placeholder) -->
      <section v-else-if="active === 'review'" class="card">
        <h2>明細・得意先別集計</h2>
        <p>
          期間選択 → 明細・得意先別集計・警告は
          <a href="https://github.com/ohishi-exp/nuxt-ichibanboshi-seikyu/issues/5">#5</a>
          で実装予定です。計算エンジン (段階テーブル + ceil、有効期間つき燃費) は実装済み。
        </p>
      </section>

      <!-- 設定 / スキーマ初期化 -->
      <section v-else class="card">
        <h2>DB スキーマ初期化</h2>
        <p>
          D1 のテーブル (県庁間距離 / 燃費マスタ) を作成します。
          <code>wrangler d1 migrations apply</code> を CLI で叩く代わりの初回セットアップ用です。
          <code>CREATE TABLE IF NOT EXISTS</code> なので何度押しても安全です。
        </p>
        <div class="actions">
          <button class="btn" :disabled="migrateState === 'running'" @click="onMigrate">
            スキーマを適用
          </button>
        </div>
        <p v-if="migrateState === 'running'" class="status">スキーマ適用中…</p>
        <p v-else-if="migrateState === 'done'" class="status ok">{{ migrateMsg }}</p>
        <p v-else-if="migrateState === 'error'" class="status err">{{ migrateMsg }}</p>
      </section>
    </main>
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  min-height: 100vh;
  font-family: system-ui, sans-serif;
  color: #1f2937;
}
.sidebar {
  width: 240px;
  flex-shrink: 0;
  background: #111827;
  color: #e5e7eb;
  display: flex;
  flex-direction: column;
  padding: 1.25rem 0;
}
.brand {
  display: flex;
  flex-direction: column;
  padding: 0 1.25rem 1.25rem;
  border-bottom: 1px solid #1f2937;
}
.brand strong {
  font-size: 1.2rem;
}
.brand span {
  font-size: 0.75rem;
  color: #9ca3af;
}
nav {
  flex: 1;
  padding: 0.75rem 0.5rem;
}
.nav-group {
  margin: 0.75rem 0.75rem 0.25rem;
  font-size: 0.7rem;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: #6b7280;
}
.nav-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 0.5rem 0.75rem;
  border: 0;
  border-radius: 0.375rem;
  background: transparent;
  color: #d1d5db;
  font-size: 0.9rem;
  cursor: pointer;
}
.nav-item:hover {
  background: #1f2937;
  color: #fff;
}
.nav-item.active {
  background: #2563eb;
  color: #fff;
}
.side-foot {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 1rem 1.25rem 0;
  border-top: 1px solid #1f2937;
  font-size: 0.7rem;
  color: #9ca3af;
}
.side-foot a {
  color: #93c5fd;
}
.content {
  flex: 1;
  padding: 2rem 2.5rem;
  background: #f3f4f6;
}
.card {
  max-width: 720px;
  border: 1px solid #e5e7eb;
  border-radius: 0.5rem;
  padding: 1.25rem 1.5rem;
  background: #fff;
}
.card h2 {
  font-size: 1.2rem;
  font-weight: 600;
  margin: 0 0 0.5rem;
}
.card code {
  background: #f3f4f6;
  padding: 0.1rem 0.3rem;
  border-radius: 0.25rem;
  font-size: 0.85em;
}
.actions {
  display: flex;
  gap: 0.75rem;
  margin-top: 0.75rem;
  flex-wrap: wrap;
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
.btn:hover {
  background: #f9fafb;
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
.view-title {
  font-size: 0.95rem;
  font-weight: 600;
  margin: 1.25rem 0 0.5rem;
  padding-top: 0.75rem;
  border-top: 1px solid #e5e7eb;
}
.summary {
  margin: 0 0 0.5rem;
  font-size: 0.85rem;
  color: #374151;
}
.grid {
  border-collapse: collapse;
  font-size: 0.85rem;
}
.grid th,
.grid td {
  border: 1px solid #e5e7eb;
  padding: 0.3rem 0.6rem;
  text-align: left;
}
.grid th {
  background: #f3f4f6;
  font-weight: 600;
}
.grid td.num {
  text-align: right;
}
.row-form {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: flex-end;
}
.row-form label {
  display: flex;
  flex-direction: column;
  font-size: 0.75rem;
  color: #374151;
  gap: 0.2rem;
}
.row-form input,
.row-form select {
  padding: 0.3rem 0.5rem;
  border: 1px solid #d1d5db;
  border-radius: 0.375rem;
  font-size: 0.85rem;
}
.warn-note {
  color: #b45309;
}
.link-del {
  border: 0;
  background: transparent;
  color: #b91c1c;
  cursor: pointer;
  font-size: 0.8rem;
  text-decoration: underline;
}
.matrix-scroll {
  max-height: 460px;
  overflow: auto;
  border: 1px solid #e5e7eb;
}
.matrix {
  border-collapse: collapse;
  font-size: 0.72rem;
}
.matrix th,
.matrix td {
  border: 1px solid #e5e7eb;
  padding: 0.2rem 0.35rem;
  text-align: right;
  white-space: nowrap;
}
.matrix thead th {
  position: sticky;
  top: 0;
  background: #f3f4f6;
  z-index: 1;
}
.matrix th.rowhead,
.matrix th.corner {
  position: sticky;
  left: 0;
  background: #f3f4f6;
  text-align: left;
  z-index: 2;
}
.matrix th.corner {
  z-index: 3;
}
@media (max-width: 640px) {
  .shell {
    flex-direction: column;
  }
  .sidebar {
    width: 100%;
  }
  .content {
    padding: 1.25rem;
  }
}
</style>
