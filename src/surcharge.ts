// 燃料サーチャージ計算エンジン
//
// 確定ルール (Refs ohishi-exp/nuxt-ichibanboshi-seikyu#4):
//   価格差         = max(0, 当月全国平均軽油 − 基準価格)        (0止め)
//   行サーチャージ = round( 価格差 × 距離km ÷ 燃費km/L )        (係数1・1行1台・片道・最低額なし)
//   基準価格は全社共通、当月 = 売上年月日 の月
//   集計           = 得意先C × 入金予定日(請求日)              (多締も自動分割)
//   距離未取得 / 燃費未定義 / 当月価格なし → 未計上＋警告
//
// 計算式に運賃 (unchin) は使わない (参考保持のみ)。
// マスタ (基準価格・軽油価格・燃費・県庁間距離) は呼び出し側が注入する純粋関数として実装する
// (実マスタの整備は #1 / #2、producer 連携は #3)。

/** 運転日報明細 1 行 (producer = rust-ichibanboshi #3 の取得結果をマップしたもの) */
export interface MeisaiRow {
  /** 得意先C */
  tokuiC: string
  /** 得意先N (表示用) */
  tokuiName?: string
  /** 積地県 (正規化済み。未マップは '?') */
  fromPref: string
  /** 卸地県 (正規化済み。未マップは '?') */
  toPref: string
  /** 車種C ('00' は未設定) */
  sharuC: string
  /** 売上年月日 (YYYY-MM-DD) */
  uriageDate: string
  /** 運賃 (参考保持。計算式には使わない) */
  unchin: number
  /** 入金予定日 = 請求日 (YYYY-MM-DD) */
  seikyuDate: string
}

export interface SurchargeMasters {
  /** 基準燃料価格 (全社共通) */
  basePrice: number
  /** "YYYY-MM" -> 当月全国平均軽油価格。無ければ当月価格なし → 警告 */
  monthlyDieselPrice: Record<string, number>
  /** 車種C -> 燃費 km/L。未定義 or 0 以下 → 警告 */
  fuelEfficiency: Record<string, number>
  /**
   * 県庁間距離 km。キーは `積地県\t卸地県`。
   * 同県は 0 (km=0 → 額0)、未登録は警告。距離は対称とみなし逆順キーも参照する。
   */
  distanceKm: Record<string, number>
  /** サーチャージ対象得意先か。省略時は全件対象 */
  isTargetCustomer?: (tokuiC: string) => boolean
}

export type SurchargeStatus = 'ok' | 'warning' | 'excluded'

export interface SurchargeResult {
  row: MeisaiRow
  /** ok=計上 / warning=未計上(要確認) / excluded=対象外得意先 */
  status: SurchargeStatus
  /** status==='ok' 以外は 0 */
  amount: number
  priceDiff?: number
  km?: number
  efficiency?: number
  /** status==='warning' の理由 */
  warning?: string
}

const PREF_UNMAPPED = '?'

/** 売上年月日 (YYYY-MM-DD) から当月キー (YYYY-MM) を取り出す */
function monthKey(date: string): string {
  return date.slice(0, 7)
}

/** 県庁間距離を引く。未マップ県 → null (警告)、同県 → 0、対称参照あり */
function lookupKm(
  from: string,
  to: string,
  table: Record<string, number>,
): number | null {
  if (from === PREF_UNMAPPED || to === PREF_UNMAPPED) return null
  if (from === to) return 0
  const direct = table[`${from}\t${to}`]
  if (direct !== undefined) return direct
  const reverse = table[`${to}\t${from}`]
  if (reverse !== undefined) return reverse
  return null
}

/** 1 行のサーチャージを計算する */
export function computeRowSurcharge(
  row: MeisaiRow,
  m: SurchargeMasters,
): SurchargeResult {
  if (m.isTargetCustomer && !m.isTargetCustomer(row.tokuiC)) {
    return { row, status: 'excluded', amount: 0 }
  }

  const month = monthKey(row.uriageDate)
  const monthly = m.monthlyDieselPrice[month]
  if (monthly === undefined) {
    return { row, status: 'warning', amount: 0, warning: `当月価格なし (${month})` }
  }

  const km = lookupKm(row.fromPref, row.toPref, m.distanceKm)
  if (km === null) {
    return {
      row,
      status: 'warning',
      amount: 0,
      warning: `距離未取得 (${row.fromPref}→${row.toPref})`,
    }
  }

  const efficiency = m.fuelEfficiency[row.sharuC]
  if (efficiency === undefined || efficiency <= 0) {
    return {
      row,
      status: 'warning',
      amount: 0,
      warning: `燃費未定義 (車種C=${row.sharuC})`,
    }
  }

  const priceDiff = Math.max(0, monthly - m.basePrice)
  const amount = Math.round((priceDiff * km) / efficiency)
  return { row, status: 'ok', amount, priceDiff, km, efficiency }
}

/** 得意先C × 入金予定日(請求日) の集計行 */
export interface AggregateRow {
  tokuiC: string
  tokuiName?: string
  seikyuDate: string
  /** 計上 (ok) 行数 */
  count: number
  /** 合計サーチャージ額 */
  amount: number
}

/** ok 行のみを 得意先C × 入金予定日 で集計する (多締は seikyuDate 差で自動分割) */
export function aggregate(results: SurchargeResult[]): AggregateRow[] {
  const map = new Map<string, AggregateRow>()
  for (const r of results) {
    if (r.status !== 'ok') continue
    const key = `${r.row.tokuiC}\t${r.row.seikyuDate}`
    let agg = map.get(key)
    if (!agg) {
      agg = {
        tokuiC: r.row.tokuiC,
        tokuiName: r.row.tokuiName,
        seikyuDate: r.row.seikyuDate,
        count: 0,
        amount: 0,
      }
      map.set(key, agg)
    }
    agg.count += 1
    agg.amount += r.amount
  }
  return [...map.values()].sort((a, b) =>
    a.tokuiC === b.tokuiC
      ? a.seikyuDate.localeCompare(b.seikyuDate)
      : a.tokuiC.localeCompare(b.tokuiC),
  )
}

export interface SurchargeSummary {
  results: SurchargeResult[]
  aggregates: AggregateRow[]
  /** ok 合計額 */
  total: number
  /** 未計上 (要確認) 行 */
  warnings: SurchargeResult[]
}

/** 明細行群を一括計算し、明細結果・集計・合計・警告をまとめて返す */
export function computeSurcharge(
  rows: MeisaiRow[],
  m: SurchargeMasters,
): SurchargeSummary {
  const results = rows.map((r) => computeRowSurcharge(r, m))
  const aggregates = aggregate(results)
  const total = aggregates.reduce((sum, a) => sum + a.amount, 0)
  const warnings = results.filter((r) => r.status === 'warning')
  return { results, aggregates, total, warnings }
}
