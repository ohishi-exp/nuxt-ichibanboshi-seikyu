<script setup lang="ts">
// 締め日別 取引先の「明細 + 計算根拠」表。締め日別画面 (下/右/モーダル) と
// 別タブページ (pages/shimebi-detail.vue) で共有する。Refs #11
import type { SurchargeResult } from '../../src/surcharge'
import { ownershipLabel, reconcileRow } from '../../src/surcharge-review'
import { detectKumiawaseKeys, kumiawaseKey } from '../../src/kumiawase'

const props = withDefaults(
  defineProps<{
    code: string
    name: string
    date: string
    rows: SurchargeResult[]
    /** "YYYY-MM" -> 当月軽油価格 (円/L) */
    dieselMap: Record<string, number>
    /** skip (計算しない) 登録済みの行 ID 集合 */
    skippedRowIds?: Set<string>
    /** m.tama.ramu のみ true。一番星 生データ取得 (debug) ボタンの出し分け */
    debugEnabled?: boolean
    /** 再取得ボタンを出すか (親が refetch を処理できる場合 true)。別タブ表示では false */
    canRefetch?: boolean
    /** 再取得中 (ボタン disable + ラベル切替) */
    refetching?: boolean
    /** 行単位 再取得中の row_id 集合 (その行にスピナー) */
    refetchingRowIds?: Set<string>
  }>(),
  { skippedRowIds: () => new Set<string>(), refetchingRowIds: () => new Set<string>() },
)
const emit = defineEmits<{
  debug: []
  toggleSkip: [rowId: string]
  refetch: []
  refetchRow: [rowId: string]
}>()

/** 行が単体再取得中か */
function isRowRefetching(rowId?: string): boolean {
  return !!rowId && props.refetchingRowIds.has(rowId)
}

function dieselPriceForRow(uriageDate: string): number | null {
  return props.dieselMap[uriageDate.slice(0, 7)] ?? null
}

/** 行が skip 登録済みか (row_id 欠落行は skip 不可) */
function isSkipped(rowId?: string): boolean {
  return !!rowId && props.skippedRowIds.has(rowId)
}

// 積み合わせ警告: 同一 (売上日+車番+積地) が 2 行以上ある行を薄い黄色で警告する。
const kumiawaseKeys = computed(() => detectKumiawaseKeys(props.rows.map((r) => r.row)))
function isKumiawase(d: SurchargeResult): boolean {
  const k = kumiawaseKey(d.row)
  return !!k && kumiawaseKeys.value.has(k)
}
</script>

<template>
  <div class="detail-wrap">
    <div v-if="refetching" class="refetch-overlay">
      <span class="spinner" aria-label="再取得中" />
      <span class="refetch-text">再取得中…</span>
    </div>
    <h3 class="view-title">
      明細・計算根拠 — {{ code }} {{ name }}（締め日 {{ date }}）
      <button
        v-if="canRefetch"
        type="button"
        class="btn-refetch-inline"
        :disabled="refetching"
        title="この締め日のデータを一番星から再取得して明細を更新する"
        @click="emit('refetch')"
      >
        {{ refetching ? '再取得中…' : '🔄 再取得' }}
      </button>
      <button
        v-if="debugEnabled"
        type="button"
        class="btn-debug-inline"
        title="一番星 (rust-ichibanboshi) の surcharge/base 生データを取得し重複検出 + JSON download (debug)"
        @click="emit('debug')"
      >
        🐞 一番星 生データ取得 (debug)
      </button>
    </h3>
    <p class="lead-note">
      計算サーチャージ = 切上(距離 km ÷ 燃費 km/L × 上昇額 円/L)。上昇額は当月軽油価格を段階表に当てた値
      (基準価格以下は 0)。未計上は距離/当月価格の欠落が理由です。
      <strong>実額</strong>は一番星の割増 (割増C=19 燃料ｻｰﾁｬｰｼﾞ) で、各行で計算と実額を照合します
      (差額 = 計算 − 実額、正=未計上 / 負=過計上 / 0=一致)。
      <strong>計算しない</strong>にチェックした行は集計から除外され、行 ID (管理年月日+管理C) で保存されます。
      <strong style="background: #fef9c3">薄い黄色</strong>の行は積み合わせ警告 (同じ売上日・車番・積地が
      複数 = 品目/卸地違いの積み合わせ)。行ごとに計算すると距離が重複計上され得るため要確認です。
    </p>
    <table class="grid">
      <thead>
        <tr>
          <th>売上日</th><th>区分</th><th>積地</th><th>卸地</th><th>車種</th><th>車番</th><th>品名</th><th>運賃</th>
          <th>当月軽油 (円/L)</th><th>上昇額 (円/L)</th><th>距離 (km)</th>
          <th>燃費 (km/L)</th><th>計算 (円)</th><th>実額 (円)</th><th>差額 (円)</th><th>照合</th><th>状態</th>
          <th v-if="canRefetch">再取得</th>
          <th>計算しない</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="(d, i) in rows"
          :key="i"
          :class="{
            'row-skipped': isSkipped(d.row.rowId),
            'row-kumiawase': isKumiawase(d) && !isSkipped(d.row.rowId),
          }"
          :title="isKumiawase(d) ? '積み合わせ警告: 同じ売上日・車番・積地の行が複数あります (品目/卸地違い)。距離の重複計上に注意' : undefined"
        >
          <td>{{ d.row.uriageDate }}</td>
          <td>{{ ownershipLabel(d.row.subcontractorCode) }}</td>
          <td>{{ d.row.fromPref }}</td>
          <td>{{ d.row.toPref }}</td>
          <td>{{ d.row.vehicleName || d.row.sharuC }}</td>
          <td>{{ d.row.vehicleNumber || '—' }}</td>
          <td>{{ d.row.itemName || '—' }}</td>
          <td class="num">{{ d.row.unchin.toLocaleString() }}</td>
          <td class="num">{{ dieselPriceForRow(d.row.uriageDate) ?? '—' }}</td>
          <td class="num">{{ d.increment ?? '—' }}</td>
          <td class="num">{{ d.km ?? '—' }}</td>
          <td class="num">{{ d.efficiency ?? '—' }}</td>
          <td class="num">{{ reconcileRow(d).computed.toLocaleString() }}</td>
          <td class="num">{{ reconcileRow(d).actual.toLocaleString() }}</td>
          <td class="num" :class="reconcileRow(d).diff === 0 ? '' : 'diff-nz'">
            {{ reconcileRow(d).diff.toLocaleString() }}
          </td>
          <td>
            <span v-if="reconcileRow(d).match" class="badge-on">一致</span>
            <span v-else class="badge-diff">差異</span>
          </td>
          <td>
            <span v-if="d.status === 'ok'" class="badge-on">計上</span>
            <span v-else-if="d.status === 'warning'" class="warn-note">{{ d.warning }}</span>
            <span v-else class="badge-off">対象外</span>
          </td>
          <td v-if="canRefetch" class="skip-col">
            <span v-if="isRowRefetching(d.row.rowId)" class="spinner spinner-sm" aria-label="再取得中" />
            <button
              v-else
              type="button"
              class="btn-row-refetch"
              :disabled="!d.row.rowId"
              :title="d.row.rowId ? 'この行だけ一番星から再取得して差し替える' : '行 ID 未取得のため再取得不可 (producer 要更新)'"
              @click="d.row.rowId && emit('refetchRow', d.row.rowId)"
            >
              🔄
            </button>
          </td>
          <td class="skip-col">
            <input
              type="checkbox"
              :checked="isSkipped(d.row.rowId)"
              :disabled="!d.row.rowId"
              :title="d.row.rowId ? '計算対象から外す (保存)' : '行 ID 未取得のため skip 不可 (producer 要更新)'"
              @change="d.row.rowId && emit('toggleSkip', d.row.rowId)"
            />
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.detail-wrap {
  position: relative;
}
/* 再取得中: 明細の上に半透明オーバーレイ + スピナー (モーダルは閉じない) */
.refetch-overlay {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.6rem;
  background: rgba(255, 255, 255, 0.7);
}
.spinner {
  width: 2.2rem;
  height: 2.2rem;
  border: 3px solid #c7d2fe;
  border-top-color: #2563eb;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
.spinner-sm {
  display: inline-block;
  width: 1rem;
  height: 1rem;
  border-width: 2px;
  vertical-align: middle;
}
.btn-row-refetch {
  border: 0;
  background: transparent;
  cursor: pointer;
  font-size: 0.9rem;
  line-height: 1;
  padding: 0.1rem 0.2rem;
}
.btn-row-refetch:disabled {
  opacity: 0.3;
  cursor: default;
}
.refetch-text {
  font-size: 0.85rem;
  color: #2563eb;
  font-weight: 600;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.view-title {
  font-size: 1rem;
  margin: 1rem 0 0.5rem;
}
.lead-note {
  font-size: 0.85rem;
  color: #6b7280;
  margin: 0.25rem 0 1rem;
}
.grid {
  border-collapse: collapse;
  width: 100%;
  font-size: 0.85rem;
}
.grid th,
.grid td {
  border: 1px solid #e5e7eb;
  padding: 0.3rem 0.5rem;
  text-align: left;
}
.grid th {
  background: #f9fafb;
}
.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
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
.badge-diff {
  display: inline-block;
  padding: 0.05rem 0.45rem;
  border-radius: 0.25rem;
  font-size: 0.78rem;
  background: #fef3c7;
  color: #92400e;
}
.diff-nz {
  color: #b45309;
  font-weight: 600;
}
.skip-col {
  text-align: center;
}
.row-skipped {
  opacity: 0.5;
  text-decoration: line-through;
  background: #f9fafb;
}
/* 積み合わせ警告 (同じ売上日+車番+積地が複数行) */
.row-kumiawase {
  background: #fef9c3;
}
.warn-note {
  font-size: 0.78rem;
  color: #b45309;
}
.btn-refetch-inline {
  margin-left: 0.75rem;
  padding: 0.2rem 0.6rem;
  font-size: 0.78rem;
  border: 0;
  border-radius: 0.375rem;
  background: #2563eb;
  color: #fff;
  cursor: pointer;
  vertical-align: middle;
}
.btn-refetch-inline:hover {
  background: #1d4ed8;
}
.btn-refetch-inline:disabled {
  background: #93c5fd;
  cursor: default;
}
.btn-debug-inline {
  margin-left: 0.75rem;
  padding: 0.2rem 0.6rem;
  font-size: 0.78rem;
  border: 0;
  border-radius: 0.375rem;
  background: #6b7280;
  color: #fff;
  cursor: pointer;
  vertical-align: middle;
}
.btn-debug-inline:hover {
  background: #4b5563;
}
</style>
