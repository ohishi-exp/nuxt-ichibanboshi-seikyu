// 締め日別 (請求月) の取引先サマリを計算エンジンの結果から組み立てる純粋関数。Refs #11
//
// computeSurcharge の SurchargeResult[] を取引先 (取引先コード) 単位に集計し、
// 金額 (運賃合計=実請求) / サーチャージ金額 (計算) / 実額 (割増C=19) / 登録有無 / 差額 を出す。
// 差額 = 計算サーチャージ合計 − 実額サーチャージ合計 (割増C=19、producer #26 の fuel_surcharge)。
//        正 = 現状の請求に未計上で今後請求すべき額 / 負 = 過計上 / 0 = 一致。

import type { SurchargeResult } from './surcharge'

export interface ShimebiCustomerRow {
  customerCode: string
  customerName: string
  /** 運賃合計 (実請求) */
  fareTotal: number
  /** 計算サーチャージ合計 (ok 行のみ。対象外/警告は 0) */
  surchargeTotal: number
  /** 実額サーチャージ合計 (割増C=19、producer #26 の fuel_surcharge) */
  actualTotal: number
  /** サーチャージマスタ登録有無 */
  registered: boolean
  /** 差額 = 計算サーチャージ合計 − 実額サーチャージ合計 (正=未計上 / 負=過計上 / 0=一致) */
  diff: number
  /** 未計上 (warning) 行数。距離/当月価格欠落で算定不能だった行の参考値 */
  warningCount: number
}

/**
 * SurchargeResult[] を取引先コード単位に集計し、取引先コード昇順で返す (純粋)。
 * `isRegistered` でサーチャージマスタ登録有無を判定する。
 */
export function aggregateByCustomer(
  results: SurchargeResult[],
  isRegistered: (code: string) => boolean,
): ShimebiCustomerRow[] {
  const map = new Map<string, ShimebiCustomerRow>()
  for (const r of results) {
    const code = r.row.tokuiC
    let agg = map.get(code)
    if (!agg) {
      agg = {
        customerCode: code,
        customerName: r.row.tokuiName ?? '',
        fareTotal: 0,
        surchargeTotal: 0,
        actualTotal: 0,
        registered: isRegistered(code),
        diff: 0,
        warningCount: 0,
      }
      map.set(code, agg)
    }
    agg.fareTotal += r.row.unchin
    if (r.status === 'ok') agg.surchargeTotal += r.amount
    agg.actualTotal += r.row.actualSurcharge ?? 0
    if (r.status === 'warning') agg.warningCount += 1
    if (!agg.customerName && r.row.tokuiName) agg.customerName = r.row.tokuiName
  }
  for (const agg of map.values()) {
    // 差額 = 計算サーチャージ合計 − 実額サーチャージ合計 (割増C=19)。
    agg.diff = agg.surchargeTotal - agg.actualTotal
  }
  return [...map.values()].sort((a, b) => a.customerCode.localeCompare(b.customerCode))
}
