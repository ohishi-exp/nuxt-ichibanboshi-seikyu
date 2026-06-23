// 燃料サーチャージ計算エンジン
//
// 確定ルール (Refs ohishi-exp/nuxt-ichibanboshi-seikyu#4 / 届出書方式 #11-C):
//   上昇額         = 段階テーブル参照 (5 円刻みの代表価格 − 基準価格、中点 2.5 倍数)
//   行サーチャージ = ceil( 上昇額 × 距離km ÷ 燃費km/L )         (円単位切り上げ・係数1・1行1台・片道・最低額なし)
//   基準価格は全社共通、当月 = 売上年月日 の月
//   集計           = 得意先C × 入金予定日(請求日)              (多締も自動分割)
//   距離未取得 / 燃費未定義 / 当月価格なし → 未計上＋警告
//
// 段階テーブル (届出書 `条件設定シート` の正式方式、Refs #11):
//   区間 (base + step·k, base + step·(k+1)] の上昇額 = step·k + step/2  (k = 0,1,2,…)
//   軽油価格が基準価格以下なら廃止扱い → 上昇額 0。
//   端数処理は円単位の切り上げ (ceil) — 官公庁提出の届出書に合わせる。
//
// 計算式に運賃 (unchin) は使わない (参考保持のみ)。
// マスタ (基準価格・刻み幅・軽油価格・燃費・県庁間距離) は呼び出し側が注入する純粋関数として
// 実装する (実マスタの整備は #1 / #2、producer 連携は #3)。

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
  /** 傭車先C ('000000' なら自車、それ以外は傭車)。計算には使わない表示用 */
  subcontractorCode?: string
}

/**
 * 車種別燃費 km/L の引き方。
 * - `Record<車種C, number>`: 期間を問わない単一値 (簡易・テスト用)
 * - 関数: (車種C, 売上年月日 YYYY-MM-DD) → km/L。有効期間つきマスタ
 *   (src/fuel-efficiency.ts の `toEfficiencyLookup`) を渡す本番経路
 * いずれも未定義 or 0 以下 → 警告 (未計上)。
 */
export type FuelEfficiencyLookup =
  | Record<string, number>
  | ((sharuC: string, date: string) => number | undefined)

export interface SurchargeMasters {
  /** 基準燃料価格 (全社共通) */
  basePrice: number
  /** 改定する刻み幅 (円/L)。届出書既定は 5。省略時 5 */
  priceStep?: number
  /** "YYYY-MM" -> 当月全国平均軽油価格。無ければ当月価格なし → 警告 */
  monthlyDieselPrice: Record<string, number>
  /** 車種別燃費 km/L (単一値 Record か、有効期間つき lookup 関数)。未定義 or 0 以下 → 警告 */
  fuelEfficiency: FuelEfficiencyLookup
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
  /** 段階テーブル由来の燃料価格上昇額 (円/L)。基準価格以下なら 0 */
  increment?: number
  km?: number
  efficiency?: number
  /** status==='warning' の理由 */
  warning?: string
}

const PREF_UNMAPPED = '?'

/** 刻み幅の既定値 (届出書 `条件設定シート` の 5 円/L) */
const DEFAULT_PRICE_STEP = 5

/** 売上年月日 (YYYY-MM-DD) から当月キー (YYYY-MM) を取り出す */
function monthKey(date: string): string {
  return date.slice(0, 7)
}

/**
 * 段階テーブルの上昇額 (円/L) を返す。届出書 `条件設定シート` の正式方式。
 *   区間 (base + step·k, base + step·(k+1)] → 上昇額 = step·k + step/2  (k = 0,1,2,…)
 *   軽油価格が基準価格以下 → 廃止扱いで 0。
 */
export function surchargeIncrement(
  monthlyPrice: number,
  basePrice: number,
  step: number = DEFAULT_PRICE_STEP,
): number {
  if (step <= 0) return 0
  if (monthlyPrice <= basePrice) return 0
  const k = Math.ceil((monthlyPrice - basePrice) / step) - 1
  return step * k + step / 2
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

  const efficiency =
    typeof m.fuelEfficiency === 'function'
      ? m.fuelEfficiency(row.sharuC, row.uriageDate)
      : m.fuelEfficiency[row.sharuC]
  if (efficiency === undefined || efficiency <= 0) {
    return {
      row,
      status: 'warning',
      amount: 0,
      warning: `燃費未定義 (車種C=${row.sharuC})`,
    }
  }

  const increment = surchargeIncrement(monthly, m.basePrice, m.priceStep)
  const amount = Math.ceil((increment * km) / efficiency)
  return { row, status: 'ok', amount, increment, km, efficiency }
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
