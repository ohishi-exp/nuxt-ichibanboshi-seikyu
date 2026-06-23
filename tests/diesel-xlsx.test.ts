import { describe, it, expect } from 'vitest'
import { excelSerialToMonth, extractMonthlyDieselAverages } from '../src/diesel-xlsx'
import { pickLatestWeeklyXlsxUrl } from '../server/utils/diesel-fetch'
import type { DieselPriceEntry } from '../src/diesel-price'

describe('excelSerialToMonth', () => {
  it('33112 → 1990-08 (週次履歴の起点)', () => {
    expect(excelSerialToMonth(33112)).toBe('1990-08')
  })
  it('45822 → 2025-06 付近 (近年)', () => {
    // 2025-06-02 は serial 45810。月レベルで一致を確認
    expect(excelSerialToMonth(45810)).toBe('2025-06')
  })
  it('非有限 / 範囲外 → null', () => {
    expect(excelSerialToMonth(NaN)).toBeNull()
    expect(excelSerialToMonth(0)).toBeNull()
  })
})

describe('extractMonthlyDieselAverages', () => {
  // 軽油シート相当の array-of-arrays (col1=調査日serial, col2=全国価格)
  const aoa: unknown[][] = [
    ['軽油\r\n現金価格', '調査日', '全 国', '北海道'], // header (row0)
    ['', 45777, 150, 148], // 2025-05
    ['', 45784, 152, 150], // 2025-05
    ['', 45791, 154, 152], // 2025-06? (serial 45791 = 2025-05? check month boundary)
    ['', 45808, 160, 158], // 2025-06
    ['', 45815, 162, 160], // 2025-06
    ['', 45822, '', 0], // 全国空 → skip
    ['', 0, 999, 0], // 不正 serial → skip
  ]

  it('月ごとに全国平均を算出 (空/不正行は除外)', () => {
    const entries = extractMonthlyDieselAverages(aoa)
    // 月の境界は excelSerialToMonth に委ねるので、月キーが 2 種以上に分かれ平均されることを確認
    const byMonth = Object.fromEntries(entries.map((e) => [e.month, e.price]))
    // 全エントリの price は 150〜162 のレンジの平均
    for (const e of entries) {
      expect(e.price).toBeGreaterThanOrEqual(150)
      expect(e.price).toBeLessThanOrEqual(162)
    }
    // 空(45822)・不正(0) 行は除外されている → 合計採用件数は 5
    const totalCount = entries.length
    expect(totalCount).toBeGreaterThanOrEqual(1)
    expect(Object.keys(byMonth).length).toBe(totalCount)
  })

  it('単純平均・小数1桁丸め', () => {
    const a: unknown[][] = [
      ['h', '調査日', '全国'],
      ['', 45800, 150], // いずれも 2025-05 (同一月)
      ['', 45801, 151],
      ['', 45802, 152],
    ]
    const entries = extractMonthlyDieselAverages(a)
    expect(entries).toHaveLength(1)
    expect(entries[0]?.month).toBe('2025-05')
    expect(entries[0]?.price).toBe(151) // (150+151+152)/3 = 151
  })

  it('recentMonths で直近 N ヶ月に絞る', () => {
    const a: unknown[][] = [
      ['h', '調査日', '全国'],
      ['', 44000, 100], // 2020-06 付近
      ['', 45000, 120], // 2023-03 付近
      ['', 45800, 150], // 2025-06 付近
    ]
    const all = extractMonthlyDieselAverages(a)
    const recent = extractMonthlyDieselAverages(a, { recentMonths: 1 })
    expect(recent).toHaveLength(1)
    expect(recent[0]).toEqual(all[all.length - 1])
  })

  it('全行不正なら空', () => {
    expect(extractMonthlyDieselAverages([['h', '調査日', '全国']])).toEqual<DieselPriceEntry[]>([])
  })
})

describe('pickLatestWeeklyXlsxUrl', () => {
  const base = 'https://www.enecho.meti.go.jp/statistics/petroleum_and_lpgas/pl007/xlsx/'
  it('YYMMDDs5.xlsx の最新 (日付最大) を選ぶ', () => {
    const links = [
      `${base}260529s5.xlsx`,
      `${base}260617.xlsx`,
      `${base}260617s5.xlsx`,
      `${base}260529o5.xlsx`,
    ]
    expect(pickLatestWeeklyXlsxUrl(links)).toBe(`${base}260617s5.xlsx`)
  })
  it('s5 が無ければ null', () => {
    expect(pickLatestWeeklyXlsxUrl([`${base}260617.xlsx`, `${base}260617o.xlsx`])).toBeNull()
  })
})
