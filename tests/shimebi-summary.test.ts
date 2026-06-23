import { describe, it, expect } from 'vitest'
import { aggregateByCustomer } from '../src/shimebi-summary'
import type { SurchargeResult, MeisaiRow } from '../src/surcharge'

function meisai(tokuiC: string, tokuiName: string, unchin: number): MeisaiRow {
  return {
    tokuiC,
    tokuiName,
    fromPref: '東京都',
    toPref: '大阪府',
    sharuC: '01',
    uriageDate: '2026-06-10',
    seikyuDate: '2026-07-31',
  } as MeisaiRow
}
function res(
  tokuiC: string,
  name: string,
  unchin: number,
  status: SurchargeResult['status'],
  amount: number,
): SurchargeResult {
  return { row: { ...meisai(tokuiC, name, unchin), unchin } as MeisaiRow, status, amount }
}

describe('aggregateByCustomer', () => {
  it('取引先コード単位に金額・サーチャージを集計、コード昇順', () => {
    const results: SurchargeResult[] = [
      res('B002', '乙社', 1000, 'ok', 50),
      res('A001', '甲社', 2000, 'ok', 80),
      res('A001', '甲社', 3000, 'ok', 120),
    ]
    const rows = aggregateByCustomer(results, () => false)
    expect(rows.map((r) => r.customerCode)).toEqual(['A001', 'B002']) // 昇順
    const a = rows[0]!
    expect(a.fareTotal).toBe(5000)
    expect(a.surchargeTotal).toBe(200)
    expect(a.diff).toBe(200) // 差額 = 実請求との差 = 計算サーチャージ
  })

  it('登録有無を isRegistered で判定', () => {
    const rows = aggregateByCustomer([res('A001', '甲社', 1000, 'ok', 50)], (c) => c === 'A001')
    expect(rows[0]?.registered).toBe(true)
  })

  it('warning 行は金額に含むがサーチャージ 0、warningCount に計上', () => {
    const rows = aggregateByCustomer(
      [
        res('A001', '甲社', 1000, 'ok', 50),
        res('A001', '甲社', 2000, 'warning', 0),
        res('A001', '甲社', 500, 'excluded', 0),
      ],
      () => false,
    )
    const a = rows[0]!
    expect(a.fareTotal).toBe(3500) // 全行の運賃
    expect(a.surchargeTotal).toBe(50) // ok のみ
    expect(a.warningCount).toBe(1)
  })

  it('空入力は空配列', () => {
    expect(aggregateByCustomer([], () => true)).toEqual([])
  })
})
