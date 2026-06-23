// 締め日別 (請求月) の取引先サマリを計算エンジンの結果から組み立てる純粋関数。Refs #11
//
// computeSurcharge の SurchargeResult[] を取引先 (取引先コード) 単位に集計し、
// 金額 (運賃合計=実請求) / サーチャージ金額 (計算) / 登録有無 / 差額 を出す。
// 差額 = 実請求との差。一番星は燃料サーチャージを別建てで返さない (= 実請求サーチャージ 0)
//        ため、差額 = 計算サーチャージ合計 (= 現状の請求に未計上で、今後請求すべき額)。

import type { SurchargeResult } from './surcharge'

export interface ShimebiCustomerRow {
  customerCode: string
  customerName: string
  /** 運賃合計 (実請求) */
  fareTotal: number
  /** 計算サーチャージ合計 (ok 行のみ。対象外/警告は 0) */
  surchargeTotal: number
  /** サーチャージマスタ登録有無 */
  registered: boolean
  /** 差額 = 実請求との差 (= surchargeTotal、実請求サーチャージ 0 前提) */
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
        registered: isRegistered(code),
        diff: 0,
        warningCount: 0,
      }
      map.set(code, agg)
    }
    agg.fareTotal += r.row.unchin
    agg.surchargeTotal += r.amount
    if (r.status === 'warning') agg.warningCount += 1
    if (!agg.customerName && r.row.tokuiName) agg.customerName = r.row.tokuiName
  }
  for (const agg of map.values()) {
    // 差額 = 実請求との差。実請求サーチャージ 0 前提 → 計算サーチャージ合計。
    agg.diff = agg.surchargeTotal
  }
  return [...map.values()].sort((a, b) => a.customerCode.localeCompare(b.customerCode))
}
