<script setup lang="ts">
import { parseDistanceCsv, distanceKey, type DistanceMaster } from '../../src/distance'
import { parseFuelEfficiencyCsv, toEfficiencyLookup, type FuelEfficiencyEntry } from '../../src/fuel-efficiency'
import { parseDieselPriceCsv, toMonthlyPriceMap, type DieselPriceEntry } from '../../src/diesel-price'
import { computeSurcharge, type SurchargeMasters, type SurchargeResult } from '../../src/surcharge'
import {
  mapToMeisaiRows,
  isAdjustmentRow,
  type IchibanSurchargeRow,
} from '../../src/surcharge-review'
import { aggregateByCustomer, type ShimebiCustomerRow } from '../../src/shimebi-summary'
import { replaceResultsByRowId } from '../../src/shimebi-merge'
import { SHIMEBI_DETAIL_PAYLOAD_KEY } from '../../src/shimebi-detail-key'
import { buildShimebiCsv } from '../../src/shimebi-csv'
import {
  generateIncrementTable,
  TIME_BASED_DISTANCES,
  NOTIFICATION_BASE_PRICE,
  NOTIFICATION_PRICE_STEP,
} from '../../src/notification-form'

// 認証 gate は app/plugins/auth.client.ts (initAuthSession) が担う。
// 未認証ならこのページに到達する前に auth-worker ログインへ redirect される。
// = ここが描画される時点で「大石運輸倉庫テナントで認証済み」。
const config = useRuntimeConfig()
const authWorkerUrl = config.public.authWorkerUrl as string

// --- サイドバー (nuxt_dtako_logs ライクの左ナビ形式) ---
type Section =
  | 'distance'
  | 'fuel'
  | 'diesel'
  | 'surchargeCustomers'
  | 'notification'
  | 'shimebi'
  | 'settings'
const active = ref<Section>('shimebi')
const nav: { key: Section; label: string; group: string }[] = [
  { key: 'shimebi', label: '締め日別 取引先', group: '確認' },
  { key: 'distance', label: '県庁間距離マスタ', group: '設定' },
  { key: 'fuel', label: '燃費マスタ', group: '設定' },
  { key: 'diesel', label: '軽油価格マスタ', group: '設定' },
  { key: 'surchargeCustomers', label: 'サーチャージマスタ', group: '設定' },
  { key: 'notification', label: '届出書', group: '設定' },
  { key: 'settings', label: 'DB スキーマ初期化', group: '設定' },
]
// 設定グループ (距離/燃費/軽油/サーチャージ/届出/DB初期化) を 2 段目タブにする。
const settingsNav = nav.filter((n) => n.key !== 'shimebi')
const isSettings = computed(() => active.value !== 'shimebi')
// 設定内で最後に開いていたサブタブ。「設定」を押した時にここへ戻す。
const lastSettingsSub = ref<Section>('distance')
watch(active, (v) => {
  if (v !== 'shimebi') lastSettingsSub.value = v
})
function openSettings() {
  if (active.value === 'shimebi') active.value = lastSettingsSub.value
}

// 直近に開いていたタブを復元する (リロードで毎回先頭タブに戻らないように)。
// 認証コールバックが URL fragment を使うため hash は避け、localStorage に保存する。
const ACTIVE_TAB_KEY = 'ichibanboshi-seikyu:active-tab'
if (import.meta.client) {
  const saved = localStorage.getItem(ACTIVE_TAB_KEY)
  if (saved && nav.some((n) => n.key === saved)) {
    active.value = saved as Section
  }
}

// --- 届出書 (届出用紙)。段階上昇額テーブル + 時間制平均距離 + 燃費マスタ現在値。Refs #11-B ---
const timeBasedDistances = TIME_BASED_DISTANCES
// 基準価格 / 刻み幅は設定 (surcharge_settings) で変更可能。既定は notification-form の定数。
const notifBasePrice = ref(NOTIFICATION_BASE_PRICE)
const notifPriceStep = ref(NOTIFICATION_PRICE_STEP)
// 段階上昇額テーブルは基準価格・刻み幅から導出 (設定変更で追従)。
const incrementTable = computed(() => generateIncrementTable(notifBasePrice.value, notifPriceStep.value))

// サーチャージ設定 (基準価格 / 刻み幅) の読込・保存。Refs #11
const settingsState = ref<'idle' | 'loading' | 'saving' | 'done' | 'error'>('idle')
const settingsMsg = ref('')
async function loadSurchargeSettingsView() {
  settingsState.value = 'loading'
  try {
    const s = await $fetch<{ basePrice: number; priceStep: number }>('/api/surcharge-settings')
    notifBasePrice.value = s.basePrice
    notifPriceStep.value = s.priceStep
    settingsState.value = 'idle'
  } catch (err: unknown) {
    settingsState.value = 'error'
    settingsMsg.value = err instanceof Error ? err.message : '設定の読込に失敗しました'
  }
}
async function onSaveSurchargeSettings() {
  settingsState.value = 'saving'
  settingsMsg.value = ''
  try {
    const s = await $fetch<{ basePrice: number; priceStep: number }>('/api/surcharge-settings', {
      method: 'PUT',
      body: { basePrice: notifBasePrice.value, priceStep: notifPriceStep.value },
    })
    notifBasePrice.value = s.basePrice
    notifPriceStep.value = s.priceStep
    settingsState.value = 'done'
    settingsMsg.value = '保存しました (届出書・計算に反映)'
  } catch (err: unknown) {
    settingsState.value = 'error'
    settingsMsg.value = err instanceof Error ? err.message : '保存に失敗しました'
  }
}
function onPrintNotification() {
  // 印刷ダイアログ → 「PDF に保存」。@media print で届出書だけを出す。
  window.print()
}

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
const rowSavedMsg = ref('')

// 車種選択で車種名を自動補完 (ドロップダウン使用時)
function onSelectVehicle() {
  const v = vehicles.value.find((x) => x.vehicle_code === formSharuC.value)
  if (v) formName.value = v.vehicle_name
}

// 既存行のインライン編集を保存 (PK = 車種C×有効開始 は不変なので upsert で置換)
async function onSaveRow(e: FuelEfficiencyEntry) {
  rowState.value = 'saving'
  rowMsg.value = ''
  rowSavedMsg.value = ''
  try {
    await $fetch('/api/fuel-efficiency-row', {
      method: 'POST',
      body: {
        sharuC: e.sharuC,
        name: e.name,
        kmPerL: e.kmPerL,
        validFrom: e.validFrom,
        validTo: e.validTo ?? '',
      },
    })
    rowState.value = 'idle'
    rowSavedMsg.value = `保存しました: ${e.sharuC} (${e.validFrom})`
    await loadFuelView()
  } catch (err: unknown) {
    rowState.value = 'error'
    rowMsg.value = err instanceof Error ? err.message : '保存に失敗しました'
  }
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

// --- 軽油価格マスタ (当月全国平均軽油価格)。Refs #11 (#2) ---
const dieselEntries = ref<DieselPriceEntry[]>([])
const dieselViewState = ref<ViewState>('idle')
const dieselViewMsg = ref('')
const dieselUploadState = ref<UploadState>('idle')
const dieselUploadMsg = ref('')
const dieselUploadWarnings = ref<string[]>([])
const dieselFormMonth = ref('')
const dieselFormPrice = ref<number | null>(null)
const dieselRowState = ref<'idle' | 'saving' | 'error'>('idle')
const dieselRowMsg = ref('')

// 週次 全国平均 (検算用)。月次平均が妥当か人が確認できるよう、取込時に保存した週次を月別に表示。
const dieselWeekly = ref<{ date: string; month: string; price: number }[]>([])
// 月別グループ (降順)。各月の週次価格 + 単純平均 (= 月次平均の根拠)。
const dieselWeeklyByMonth = computed(() => {
  const map = new Map<string, { date: string; price: number }[]>()
  for (const w of dieselWeekly.value) {
    const arr = map.get(w.month) ?? []
    arr.push({ date: w.date, price: w.price })
    map.set(w.month, arr)
  }
  return [...map.entries()]
    .map(([month, weeks]) => {
      const sorted = weeks.sort((a, b) => a.date.localeCompare(b.date))
      const mean = sorted.reduce((s, w) => s + w.price, 0) / sorted.length
      // avg = 登録値と同じ四捨五入 (小数1桁)。avgRaw = 丸め前 (検算で四捨五入方向を確認)。
      const avg = Math.round(mean * 10) / 10
      const avgRaw = Math.round(mean * 100) / 100
      return { month, weeks: sorted, avg, avgRaw }
    })
    .sort((a, b) => b.month.localeCompare(a.month))
})

// 月 -> 週次内訳 の索引 (現在の登録内容テーブルの行展開で検算表示する)。
const dieselWeeklyMap = computed(() => {
  const m = new Map<
    string,
    { weeks: { date: string; price: number }[]; avg: number; avgRaw: number }
  >()
  for (const g of dieselWeeklyByMonth.value)
    m.set(g.month, { weeks: g.weeks, avg: g.avg, avgRaw: g.avgRaw })
  return m
})
// 現在の登録内容テーブルで週次内訳 (検算) を展開している月。
const openDieselMonths = ref<Record<string, boolean>>({})
function toggleDieselMonth(month: string) {
  openDieselMonths.value = { ...openDieselMonths.value, [month]: !openDieselMonths.value[month] }
}

async function loadDieselView() {
  dieselViewState.value = 'loading'
  dieselViewMsg.value = ''
  try {
    const csv = await $fetch<string>('/api/diesel-price', { responseType: 'text' })
    // 表示は年月の降順 (新しい月が上)。保存/削除は month キー単位なので並び順は不問。
    dieselEntries.value = parseDieselPriceCsv(csv).entries.sort((a, b) => b.month.localeCompare(a.month))
    // 週次内訳 (検算用) も取得。未取込なら空 (=従来表示)。失敗は握って月次表示は出す。
    try {
      const wk = await $fetch<{ weekly: { date: string; month: string; price: number }[] }>(
        '/api/diesel-weekly',
      )
      dieselWeekly.value = wk.weekly
    } catch {
      dieselWeekly.value = []
    }
    dieselViewState.value = 'done'
    if (dieselEntries.value.length === 0) dieselViewMsg.value = '登録なし (まだ登録されていません)'
  } catch (err: unknown) {
    dieselViewState.value = 'error'
    dieselViewMsg.value = err instanceof Error ? err.message : '読込に失敗しました'
  }
}

async function onDieselUpload(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  dieselUploadState.value = 'uploading'
  dieselUploadMsg.value = ''
  dieselUploadWarnings.value = []
  try {
    const text = await file.text()
    const res = await $fetch<{ ok: boolean; entries: number; warnings: string[] }>(
      '/api/diesel-price',
      { method: 'POST', body: text, headers: { 'Content-Type': 'text/csv' } },
    )
    dieselUploadState.value = 'done'
    dieselUploadMsg.value = `取込完了: ${res.entries} 件`
    dieselUploadWarnings.value = res.warnings ?? []
    await loadDieselView()
  } catch (err: unknown) {
    dieselUploadState.value = 'error'
    dieselUploadMsg.value = err instanceof Error ? err.message : '取込に失敗しました'
  } finally {
    input.value = ''
  }
}

async function onAddDiesel() {
  dieselRowState.value = 'saving'
  dieselRowMsg.value = ''
  try {
    await $fetch('/api/diesel-price-row', {
      method: 'POST',
      body: { month: dieselFormMonth.value, price: dieselFormPrice.value },
    })
    dieselRowState.value = 'idle'
    dieselFormMonth.value = ''
    dieselFormPrice.value = null
    await loadDieselView()
  } catch (err: unknown) {
    dieselRowState.value = 'error'
    dieselRowMsg.value = err instanceof Error ? err.message : '登録に失敗しました'
  }
}

async function onSaveDiesel(e: DieselPriceEntry) {
  dieselRowState.value = 'saving'
  dieselRowMsg.value = ''
  try {
    await $fetch('/api/diesel-price-row', {
      method: 'POST',
      body: { month: e.month, price: e.price },
    })
    dieselRowState.value = 'idle'
    await loadDieselView()
  } catch (err: unknown) {
    dieselRowState.value = 'error'
    dieselRowMsg.value = err instanceof Error ? err.message : '保存に失敗しました'
  }
}

async function onDeleteDiesel(month: string) {
  try {
    await $fetch('/api/diesel-price-row', { method: 'DELETE', query: { month } })
    await loadDieselView()
  } catch (err: unknown) {
    dieselViewMsg.value = err instanceof Error ? err.message : '削除に失敗しました'
    dieselViewState.value = 'error'
  }
}

// 経産省公表値の取込 (動的に最新週次 xlsx を解決 → 月次平均 → upsert)。Refs #11 (#2)
const importState = ref<'idle' | 'running' | 'done' | 'error'>('idle')
const importMsg = ref('')
async function onDieselImport() {
  importState.value = 'running'
  importMsg.value = ''
  try {
    const res = await $fetch<{
      ok: boolean
      months?: number
      latestMonth?: string
      latestPrice?: number
      sourceUrl?: string
      weeklyWritten?: number
      weeklyError?: string
    }>('/api/diesel-import', { method: 'POST' })
    importState.value = 'done'
    const weeklyMsg = res.weeklyError
      ? ` / 週次保存エラー: ${res.weeklyError}`
      : ` / 週次 ${res.weeklyWritten ?? 0} 件保存`
    importMsg.value = `取込完了: ${res.months} ヶ月 (最新 ${res.latestMonth} = ${res.latestPrice} 円/L)${weeklyMsg}`
    await loadDieselView()
  } catch (err: unknown) {
    importState.value = 'error'
    importMsg.value = err instanceof Error ? err.message : '取込に失敗しました'
  }
}

// cron と同じオーケストレーション (重複判定 + LINE WORKS 通知) を手動実行。Refs #11 (#2)
const cronState = ref<'idle' | 'running' | 'done' | 'error'>('idle')
const cronMsg = ref('')
async function onDieselCron() {
  cronState.value = 'running'
  cronMsg.value = ''
  try {
    const res = await $fetch<{
      status: string
      months?: number
      latestMonth?: string
      latestPrice?: number
      notified?: boolean
      reason?: string
    }>('/api/diesel-cron', { method: 'POST' })
    cronState.value = 'done'
    if (res.status === 'imported') {
      cronMsg.value = `取込 (最新 ${res.latestMonth} = ${res.latestPrice} 円/L) / 通知: ${res.notified ? '送信' : '未設定'}`
    } else if (res.status === 'skipped_no_new') {
      cronMsg.value = '新しい週次ファイルが無いため skip (取得済み)'
    } else {
      cronMsg.value = `${res.status}: ${res.reason ?? ''}`
    }
    await loadDieselView()
  } catch (err: unknown) {
    cronState.value = 'error'
    cronMsg.value = err instanceof Error ? err.message : 'cron 実行に失敗しました'
  }
}

// 経産省公表値の自動取得 probe (Phase 1: Worker から到達できるか確認)。Refs #11 (#2)
interface PublicationDate {
  date: string
  time: string
  weekday: string
}
interface DieselProbeResult {
  ok: boolean
  status?: number
  contentType?: string
  bytes?: number
  url?: string
  links?: string[]
  schedule?: PublicationDate[]
  reason?: string
  message?: string
}
const probeUrl = ref('')
const probeState = ref<'idle' | 'running' | 'done' | 'error'>('idle')
const probeResult = ref<DieselProbeResult | null>(null)
const probeErr = ref('')

async function onDieselProbe() {
  probeState.value = 'running'
  probeErr.value = ''
  probeResult.value = null
  try {
    const res = await $fetch<DieselProbeResult>('/api/diesel-fetch', {
      query: probeUrl.value ? { url: probeUrl.value } : {},
    })
    probeResult.value = res
    probeState.value = 'done'
  } catch (err: unknown) {
    probeState.value = 'error'
    probeErr.value = err instanceof Error ? err.message : 'probe に失敗しました'
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

// --- サーチャージマスタ (サーチャージ対象として登録する取引先)。Refs #11 ---
interface SurchargeCustomerView {
  customerCode: string
  customerName: string
}
const surchargeCustomers = ref<SurchargeCustomerView[]>([])
const scState = ref<ViewState>('idle')
const scMsg = ref('')
const scFormCode = ref('')
const scFormName = ref('')
// 締め日別画面と共有する「登録済み取引先コード」集合
const registeredCodes = ref<Set<string>>(new Set())

async function loadSurchargeCustomers() {
  scState.value = 'loading'
  scMsg.value = ''
  try {
    const res = await $fetch<{ customers: SurchargeCustomerView[] }>('/api/surcharge-customers')
    surchargeCustomers.value = res.customers
    registeredCodes.value = new Set(res.customers.map((c) => c.customerCode))
    scState.value = 'done'
    if (res.customers.length === 0) scMsg.value = '登録なし'
  } catch (err: unknown) {
    scState.value = 'error'
    scMsg.value = err instanceof Error ? err.message : '読込に失敗しました'
  }
}
async function onAddSurchargeCustomer() {
  const code = scFormCode.value.trim()
  if (!code) return
  try {
    await $fetch('/api/surcharge-customers', {
      method: 'POST',
      body: { customerCode: code, customerName: scFormName.value },
    })
    scFormCode.value = ''
    scFormName.value = ''
    await loadSurchargeCustomers()
  } catch (err: unknown) {
    scState.value = 'error'
    scMsg.value = err instanceof Error ? err.message : '追加に失敗しました'
  }
}
async function onDeleteSurchargeCustomer(code: string) {
  try {
    await $fetch('/api/surcharge-customers', { method: 'DELETE', query: { code } })
    await loadSurchargeCustomers()
  } catch (err: unknown) {
    scState.value = 'error'
    scMsg.value = err instanceof Error ? err.message : '削除に失敗しました'
  }
}

// --- 締め日別 取引先 (締め日 = 請求日/入金予定の日付)。Refs #11 ---
function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
const shimebiDate = ref('') // YYYY-MM-DD (締め日 = 請求日)
const shimebiState = ref<ViewState>('idle')
// 明細を開いたままの「再取得」中フラグ (shimebiState は 'done' のまま → モーダル/明細を閉じない)
const shimebiRefetching = ref(false)
// 行単位 再取得中の row_id (その行にスピナーを出す)
const refetchingRowIds = ref<Set<string>>(new Set())
const shimebiMsg = ref('')
const shimebiRows = ref<ShimebiCustomerRow[]>([])
// 名前クリックで明細を出すため、締め日一致行の per-row 計算結果と当月軽油価格を保持。
const shimebiResults = ref<SurchargeResult[]>([])
const shimebiDieselMap = ref<Record<string, number>>({})
// skip (計算しない) 登録済みの行 ID。集計から除外する。
const skippedRowIds = ref<Set<string>>(new Set())
// 入力者 (入力担当C) 絞り込み。空 ('') = 入力者指定なし → 登録済み取引先のみ表示。
const selectedInputStaff = ref('')

/** 取得済み結果に含まれる入力担当C の一覧 (昇順、空欄除く)。入力者ドロップダウン用 */
const inputStaffOptions = computed(() => {
  const set = new Set<string>()
  for (const r of shimebiResults.value) {
    const code = r.row.inputStaffCode
    if (code) set.add(code)
  }
  return [...set].sort()
})

/** skip 行を除いた計算結果 (集計対象) */
function nonSkippedResults(results: SurchargeResult[]): SurchargeResult[] {
  return results.filter((r) => !(r.row.rowId && skippedRowIds.value.has(r.row.rowId)))
}
/**
 * shimebiResults + skip + 入力者 + 登録有無 から取引先サマリを再集計する。
 * - 入力者を選択中: その入力担当C の行のみを集計 (登録 / 未登録どちらも表示)
 * - 入力者なし (空): 登録済み (サーチャージ対象) 取引先のみ表示
 */
function recomputeShimebiRows() {
  let results = nonSkippedResults(shimebiResults.value)
  if (selectedInputStaff.value) {
    results = results.filter((r) => r.row.inputStaffCode === selectedInputStaff.value)
  }
  let rows = aggregateByCustomer(results, (code) => registeredCodes.value.has(code))
  if (!selectedInputStaff.value) {
    rows = rows.filter((r) => r.registered)
  }
  shimebiRows.value = rows
}
// 入力者の選択を変えたら再集計 (再取得は不要 — 取得済み結果の絞り込みだけ)
watch(selectedInputStaff, () => {
  if (shimebiState.value === 'done') recomputeShimebiRows()
})
const shimebiDetailCode = ref<string | null>(null)
const shimebiDetailRows = computed(() =>
  shimebiResults.value.filter((r) => r.row.tokuiC === shimebiDetailCode.value),
)
const shimebiDetailName = computed(
  () => shimebiRows.value.find((r) => r.customerCode === shimebiDetailCode.value)?.customerName ?? '',
)

// 明細の表示方法 (下/右/モーダル/別タブ) を localStorage に保存して設定にする。
type DetailMode = 'below' | 'right' | 'modal' | 'newtab'
const DETAIL_MODE_KEY = 'ichibanboshi-seikyu:shimebi-detail-mode'
const shimebiDetailMode = ref<DetailMode>('modal')
if (import.meta.client) {
  const saved = localStorage.getItem(DETAIL_MODE_KEY)
  if (saved === 'below' || saved === 'right' || saved === 'modal' || saved === 'newtab') {
    shimebiDetailMode.value = saved
  }
}
watch(shimebiDetailMode, (m) => {
  if (import.meta.client) localStorage.setItem(DETAIL_MODE_KEY, m)
})

function onShowShimebiDetail(code: string) {
  // 別タブ: 明細データを localStorage に渡して standalone ページを新規タブで開く
  if (shimebiDetailMode.value === 'newtab') {
    if (!import.meta.client) return
    const rows = shimebiResults.value.filter((r) => r.row.tokuiC === code)
    const name = shimebiRows.value.find((r) => r.customerCode === code)?.customerName ?? ''
    localStorage.setItem(
      SHIMEBI_DETAIL_PAYLOAD_KEY,
      JSON.stringify({
        code,
        name,
        date: shimebiDate.value,
        rows,
        dieselMap: shimebiDieselMap.value,
        skippedRowIds: [...skippedRowIds.value],
      }),
    )
    window.open('/shimebi-detail', '_blank')
    return
  }
  // 下/右/モーダル: ページ内でトグル表示
  shimebiDetailCode.value = shimebiDetailCode.value === code ? null : code
}

// 明細ヘッダの「再取得」: モーダル/明細を閉じずに (shimebiState は 'done' のまま) データだけ
// 再取得して差し替える。再取得中は shimebiRefetching=true で明細上にローディングを出す。
async function onRefetchShimebiDetail() {
  const date = shimebiDate.value
  if (!date || shimebiRefetching.value) return
  shimebiRefetching.value = true
  shimebiMsg.value = ''
  try {
    const r = await fetchAndComputeShimebi(date)
    // 明細 (shimebiDetailCode) は維持。shimebiResults 更新で明細は自動再描画される。
    if (!r.ok) shimebiMsg.value = r.errorMsg
  } catch (err: unknown) {
    shimebiMsg.value = err instanceof Error ? err.message : '再取得に失敗しました'
  } finally {
    shimebiRefetching.value = false
  }
}

// 明細の行単位「再取得」: 範囲取得し直し、その row_id の行だけ最新値に差し替える。
// 他行・モーダルは触らず、対象行にだけスピナーを出す。
async function onRefetchRow(rowId: string) {
  const date = shimebiDate.value
  if (!rowId || !date || refetchingRowIds.value.has(rowId)) return
  refetchingRowIds.value = new Set(refetchingRowIds.value).add(rowId)
  shimebiMsg.value = ''
  try {
    const r = await fetchComputedOnDate(date)
    if (!r.ok) {
      shimebiMsg.value = r.errorMsg
      return
    }
    const fresh = r.results.filter((x) => x.row.rowId === rowId)
    shimebiResults.value = replaceResultsByRowId(shimebiResults.value, rowId, fresh)
    recomputeShimebiRows()
  } catch (err: unknown) {
    shimebiMsg.value = err instanceof Error ? err.message : '行の再取得に失敗しました'
  } finally {
    const s = new Set(refetchingRowIds.value)
    s.delete(rowId)
    refetchingRowIds.value = s
  }
}
/** 当月軽油価格 (円/L) を行の売上月から引く。無ければ null */
function dieselPriceForRow(uriageDate: string): number | null {
  return shimebiDieselMap.value[uriageDate.slice(0, 7)] ?? null
}

// debug: m.tama.ramu だけに「一番星 生データ取得」ボタンを出す (請求明細の重複調査用)。
const currentEmail = ref<string | null>(null)
const isDebugUser = computed(() => currentEmail.value === 'm.tama.ramu@gmail.com')
onMounted(async () => {
  try {
    const me = await $fetch<{ email?: string | null }>('/api/whoami')
    currentEmail.value = me.email ?? null
  } catch {
    currentEmail.value = null
  }
})

// 一番星 (rust-ichibanboshi) の surcharge/base 生データを締め日範囲で取得し、
// 完全一致重複の検出付きで console + JSON download に吐く。計算・集計はしない。
async function onDebugIchiban() {
  const date = shimebiDate.value
  if (!date) {
    shimebiState.value = 'error'
    shimebiMsg.value = '締め日 (請求日) を入力してください'
    return
  }
  const ym = date.slice(0, 7)
  const from = shiftMonth(ym, -2)
  const to = shiftMonth(ym, 1)
  const fetchKind = (kind: string) =>
    $fetch<{ rows: IchibanSurchargeRow[]; reason?: string; upstreamStatus?: number }>(
      '/api/surcharge-base',
      { query: { from, to, kind, limit: 10000 } },
    )
  const [billing, transport, all] = await Promise.all([
    fetchKind('billing_only'),
    fetchKind('transport'),
    fetchKind('all'),
  ])
  const dupGroups = (rows: IchibanSurchargeRow[]) => {
    const seen = new Map<string, number>()
    for (const r of rows) {
      const k = JSON.stringify(r)
      seen.set(k, (seen.get(k) ?? 0) + 1)
    }
    return [...seen.entries()]
      .filter(([, n]) => n > 1)
      .map(([k, n]) => ({ count: n, row: JSON.parse(k) as IchibanSurchargeRow }))
  }
  const dump = {
    query: { from, to, date },
    counts: {
      billing_only: billing.rows.length,
      transport: transport.rows.length,
      all: all.rows.length,
    },
    exactDuplicateGroups: {
      billing_only: dupGroups(billing.rows),
      transport: dupGroups(transport.rows),
      all: dupGroups(all.rows),
    },
    rows: { billing_only: billing.rows, transport: transport.rows, all: all.rows },
  }
  console.log('[ichiban debug]', dump)
  // 運転日報明細 のカラム一覧 (明細に追加する「車番」等の正確な DB カラム名 特定用)。
  try {
    const cols = await $fetch<{ columns?: { column_name: string; data_type: string }[] }>(
      '/api/ichiban-columns',
    )
    console.log(
      '[ichiban debug] 運転日報明細 columns:',
      (cols.columns ?? []).map((c) => `${c.column_name}(${c.data_type})`).join(', '),
    )
  } catch (e) {
    console.warn('[ichiban debug] columns 取得失敗', e)
  }
  shimebiMsg.value = `一番星 生データ取得: billing=${dump.counts.billing_only} / transport=${dump.counts.transport} / all=${dump.counts.all} 件 (重複 all=${dump.exactDuplicateGroups.all.length} 群)。JSON を download し console にも出力しました`
  const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `ichibanboshi-raw-${date}.json`
  a.click()
  URL.revokeObjectURL(a.href)
}

// 一番星から締め日分を取得 → マスタ流し込み → 計算し、締め日一致の per-row 結果を返す。
// shimebiResults / skip / 集計には触れない (呼び出し側が全体適用 or 行単位差し替えを選ぶ)。
// producer 連携の失敗は errorMsg を返し、それ以外の例外は throw する。
async function fetchComputedOnDate(
  date: string,
): Promise<{ ok: true; results: SurchargeResult[] } | { ok: false; errorMsg: string }> {
  // 一番星 from/to は売上月フィルタ。請求日(入金予定)はその後の月になり得るので、
  // 売上月を広めに取得し、client 側で「請求日 === 締め日」に絞る。
  // 対象は 請求K 0 と 1 → billing_only(=1) と transport(=0) を取得してマージ
  // (kind=all は請求K=2 等も含み limit 切れの恐れがあるため使わない)。
  const ym = date.slice(0, 7)
  const from = shiftMonth(ym, -2)
  const to = shiftMonth(ym, 1)
  const [billing, transport] = await Promise.all([
    $fetch<{ rows: IchibanSurchargeRow[]; reason?: string; upstreamStatus?: number }>(
      '/api/surcharge-base',
      { query: { from, to, kind: 'billing_only', limit: 10000 } },
    ),
    $fetch<{ rows: IchibanSurchargeRow[]; reason?: string; upstreamStatus?: number }>(
      '/api/surcharge-base',
      { query: { from, to, kind: 'transport', limit: 10000 } },
    ),
  ])
  const failed = billing.reason ? billing : transport.reason ? transport : null
  if (failed) {
    return {
      ok: false,
      errorMsg:
        failed.reason === 'upstream'
          ? `一番星が ${failed.upstreamStatus} を返しました`
          : failed.reason === 'connect_failed'
            ? '一番星への接続に失敗しました'
            : '一番星連携が未設定です',
    }
  }
  // 一括調整明細 (※請求一括調整明細※ 等) は運送実体が無い調整行なので明細・集計から除外。
  // 燃料油価格変動調整金 / 燃料調整金 (実サーチャージ請求) は除外しない (isAdjustmentRow 参照)。
  const allRows = [...billing.rows, ...transport.rows].filter((r) => !isAdjustmentRow(r))
  const [distCsv, fuelCsv, dieselCsv, settings] = await Promise.all([
    $fetch<string>('/api/distance', { responseType: 'text' }),
    $fetch<string>('/api/fuel-efficiency', { responseType: 'text' }),
    $fetch<string>('/api/diesel-price', { responseType: 'text' }),
    $fetch<{ basePrice: number; priceStep: number }>('/api/surcharge-settings'),
  ])
  await loadSurchargeCustomers()
  const dieselMap = toMonthlyPriceMap(parseDieselPriceCsv(dieselCsv).entries)
  shimebiDieselMap.value = dieselMap
  const masters: SurchargeMasters = {
    basePrice: settings.basePrice,
    priceStep: settings.priceStep,
    monthlyDieselPrice: dieselMap,
    fuelEfficiency: toEfficiencyLookup(parseFuelEfficiencyCsv(fuelCsv).entries),
    distanceKm: parseDistanceCsv(distCsv).master.distanceKm,
  }
  const summary = computeSurcharge(mapToMeisaiRows(allRows), masters)
  // 締め日 (請求日) が一致する行のみ
  const onDate = summary.results.filter((r) => (r.row.seikyuDate || '').slice(0, 10) === date)
  return { ok: true, results: onDate }
}

// 全体適用: 取得結果で shimebiResults を総入替し、skip を読み込んで再集計する。
async function fetchAndComputeShimebi(
  date: string,
): Promise<{ ok: true } | { ok: false; errorMsg: string }> {
  const r = await fetchComputedOnDate(date)
  if (!r.ok) return r
  shimebiResults.value = r.results
  // skip (計算しない) 登録を読み込み、集計から除外する
  try {
    const sk = await $fetch<{ rowIds: string[] }>('/api/surcharge-skips')
    skippedRowIds.value = new Set(sk.rowIds)
  } catch {
    skippedRowIds.value = new Set()
  }
  recomputeShimebiRows()
  return { ok: true }
}

async function onRunShimebi() {
  const date = shimebiDate.value
  if (!date) {
    shimebiState.value = 'error'
    shimebiMsg.value = '締め日 (請求日) を入力してください'
    return
  }
  shimebiState.value = 'loading'
  shimebiMsg.value = ''
  shimebiRows.value = []
  shimebiDetailCode.value = null
  selectedInputStaff.value = '' // 新規検索は「登録済みのみ」(指定なし) から始める
  try {
    const r = await fetchAndComputeShimebi(date)
    if (!r.ok) {
      shimebiState.value = 'error'
      shimebiMsg.value = r.errorMsg
      return
    }
    shimebiState.value = 'done'
    if (shimebiRows.value.length === 0) {
      shimebiMsg.value = selectedInputStaff.value
        ? `入力者 ${selectedInputStaff.value} の請求がこの締め日にありません`
        : 'この締め日 (請求日) に「登録済み (サーチャージ対象)」の取引先がありません'
    }
  } catch (err: unknown) {
    shimebiState.value = 'error'
    shimebiMsg.value = err instanceof Error ? err.message : '集計に失敗しました'
  }
}
async function onToggleShimebiRegister(row: ShimebiCustomerRow) {
  try {
    if (row.registered) {
      await $fetch('/api/surcharge-customers', {
        method: 'DELETE',
        query: { code: row.customerCode },
      })
      registeredCodes.value.delete(row.customerCode)
      row.registered = false
    } else {
      await $fetch('/api/surcharge-customers', {
        method: 'POST',
        body: { customerCode: row.customerCode, customerName: row.customerName },
      })
      registeredCodes.value.add(row.customerCode)
      row.registered = true
    }
  } catch (err: unknown) {
    shimebiMsg.value = err instanceof Error ? err.message : '登録更新に失敗しました'
  }
}

// 明細行の「計算しない (skip)」を切替え、行 ID (管理年月日+管理C) で永続化する。
async function onToggleSkip(rowId: string) {
  if (!rowId) return
  const wasSkipped = skippedRowIds.value.has(rowId)
  try {
    if (wasSkipped) {
      await $fetch('/api/surcharge-skips', { method: 'DELETE', query: { rowId } })
      skippedRowIds.value.delete(rowId)
    } else {
      const r = shimebiResults.value.find((x) => x.row.rowId === rowId)
      await $fetch('/api/surcharge-skips', {
        method: 'POST',
        body: {
          rowId,
          customerCode: r?.row.tokuiC,
          saleDate: r?.row.uriageDate,
          billingDate: r?.row.seikyuDate,
        },
      })
      skippedRowIds.value.add(rowId)
    }
    // Set の mutation は reactivity を起こさないので再代入してから再集計
    skippedRowIds.value = new Set(skippedRowIds.value)
    recomputeShimebiRows()
  } catch (err: unknown) {
    shimebiMsg.value = err instanceof Error ? err.message : 'skip 更新に失敗しました'
  }
}

// 締め日別 得意先別サーチャージを CSV ダウンロード (一番星 手動入力の元票)。Refs #6
// 文字コードは UTF-8 BOM (Excel/一番星取込を考慮)。サーチャージ 0 の取引先は出さない。
function onExportShimebiCsv() {
  if (!import.meta.client || shimebiRows.value.length === 0) return
  const csv = buildShimebiCsv(shimebiRows.value, shimebiDate.value)
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `surcharge_${shimebiDate.value || 'export'}.csv`
  a.click()
  URL.revokeObjectURL(url)
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
    if (sec === 'diesel' && dieselViewState.value === 'idle') void loadDieselView()
    if (sec === 'surchargeCustomers' && scState.value === 'idle') void loadSurchargeCustomers()
    if (sec === 'shimebi' && scState.value === 'idle') void loadSurchargeCustomers()
    // 届出書も燃費マスタ現在値を載せるため fuel を読む + サーチャージ設定を読む
    if (sec === 'notification') {
      if (fuelViewState.value === 'idle') void loadFuelView()
      if (settingsState.value === 'idle') void loadSurchargeSettingsView()
    }
    // 開いたタブを保存 (次回リロード時に復元する)
    if (import.meta.client) localStorage.setItem(ACTIVE_TAB_KEY, sec)
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
        <button
          class="nav-item"
          :class="{ active: active === 'shimebi' }"
          @click="active = 'shimebi'"
        >
          締め日別 取引先
        </button>
        <button
          class="nav-item"
          :class="{ active: isSettings }"
          @click="openSettings"
        >
          設定
        </button>
      </nav>
      <footer class="side-foot">
        <span>大石運輸倉庫株式会社テナント限定</span>
        <a v-if="authWorkerUrl" :href="authWorkerUrl">auth-worker 認証</a>
      </footer>
    </aside>

    <main class="content">
      <!-- 設定グループの 2 段目タブ (締め日別 取引先 以外を「設定」配下にまとめる) -->
      <div v-if="isSettings" class="subtabs">
        <button
          v-for="item in settingsNav"
          :key="item.key"
          class="subtab"
          :class="{ active: active === item.key }"
          @click="active = item.key"
        >
          {{ item.label }}
        </button>
      </div>

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
        <p class="lead-note">
          車種名・燃費・有効終了は直接編集して「保存」で更新できます（車種C・有効開始は
          キーのため変更不可。変えたい場合は削除して新規登録）。
        </p>
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
            <tr v-for="(e, i) in fuelEntries" :key="`${e.sharuC}\t${e.validFrom}`">
              <td>{{ e.sharuC }}</td>
              <td><input v-model="e.name" class="cell-edit" /></td>
              <td>
                <input
                  v-model.number="e.kmPerL"
                  type="number"
                  step="0.1"
                  min="0"
                  class="cell-edit num"
                />
              </td>
              <td>{{ e.validFrom }}</td>
              <td><input v-model="e.validTo" type="date" class="cell-edit" /></td>
              <td class="row-ops">
                <button class="link-save" :disabled="rowState === 'saving'" @click="onSaveRow(e)">
                  保存
                </button>
                <button class="link-del" @click="onDeleteRow(e.sharuC, e.validFrom)">削除</button>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-if="rowState === 'error'" class="status err">{{ rowMsg }}</p>
        <p v-else-if="rowSavedMsg" class="status ok">{{ rowSavedMsg }}</p>
      </section>

      <!-- 軽油価格マスタ -->
      <section v-else-if="active === 'diesel'" class="card">
        <h2>軽油価格マスタ (当月全国平均)</h2>
        <p>
          月別の全国平均軽油価格 (円/L) を管理します。列は <code>年月,軽油価格</code>。
          計算エンジンの「当月価格」に使います。経産省 (資源エネルギー庁) 公表の最新
          週次データから自動取込できます。手入力 / CSV でも登録できます。
        </p>
        <div class="actions">
          <a class="btn" href="/api/diesel-price" download="diesel-price.csv">CSV ダウンロード</a>
          <label class="btn file">
            CSV アップロード
            <input type="file" accept=".csv,text/csv" @change="onDieselUpload" />
          </label>
          <button class="btn" :disabled="dieselViewState === 'loading'" @click="loadDieselView">
            表示を更新
          </button>
        </div>
        <p v-if="dieselUploadState === 'uploading'" class="status">取込中…</p>
        <p v-else-if="dieselUploadState === 'done'" class="status ok">{{ dieselUploadMsg }}</p>
        <p v-else-if="dieselUploadState === 'error'" class="status err">{{ dieselUploadMsg }}</p>
        <ul v-if="dieselUploadWarnings.length" class="warnings">
          <li v-for="(w, i) in dieselUploadWarnings.slice(0, 20)" :key="i">{{ w }}</li>
          <li v-if="dieselUploadWarnings.length > 20">…他 {{ dieselUploadWarnings.length - 20 }} 件</li>
        </ul>

        <details class="advanced">
          <summary>詳細 / 開発者向け (probe・手動取込・cron 手動実行)</summary>
          <p class="lead-note adv-note">
            通常は週次 cron が自動で取込・通知します。以下は到達確認や手動取込など保守用です。
          </p>

        <h3 class="view-title">経産省から自動取得 (probe)</h3>
        <p class="lead-note">
          資源エネルギー庁の公表ページ/ファイルへ Worker から到達できるか確認します
          (Phase 1)。到達できれば次段で月次平均を parse して自動 upsert します。URL 空欄なら
          石油製品価格調査の結果ページを対象にします。
        </p>
        <div class="actions">
          <input
            v-model="probeUrl"
            class="cell-edit"
            style="min-width: 22rem"
            placeholder="https://www.enecho.meti.go.jp/.../results.html (空欄で既定)"
          />
          <button class="btn" :disabled="probeState === 'running'" @click="onDieselProbe">
            到達確認
          </button>
        </div>
        <p v-if="probeState === 'running'" class="status">取得中…</p>
        <p v-else-if="probeState === 'error'" class="status err">{{ probeErr }}</p>
        <div v-else-if="probeState === 'done' && probeResult" class="probe-result">
          <p class="status" :class="probeResult.ok ? 'ok' : 'err'">
            {{ probeResult.ok ? '到達 OK' : '到達 NG' }} —
            status {{ probeResult.status ?? probeResult.reason }} /
            {{ probeResult.contentType }} / {{ probeResult.bytes }} bytes
          </p>
          <p v-if="probeResult.message" class="status err">{{ probeResult.message }}</p>
          <template v-if="probeResult.links && probeResult.links.length">
            <p class="lead-note">見つかったデータファイル候補 (.xlsx/.xls/.csv):</p>
            <ul class="warnings">
              <li v-for="(l, i) in probeResult.links" :key="i">{{ l }}</li>
            </ul>
          </template>
          <template v-if="probeResult.schedule && probeResult.schedule.length">
            <p class="lead-note">公表予定日 (毎週月曜調査・水曜公表):</p>
            <ul class="warnings">
              <li v-for="(s, i) in probeResult.schedule" :key="i">
                {{ s.date }}（{{ s.weekday }}）{{ s.time }}
              </li>
            </ul>
          </template>
        </div>

        <h3 class="view-title">経産省から取込 (自動)</h3>
        <p class="lead-note">
          石油製品価格調査の結果ページから最新の週次ファイル (給油所小売価格) を解決し、
          軽油シートの全国平均を月次平均に集約して直近 24 ヶ月を upsert します。手入力した月は
          上書きされません。<br />
          自動取込は <strong>毎週水曜 14:05/14:15/14:25 (公表直後) に cron</strong> が実行し、
          新ファイルが出た 1 回だけ取込 + LINE WORKS 通知します (取得後は当日 skip)。
          下のボタンで手動でも実行できます。
        </p>
        <div class="actions">
          <button class="btn" :disabled="importState === 'running'" @click="onDieselImport">
            経産省から取込 (強制)
          </button>
          <button class="btn" :disabled="cronState === 'running'" @click="onDieselCron">
            cron 手動実行 (重複判定+通知)
          </button>
        </div>
        <p v-if="importState === 'running'" class="status">取込中… (公表ページ → xlsx 解析)</p>
        <p v-else-if="importState === 'done'" class="status ok">{{ importMsg }}</p>
        <p v-else-if="importState === 'error'" class="status err">{{ importMsg }}</p>
        <p v-if="cronState === 'running'" class="status">cron 実行中… (重複判定 → 取込 → 通知)</p>
        <p v-else-if="cronState === 'done'" class="status ok">{{ cronMsg }}</p>
        <p v-else-if="cronState === 'error'" class="status err">{{ cronMsg }}</p>
        </details>

        <h3 class="view-title">新規登録</h3>
        <form class="row-form" @submit.prevent="onAddDiesel">
          <label>
            年月
            <input v-model="dieselFormMonth" type="month" required />
          </label>
          <label>
            軽油価格 (円/L)
            <input v-model.number="dieselFormPrice" type="number" step="0.1" min="0" required />
          </label>
          <button class="btn" type="submit" :disabled="dieselRowState === 'saving'">追加</button>
        </form>
        <p v-if="dieselRowState === 'error'" class="status err">{{ dieselRowMsg }}</p>

        <h3 class="view-title">現在の登録内容</h3>
        <p class="lead-note">
          軽油価格は直接編集して「保存」で更新できます (年月はキーのため変更不可)。<br />
          各月の <strong>▶</strong> で週次内訳 (検算) を展開し、月平均が登録値と一致するか確認できます
          (週次は「経産省から取込」/ cron 実行時に保存。未取込月は ▶ が出ません)。
        </p>
        <p v-if="dieselViewState === 'loading'" class="status">読込中…</p>
        <p v-else-if="dieselViewState === 'error'" class="status err">{{ dieselViewMsg }}</p>
        <p v-else-if="dieselViewMsg" class="status">{{ dieselViewMsg }}</p>
        <table v-if="dieselViewState === 'done' && dieselEntries.length" class="grid">
          <thead>
            <tr><th></th><th>年月</th><th>軽油価格 (円/L)</th><th></th></tr>
          </thead>
          <tbody>
            <template v-for="e in dieselEntries" :key="e.month">
              <tr>
                <td class="expand-col">
                  <button
                    v-if="dieselWeeklyMap.get(e.month)"
                    class="link-expand"
                    :title="openDieselMonths[e.month] ? '週次内訳を閉じる' : '週次内訳 (検算) を開く'"
                    @click="toggleDieselMonth(e.month)"
                  >
                    {{ openDieselMonths[e.month] ? '▼' : '▶' }}
                  </button>
                </td>
                <td>{{ e.month }}</td>
                <td>
                  <input v-model.number="e.price" type="number" step="0.1" min="0" class="cell-edit num" />
                </td>
                <td class="row-ops">
                  <button class="link-save" :disabled="dieselRowState === 'saving'" @click="onSaveDiesel(e)">保存</button>
                  <button class="link-del" @click="onDeleteDiesel(e.month)">削除</button>
                </td>
              </tr>
              <tr v-if="openDieselMonths[e.month] && dieselWeeklyMap.get(e.month)" class="weekly-detail-row">
                <td></td>
                <td colspan="3">
                  <table class="weekly-inline">
                    <thead>
                      <tr><th>調査日</th><th>軽油価格 (円/L)</th><th>月平均 (円/L)</th></tr>
                    </thead>
                    <tbody>
                      <tr v-for="(w, i) in dieselWeeklyMap.get(e.month)!.weeks" :key="w.date">
                        <td>{{ w.date }}</td>
                        <td class="num">{{ w.price }}</td>
                        <td
                          v-if="i === 0"
                          :rowspan="dieselWeeklyMap.get(e.month)!.weeks.length"
                          class="num weekly-avg-col"
                        >
                          {{ dieselWeeklyMap.get(e.month)!.avg }}
                          <span class="avg-raw"
                            >(実際 {{ dieselWeeklyMap.get(e.month)!.avgRaw }} → 四捨五入)</span
                          >
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </td>
              </tr>
            </template>
          </tbody>
        </table>

        <p
          v-if="dieselViewState === 'done' && dieselEntries.length && dieselWeeklyByMonth.length === 0"
          class="lead-note"
        >
          週次内訳なし — 「詳細 / 開発者向け」→「経産省から取込」で直近 24 ヶ月の週次が保存され、▶ で展開できます。
        </p>
      </section>

      <!-- サーチャージマスタ (サーチャージ対象として登録する取引先) -->
      <section v-else-if="active === 'surchargeCustomers'" class="card">
        <h2>サーチャージマスタ (対象取引先)</h2>
        <p class="lead-note">
          燃料サーチャージの対象として登録する取引先を管理します。締め日別の確認画面でも
          その場で追加/削除できます。取引先コードで一意。
        </p>

        <h3 class="view-title">新規登録</h3>
        <form class="row-form" @submit.prevent="onAddSurchargeCustomer">
          <label>
            取引先コード
            <input v-model="scFormCode" type="text" required />
          </label>
          <label>
            取引先名 (任意)
            <input v-model="scFormName" type="text" />
          </label>
          <button class="btn" type="submit" :disabled="scState === 'loading'">追加</button>
        </form>

        <h3 class="view-title">登録済みの取引先</h3>
        <p v-if="scState === 'loading'" class="status">読込中…</p>
        <p v-else-if="scState === 'error'" class="status err">{{ scMsg }}</p>
        <p v-else-if="scMsg" class="status">{{ scMsg }}</p>
        <table v-if="surchargeCustomers.length" class="grid">
          <thead>
            <tr><th>取引先コード</th><th>取引先名</th><th></th></tr>
          </thead>
          <tbody>
            <tr v-for="c in surchargeCustomers" :key="c.customerCode">
              <td>{{ c.customerCode }}</td>
              <td>{{ c.customerName }}</td>
              <td class="row-ops">
                <button class="link-del" @click="onDeleteSurchargeCustomer(c.customerCode)">削除</button>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <!-- 届出書 (届出用紙)。印刷 → PDF 保存 -->
      <section v-else-if="active === 'notification'" class="card">
        <div class="doc-actions no-print">
          <h2>燃料サーチャージ 届出用紙</h2>
          <button class="btn" @click="onPrintNotification">印刷 / PDF 保存</button>
        </div>
        <p class="no-print lead-note">
          下記をブラウザの印刷ダイアログで「PDF に保存」すると届出用紙 PDF になります。
          車種別燃費は「燃費マスタ」の現在値を反映します。
        </p>

        <!-- 基準価格 / 刻み幅 の設定 (届出書・段階表・計算に即反映)。印刷には出さない -->
        <form class="row-form no-print" @submit.prevent="onSaveSurchargeSettings">
          <label>
            基準価格 (円/L)
            <input v-model.number="notifBasePrice" type="number" step="0.1" min="0" required />
          </label>
          <label>
            改定する刻み幅 (円/L)
            <input v-model.number="notifPriceStep" type="number" step="0.1" min="0.1" required />
          </label>
          <button class="btn" type="submit" :disabled="settingsState === 'saving'">設定を保存</button>
        </form>
        <p v-if="settingsState === 'saving'" class="status no-print">保存中…</p>
        <p v-else-if="settingsState === 'done'" class="status ok no-print">{{ settingsMsg }}</p>
        <p v-else-if="settingsState === 'error'" class="status err no-print">{{ settingsMsg }}</p>

        <div class="notification-doc">
          <h1 class="doc-title">燃料サーチャージ 届出書</h1>

          <h3>1. 前提条件</h3>
          <table class="doc-table">
            <tbody>
              <tr><th>基準価格</th><td>{{ notifBasePrice }} 円/L（石油情報センター 週間統計データ）</td></tr>
              <tr><th>改定する刻み幅</th><td>{{ notifPriceStep }} 円/L</td></tr>
              <tr><th>改定条件</th><td>刻み幅 {{ notifPriceStep.toFixed(2) }} 円/L の幅で軽油価格が変動した時点で、翌月から改定</td></tr>
              <tr><th>廃止条件</th><td>軽油価格が {{ notifBasePrice.toFixed(2) }} 円/L を下回った時点で、翌月から廃止</td></tr>
              <tr><th>端数処理</th><td>円単位に切り上げ</td></tr>
            </tbody>
          </table>

          <h3>2. 計算式</h3>
          <ul class="doc-formula">
            <li>距離制運賃: 走行距離(km) ÷ 燃費(km/L) × 算出上の燃料価格上昇額(円/L)</li>
            <li>時間制運賃: 平均走行距離(km) ÷ 燃費(km/L) × 算出上の燃料価格上昇額(円/L)</li>
          </ul>

          <h3>3. 算出上の燃料価格上昇額（段階方式）</h3>
          <table class="doc-table">
            <thead>
              <tr><th>適用時の軽油価格 (円/L)</th><th>代表価格</th><th>上昇額 (円/L)</th></tr>
            </thead>
            <tbody>
              <tr>
                <td>～ {{ notifBasePrice }}（基準価格以下）</td>
                <td>廃止</td>
                <td>－</td>
              </tr>
              <tr v-for="b in incrementTable" :key="b.upperInclusive">
                <td>{{ b.lowerExclusive }} 超 ～ {{ b.upperInclusive }}</td>
                <td>{{ b.representative }}</td>
                <td class="num">{{ b.increment }}</td>
              </tr>
            </tbody>
          </table>

          <h3>4. 車種別燃費（km/L）</h3>
          <table v-if="fuelEntries.length" class="doc-table">
            <thead>
              <tr><th>車種C</th><th>車種名</th><th>燃費 (km/L)</th><th>有効開始</th><th>有効終了</th></tr>
            </thead>
            <tbody>
              <tr v-for="(e, i) in fuelEntries" :key="i">
                <td>{{ e.sharuC }}</td>
                <td>{{ e.name }}</td>
                <td class="num">{{ e.kmPerL }}</td>
                <td>{{ e.validFrom }}</td>
                <td>{{ e.validTo ?? '（無期限）' }}</td>
              </tr>
            </tbody>
          </table>
          <p v-else class="doc-empty">
            燃費マスタ未登録です。「燃費マスタ」で車種別燃費を登録すると本欄に反映されます。
          </p>

          <h3>5. 時間制運賃の 1 日当たり平均走行距離（km）</h3>
          <table class="doc-table">
            <thead>
              <tr><th>車種</th><th>8 時間制</th><th>4 時間制</th></tr>
            </thead>
            <tbody>
              <tr v-for="d in timeBasedDistances" :key="d.category">
                <td>{{ d.category }}</td>
                <td class="num">{{ d.h8 }}</td>
                <td class="num">{{ d.h4 }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- 締め日別 取引先 (締め日 = 請求日)。金額/サーチャージ/登録有無/差額 + その場で登録 -->
      <section v-else-if="active === 'shimebi'" class="card">
        <h2>締め日別 取引先</h2>
        <p class="lead-note">
          締め日 (請求日 / 入金予定日) を指定すると、その締め日に請求のある取引先を取引先コード順に
          一覧します。各取引先の運賃合計・計算サーチャージ・マスタ登録有無・差額を表示し、その場で
          サーチャージ対象の登録/解除ができます。<strong>取引先名をクリック</strong>すると明細と計算根拠を表示します。<br />
          対象は <strong>請求K 0 (通常運送) と 1 (請求のみ)</strong>。<strong>実額</strong>は一番星の割増
          (割増C=19 燃料ｻｰﾁｬｰｼﾞ) で、差額 = 計算サーチャージ − 実額 (正 = 未計上で今後請求すべき額 /
          負 = 過計上 / 0 = 一致)。取引先名クリックで各明細行の計算 vs 実額を照合できます。
        </p>
        <div class="actions">
          <label class="inline-label">
            締め日 (請求日)
            <input v-model="shimebiDate" type="date" required />
          </label>
          <button class="btn" :disabled="shimebiState === 'loading'" @click="onRunShimebi">
            表示
          </button>
          <label class="inline-label">
            入力者
            <select v-model="selectedInputStaff" :disabled="shimebiState !== 'done'">
              <option value="">指定なし (登録済みのみ)</option>
              <option v-for="code in inputStaffOptions" :key="code" :value="code">
                {{ code }}
              </option>
            </select>
          </label>
          <label class="inline-label">
            明細の表示
            <select v-model="shimebiDetailMode">
              <option value="below">下に表示</option>
              <option value="right">右に表示</option>
              <option value="modal">モーダル (全画面)</option>
              <option value="newtab">別タブ</option>
            </select>
          </label>
          <button
            v-if="isDebugUser"
            class="btn btn-debug"
            :disabled="shimebiState === 'loading'"
            title="一番星 (rust-ichibanboshi) の surcharge/base 生データを取得し重複検出 + JSON download (debug)"
            @click="onDebugIchiban"
          >
            🐞 一番星 生データ取得 (debug)
          </button>
        </div>
        <p v-if="shimebiState === 'loading'" class="status">集計中…</p>
        <p v-else-if="shimebiState === 'error'" class="status err">{{ shimebiMsg }}</p>
        <template v-if="shimebiState === 'done'">
          <p v-if="shimebiMsg" class="status">{{ shimebiMsg }}</p>
          <div v-if="shimebiRows.length" class="actions">
            <button class="btn" @click="onExportShimebiCsv">CSV 出力 (一番星 手動入力用)</button>
            <span class="lead-note">サーチャージ &gt; 0 の取引先のみ・品名「{{ '燃料サーチャージ' }}」(暫定)・UTF-8 BOM</span>
          </div>
          <div :class="['shimebi-layout', shimebiDetailMode === 'right' && shimebiDetailCode ? 'is-right' : '']">
            <div class="shimebi-list">
          <table v-if="shimebiRows.length" class="grid">
            <thead>
              <tr>
                <th>取引先コード</th>
                <th>取引先名</th>
                <th>金額 (運賃)</th>
                <th>計算サーチャージ</th>
                <th>実額 (割増C=19)</th>
                <th>登録</th>
                <th>差額</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in shimebiRows" :key="r.customerCode">
                <td>{{ r.customerCode }}</td>
                <td>
                  <button class="link-name" @click="onShowShimebiDetail(r.customerCode)">
                    {{ r.customerName }}
                  </button>
                </td>
                <td class="num">{{ r.fareTotal.toLocaleString() }}</td>
                <td class="num">{{ r.surchargeTotal.toLocaleString() }}</td>
                <td class="num">{{ r.actualTotal.toLocaleString() }}</td>
                <td>
                  <span :class="r.registered ? 'badge-on' : 'badge-off'">
                    {{ r.registered ? '登録済' : '未登録' }}
                  </span>
                  <span v-if="r.warningCount" class="warn-note">（未計上 {{ r.warningCount }}）</span>
                </td>
                <td class="num" :class="r.diff === 0 ? '' : 'diff-nz'">{{ r.diff.toLocaleString() }}</td>
                <td class="row-ops">
                  <button
                    :class="r.registered ? 'link-del' : 'link-save'"
                    @click="onToggleShimebiRegister(r)"
                  >
                    {{ r.registered ? '解除' : '登録' }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>

            </div>
            <!-- 下 / 右: ページ内インライン明細 -->
            <div
              v-if="shimebiDetailCode && (shimebiDetailMode === 'below' || shimebiDetailMode === 'right')"
              class="detail-panel"
            >
              <button class="link-del detail-close" @click="shimebiDetailCode = null">閉じる ✕</button>
              <ShimebiDetail
                :code="shimebiDetailCode"
                :name="shimebiDetailName"
                :date="shimebiDate"
                :rows="shimebiDetailRows"
                :diesel-map="shimebiDieselMap"
                :skipped-row-ids="skippedRowIds"
                :debug-enabled="isDebugUser"
                :can-refetch="true"
                :refetching="shimebiRefetching"
                :refetching-row-ids="refetchingRowIds"
                @debug="onDebugIchiban"
                @toggle-skip="onToggleSkip"
                @refetch="onRefetchShimebiDetail"
                @refetch-row="onRefetchRow"
              />
            </div>
          </div>

          <!-- モーダル (全画面) -->
          <div
            v-if="shimebiDetailCode && shimebiDetailMode === 'modal'"
            class="modal-overlay"
            @click.self="shimebiDetailCode = null"
          >
            <div class="modal-box">
              <button class="btn modal-close" @click="shimebiDetailCode = null">✕ 閉じる</button>
              <ShimebiDetail
                :code="shimebiDetailCode"
                :name="shimebiDetailName"
                :date="shimebiDate"
                :rows="shimebiDetailRows"
                :diesel-map="shimebiDieselMap"
                :skipped-row-ids="skippedRowIds"
                :debug-enabled="isDebugUser"
                :can-refetch="true"
                :refetching="shimebiRefetching"
                :refetching-row-ids="refetchingRowIds"
                @debug="onDebugIchiban"
                @toggle-skip="onToggleSkip"
                @refetch="onRefetchShimebiDetail"
                @refetch-row="onRefetchRow"
              />
            </div>
          </div>
        </template>
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
.subtabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  margin-bottom: 1.5rem;
  border-bottom: 1px solid #d1d5db;
}
.subtab {
  padding: 0.45rem 0.9rem;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: #4b5563;
  font-size: 0.85rem;
  cursor: pointer;
}
.subtab:hover {
  color: #111827;
}
.subtab.active {
  color: #2563eb;
  border-bottom-color: #2563eb;
  font-weight: 600;
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
.inline-label {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.8rem;
  color: #374151;
}
.inline-label input,
.inline-label select {
  padding: 0.3rem 0.5rem;
  border: 1px solid #d1d5db;
  border-radius: 0.375rem;
  font-size: 0.85rem;
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
.link-save {
  border: 0;
  background: transparent;
  color: #2563eb;
  cursor: pointer;
  font-size: 0.8rem;
  text-decoration: underline;
}
.row-ops {
  display: flex;
  gap: 0.6rem;
  white-space: nowrap;
}
.cell-edit {
  width: 100%;
  min-width: 5rem;
  padding: 0.2rem 0.35rem;
  border: 1px solid #d1d5db;
  border-radius: 0.25rem;
  font-size: 0.82rem;
  box-sizing: border-box;
}
.cell-edit.num {
  text-align: right;
  min-width: 4rem;
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

/* --- 届出書 (届出用紙) --- */
.doc-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}
.lead-note {
  font-size: 0.85rem;
  color: #6b7280;
  margin: 0.25rem 0 1rem;
}
/* 保守用 (probe / 手動取込 / cron 手動実行) は既定で折り畳む */
.advanced {
  margin-top: 1rem;
  border-top: 1px dashed #e5e7eb;
  padding-top: 0.75rem;
}
.advanced > summary {
  cursor: pointer;
  font-size: 0.85rem;
  color: #6b7280;
  user-select: none;
}
.advanced > summary:hover {
  color: #374151;
}
.adv-note {
  margin-top: 0.75rem;
}
/* サーチャージマスタ登録バッジ (締め日別画面) */
.badge-on {
  display: inline-block;
  padding: 0.05rem 0.45rem;
  border-radius: 0.25rem;
  font-size: 0.78rem;
  background: #dcfce7;
  color: #166534;
}
.badge-off {
  display: inline-block;
  padding: 0.05rem 0.45rem;
  border-radius: 0.25rem;
  font-size: 0.78rem;
  background: #f3f4f6;
  color: #6b7280;
}
.warn-note {
  margin-left: 0.4rem;
  font-size: 0.75rem;
  color: #b45309;
}
.diff-nz {
  color: #b45309;
  font-weight: 600;
}
/* 締め日別: 取引先名クリックで明細展開 */
.link-name {
  background: none;
  border: none;
  padding: 0;
  color: #2563eb;
  cursor: pointer;
  text-decoration: underline;
  font-size: inherit;
}
.detail-panel {
  margin-top: 1.25rem;
  padding-top: 0.75rem;
  border-top: 2px solid #e5e7eb;
}
.detail-close {
  margin-bottom: 0.5rem;
}
/* 右に表示: 一覧と明細を横並び */
.shimebi-layout.is-right {
  display: flex;
  gap: 1rem;
  align-items: flex-start;
}
.shimebi-layout.is-right .shimebi-list {
  flex: 0 0 auto;
}
.shimebi-layout.is-right .detail-panel {
  flex: 1 1 0;
  min-width: 0;
  margin-top: 0;
  padding-top: 0;
  border-top: none;
  overflow-x: auto;
}
/* モーダル (全画面オーバーレイ) */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 2rem 1rem;
  z-index: 50;
  overflow: auto;
}
.modal-box {
  background: #fff;
  border-radius: 0.5rem;
  padding: 1.5rem;
  width: 100%;
  max-width: 1200px;
  max-height: 90vh;
  overflow: auto;
}
.modal-close {
  margin-bottom: 0.75rem;
}
/* 週次内訳セル: 調査日:価格 を折り返しチップ表示 */
.weekly-avg-col {
  background: #eff6ff;
  font-weight: 600;
  vertical-align: middle;
  border-left: 1px solid #bfdbfe;
}
.avg-raw {
  display: block;
  font-weight: 400;
  font-size: 0.72rem;
  color: #6b7280;
}
.btn-debug {
  background: #6b7280;
}
.btn-debug:hover {
  background: #4b5563;
}
.month-first td {
  border-top: 2px solid #d1d5db;
}
.expand-col {
  width: 1.5rem;
  text-align: center;
}
.link-expand {
  border: 0;
  background: transparent;
  color: #2563eb;
  cursor: pointer;
  font-size: 0.8rem;
  padding: 0 0.25rem;
}
.weekly-detail-row > td {
  background: #f9fafb;
  padding: 0.25rem 0.5rem 0.75rem;
}
.weekly-inline {
  width: auto;
  border-collapse: collapse;
  margin: 0.25rem 0 0;
}
.weekly-inline th,
.weekly-inline td {
  border: 1px solid #e5e7eb;
  padding: 0.25rem 0.6rem;
  font-size: 0.85rem;
}
.weekly-inline thead th {
  background: #f3f4f6;
}
.weekly-cell {
  display: inline-block;
  margin: 0.1rem 0.4rem 0.1rem 0;
  padding: 0.05rem 0.4rem;
  background: #f3f4f6;
  border-radius: 0.25rem;
  font-size: 0.8rem;
  white-space: nowrap;
}
.notification-doc {
  border: 1px solid #e5e7eb;
  border-radius: 0.5rem;
  padding: 1.5rem 1.75rem;
  background: #fff;
}
.doc-title {
  font-size: 1.4rem;
  text-align: center;
  margin: 0 0 1.25rem;
}
.notification-doc h3 {
  font-size: 1rem;
  font-weight: 600;
  margin: 1.25rem 0 0.5rem;
  border-left: 4px solid #2563eb;
  padding-left: 0.5rem;
}
.doc-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}
.doc-table th,
.doc-table td {
  border: 1px solid #d1d5db;
  padding: 0.35rem 0.6rem;
  text-align: left;
}
.doc-table thead th {
  background: #f3f4f6;
  text-align: center;
}
.doc-table td.num {
  text-align: right;
}
.doc-formula {
  margin: 0.25rem 0 0;
  padding-left: 1.25rem;
  font-size: 0.85rem;
}
.doc-empty {
  font-size: 0.85rem;
  color: #b45309;
}

/* 印刷: 届出書だけを A4 に出す (サイドバー・ボタン・操作系は隠す) */
@media print {
  .sidebar,
  .no-print {
    display: none !important;
  }
  .shell,
  .content {
    display: block;
    padding: 0;
    background: #fff;
  }
  .card {
    border: 0;
    padding: 0;
    background: #fff;
    max-width: none;
  }
  .notification-doc {
    border: 0;
    padding: 0;
  }
  .doc-table th,
  .doc-table td {
    border: 1px solid #999;
  }
  @page {
    size: A4;
    margin: 14mm;
  }
}
</style>
