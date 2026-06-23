<script setup lang="ts">
// 締め日別 取引先の「明細 + 計算根拠」表。締め日別画面 (下/右/モーダル) と
// 別タブページ (pages/shimebi-detail.vue) で共有する。Refs #11
import type { SurchargeResult } from '../../src/surcharge'

const props = defineProps<{
  code: string
  name: string
  date: string
  rows: SurchargeResult[]
  /** "YYYY-MM" -> 当月軽油価格 (円/L) */
  dieselMap: Record<string, number>
}>()

function dieselPriceForRow(uriageDate: string): number | null {
  return props.dieselMap[uriageDate.slice(0, 7)] ?? null
}
</script>

<template>
  <div>
    <h3 class="view-title">
      明細・計算根拠 — {{ code }} {{ name }}（締め日 {{ date }}）
    </h3>
    <p class="lead-note">
      サーチャージ = 切上(距離 km ÷ 燃費 km/L × 上昇額 円/L)。上昇額は当月軽油価格を段階表に当てた値
      (基準価格以下は 0)。未計上は距離/当月価格の欠落が理由です。
    </p>
    <table class="grid">
      <thead>
        <tr>
          <th>売上日</th><th>積地</th><th>卸地</th><th>車種</th><th>運賃</th>
          <th>当月軽油 (円/L)</th><th>上昇額 (円/L)</th><th>距離 (km)</th>
          <th>燃費 (km/L)</th><th>サーチャージ (円)</th><th>状態</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(d, i) in rows" :key="i">
          <td>{{ d.row.uriageDate }}</td>
          <td>{{ d.row.fromPref }}</td>
          <td>{{ d.row.toPref }}</td>
          <td>{{ d.row.sharuC }}</td>
          <td class="num">{{ d.row.unchin.toLocaleString() }}</td>
          <td class="num">{{ dieselPriceForRow(d.row.uriageDate) ?? '—' }}</td>
          <td class="num">{{ d.increment ?? '—' }}</td>
          <td class="num">{{ d.km ?? '—' }}</td>
          <td class="num">{{ d.efficiency ?? '—' }}</td>
          <td class="num">{{ d.amount.toLocaleString() }}</td>
          <td>
            <span v-if="d.status === 'ok'" class="badge-on">計上</span>
            <span v-else-if="d.status === 'warning'" class="warn-note">{{ d.warning }}</span>
            <span v-else class="badge-off">対象外</span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
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
.warn-note {
  font-size: 0.78rem;
  color: #b45309;
}
</style>
