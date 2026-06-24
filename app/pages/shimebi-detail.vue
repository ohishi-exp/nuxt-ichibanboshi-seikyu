<script setup lang="ts">
// 締め日別 取引先 明細の「別タブ表示」用 standalone ページ。Refs #11
//
// 親画面 (pages/index.vue) が「別タブ」モードで取引先名クリック時に、明細データを
// localStorage (SHIMEBI_DETAIL_PAYLOAD_KEY) に書き出して window.open する。
// 本ページはそれを読み出して ShimebiDetail で描画するだけ (API 再取得しない)。
import type { SurchargeResult } from '../../src/surcharge'
import { SHIMEBI_DETAIL_PAYLOAD_KEY } from '../../src/shimebi-detail-key'

interface DetailPayload {
  code: string
  name: string
  date: string
  rows: SurchargeResult[]
  dieselMap: Record<string, number>
  skippedRowIds?: string[]
}

const payload = ref<DetailPayload | null>(null)
const error = ref('')
const skippedRowIds = ref<Set<string>>(new Set())

onMounted(() => {
  try {
    const raw = localStorage.getItem(SHIMEBI_DETAIL_PAYLOAD_KEY)
    if (!raw) {
      error.value = '表示データがありません (締め日別画面の取引先名から開いてください)'
      return
    }
    const p = JSON.parse(raw) as DetailPayload
    payload.value = p
    skippedRowIds.value = new Set(p.skippedRowIds ?? [])
  } catch {
    error.value = '表示データの読込に失敗しました'
  }
})

// 別タブでも skip を永続化できるよう、API を直接叩いてローカル集合を更新する。
async function onToggleSkip(rowId: string) {
  if (!rowId) return
  const wasSkipped = skippedRowIds.value.has(rowId)
  try {
    if (wasSkipped) {
      await $fetch('/api/surcharge-skips', { method: 'DELETE', query: { rowId } })
      skippedRowIds.value.delete(rowId)
    } else {
      const r = payload.value?.rows.find((x) => x.row.rowId === rowId)
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
    skippedRowIds.value = new Set(skippedRowIds.value)
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : 'skip 更新に失敗しました'
  }
}

useHead({ title: '締め日別 明細' })
</script>

<template>
  <div class="detail-page">
    <p v-if="error" class="err">{{ error }}</p>
    <ShimebiDetail
      v-else-if="payload"
      :code="payload.code"
      :name="payload.name"
      :date="payload.date"
      :rows="payload.rows"
      :diesel-map="payload.dieselMap"
      :skipped-row-ids="skippedRowIds"
      @toggle-skip="onToggleSkip"
    />
  </div>
</template>

<style scoped>
.detail-page {
  max-width: 1100px;
  margin: 1.5rem auto;
  padding: 0 1rem;
  font-family:
    system-ui,
    -apple-system,
    'Segoe UI',
    sans-serif;
}
.err {
  color: #b91c1c;
}
</style>
